import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useSocket } from '../hooks/useSocket'
import type { Player } from '../types'

const ELO_MEDALS = ['I', 'II', 'III']

export default function HomePage() {
  const { user, signOut } = useAuth()
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
    return () => { socket.off('players:online') }
  }, [socket])

  const fetchLeaderboard = async () => {
    const { data } = await supabase.from('profiles').select('*').order('elo', { ascending: false }).limit(10)
    if (data) setLeaderboard(data as Player[])
  }

  const fetchOpenGames = async () => {
    const { data } = await supabase
      .from('games').select('*, game_players(player_id, team, position, profiles(id, display_name, elo, avatar_url))')
      .eq('status', 'waiting').order('created_at', { ascending: false })
    if (data) setOpenGames(data)
  }

  const createGame = async () => {
    if (!user) return
    setLoadingCreate(true)
    try {
      const { data: game, error } = await (supabase.from('games') as any)
        .insert({ status: 'waiting', team1_score: 0, team2_score: 0, winning_team: null, created_by: user.id })
        .select().single()
      if (error) throw error
      await supabase.from('game_players').insert({
        game_id: game.id, player_id: user.id, team: 1, position: 1,
        elo_before: leaderboard.find((p) => p.id === user.id)?.elo ?? 1000,
      })
      navigate(`/game/${game.id}`)
    } finally { setLoadingCreate(false) }
  }

  const joinGame = async (game: any) => {
    if (!user) return
    navigate(`/game/${game.id}`)
  }

  const deleteGame = async (gameId: string) => {
    const { error: e1 } = await supabase.from('game_players').delete().eq('game_id', gameId)
    if (e1) { console.error('game_players delete:', e1); return }
    const { error: e2 } = await supabase.from('games').delete().eq('id', gameId)
    if (e2) { console.error('games delete:', e2); return }
    fetchOpenGames()
  }

  return (
    <div className="salon-root" style={{ minHeight: '100vh' }}>
      <div className="salon-ornament tl" /><div className="salon-ornament tr" />
      <div className="salon-ornament bl" /><div className="salon-ornament br" />

      <header className="salon-topbar">
        <span className="salon-title-main" style={{ color: 'var(--brass-soft)', justifySelf: 'start' }}>
          Salon principal
        </span>
        <div />
        <div style={{ justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => {
              const url = window.location.href
              window.open(url, 'belote_window', 'width=1024,height=768,resizable=yes,menubar=no,toolbar=no,location=no,status=no')
            }}
            className="salon-ghost-btn"
            title="Ouvrir dans une fenêtre dédiée"
            style={{ fontSize: 16, padding: '8px 12px' }}
          >
            ⊡
          </button>
          <button onClick={() => navigate('/profile')} className="salon-ghost-btn">Mon profil</button>
          <button onClick={() => signOut()} className="salon-ghost-btn">Déconnexion</button>
        </div>
      </header>

      <main className="salon-home-main">
        {/* LEFT column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Hero CTA */}
          <section className="salon-card-panel salon-hero">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <span className="salon-title-eyebrow">Nouvelle table</span>
                <h2 style={{ margin: '4px 0 6px', fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 500, color: 'var(--ink)' }}>
                  Prêt pour une partie&nbsp;?
                </h2>
                <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>
                  Crée une table, invite trois collègues, distribue.
                </p>
              </div>
              <button onClick={createGame} disabled={loadingCreate} className="salon-primary-btn">
                {loadingCreate ? 'Création…' : '+ Créer une partie'}
              </button>
            </div>
          </section>

          {/* Open tables */}
          <section className="salon-card-panel">
            <div className="salon-panel-head">
              <h2 className="salon-panel-title">Parties en attente</h2>
              <span className="salon-panel-meta">{openGames.length} table{openGames.length > 1 ? 's' : ''}</span>
            </div>
            {openGames.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13, padding: '36px 0', margin: 0 }}>
                Aucune partie ouverte — sois le premier à dresser une table.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {openGames.map((game: any) => {
                  const playerCount = game.game_players?.length ?? 0
                  const isInGame = game.game_players?.some((gp: any) => gp.player_id === user?.id)
                  const isFull = playerCount >= 4
                  const isOwner = game.created_by === user?.id
                  return (
                    <div key={game.id} className="salon-game-row">
                      <div className="salon-game-seats">
                        {Array.from({ length: 4 }).map((_, i) => {
                          const filled = i < playerCount
                          const player = game.game_players?.[i]
                          const avatarUrl = player?.profiles?.avatar_url
                          return (
                            <div key={i} className={`salon-seat-chip ${filled ? 'is-filled' : ''}`}
                              title={player?.profiles?.display_name ?? 'Place libre'}
                              style={{ overflow: 'hidden', padding: avatarUrl ? 0 : undefined }}>
                              {filled
                                ? avatarUrl
                                  ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  : (player?.profiles?.display_name?.[0]?.toUpperCase() ?? '?')
                                : ''}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                          Table de {game.game_players?.[0]?.profiles?.display_name ?? 'joueur'}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-soft)' }}>
                          {playerCount}/4 joueurs · {new Date(game.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <button
                        onClick={() => joinGame(game)}
                        disabled={isFull && !isInGame}
                        className={isInGame || isFull ? 'salon-secondary-btn' : 'salon-primary-btn'}
                      >
                        {isInGame ? 'Rejoindre' : isFull ? 'Complète' : 'Rejoindre'}
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => deleteGame(game.id)}
                          className="salon-ghost-btn"
                          title="Supprimer cette partie"
                          style={{ padding: '8px 10px', color: '#e98e8e', borderColor: 'rgba(233,142,142,0.25)' }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Online players */}
          <section className="salon-card-panel">
            <div className="salon-panel-head">
              <h2 className="salon-panel-title">Au comptoir</h2>
              <span className="salon-panel-meta">{onlinePlayers.length} en ligne</span>
            </div>
            {onlinePlayers.length === 0 ? (
              <p style={{ color: 'var(--ink-faint)', fontSize: 13, margin: 0 }}>
                Personne pour l'instant. Le bar reste ouvert.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {onlinePlayers.map((p) => (
                  <div key={p.id} className="salon-online-chip">
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      : <span className="salon-online-dot" />
                    }
                    <span>{p.display_name}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT column — Leaderboard */}
        <aside className="salon-card-panel" style={{ alignSelf: 'start' }}>
          <div className="salon-panel-head">
            <h2 className="salon-panel-title">Classement Elo</h2>
            <span className="salon-panel-meta">Top 10</span>
          </div>
          {leaderboard.length === 0 ? (
            <p style={{ color: 'var(--ink-faint)', fontSize: 13, margin: 0 }}>Aucun joueur encore.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {leaderboard.map((p, i) => (
                <div key={p.id} className={`salon-leader-row ${p.id === user?.id ? 'is-me' : ''}`}>
                  <span className={`salon-leader-rank ${i < 3 ? `salon-medal-${i + 1}` : ''}`}>
                    {i < 3 ? ELO_MEDALS[i] : `${i + 1}`}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.display_name}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-soft)' }}>
                      {p.games_played} partie{p.games_played !== 1 ? 's' : ''} · {p.games_won ?? 0} gagnée{(p.games_won ?? 0) > 1 ? 's' : ''}
                    </p>
                  </div>
                  <span className="salon-leader-elo">{p.elo}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}
