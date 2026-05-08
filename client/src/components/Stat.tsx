export function Stat({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`salon-stat-card ${highlight ? 'salon-stat-card--brass' : ''}`}>
      <span className="salon-score-label">{label}</span>
      <span className="salon-stat-num">{value}</span>
    </div>
  )
}
