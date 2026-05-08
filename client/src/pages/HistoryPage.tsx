import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { AppHeader } from '../components/AppHeader'

interface HistoryEntry {
  id: string
  status: string
  team1_score: number
  team2_score: number
  winning_team: 1 | 2 | null
  created_at: string
  game_players: Array<{
    player_id: string
    team: 1 | 2
    elo_before: number
    elo_after?: number
    profiles: { id: string; display_name: string }
  }>
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    supabase
      .from('games')
      .select('*, game_players!inner(player_id, team, elo_before, elo_after, profiles(id, display_name))')
      .eq('status', 'finished')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) {
          const filtered = data.filter((g: any) => g.game_players.some((p: any) => p.player_id === user.id))
          setHistory(filtered as HistoryEntry[])
        }
        setLoading(false)
      })
  }, [user])

  return (
    <div className="salon-root">
      <AppHeader variant="subpage" subtitle="Historique" onBack={() => navigate('/')} />

      <main className="salon-page-main salon-history-main">
        <section className="salon-card-panel">
          <div className="salon-panel-head">
            <h1 className="salon-panel-title">Historique des parties</h1>
            <span className="salon-panel-meta">{history.length} partie{history.length > 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="salon-loader-spinner" style={{ margin: '40px auto' }} />
          ) : history.length === 0 ? (
            <div className="salon-history-empty">
              <p>Aucune partie pour l'instant.</p>
              <button onClick={() => navigate('/')} className="salon-primary-btn">Lancer une partie</button>
            </div>
          ) : (
            <div className="salon-history-list">
              {history.map((g) => {
                const me = g.game_players.find((p) => p.player_id === user?.id)
                if (!me) return null
                const won = g.winning_team === me.team
                const partner = g.game_players.find((p) => p.team === me.team && p.player_id !== user?.id)
                const opponents = g.game_players.filter((p) => p.team !== me.team)
                const myScore = me.team === 1 ? g.team1_score : g.team2_score
                const oppScore = me.team === 1 ? g.team2_score : g.team1_score
                const eloDelta = (me.elo_after ?? me.elo_before) - me.elo_before

                return (
                  <article key={g.id} className={`salon-history-row ${won ? 'is-win' : 'is-loss'}`}>
                    <div className="salon-history-result">
                      <span className="salon-history-badge">{won ? 'V' : 'D'}</span>
                      <span className="salon-history-date">
                        {new Date(g.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <div className="salon-history-teams">
                      <div className="salon-history-team">
                        <span className="salon-history-side-label">Vous</span>
                        <span className="salon-history-names">
                          {me.profiles.display_name}
                          {partner && <span> · {partner.profiles.display_name}</span>}
                        </span>
                      </div>
                      <span className="salon-history-vs">vs</span>
                      <div className="salon-history-team">
                        <span className="salon-history-side-label">Adverses</span>
                        <span className="salon-history-names">
                          {opponents.map((o) => o.profiles.display_name).join(' · ')}
                        </span>
                      </div>
                    </div>
                    <div className="salon-history-score">
                      <span className="salon-history-score-num">{myScore}</span>
                      <span className="salon-history-score-sep">–</span>
                      <span className="salon-history-score-num salon-history-score-loss">{oppScore}</span>
                    </div>
                    <div className={`salon-history-elo ${eloDelta >= 0 ? 'is-up' : 'is-down'}`}>
                      {eloDelta >= 0 ? '+' : ''}{eloDelta} ELO
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
