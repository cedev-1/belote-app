import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Logo } from './Logo'

// ── Icons ──
function IconHistory()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8.5L10.5 10.5"/></svg> }
function IconProfile()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="5.5" r="2.8"/><path d="M2.5 14.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2"/></svg> }
function IconLogout()    { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2.5H3.5A1 1 0 0 0 2.5 3.5v9a1 1 0 0 0 1 1H6"/><path d="M10.5 11L13.5 8 10.5 5"/><path d="M13.5 8H6.5"/></svg> }
function IconBurger()    { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/></svg> }
function IconClose()     { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg> }
function IconPopout()    { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3.5" width="11" height="9" rx="1.2"/><path d="M9 7L13.5 2.5M13.5 2.5H10M13.5 2.5V6"/></svg> }
function IconBack()      { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5"/></svg> }

interface AppHeaderProps {
  variant?: 'default' | 'subpage'
  subtitle?: string
  onBack?: () => void
}

export function AppHeader({ variant = 'default', subtitle, onBack }: AppHeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])
  // Lock body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const popOut = () => {
    window.open(window.location.href, 'belote_window', 'width=1280,height=820,resizable=yes,menubar=no,toolbar=no,location=no,status=no')
  }

  return (
    <>
      <header className="salon-appheader">
        {/* Left: logo or back */}
        <div className="salon-appheader-left">
          {variant === 'subpage' ? (
            <button onClick={onBack ?? (() => navigate('/'))} className="salon-ghost-btn">
              <IconBack />
              <span className="salon-hide-xs">Retour</span>
            </button>
          ) : (
            <Logo size={28} showWordmark onClick={() => navigate('/')} />
          )}
          {subtitle && <span className="salon-appheader-sub">{subtitle}</span>}
        </div>

        {/* Right: nav (desktop) */}
        <nav className="salon-appheader-nav">
          <button onClick={() => navigate('/history')} className="salon-ghost-btn">
            <IconHistory /><span>Historique</span>
          </button>
          <button onClick={() => navigate('/profile')} className="salon-ghost-btn">
            <IconProfile /><span>Mon profil</span>
          </button>
          <button onClick={() => signOut()} className="salon-ghost-btn">
            <IconLogout /><span>Déconnexion</span>
          </button>
        </nav>

        {/* Right: burger (mobile) */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="salon-icon-btn salon-appheader-burger"
          aria-label="Menu"
          aria-expanded={drawerOpen}
        >
          <IconBurger />
        </button>
      </header>

      {/* Drawer */}
      {drawerOpen && (
        <>
          <div className="salon-drawer-overlay" onClick={() => setDrawerOpen(false)} />
          <aside className="salon-drawer" role="dialog" aria-label="Menu">
            <div className="salon-drawer-head">
              <Logo size={26} showWordmark />
              <button onClick={() => setDrawerOpen(false)} className="salon-icon-btn" aria-label="Fermer">
                <IconClose />
              </button>
            </div>
            <nav className="salon-drawer-nav">
              <button onClick={() => { navigate('/'); setDrawerOpen(false) }} className="salon-drawer-link">
                <span className="salon-drawer-icon"><IconBack /></span>
                Salon principal
              </button>
              <button onClick={() => { navigate('/history'); setDrawerOpen(false) }} className="salon-drawer-link">
                <span className="salon-drawer-icon"><IconHistory /></span>
                Historique
              </button>
              <button onClick={() => { navigate('/profile'); setDrawerOpen(false) }} className="salon-drawer-link">
                <span className="salon-drawer-icon"><IconProfile /></span>
                Mon profil
              </button>
              <div className="salon-drawer-divider" />
              <button onClick={popOut} className="salon-drawer-link">
                <span className="salon-drawer-icon"><IconPopout /></span>
                Fenêtre dédiée
              </button>
              <button onClick={() => signOut()} className="salon-drawer-link salon-drawer-link-danger">
                <span className="salon-drawer-icon"><IconLogout /></span>
                Déconnexion
              </button>
            </nav>
          </aside>
        </>
      )}
    </>
  )
}
