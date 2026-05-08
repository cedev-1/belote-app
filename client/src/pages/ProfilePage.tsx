import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { AppHeader } from '../components/AppHeader'
import { Stat } from '../components/Stat'
import type { Player } from '../types'

export default function ProfilePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState<Player | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => {
      if (data) { setProfile(data as Player); setNewName(data.display_name) }
    })
  }, [user])

  const updateName = async () => {
    if (!user || !newName.trim()) return
    const { error } = await supabase.from('profiles').update({ display_name: newName.trim() }).eq('id', user.id)
    if (error) { setError(error.message); return }
    setProfile(p => p ? { ...p, display_name: newName.trim() } : p)
    setEditingName(false)
  }

  const uploadAvatar = async (file: File) => {
    if (!user) return
    setUploading(true); setError(null)
    try {
      const ext = file.name.split('.').pop()
      const path = `${user.id}/avatar.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = `${publicUrl}?t=${Date.now()}`
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id)
      setProfile(p => p ? { ...p, avatar_url: url } : p)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload échoué')
    } finally { setUploading(false) }
  }

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
      <AppHeader variant="subpage" subtitle="Mon profil" onBack={() => navigate('/')} />

      <main className="salon-page-main salon-profile-main">
        <section className="salon-card-panel salon-profile-hero">
          <label className="salon-avatar-upload" title="Changer l'avatar">
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="" />
              : <span className="salon-avatar-letter">{profile.display_name[0]?.toUpperCase()}</span>
            }
            <span className="salon-avatar-overlay">{uploading ? '…' : 'Modifier'}</span>
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} hidden />
          </label>

          <div className="salon-profile-id">
            {editingName ? (
              <div className="salon-profile-edit-row">
                <input
                  className="salon-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <button onClick={updateName} className="salon-primary-btn">Sauver</button>
                <button onClick={() => { setEditingName(false); setNewName(profile.display_name) }} className="salon-secondary-btn">Annuler</button>
              </div>
            ) : (
              <>
                <h1 className="salon-profile-name">{profile.display_name}</h1>
                <button onClick={() => setEditingName(true)} className="salon-link-btn">
                  <span className="salon-link-bullet" />
                  Renommer
                </button>
              </>
            )}
            {error && <p className="salon-form-error">{error}</p>}
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

        <div className="salon-profile-actions">
          <button onClick={() => navigate('/history')} className="salon-primary-btn">Voir l'historique</button>
        </div>
      </main>
    </div>
  )
}

