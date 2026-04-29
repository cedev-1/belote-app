interface SeatBadgeProps {
  name: string
  team: 1 | 2
  teamName?: string
  elo?: number
  active?: boolean
  highlight?: boolean
  size?: 'sm' | 'md'
  avatarUrl?: string | null
  turnLabel?: string | null
}

export function SeatBadge({ name, team, teamName, elo, active = false, highlight = true, size = 'sm', avatarUrl, turnLabel }: SeatBadgeProps) {
  const badge = (
    <div className={`salon-seat-badge ${active && highlight ? 'is-active' : ''}`}>
      <span
        className="salon-seat-avatar"
        style={{
          ...(size === 'md' ? { width: 38, height: 38, fontSize: 17 } : undefined),
          overflow: 'hidden', padding: avatarUrl ? 0 : undefined,
        }}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          : name[0]?.toUpperCase() ?? '?'
        }
      </span>
      <span className="salon-seat-meta">
        <span className="salon-seat-name">{name}</span>
        <span className="salon-seat-sub">
          <span className={`salon-team-pip salon-team-${team}`} />
          {teamName ?? `Éq.${team}`}
        </span>
        {elo != null && (
          <span style={{ fontSize: 12, color: 'var(--brass)', fontFamily: "'Fraunces', serif", fontWeight: 600, letterSpacing: '0.02em' }}>
            Elo {elo}
          </span>
        )}
      </span>
    </div>
  )

  if (!turnLabel) return badge

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <span style={{
        fontSize: 10, fontFamily: 'Fraunces, serif', fontStyle: 'italic',
        color: 'var(--brass-soft)', letterSpacing: '0.04em',
        animation: 'salonTagPulse 2s ease-in-out infinite',
      }}>
        {turnLabel}
      </span>
      {badge}
    </div>
  )
}
