import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { AppHeader } from '../components/AppHeader'
import { Stat } from '../components/Stat'
import type { Player } from '../types'

export default function PublicProfilePage() {
  const { id: userId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Player | null>(null)

  useEffect(() => {
    if (!userId) return
    supabase.from('profiles').select('*').eq('id', userId).single().then(({ data }) => {
      if (data) setProfile(data as Player)
    })
  }, [userId])

  if (!profile) {
    return (
      <div className="salon-root salon-loader-root">
        <AppHeader variant="subpage" onBack={() => navigate('/')} />
        <div className="salon-loader-spinner" />
      </div>
    )
  }

  const winRate = profile.games_played > 0 ? Math.round((profile.games_won / profile.games_played) * 100) : 0

  return (
    <div className="salon-root">
      <AppHeader variant="subpage" subtitle="Profil" onBack={() => navigate(-1 as any)} />
      <main className="salon-page-main salon-profile-main">
        <section className="salon-card-panel salon-profile-hero">
          <div className="salon-avatar-upload" style={{ cursor: 'default' }}>
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="" />
              : <span className="salon-avatar-letter">{profile.display_name[0]?.toUpperCase()}</span>
            }
          </div>
          <div className="salon-profile-id">
            <h1 className="salon-profile-name">{profile.display_name}</h1>
          </div>
          <div className="salon-profile-elo">
            <span className="salon-score-label">ELO</span>
            <span className="salon-profile-elo-num">{profile.elo}</span>
          </div>
        </section>

        <section className="salon-stats-grid">
          <Stat label="Parties" value={profile.games_played} />
          <Stat label="Victoires" value={profile.games_won} highlight />
          <Stat label="Défaites" value={profile.games_played - profile.games_won} />
          <Stat label="Taux de victoire" value={`${winRate}%`} highlight={winRate >= 50} />
        </section>
      </main>
    </div>
  )
}

