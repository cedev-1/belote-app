import { useId } from 'react'

interface LogoProps {
  size?: number
  showWordmark?: boolean
  onClick?: () => void
}

export function Logo({ size = 32, showWordmark = false, onClick }: LogoProps) {
  const uid = useId().replace(/:/g, '')
  const h = Math.round(size * 1.4)

  return (
    <button
      onClick={onClick}
      className="salon-logo-btn"
      aria-label="Tapons l'carton — accueil"
    >
      <svg width={size} height={h} viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}p`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#fdf9ec" />
            <stop offset="55%"  stopColor="#f6efd8" />
            <stop offset="100%" stopColor="#ebe1c1" />
          </linearGradient>
          <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="0.7">
            <stop offset="0%"   stopColor="#fff" stopOpacity="0.5" />
            <stop offset="50%"  stopColor="#fff" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}b`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#f0d690" />
            <stop offset="40%"  stopColor="#c9a24b" />
            <stop offset="100%" stopColor="#7a5a1c" />
          </linearGradient>
          <filter id={`${uid}f`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" />
            <feOffset dx="0" dy="1.6" result="off" />
            <feComponentTransfer in="off" result="sh">
              <feFuncA type="linear" slope="0.45" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="sh" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Card body */}
        <g filter={`url(#${uid}f)`}>
          <rect x="3" y="3" width="94" height="134" rx="10" fill={`url(#${uid}b)`} />
          <rect x="5.5" y="5.5" width="89" height="129" rx="8.2" fill={`url(#${uid}p)`} />
          <rect x="8" y="8" width="84" height="124" rx="6.5" fill="none" stroke={`url(#${uid}b)`} strokeWidth="0.7" opacity="0.55" />
        </g>

        {/* Center spade */}
        <g transform="translate(12 32) scale(0.76)">
          <path d="M50 8C50 8,80 35,80 58C80 72,70 80,60 80C55 80,51 77,50 74C49 77,45 80,40 80C30 80,20 72,20 58C20 35,50 8,50 8ZM50 70C50 78,47 86,40 92L60 92C53 86,50 78,50 70Z" fill="#0a0805" />
        </g>

        {/* Top-left index */}
        <g transform="translate(11 9)">
          <text x="0" y="17" fontFamily="'DM Serif Display', Georgia, serif" fontSize="22" fill="#0a0805">A</text>
          <g transform="translate(2 21) scale(0.18)">
            <path d="M50 8C50 8,80 35,80 58C80 72,70 80,60 80C55 80,51 77,50 74C49 77,45 80,40 80C30 80,20 72,20 58C20 35,50 8,50 8ZM50 70C50 78,47 86,40 92L60 92C53 86,50 78,50 70Z" fill="#0a0805" />
          </g>
        </g>

        {/* Bottom-right index (rotated) */}
        <g transform="translate(89 131) rotate(180)">
          <text x="0" y="17" fontFamily="'DM Serif Display', Georgia, serif" fontSize="22" fill="#0a0805">A</text>
          <g transform="translate(2 21) scale(0.18)">
            <path d="M50 8C50 8,80 35,80 58C80 72,70 80,60 80C55 80,51 77,50 74C49 77,45 80,40 80C30 80,20 72,20 58C20 35,50 8,50 8ZM50 70C50 78,47 86,40 92L60 92C53 86,50 78,50 70Z" fill="#0a0805" />
          </g>
        </g>

        {/* Sheen overlay */}
        <rect x="5.5" y="5.5" width="89" height="60" rx="8.2" fill={`url(#${uid}s)`} />
      </svg>

      {showWordmark && (
        <span className="salon-logo-wordmark">
          <span className="salon-logo-tapons">Tapons</span>
          <span className="salon-logo-carton">l'carton</span>
        </span>
      )}
    </button>
  )
}
