interface SeatBadgeProps {
  name: string
  team?: 1 | 2
  elo?: number
  active?: boolean
}
export function SeatBadge({ name, team, elo, active = false }: SeatBadgeProps) {
  return (
    <div className={`salon-seat-badge ${active ? 'is-active' : ''}`}>
      <span className="salon-seat-avatar">
        {name?.[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="salon-seat-meta">
        <span className="salon-seat-name">{name}</span>
        {team && (
          <span className="salon-seat-team">
            <span className={`salon-team-pip salon-team-${team}`} />
            {`Équipe ${team}`}
          </span>
        )}
        {elo != null && (
          <span className="salon-seat-elo">{elo} Elo</span>
        )}
      </span>
    </div>
  )
}
