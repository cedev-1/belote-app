import type { Card, Suit } from '../../types'

export const SUIT_GLYPH: Record<Suit, string> = {
  hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663', spades: '\u2660',
}
export const SUIT_LABEL: Record<Suit, string> = {
  hearts: 'Cœur', diamonds: 'Carreau', clubs: 'Trèfle', spades: 'Pique',
}
const SUIT_IS_RED = (s: Suit) => s === 'hearts' || s === 'diamonds'
export function suitColor(suit: Suit) {
  return SUIT_IS_RED(suit) ? '#e26b6f' : '#f6f1e3'
}

interface CardFrontProps {
  card: Card
  onClick?: () => void
  selected?: boolean
  playable?: boolean
  disabled?: boolean
  faded?: boolean
  /** width:height ~ 1:1.42 — provide width via CSS var --card-w on parent if you want non-default */
  width?: number
}

export function CardFront({
  card, onClick, selected = false, playable = false, disabled = false, faded = false, width,
}: CardFrontProps) {
  const red = SUIT_IS_RED(card.suit)
  const inkColor = red ? '#b1242b' : '#1c1a16'
  const style: React.CSSProperties = {
    cursor: disabled ? 'default' : (onClick ? 'pointer' : 'default'),
    opacity: faded ? 0.55 : 1,
    transform: selected ? 'translateY(-14px)' : undefined,
    boxShadow: selected
      ? '0 18px 28px -10px rgba(0,0,0,0.55), 0 0 0 2px #c9a24b, 0 0 26px rgba(201,162,75,0.55)'
      : playable
        ? '0 8px 18px -8px rgba(0,0,0,0.55), 0 0 0 2px #c9a24b'
        : '0 6px 14px -6px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.06)',
  }
  if (width) {
    style.width = width
    style.height = width * 1.42
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(style as any)['--card-w'] = `${width}px`
  }

  return (
    <button onClick={onClick} disabled={disabled} className="salon-card-front" style={style} aria-label={`${card.value} de ${SUIT_LABEL[card.suit]}`}>
      <span className="salon-card-corner salon-card-corner-tl" style={{ color: inkColor }}>
        <span className="salon-card-idx">{card.value}</span>
        <span className="salon-card-idx-suit">{SUIT_GLYPH[card.suit]}</span>
      </span>
      <span className="salon-card-crest" style={{ color: inkColor, opacity: 0.92 }}>
        {SUIT_GLYPH[card.suit]}
      </span>
      <span className="salon-card-corner salon-card-corner-br" style={{ color: inkColor }}>
        <span className="salon-card-idx">{card.value}</span>
        <span className="salon-card-idx-suit">{SUIT_GLYPH[card.suit]}</span>
      </span>
    </button>
  )
}

interface CardBackProps {
  width?: number
}
export function CardBack({ width = 52 }: CardBackProps) {
  const h = width * 1.42
  return (
    <div className="salon-card-back" style={{ width, height: h, borderRadius: Math.max(4, width * 0.10) }}>
      <div className="salon-card-back-frame" />
      <div className="salon-card-back-mono" style={{ fontSize: Math.max(8, Math.round(width * 0.26)) }}>TC</div>
    </div>
  )
}

interface OpponentStackProps {
  count: number
  orientation?: 'row' | 'column'
  /** card back width in px */
  cardWidth?: number
}
export function OpponentStack({ count, orientation = 'row', cardWidth = 38 }: OpponentStackProps) {
  if (count <= 0) return null
  const isRow = orientation === 'row'
  const overlap = cardWidth * 0.55
  return (
    <div style={{ display: 'flex', flexDirection: isRow ? 'row' : 'column' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          marginLeft: isRow && i > 0 ? -overlap : 0,
          marginTop: !isRow && i > 0 ? -overlap : 0,
          transform: isRow ? `rotate(${(i - (count - 1) / 2) * 1.0}deg)` : 'none',
          zIndex: i,
        }}>
          <CardBack width={cardWidth} />
        </div>
      ))}
    </div>
  )
}
