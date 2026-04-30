import type { Card, Suit } from '../../types'

export const SUIT_GLYPH: Record<Suit, string> = {
  hearts:   '\u2665',
  diamonds: '\u2666',
  clubs:    '\u2663',
  spades:   '\u2660',
}

export const SUIT_LABEL: Record<Suit, string> = {
  hearts: 'Cœur',
  diamonds: 'Carreau',
  clubs: 'Trèfle',
  spades: 'Pique',
}

export const SUIT_IS_RED = (s: Suit) => s === 'hearts' || s === 'diamonds'

export function suitColor(suit: Suit) {
  return SUIT_IS_RED(suit) ? '#e26b6f' : '#f6f1e3'
}

type CardSize = 'sm' | 'md' | 'lg'
const SIZE_MAP: Record<CardSize, { w: number; h: number; idx: number; glyph: number; crest: number; radius: number }> = {
  sm: { w: 52, h: 76,  idx: 12, glyph: 14, crest: 26, radius: 6 },
  md: { w: 70, h: 100, idx: 14, glyph: 17, crest: 38, radius: 8 },
  lg: { w: 92, h: 132, idx: 18, glyph: 22, crest: 56, radius: 10 },
}

interface CardFrontProps {
  card: Card
  onClick?: () => void
  selected?: boolean
  playable?: boolean
  disabled?: boolean
  faded?: boolean
  size?: CardSize
}

export function CardFront({
  card, onClick, selected = false, playable = false, disabled = false, faded = false, size = 'md',
}: CardFrontProps) {
  const dim = SIZE_MAP[size]
  const red = SUIT_IS_RED(card.suit)
  const inkColor = red ? '#b1242b' : '#1c1a16'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="salon-card-front"
      style={{
        width: dim.w,
        height: dim.h,
        borderRadius: dim.radius,
        cursor: disabled ? 'default' : (onClick ? 'pointer' : 'default'),
        opacity: faded ? 0.55 : 1,
        transform: selected ? 'translateY(-14px)' : 'translateY(0)',
        boxShadow: selected
          ? '0 18px 28px -10px rgba(0,0,0,0.55), 0 0 0 2px #c9a24b, 0 0 26px rgba(201,162,75,0.55)'
          : playable
            ? '0 8px 18px -8px rgba(0,0,0,0.55), 0 0 0 2px #c9a24b'
            : '0 6px 14px -6px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.06)',
      }}
    >
      <span className="salon-card-corner salon-card-corner-tl" style={{ color: inkColor, fontSize: dim.idx, lineHeight: 1 }}>
        <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>{card.value}</span>
        <span style={{ fontSize: dim.glyph, marginTop: 1 }}>{SUIT_GLYPH[card.suit]}</span>
      </span>
      <span className="salon-card-crest" style={{ color: inkColor, fontSize: dim.crest, opacity: 0.92 }}>
        {SUIT_GLYPH[card.suit]}
      </span>
      <span className="salon-card-corner salon-card-corner-br" style={{ color: inkColor, fontSize: dim.idx, lineHeight: 1 }}>
        <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>{card.value}</span>
        <span style={{ fontSize: dim.glyph, marginTop: 1 }}>{SUIT_GLYPH[card.suit]}</span>
      </span>
    </button>
  )
}

type BackSize = 'xs' | 'sm' | 'md'
const BACK_DIM: Record<BackSize, { w: number; h: number; radius: number }> = {
  xs: { w: 36, h: 52,  radius: 5 },
  sm: { w: 52, h: 76,  radius: 6 },
  md: { w: 70, h: 100, radius: 8 },
}

export function CardBack({ size = 'sm' }: { size?: BackSize }) {
  const dim = BACK_DIM[size]
  return (
    <div className="salon-card-back" style={{ width: dim.w, height: dim.h, borderRadius: dim.radius }}>
      <div className="salon-card-back-frame" />
    </div>
  )
}

export function OpponentFan({ count, orientation, compact = false }: {
  count: number
  orientation: 'top' | 'left' | 'right'
  compact?: boolean
}) {
  if (count === 0) return null

  const N = count
  const mid = (N - 1) / 2
  const size: BackSize = compact ? 'xs' : 'sm'
  const dim = BACK_DIM[size]
  const cardW = dim.w
  const cardH = dim.h
  const overlap = compact ? 30 : 20
  const fanW = cardW + (N - 1) * (cardW - overlap)
  const arcH = Math.ceil(mid) * (compact ? 2 : 3)
  const fanH = cardH + arcH + 6

  // Rotate the whole fan: top=180° (upside-down), left=90°, right=-90°
  const containerRot = orientation === 'top' ? 180 : orientation === 'left' ? 90 : -90

  // After rotation, visual dimensions swap for left/right
  const wrapW = orientation === 'top' ? fanW : fanH
  const wrapH = orientation === 'top' ? fanH : fanW

  const fan = Array.from({ length: N }, (_, i) => {
    const offset = i - mid
    return {
      ty: Math.abs(offset) * (compact ? 2 : 3),
      rot: offset * 4,
      ml: i === 0 ? 0 : -overlap,
    }
  })

  return (
    <div style={{ width: wrapW, height: wrapH, position: 'relative', flexShrink: 0 }}>
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: `translate(-50%, -50%) rotate(${containerRot}deg)`,
        display: 'inline-flex', alignItems: 'flex-end',
      }}>
        {fan.map(({ ty, rot, ml }, i) => (
          <div
            key={i}
            style={{
              transform: `translateY(${ty}px) rotate(${rot}deg)`,
              marginLeft: ml,
              zIndex: i,
              transformOrigin: '50% 110%',
            }}
          >
            <CardBack size={size} />
          </div>
        ))}
      </div>
    </div>
  )
}
