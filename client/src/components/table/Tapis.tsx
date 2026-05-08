import type { Card, Suit } from '../../types'
import { CardFront, SUIT_GLYPH, SUIT_LABEL, suitColor } from './Card'

export interface TrickCard {
  playerId: string
  card: Card
  fromSlot?: 'top' | 'left' | 'right' | 'bottom'
  playerName?: string
  isMaster?: boolean
}

interface TapisProps {
  trump: Suit | null
  trumpCallerName?: string | null
  trick: TrickCard[]
  ledSuit?: Suit | null
  emptyState?: React.ReactNode
  compact?: boolean
}

export function Tapis({ trump, trumpCallerName, trick, ledSuit, emptyState, compact = false }: TapisProps) {
  const N = trick.length

  const trickDisplay = compact ? (
    // Mobile: slight fan pile — cards overlap, each slightly rotated
    <div style={{
      position: 'relative',
      width: N > 0 ? 52 + (N - 1) * 16 : 52,
      height: 84,
      flexShrink: 0,
    }}>
      {trick.map(({ playerId, card, isMaster }, i) => {
        const rot = (i - (N - 1) / 2) * 5
        return (
          <div
            key={playerId}
            style={{
              position: 'absolute',
              left: i * 16,
              bottom: isMaster ? 10 : 0,
              zIndex: isMaster ? N + 1 : i,
              transform: `rotate(${rot}deg)`,
              transformOrigin: '50% 110%',
              transition: 'bottom 0.25s ease',
            }}
          >
            <CardFront card={card} width={32} />
          </div>
        )
      })}
    </div>
  ) : (
    <div className="salon-tapis-trick">
      {trick.map(({ playerId, card, playerName, isMaster }, i) => (
        <div
          key={playerId}
          className="salon-trick-slot"
          style={{ animationDelay: `${i * 110}ms` }}
        >
          <div style={{
            transform: isMaster ? 'translateY(-8px)' : 'none',
            transition: 'transform 0.25s ease',
          }}>
            <CardFront card={card} />
          </div>
          {playerName && (
            <span className="salon-trick-label" style={isMaster ? { color: 'var(--brass-soft)', fontWeight: 700 } : undefined}>
              {playerName}
            </span>
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className="salon-tapis">
      {/* Trump badge — always rendered to keep tapis height stable; hidden if no trump */}
      <div style={{ visibility: trump ? 'visible' : 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <div className="salon-tapis-trump">
          <span className="salon-trump-eyebrow">Atout</span>
          <span className="salon-trump-glyph" style={{ color: trump ? suitColor(trump) : 'transparent' }}>
            {trump ? SUIT_GLYPH[trump] : '♠'}
          </span>
          <span className="salon-trump-name">{trump ? SUIT_LABEL[trump] : ' '}</span>
        </div>
        {/* Led suit right below trump pill */}
        <span style={{
          fontSize: 11, fontFamily: 'Fraunces, serif', fontStyle: 'italic',
          color: 'rgba(246,241,227,0.72)', letterSpacing: '0.05em',
          visibility: (!compact && ledSuit) ? 'visible' : 'hidden',
          display: 'block', minHeight: '1em',
        }}>
          {ledSuit ? `${SUIT_GLYPH[ledSuit]} ${SUIT_LABEL[ledSuit]} demandé` : ' '}
        </span>
        <span style={{
          fontSize: 11, color: 'var(--ink-soft)', fontFamily: "'Fraunces', serif",
          fontStyle: 'italic', letterSpacing: '0.04em',
          visibility: trumpCallerName ? 'visible' : 'hidden',
          display: 'block', minHeight: '1em',
        }}>
          {trumpCallerName ?? ' '} a pris
        </span>
      </div>

      {trick.length > 0 ? trickDisplay : (
        <div style={{ minHeight: compact ? 84 : 132, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {emptyState ?? <span style={{ color: 'rgba(246,241,227,0.45)', fontSize: 13 }}>En attente…</span>}
        </div>
      )}
    </div>
  )
}
