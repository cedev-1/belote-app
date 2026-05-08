import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useSocket } from '../hooks/useSocket'
import { AppHeader } from '../components/AppHeader'
import type { Player } from '../types'

const ELO_MEDALS = ['I', 'II', 'III']

function IconCrown() {
  return (
    <svg width="13" height="11" viewBox="0 0 13 11" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0, marginBottom: 1 }}>
      <path d="M1 8.5L2.5 2.5L5.5 5.5L6.5 1L7.5 5.5L10.5 2.5L12 8.5H1Z" />
      <rect x="1" y="8.5" width="11" height="2" rx="0.8" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="6" r="2.6"/>
      <path d="M3 14c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"/>
    </svg>
  )
}

export default function HomePage() {
  const { user } = useAuth()
  const { socket } = useSocket()
  const navigate = useNavigate()

  const [leaderboard, setLeaderboard] = useState<Player[]>([])
  const [openGames, setOpenGames] = useState<any[]>([])
  const [onlinePlayers, setOnlinePlayers] = useState<Player[]>([])
  const [loadingCreate, setLoadingCreate] = useState(false)

  useEffect(() => {
    fetchLeaderboard(); fetchOpenGames()
    const channel = supabase
      .channel('open-games')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, fetchOpenGames)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players' }, fetchOpenGames)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    if (!socket) return
    socket.on('players:online', (p: Player[]) => setOnlinePlayers(p))
    socket.on('games:updated', () => fetchOpenGames())
    return () => {
      socket.off('players:online')
      socket.off('games:updated')
    }
  }, [socket])

  const fetchLeaderboard = async () => {
    const { data } = await supabase.from('profiles').select('*').order('elo', { ascending: false }).limit(10)
    if (data) setLeaderboard(data as Player[])
  }

  const fetchOpenGames = async () => {
    const { data } = await supabase
      .from('games')
      .select('id, status, created_by, created_at, game_players(player_id, team, position, profiles(id, display_name, elo, avatar_url))')
      .in('status', ['waiting', 'in_progress']).order('created_at', { ascending: false })
    if (data) setOpenGames(data)
  }

  const createGame = async () => {
    if (!user) return
    setLoadingCreate(true)
    try {
      const { data: game, error } = await supabase
        .from('games')
        .insert({ status: 'waiting', team1_score: 0, team2_score: 0, winning_team: null, created_by: user.id })
        .select().single()
      if (error) throw error
      await supabase.from('game_players').insert({
        game_id: game.id, player_id: user.id, team: 1, position: 1,
        elo_before: leaderboard.find((p) => p.id === user.id)?.elo ?? 1000,
      })
      socket?.emit('games:refresh')
      navigate(`/game/${game.id}`)
    } finally { setLoadingCreate(false) }
  }

  const joinGame = (game: any) => {
    // In-progress games go directly to the play page; waiting games go via the lobby
    navigate(game.status === 'in_progress' ? `/game/${game.id}/play` : `/game/${game.id}`)
  }

  const deleteGame = (gameId: string) => {
    socket?.emit('game:delete', gameId)
  }

  return (
    <div className="salon-root">
      <AppHeader />

      <main className="salon-page-main salon-home-main">
        <div className="salon-home-grid">
          {/* ── HERO: poker-style table with open games centered ── */}
          <section className="salon-hero-table">
            <div className="salon-hero-eyebrow">À la table</div>
            <h1 className="salon-hero-title">
              {openGames.length === 0 ? "Personne n'a encore distribué" : `${openGames.length} table${openGames.length > 1 ? 's' : ''} en attente`}
            </h1>
            <p className="salon-hero-sub">
              {openGames.length === 0
                ? "Lance la première partie — trois collègues attendent ton signal."
                : "Choisis ta partie ou ouvre la tienne."}
            </p>

            <div className="salon-hero-actions">
              <button onClick={createGame} disabled={loadingCreate} className="salon-primary-btn salon-primary-btn--lg">
                {loadingCreate ? 'Création…' : 'Nouvelle partie'}
              </button>
            </div>

            {openGames.length > 0 && (
              <div className="salon-tables-list">
                {openGames.map((game: any) => {
                  const playerCount = game.game_players?.length ?? 0
                  const isInGame = game.game_players?.some((gp: any) => gp.player_id === user?.id)
                  const isFull = playerCount >= 4
                  const isOwner = game.created_by === user?.id
                  const isInProgress = game.status === 'in_progress'
                  const ownerName = game.game_players?.find((gp: any) => gp.player_id === game.created_by)?.profiles?.display_name
                                  ?? game.game_players?.[0]?.profiles?.display_name
                                  ?? 'Joueur'
                  // Hide games in progress if the user isn't a participant
                  if (isInProgress && !isInGame) return null
                  return (
                    <div key={game.id} className="salon-table-row">
                      <div className="salon-table-seats">
                        {Array.from({ length: 4 }).map((_, i) => {
                          const player = game.game_players?.[i]
                          const filled = !!player
                          const avatarUrl = player?.profiles?.avatar_url
                          return (
                            <div key={i} className={`salon-seat-chip ${filled ? 'is-filled' : ''}`}
                              title={player?.profiles?.display_name ?? 'Place libre'}>
                              {filled
                                ? avatarUrl
                                  ? <img src={avatarUrl} alt="" />
                                  : <span>{player.profiles?.display_name?.[0]?.toUpperCase() ?? '?'}</span>
                                : null}
                            </div>
                          )
                        })}
                      </div>
                      <div className="salon-table-meta">
                        <p className="salon-table-name">Table de {ownerName}</p>
                        <p className="salon-table-info">
                          {isInProgress ? 'En cours' : `${playerCount}/4 joueurs`} · {new Date(game.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="salon-table-actions">
                        <button
                          onClick={() => joinGame(game)}
                          disabled={!isInProgress && isFull && !isInGame}
                          className={isInGame || isFull ? 'salon-secondary-btn' : 'salon-primary-btn'}
                        >
                          {isInGame ? 'Reprendre' : isFull ? 'Complète' : 'Rejoindre'}
                        </button>
                        {isOwner && !isInProgress && (
                          <button
                            onClick={() => deleteGame(game.id)}
                            className="salon-icon-btn salon-icon-btn--danger"
                            title="Supprimer cette partie"
                            aria-label="Supprimer"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── SIDEBAR ── */}
          <aside className="salon-home-sidebar">
            {/* Online players */}
            <section className="salon-card-panel">
              <div className="salon-panel-head">
                <h2 className="salon-panel-title">
                  <IconUsers />
                  <span>En ligne</span>
                </h2>
                <span className="salon-panel-meta">{onlinePlayers.length}</span>
              </div>
              {onlinePlayers.length === 0 ? (
                <p className="salon-panel-empty">Personne pour l'instant.</p>
              ) : (
                <div className="salon-online-grid">
                  {onlinePlayers.map((p) => (
                    <div key={p.id} className="salon-online-chip">
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" />
                        : <span className="salon-online-dot" />
                      }
                      <span>{p.display_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Leaderboard */}
            <section className="salon-card-panel">
              <div className="salon-panel-head">
                <h2 className="salon-panel-title">Classement</h2>
                <span className="salon-panel-meta">Top 10</span>
              </div>
              {leaderboard.length === 0 ? (
                <p className="salon-panel-empty">Aucun joueur classé.</p>
              ) : (
                <div className="salon-leader-list">
                  {leaderboard.map((p, i) => (
                    <button
                      key={p.id}
                      onClick={() => p.id === user?.id ? navigate('/profile') : navigate(`/profile/${p.id}`)}
                      className={`salon-leader-row ${p.id === user?.id ? 'is-me' : ''}`}
                    >
                      <span className={`salon-leader-rank ${i < 3 ? `salon-medal-${i + 1}` : ''}`}>
                        {i < 3 ? ELO_MEDALS[i] : i + 1}
                      </span>
                      <div className="salon-leader-meta">
                        <p className="salon-leader-name">{p.display_name}</p>
                        <p className="salon-leader-info">
                          {p.games_played} partie{p.games_played !== 1 ? 's' : ''} · {p.games_won ?? 0}V
                        </p>
                      </div>
                      <span className="salon-leader-elo">
                        {i === 0 && <IconCrown />}
                        {p.elo}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
