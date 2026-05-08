import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Logo } from '../components/Logo'

export default function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setLoading(true)
    try {
      if (mode === 'login') await signIn(email, password)
      else                  await signUp(email, password, username)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    } finally { setLoading(false) }
  }

  return (
    <div className="salon-root salon-login-root">
      {/* Decorative background cards */}
      <div className="salon-login-deco" aria-hidden="true">
        <div className="salon-deco-card salon-deco-card--1">
          <span style={{ color: '#b1242b' }}>♥</span>
        </div>
        <div className="salon-deco-card salon-deco-card--2">
          <span>♠</span>
        </div>
        <div className="salon-deco-card salon-deco-card--3">
          <span style={{ color: '#b1242b' }}>♦</span>
        </div>
        <div className="salon-deco-card salon-deco-card--4">
          <span>♣</span>
        </div>
      </div>

      <div className="salon-login-wrap">
        <div className="salon-login-brand">
          <Logo size={56} />
          <h1 className="salon-login-title">
            <span className="salon-login-title-1">Tapons</span>
            <span className="salon-login-title-2">l'carton</span>
          </h1>
          <p className="salon-login-tagline">Capot, belote et facturation.</p>
        </div>

        <div className="salon-card-panel salon-login-card">
          <div className="salon-tabbar">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`salon-tab ${mode === 'login' ? 'is-active' : ''}`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`salon-tab ${mode === 'register' ? 'is-active' : ''}`}
            >
              Inscription
            </button>
          </div>

          <form onSubmit={handleSubmit} className="salon-form">
            {mode === 'register' && (
              <div className="salon-field">
                <label className="salon-field-label" htmlFor="login-username">Pseudo</label>
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="salon-input"
                  placeholder="votre_pseudo"
                  autoComplete="username"
                />
              </div>
            )}
            <div className="salon-field">
              <label className="salon-field-label" htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="salon-input"
                placeholder="vous@sellsy.com"
                autoComplete="email"
              />
            </div>
            <div className="salon-field">
              <label className="salon-field-label" htmlFor="login-password">Mot de passe</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="salon-input"
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {error && <p className="salon-form-error">{error}</p>}

            <button type="submit" disabled={loading} className="salon-primary-btn salon-form-submit">
              {loading ? 'Chargement…' : mode === 'login' ? 'Se connecter' : "Créer mon compte"}
            </button>
          </form>
        </div>

        <p className="salon-login-foot">
          Réservé aux compagnons de bureau · v1
        </p>
      </div>
    </div>
  )
}
