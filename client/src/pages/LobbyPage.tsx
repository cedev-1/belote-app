import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSocket } from '../hooks/useSocket'
import { AppHeader } from '../components/AppHeader'

interface GamePlayer {
  player_id: string
  position: 1 | 2 | 3 | 4
  team: 1 | 2
  profiles: { id: string; display_name: string; elo: number; avatar_url?: string | null }
}

interface GameData {
  id: string
  status: string
  created_by: string
  game_players: GamePlayer[]
}

const SEAT_LAYOUT: Array<{ pos: 1|2|3|4; cls: string; team: 1|2 }> = [
  { pos: 3, cls: 'salon-lobby-seat--n', team: 1 },
  { pos: 2, cls: 'salon-lobby-seat--w', team: 2 },
  { pos: 4, cls: 'salon-lobby-seat--e', team: 2 },
  { pos: 1, cls: 'salon-lobby-seat--s', team: 1 },
]


export default function LobbyPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { socket } = useSocket()

  const [game, setGame] = useState<GameData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [teamNames, setTeamNames] = useState<{ 1: string; 2: string }>({ 1: 'Équipe 1', 2: 'Équipe 2' })
  const [targetScore, setTargetScore] = useState(1000)
  const gameLoadedRef = useRef(false)

  const fetchGame = useCallback(async () => {
    if (!id) return
    const { data } = await supabase
      .from('games')
      .select('*, game_players(player_id, team, position, profiles(id, display_name, elo, avatar_url))')
      .eq('id', id)
      .single()
    if (data) {
      setGame(data as unknown as GameData)
      gameLoadedRef.current = true
    } else if (gameLoadedRef.current) {
      // Game was deleted — send everyone home
      navigate('/')
    }
  }, [id, navigate])

  useEffect(() => {
    fetchGame()
    if (!id) return
    const channel = supabase
      .channel(`lobby-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, fetchGame)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, fetchGame)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, fetchGame])

  useEffect(() => {
    if (!socket || !id) return
    socket.emit('game:join', id)
    socket.on('game:lobby_updated', fetchGame)
    socket.on('games:updated', fetchGame)
    socket.on('game:team_names', ({ gameId, names }: { gameId: string; names: { 1: string; 2: string } }) => {
      if (gameId === id) setTeamNames(names)
    })
    const handleStarted = () => navigate(`/game/${id}/play`)
    socket.on('game:started', handleStarted)
    // If the server already has an active game state (e.g. player rejoining mid-game), redirect immediately
    const handlePhase = ({ phase }: { phase: string }) => {
      if (phase !== 'waiting') navigate(`/game/${id}/play`)
    }
    socket.on('game:phase', handlePhase)
    return () => {
      socket.off('game:lobby_updated', fetchGame)
      socket.off('games:updated', fetchGame)
      socket.off('game:started', handleStarted)
      socket.off('game:team_names')
      socket.off('game:phase', handlePhase)
      socket.emit('game:leave', id)
    }
  }, [socket, id, fetchGame])

  // Auto-redirect when game starts
  useEffect(() => {
    if (game?.status === 'playing' || game?.status === 'in_progress') {
      navigate(`/game/${id}/play`)
    }
  }, [game?.status, id, navigate])

  const isInGame    = game?.game_players.some((p) => p.player_id === user?.id) ?? false
  const playerCount = game?.game_players.length ?? 0
  const isFull      = playerCount >= 4
  const isOwner     = game?.created_by === user?.id
  const canStart    = isOwner && isFull

  const teamOf = (pos: 1|2|3|4): 1|2 => (pos === 1 || pos === 3) ? 1 : 2

  const myRow = game?.game_players.find(p => p.player_id === user?.id)

  const nextOpenPosition = (): 1|2|3|4 => {
    if (!game) return 1
    const taken = new Set(game.game_players.map((p) => p.position))
    const team1Count = game.game_players.filter((p) => p.team === 1).length
    const order: Array<1|2|3|4> = team1Count <= 1 ? [1, 3, 2, 4] : [2, 4, 1, 3]
    return order.find((p) => !taken.has(p)) ?? 1
  }

  // Join an empty seat (not yet in game)
  const joinAtPosition = async (position: 1|2|3|4) => {
    if (!user || !game || isInGame || isFull || busy) return
    setBusy(true); setError(null)
    try {
      const team = teamOf(position)
      const { data: profile } = await supabase.from('profiles').select('elo').eq('id', user.id).single()
      const { error: err } = await supabase.from('game_players').insert({
        game_id: game.id, player_id: user.id, team, position, elo_before: profile?.elo ?? 1000,
      })
      if (err) {
        if (err.code === '23505') { await fetchGame(); return }
        throw err
      }
      socket?.emit('games:refresh')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de rejoindre la partie')
    } finally { setBusy(false) }
  }

  // Move to an empty seat — reuse swap_seats with self as both players won't work,
  // so delete+reinsert own row via server to keep service-role consistency
  const moveToPosition = (position: 1|2|3|4) => {
    if (!user || !game || !isInGame || busy) return
    socket?.emit('game:move_seat', game.id, user.id, position, teamOf(position), myRow?.profiles.elo ?? 1000)
  }

  // Swap seat with another player — done server-side to bypass RLS
  const swapWithPlayer = (targetPlayerId: string, _targetPos: 1|2|3|4) => {
    if (!user || !game || !myRow || busy) return
    socket?.emit('game:swap_seats', game.id, user.id, targetPlayerId)
  }

  const quickJoin = () => joinAtPosition(nextOpenPosition())

  const leave = async () => {
    if (!user || !game) return
    await supabase.from('game_players').delete().match({ game_id: game.id, player_id: user.id })
    socket?.emit('games:refresh')
    navigate('/')
  }

  const startGame = () => {
    if (!game || !canStart) return
    socket?.emit('game:set_team_names', game.id, teamNames)
    socket?.emit('game:start', game.id, targetScore)
  }

  const updateTeamName = (team: 1|2, name: string) => {
    const next = { ...teamNames, [team]: name }
    setTeamNames(next)
    socket?.emit('game:set_team_names', id, next)
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {/* ignore */}
  }

  if (!game) {
    return (
      <div className="salon-root salon-loader-root">
        <AppHeader variant="subpage" />
        <div className="salon-loader-spinner" />
      </div>
    )
  }

  return (
    <div className="salon-root">
      <AppHeader variant="subpage" subtitle={`Salle d'attente · ${playerCount}/4`} />

      <main className="salon-page-main salon-lobby-main">
        <div className="salon-lobby-table-wrap">

          {/* Table */}
          <div className="salon-lobby-table" role="group" aria-label="Table d'attente">
            <div className="salon-lobby-felt">
              <div className="salon-lobby-center">
                <p className="salon-lobby-center-eyebrow">{isFull ? 'Complète' : 'En attente'}</p>
                <p className="salon-lobby-center-count">{playerCount}<span>/ 4</span></p>
                {!isFull && (
                  <p className="salon-lobby-center-sub">
                    {playerCount === 1 ? 'Il manque 3 collègues' :
                     playerCount === 2 ? 'Il manque 2 collègues' : 'Il manque 1 collègue'}
                  </p>
                )}
              </div>
            </div>

            {SEAT_LAYOUT.map(({ pos, cls, team }) => {
              const player = game.game_players.find((p) => p.position === pos)
              const isMe = player?.player_id === user?.id

              const canSwap = !isMe && isInGame && !!myRow
              return (
                <div key={pos} className={`salon-lobby-seat ${cls} salon-lobby-seat--team-${team}`}>
                  {player ? (
                    <div className="salon-lobby-occupant-wrap">
                      <button
                        className={`salon-lobby-occupant ${isMe ? 'is-me' : ''} ${canSwap ? 'salon-lobby-swappable' : ''}`}
                        disabled={busy}
                        onClick={() => {
                          if (isMe || !canSwap) return
                          swapWithPlayer(player.player_id, pos)
                        }}
                      >
                        <span className="salon-lobby-avatar">
                          {player.profiles.avatar_url
                            ? <img src={player.profiles.avatar_url} alt="" />
                            : player.profiles.display_name[0]?.toUpperCase()}
                        </span>
                        <span className="salon-lobby-name">{player.profiles.display_name}</span>
                        <span className="salon-lobby-elo">{player.profiles.elo}</span>
                        <span className="salon-lobby-team-tag">{teamNames[team] || `Équipe ${team}`}</span>
                        {isMe && <span className="salon-lobby-you">Vous</span>}
                        {canSwap && <span className="salon-lobby-swap-hint">⇄ Échanger</span>}
                      </button>
                      {!isMe && (
                        <button
                          className="salon-lobby-profile-btn"
                          onClick={() => navigate(`/profile/${player.player_id}`)}
                          title="Voir le profil"
                          aria-label="Voir le profil"
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="8" cy="5.5" r="2.8"/><path d="M2.5 14.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2"/></svg>
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      className="salon-lobby-empty"
                      disabled={busy || (isFull && !isInGame)}
                      onClick={() => {
                        if (busy) return
                        if (isInGame) moveToPosition(pos)
                        else if (!isFull) joinAtPosition(pos)
                      }}
                      title={isInGame ? `Se déplacer en équipe ${team}` : `S'asseoir en équipe ${team}`}
                    >
                      <span className="salon-lobby-empty-plus">{isInGame ? '→' : '+'}</span>
                      <span className="salon-lobby-empty-label">{isInGame ? 'Prendre cette place' : 'Place libre'}</span>
                      <span className="salon-lobby-team-tag">{teamNames[team] || `Équipe ${team}`}</span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {error && <p className="salon-form-error">{error}</p>}

          {/* Game settings — owner only */}
          {isOwner && (
            <div className="salon-lobby-settings">
              {([1, 2] as const).map(team => (
                <div key={team} className="salon-lobby-settings-row">
                  <label className="salon-lobby-settings-label">
                    {team === 1 ? 'Nom de ton équipe' : "Nom de l'équipe adverse"}
                  </label>
                  <input
                    className="salon-input salon-input--sm"
                    value={teamNames[team]}
                    placeholder={`Équipe ${team}`}
                    maxLength={20}
                    onChange={e => updateTeamName(team, e.target.value)}
                  />
                </div>
              ))}
              <div className="salon-lobby-settings-row">
                <label className="salon-lobby-settings-label">Points requis</label>
                <div className="salon-lobby-slider-wrap">
                  <input
                    type="range"
                    className="salon-lobby-slider"
                    min={100} max={2000} step={100}
                    value={targetScore}
                    onChange={e => setTargetScore(Number(e.target.value))}
                    style={{ '--val': Math.round((targetScore - 100) / 1900 * 100) } as React.CSSProperties}
                  />
                  <span className="salon-lobby-slider-val">{targetScore} pts</span>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <footer className="salon-lobby-actions">
            {!isInGame && !isFull && (
              <button onClick={quickJoin} disabled={busy} className="salon-primary-btn salon-primary-btn--lg">
                {busy ? 'Installation…' : 'Prendre place'}
              </button>
            )}

            {isInGame && (
              <>
                {canStart && (
                  <button onClick={startGame} className="salon-primary-btn salon-primary-btn--lg">
                    Distribuer · lancer la partie
                  </button>
                )}
                {isOwner && !isFull && (
                  <p className="salon-lobby-hint">Partage le lien à tes collègues pour démarrer</p>
                )}
                <div className="salon-lobby-actions-row">
                  <button onClick={copyInvite} className="salon-secondary-btn">
                    {copied ? '✓ Lien copié' : 'Copier le lien'}
                  </button>
                  <button onClick={leave} className="salon-link-btn salon-link-btn--danger">
                    Quitter la table
                  </button>
                  {isOwner && (
                    <button
                      onClick={() => { socket?.emit('game:delete', id); navigate('/') }}
                      className="salon-link-btn salon-link-btn--danger"
                    >
                      Supprimer la partie
                    </button>
                  )}
                </div>
              </>
            )}

            {!isInGame && isFull && (
              <p className="salon-lobby-hint">Cette table est complète.</p>
            )}
          </footer>
        </div>
      </main>
    </div>
  )
}
