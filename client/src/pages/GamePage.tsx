import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSocket } from '../hooks/useSocket'
import type { Card, Suit } from '../types'
import { CardFront, CardBack, OpponentFan, SUIT_GLYPH, SUIT_LABEL, suitColor } from '../components/table/Card'
import { SeatBadge } from '../components/table/SeatBadge'
import { Tapis } from '../components/table/Tapis'
import type { TrickCard as TapisTrickCard } from '../components/table/Tapis'
import { CardReferencePanel } from '../components/table/CardReferencePanel'
import '../salon.css'

const TRUMP_ORDER = ['J', '9', 'A', '10', 'K', 'Q', '8', '7']
const PLAIN_ORDER = ['A', '10', 'K', 'Q', 'J', '9', '8', '7']

function getTrickLeaderId(
  trick: Array<{ playerId: string; card: Card }>,
  trump: Suit | null,
): string | null {
  if (trick.length === 0) return null
  const ledSuit = trick[0].card.suit
  const strength = (card: Card) => {
    if (trump && card.suit === trump) return 100 - TRUMP_ORDER.indexOf(card.value)
    if (card.suit === ledSuit) return 50 - PLAIN_ORDER.indexOf(card.value)
    return -1
  }
  return trick.reduce((best, cur) =>
    strength(cur.card) > strength(best.card) ? cur : best
  ).playerId
}

function computeHint(
  playableIndices: number[],
  myHand: Card[],
  trump: Suit | null,
  trick: Array<{ playerId: string; card: Card }>,
  partnerIds: string[],
): string | null {
  if (playableIndices.length === 0 || myHand.length === 0) return null
  if (trick.length === 0) return 'À toi d\'ouvrir ce pli'

  const ledSuit = trick[0].card.suit
  const playableCards = playableIndices.map(i => myHand[i]).filter(Boolean)
  if (playableCards.length === 0) return null

  const allPlayableTrump = trump && playableCards.every(c => c.suit === trump)
  if (allPlayableTrump && ledSuit !== trump) return `Tu dois couper — pas de ${SUIT_LABEL[ledSuit]}`

  const allPlayableLed = playableCards.every(c => c.suit === ledSuit)
  if (allPlayableLed && ledSuit === trump) return 'Joue atout — tu dois monter'
  if (allPlayableLed) return `Tu dois suivre à ${SUIT_LABEL[ledSuit]}`

  if (playableIndices.length === myHand.length) {
    const hasTrump = trump != null && myHand.some(c => c.suit === trump)
    const partnerPlayed = trick.some(t => partnerIds.includes(t.playerId))
    if (!hasTrump) return 'Tu n\'as plus d\'atout — défausse librement'
    if (partnerPlayed) return 'Ton partenaire est maître — tu peux te défausser'
    return 'Libre de jouer'
  }

  return null
}

interface GamePlayer {
  player_id: string
  position: 1 | 2 | 3 | 4
  team: 1 | 2
  profiles: { id: string; display_name: string; elo: number; avatar_url: string | null }
}

interface GameData {
  id: string
  status: string
  created_by: string
  game_players: GamePlayer[]
}

interface PhaseState {
  phase: 'waiting' | 'bidding' | 'playing' | 'cutting' | 'dealing'
  currentPlayer: string | null
  trump: Suit | null
  trumpCallerId: string | null
  team1Score: number
  team2Score: number
  biddingRound: 1 | 2
  retourneSuit: Suit | null
}

type DealOrder = '3-2' | '2-3'

interface TrickRecord {
  cards: Array<{ playerId: string; card: Card }>
  winnerId: string
  winnerTeam: 1 | 2
  points: number
}

interface RoundSummary {
  roundIndex: number
  trump: Suit | null
  trumpCallerId: string | null
  roundTeam1Points: number
  roundTeam2Points: number
  team1Score: number
  team2Score: number
  chute: boolean
  litige: boolean
  beloteTeam: 1 | 2 | null
  trickCount1: number
  trickCount2: number
  tricks: TrickRecord[]
}

function getCardDelay(i: number, order: DealOrder): number {
  const batch1Size = order === '3-2' ? 3 : 2
  const interval = 160
  const pause = 950
  if (i < batch1Size) return i * interval
  return batch1Size * interval + pause + (i - batch1Size) * interval
}

const ALL_SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

// ── Icons ────────────────────────────────────────────────────────────────────

function PersonIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
      style={{ display: 'block', opacity: 0.55 }}>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  )
}

function MicroCard({ card, highlighted }: { card: Card; highlighted?: boolean }) {
  const color = suitColor(card.suit)
  return (
    <div style={{
      width: 28, height: 40, borderRadius: 4, flexShrink: 0,
      background: 'var(--card-paper)',
      border: highlighted ? '1.5px solid var(--brass)' : '1px solid rgba(0,0,0,0.22)',
      boxShadow: highlighted ? '0 0 6px rgba(201,162,75,0.45)' : '0 1px 3px rgba(0,0,0,0.3)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color, lineHeight: 1 }}>{card.value}</span>
      <span style={{ fontSize: 11, color, lineHeight: 1 }}>{SUIT_GLYPH[card.suit]}</span>
    </div>
  )
}

function PassIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 20 22"
      fill="currentColor" aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0 }}>
      <path d="
        M2,22 L2,5
        Q2,3 3.5,3 Q5,3 5,5
        L5,13 Q5,15 5.75,15 Q6.5,15 6.5,13
        L6.5,2 Q6.5,0.5 8,0.5 Q9.5,0.5 9.5,2
        L9.5,13 Q9.5,15 10.25,15 Q11,15 11,13
        L11,3.5 Q11,2 12.5,2 Q14,2 14,3.5
        L14,13 Q14,15 14.75,15 Q15.5,15 15.5,13
        L15.5,6 Q15.5,4.5 17,4.5 Q18.5,4.5 18.5,6
        L18.5,22 Z
      "/>
    </svg>
  )
}

// ── Cutting panel ────────────────────────────────────────────────────────────

function CuttingPanel({ onCut }: { onCut: (pos: number) => void }) {
  const [pos, setPos] = useState(16)
  const top = pos
  const bottom = 32 - pos

  const Pile = ({ count }: { count: number }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: 52, height: 100 }}>
        {[3, 2, 1, 0].map(layer => (
          <div key={layer} style={{ position: 'absolute', bottom: layer * 3, left: 0 }}>
            <CardBack size="md" />
          </div>
        ))}
      </div>
      <span style={{ fontSize: 13, color: 'var(--brass)', fontFamily: 'Fraunces, serif', fontWeight: 600 }}>
        {count}
      </span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600 }}>
        Choisir où couper
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28 }}>
        <Pile count={top} />
        <span style={{ fontSize: 20, color: 'var(--brass-soft)', marginBottom: 28, opacity: 0.7 }}>✂</span>
        <Pile count={bottom} />
      </div>
      <input
        type="range" min={6} max={26} step={1} value={pos}
        onChange={e => setPos(Number(e.target.value))}
        style={{ width: 160, accentColor: 'var(--brass)', cursor: 'pointer' }}
      />
      <button onClick={() => onCut(pos)} className="salon-primary-btn">
        Couper
      </button>
    </div>
  )
}

// ── Bidding panel ────────────────────────────────────────────────────────────

function BiddingPanel({ isMyTurn, onBid, allPassed, retourne, biddingRound }: {
  isMyTurn: boolean
  onBid: (action: 'pass' | 'take', suit?: Suit) => void
  allPassed: boolean
  retourne: Card | null
  biddingRound: 1 | 2
}) {
  if (allPassed) {
    return (
      <p style={{ color: 'var(--brass-soft)', fontSize: 13, animation: 'salonTagPulse 1.5s ease-in-out infinite' }}>
        Redistribution…
      </p>
    )
  }

  if (!isMyTurn) {
    return retourne && biddingRound === 1
      ? <CardFront card={retourne} size="md" />
      : null
  }

  if (biddingRound === 2) {
    const choices = ALL_SUITS.filter(s => s !== retourne?.suit)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <p style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass-soft)', fontWeight: 600, margin: 0 }}>
          2ème tour
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {choices.map(s => (
            <button
              key={s}
              onClick={() => onBid('take', s)}
              className="salon-secondary-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}
            >
              <span style={{ fontSize: 18, color: suitColor(s) }}>{SUIT_GLYPH[s]}</span>
              <span>{SUIT_LABEL[s]}</span>
            </button>
          ))}
        </div>
        <button onClick={() => onBid('pass')} className="salon-ghost-btn"
          style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <PassIcon size={13} />
          Deux
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {retourne && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>
            Prendre à{' '}
            <span style={{ color: suitColor(retourne.suit), fontFamily: 'Fraunces, serif', fontSize: 15 }}>
              {SUIT_GLYPH[retourne.suit]} {SUIT_LABEL[retourne.suit]}
            </span>
            {' '}?
          </p>
          <CardFront card={retourne} size="md" />
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => onBid('take')} className="salon-primary-btn">Prendre</button>
        <button onClick={() => onBid('pass')} className="salon-secondary-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <PassIcon />
          Non
        </button>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function GamePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { socket } = useSocket()

  const [game, setGame] = useState<GameData | null>(null)
  const [myHand, setMyHand] = useState<Card[]>([])
  const [opponentCardCounts, setOpponentCardCounts] = useState<Record<string, number>>({})
  const [dealtAlready, setDealtAlready] = useState(false)
  const [selectedCard, setSelectedCard] = useState<number | null>(null)
  const [phaseState, setPhaseState] = useState<PhaseState>({
    phase: 'waiting', currentPlayer: null, trump: null, trumpCallerId: null,
    team1Score: 0, team2Score: 0, biddingRound: 1, retourneSuit: null,
  })
  const [retourne, setRetourne] = useState<Card | null>(null)
  const [allPassed, setAllPassed] = useState(false)
  const [trickState, setTrickState] = useState<{
    trick: Array<{ playerId: string; card: Card }>
    currentPlayer: string
    team1Points: number
    team2Points: number
  } | null>(null)
  const [playableIndices, setPlayableIndices] = useState<number[]>([])
  const [trickWon, setTrickWon] = useState<{ winnerId: string; winnerTeam: 1 | 2; points: number } | null>(null)
  const [lastTrick, setLastTrick] = useState<Array<{ playerId: string; card: Card }> | null>(null)
  const [lastTrickWinnerId, setLastTrickWinnerId] = useState<string | null>(null)
  const [showLastTrick, setShowLastTrick] = useState(false)
  const [roundEnd, setRoundEnd] = useState<{
    team1Points: number; team2Points: number
    roundTeam1Points: number; roundTeam2Points: number
    team1Score: number; team2Score: number
    trumpCallerId: string | null; trumpCallerTeam: 1 | 2 | null; chute: boolean
    trump: Suit | null; litige: boolean; pendingLitigePoints: number
    beloteTeam: 1 | 2 | null
  } | null>(null)
  const [gameOver, setGameOver] = useState<{ winner: 1 | 2; team1Score: number; team2Score: number } | null>(null)
  const [eloUpdates, setEloUpdates] = useState<Array<{ playerId: string; delta: number; newElo: number }> | null>(null)
  const [dealOrder, setDealOrder] = useState<DealOrder>('3-2')
  const [dealAnimKey, setDealAnimKey] = useState(0)
  const [animateFrom, setAnimateFrom] = useState(0)
  const [showAide, setShowAide] = useState(() => localStorage.getItem('belote_aide') !== 'off')
  const [showRefPanel, setShowRefPanel] = useState(() => localStorage.getItem('belote_aide') !== 'off')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [myBeloteCount, setMyBeloteCount] = useState<0 | 1 | 2>(0)
  const [beloteEnabled, setBeloteEnabled] = useState(false)
  const [beloteFlash, setBeloteFlash] = useState<{ playerId: string; type: 'belote' | 'rebelote' } | null>(null)
  const [roundHistory, setRoundHistory] = useState<RoundSummary[]>([])
  const [showRecap, setShowRecap] = useState(false)
  const roundTricksRef = useRef<TrickRecord[]>([])
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600)
  const [expandedRoundIdx, setExpandedRoundIdx] = useState<number | null>(null)
  const [teamNames, setTeamNames] = useState<{ 1: string; 2: string }>(
    (location.state as { teamNames?: { 1: string; 2: string } } | null)?.teamNames
    ?? { 1: 'Équipe 1', 2: 'Équipe 2' }
  )

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 600)
    window.addEventListener('resize', handle, { passive: true })
    return () => window.removeEventListener('resize', handle)
  }, [])

  const fetchGame = useCallback(async () => {
    if (!id) return
    const { data } = await supabase
      .from('games')
      .select('id, status, created_by, game_players(player_id, position, team, profiles(id, display_name, elo, avatar_url))')
      .eq('id', id)
      .single()
    if (data) setGame(data as unknown as GameData)
  }, [id])

  useEffect(() => { fetchGame() }, [fetchGame])

  useEffect(() => {
    if (!socket || !id) return

    // Register all listeners BEFORE emitting so no server response is missed
    socket.on('game:hand', ({ playerId, cards, dealOrder: order }: { playerId: string; cards: Card[]; dealOrder?: DealOrder }) => {
      if (playerId === user?.id) {
        if (order) setDealOrder(order)
        setDealtAlready(true)
        setAllPassed(false)
        if (cards.length === 5) {
          setMyHand(cards)
          setAnimateFrom(0)
          setDealAnimKey(k => k + 1)
          setLastTrick(null)
          setLastTrickWinnerId(null)
          setShowLastTrick(false)
          setTrickState(null)
          setPlayableIndices([])
          setMyBeloteCount(0)
          setBeloteEnabled(false)
        } else {
          // Preserve user's card order: keep existing 5 in place, append the 3 new ones
          setMyHand(prev => {
            const newCards = cards.filter(c => !prev.some(p => p.suit === c.suit && p.value === c.value))
            return [...prev, ...newCards]
          })
          setAnimateFrom(5)
        }
      }
    })

    socket.on('game:card_count', ({ playerId, count }: { playerId: string; count: number }) => {
      if (playerId !== user?.id) {
        setOpponentCardCounts(prev => ({ ...prev, [playerId]: count }))
      }
    })

    socket.on('game:phase', (state: PhaseState) => {
      setPhaseState(state)
    })

    socket.on('game:retourne', (card: Card) => {
      setRetourne(card)
    })

    socket.on('game:all_passed', () => {
      setAllPassed(true)
      setTimeout(() => setAllPassed(false), 1500)
    })

    socket.on('game:trick_update', (state: {
      trick: Array<{ playerId: string; card: Card }>
      currentPlayer: string; team1Points: number; team2Points: number
    }) => {
      setTrickState(state)
    })

    socket.on('game:playable', (indices: number[]) => {
      setPlayableIndices(indices)
    })

    socket.on('game:trick_won', (data: {
      winnerId: string; winnerTeam: 1 | 2; points: number
      trick: Array<{ playerId: string; card: Card }>
      team1Points: number; team2Points: number
    }) => {
      roundTricksRef.current.push({ cards: data.trick, winnerId: data.winnerId, winnerTeam: data.winnerTeam, points: data.points })
      setLastTrick(data.trick)
      setLastTrickWinnerId(data.winnerId)
      setTrickWon({ winnerId: data.winnerId, winnerTeam: data.winnerTeam, points: data.points })
      setTrickState(prev => prev ? { ...prev, trick: data.trick, team1Points: data.team1Points, team2Points: data.team2Points, currentPlayer: '' } : null)
      setPlayableIndices([])
      setTimeout(() => setTrickWon(null), 3000)
    })

    socket.on('game:belote_announced', (data: { playerId: string; type: 'belote' | 'rebelote' }) => {
      if (data.playerId === user?.id) setMyBeloteCount(prev => Math.min(prev + 1, 2) as 0 | 1 | 2)
      setBeloteFlash(data)
      setTimeout(() => setBeloteFlash(null), 3000)
    })

    socket.on('game:round_end', (data: {
      team1Points: number; team2Points: number
      roundTeam1Points: number; roundTeam2Points: number
      team1Score: number; team2Score: number
      trumpCallerId: string | null; trumpCallerTeam: 1 | 2 | null
      trump: Suit | null; chute: boolean
      litige: boolean; pendingLitigePoints: number
      beloteTeam: 1 | 2 | null
    }) => {
      const tricks = [...roundTricksRef.current]
      roundTricksRef.current = []
      setRoundHistory(prev => [...prev, {
        roundIndex: prev.length + 1,
        trump: data.trump,
        trumpCallerId: data.trumpCallerId,
        roundTeam1Points: data.roundTeam1Points,
        roundTeam2Points: data.roundTeam2Points,
        team1Score: data.team1Score,
        team2Score: data.team2Score,
        chute: data.chute,
        litige: data.litige,
        beloteTeam: data.beloteTeam,
        trickCount1: tricks.filter(t => t.winnerTeam === 1).length,
        trickCount2: tricks.filter(t => t.winnerTeam === 2).length,
        tricks,
      }])
      setLastTrick(null)
      setLastTrickWinnerId(null)
      setShowLastTrick(false)
      setTimeout(() => {
        setTrickState(null)
        setRetourne(null)
        setRoundEnd(data)
      }, 3200)
    })

    socket.on('game:game_over', (data: { winner: 1 | 2; team1Score: number; team2Score: number }) => {
      setTimeout(() => setGameOver(data), 3200)
    })

    socket.on('game:elo_update', (data: { updates: Array<{ playerId: string; delta: number; newElo: number }> }) => {
      setEloUpdates(data.updates)
    })

    socket.on('game:team_names', ({ gameId: gid, names }: { gameId: string; names: { 1: string; 2: string } }) => {
      if (gid === id) setTeamNames(names)
    })

    // Emit after all listeners are registered
    socket.emit('game:join', id)
    socket.emit('game:request_hand', id)

    return () => {
      socket.off('game:hand')
      socket.off('game:card_count')
      socket.off('game:phase')
      socket.off('game:retourne')
      socket.off('game:all_passed')
      socket.off('game:trick_update')
      socket.off('game:playable')
      socket.off('game:trick_won')
      socket.off('game:elo_update')
      socket.off('game:belote_announced')
      socket.off('game:round_end')
      socket.off('game:game_over')
      socket.off('game:team_names')
      socket.emit('game:leave', id)
    }
  }, [socket, id, user?.id])

  // Clear deal animation class once all cards have finished animating,
  // so drag-reorder doesn't retrigger the slide-in animation on moved DOM nodes.
  useEffect(() => {
    if (!dealtAlready) return
    const t = setTimeout(() => setAnimateFrom(99), getCardDelay(4, dealOrder) + 400)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealAnimKey])

  useEffect(() => {
    if (animateFrom !== 5) return
    const t = setTimeout(() => setAnimateFrom(99), 2 * 160 + 400)
    return () => clearTimeout(t)
  }, [animateFrom])

  const dealCards = () => {
    socket?.emit('game:deal', id, dealOrder)
  }

  const bid = (action: 'pass' | 'take', suit?: Suit) => {
    socket?.emit('game:bid', id, action, suit)
  }

  const playCard = (cardIndex: number) => {
    if (!playableIndices.includes(cardIndex)) return
    if (trickState?.currentPlayer !== user?.id) return
    socket?.emit('game:play_card', id, cardIndex, beloteEnabled || undefined)
    setBeloteEnabled(false)
    setMyHand(prev => prev.filter((_, i) => i !== cardIndex))
    setPlayableIndices([])
    setSelectedCard(null)
  }

  // Hooks must come before any early return — compute deps from nullable game
  const isMyPlayTurn = phaseState.phase === 'playing' && trickState?.currentPlayer === user?.id

  const partnerIds = useMemo(() => {
    if (!game) return []
    const me = game.game_players.find(p => p.player_id === user?.id)
    if (!me) return []
    return game.game_players.filter(p => p.team === me.team && p.player_id !== user?.id).map(p => p.player_id)
  }, [game, user?.id])

  const hint = useMemo(() => {
    if (!isMyPlayTurn || !showAide) return null
    return computeHint(playableIndices, myHand, phaseState.trump, trickState?.trick ?? [], partnerIds)
  }, [isMyPlayTurn, showAide, playableIndices, myHand, phaseState.trump, trickState?.trick, partnerIds])

  const beloteHint = useMemo(() => {
    if (!isMyPlayTurn || !showAide || !phaseState.trump || selectedCard == null) return null
    const card = myHand[selectedCard]
    if (!card || card.suit !== phaseState.trump || (card.value !== 'K' && card.value !== 'Q')) return null
    const trump = phaseState.trump
    const hasKing = myHand.some(c => c.suit === trump && c.value === 'K')
    const hasQueen = myHand.some(c => c.suit === trump && c.value === 'Q')
    if (myBeloteCount === 0 && hasKing && hasQueen) return "N'oublie pas d'annoncer la belote !"
    if (myBeloteCount === 1 && (hasKing || hasQueen)) return "N'oublie pas d'annoncer la rebelote !"
    return null
  }, [isMyPlayTurn, showAide, phaseState.trump, myHand, myBeloteCount, selectedCard])

  const beloteButtonLabel = (() => {
    if (!isMyPlayTurn || selectedCard == null || !phaseState.trump) return null
    const card = myHand[selectedCard]
    if (!card || card.suit !== phaseState.trump) return null
    if (card.value !== 'K' && card.value !== 'Q') return null
    const trump = phaseState.trump
    const hasKing = myHand.some(c => c.suit === trump && c.value === 'K')
    const hasQueen = myHand.some(c => c.suit === trump && c.value === 'Q')
    if (myBeloteCount === 0 && hasKing && hasQueen) return 'Belote'
    if (myBeloteCount === 1) return 'Rebelote'
    return null
  })()

  if (!game) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#08160f' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid transparent', borderTopColor: 'var(--brass)', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  const byPosition = Object.fromEntries(game.game_players.map(p => [p.position, p]))
  const me = game.game_players.find(p => p.player_id === user?.id)
  const myPosition = me?.position ?? 1

  const positionMap: Record<number, 'top' | 'left' | 'right'> = {
    [(myPosition % 4) + 1]: 'left',
    [((myPosition + 1) % 4) + 1]: 'top',
    [((myPosition + 2) % 4) + 1]: 'right',
  }

  const isMyBiddingTurn = phaseState.phase === 'bidding' && phaseState.currentPlayer === user?.id
  const isMyTurn = isMyBiddingTurn || isMyPlayTurn

  const isCurrentPlayerFor = (playerId: string | undefined) => {
    if (!playerId) return false
    if (phaseState.phase === 'bidding') return phaseState.currentPlayer === playerId
    if (phaseState.phase === 'playing') return trickState?.currentPlayer === playerId
    return false
  }

  const playerByPos = (slot: 'top' | 'left' | 'right') => {
    const pos = Object.entries(positionMap).find(([, v]) => v === slot)?.[0]
    return pos ? byPosition[Number(pos)] : undefined
  }

  const cardCountFor = (player: GamePlayer | undefined) =>
    player ? (opponentCardCounts[player.player_id] ?? 0) : 0

  const turnLabelFor = (playerId: string | undefined): string | null => {
    if (!playerId) return null
    if (phaseState.phase === 'bidding' && phaseState.currentPlayer === playerId) return 'À son tour de parler'
    if (phaseState.phase === 'playing' && trickState?.currentPlayer === playerId) return 'À son tour de jouer'
    return null
  }

  const activeTrump = phaseState.trump

  // Slot for each player (for trick card animations)
  const slotForPlayer = (playerId: string): 'top' | 'left' | 'right' | 'bottom' => {
    if (playerId === user?.id) return 'bottom'
    if (playerByPos('top')?.player_id === playerId) return 'top'
    if (playerByPos('left')?.player_id === playerId) return 'left'
    return 'right'
  }

  const nameForPlayer = (playerId: string) =>
    game.game_players.find(p => p.player_id === playerId)?.profiles.display_name ?? '?'

  // Build tapis trick cards
  const trickLeaderId = getTrickLeaderId(trickState?.trick ?? [], phaseState.trump)
  const displayTrick: TapisTrickCard[] = (trickState?.trick ?? []).map(({ playerId, card }) => ({
    playerId, card,
    fromSlot: slotForPlayer(playerId),
    playerName: nameForPlayer(playerId),
    isMaster: playerId === trickLeaderId,
  }))

  const ledSuit = trickState?.trick?.[0]?.card?.suit ?? null

  // Center (tapis) empty-state content by phase
  const isMyCut = phaseState.phase === 'cutting' && phaseState.currentPlayer === user?.id
  const cutter = game.game_players.find(p => p.player_id === phaseState.currentPlayer)

  const tapisEmptyState = (() => {
    if (phaseState.phase === 'cutting') {
      return isMyCut
        ? <CuttingPanel onCut={pos => socket?.emit('game:cut_deck', id, pos)} />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ transform: `rotate(${(i - 2) * 4}deg)`, marginLeft: i > 0 ? -20 : 0 }}>
                  <CardBack size="md" />
                </div>
              ))}
            </div>
            <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>
              {cutter?.profiles.display_name ?? '?'} coupe…
            </p>
          </div>
        )
    }

    if (phaseState.phase === 'dealing') {
      const isMyDeal = phaseState.currentPlayer === user?.id
      const dealer = game.game_players.find(p => p.player_id === phaseState.currentPlayer)
      if (isMyDeal) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600 }}>
              Ordre de distribution
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['3-2', '3 puis 2'], ['2-3', '2 puis 3']] as [DealOrder, string][]).map(([o, label]) => (
                <button key={o} onClick={() => setDealOrder(o)}
                  className={dealOrder === o ? 'salon-primary-btn' : 'salon-secondary-btn'}
                  style={{ padding: '8px 18px' }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={dealCards} className="salon-primary-btn">Distribuer</button>
          </div>
        )
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ transform: `rotate(${(i - 2) * 4}deg)`, marginLeft: i > 0 ? -20 : 0 }}>
                <CardBack size="md" />
              </div>
            ))}
          </div>
          <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>
            {dealer?.profiles.display_name ?? '?'} distribue…
          </p>
        </div>
      )
    }

    if (phaseState.phase === 'bidding') {
      return (
        <BiddingPanel
          isMyTurn={isMyBiddingTurn}
          onBid={bid}
          allPassed={allPassed}
          retourne={retourne}
          biddingRound={phaseState.biddingRound}
        />
      )
    }

    return (
      <span style={{ color: 'rgba(246,241,227,0.55)', fontSize: 13, letterSpacing: '0.04em', textAlign: 'center' }}>
        En attente…
      </span>
    )
  })()

  // Tapis trump: only show during playing or after trump is set
  const tapisTrump = (phaseState.phase === 'playing' || phaseState.phase === 'cutting') ? activeTrump : null
  // Led suit only when trick is in progress (not trickWon flash)
  const tapisLedSuit = trickState && trickState.trick.length > 0 && trickState.trick.length < 4 ? ledSuit : null

  const trickWinner = trickWon ? game.game_players.find(p => p.player_id === trickWon.winnerId) : null

  const topPlayer = playerByPos('top')
  const leftPlayer = playerByPos('left')
  const rightPlayer = playerByPos('right')

  return (
    <div className="salon-root">
      {/* Corner ornaments */}
      <div className="salon-ornament tl" aria-hidden="true" />
      <div className="salon-ornament tr" aria-hidden="true" />
      <div className="salon-ornament bl" aria-hidden="true" />
      <div className="salon-ornament br" aria-hidden="true" />

      {/* ── Header ── */}
      <header className="salon-topbar">
        <button className="salon-ghost-btn" onClick={() => navigate('/')} style={{ justifySelf: 'start', alignSelf: 'start' }}>
          <span style={{ fontSize: 18, lineHeight: 1, marginTop: -2 }}>‹</span>
          <span>Quitter</span>
        </button>

        <div className="salon-title-block">
          <>
            <span className="salon-title-main">Salon de jeu</span>
            <span className="salon-title-eyebrow">
              {phaseState.phase === 'bidding'
                ? `Enchères${phaseState.biddingRound === 2 ? ' · 2ème tour' : ''}`
                : phaseState.phase === 'cutting' ? 'Coupe du jeu'
                : phaseState.phase === 'dealing' ? 'Distribution'
                : phaseState.phase === 'playing' ? 'Partie en cours'
                : 'En attente…'}
            </span>
          </>

          {(phaseState.team1Score > 0 || phaseState.team2Score > 0 || phaseState.phase === 'playing') && (
            <div className="salon-inline-score">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--team1-soft)', opacity: 0.75, fontFamily: 'Inter, sans-serif', lineHeight: 1.2 }}>{teamNames[1]}</span>
                <span className="salon-inline-score-t1">
                  {phaseState.team1Score}
                  {trickState && trickState.team1Points > 0 && (
                    <span className="salon-score-delta">+{trickState.team1Points}</span>
                  )}
                </span>
              </div>
              <span className="salon-inline-score-sep">–</span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--team2-soft)', opacity: 0.75, fontFamily: 'Inter, sans-serif', lineHeight: 1.2 }}>{teamNames[2]}</span>
                <span className="salon-inline-score-t2">
                  {phaseState.team2Score}
                  {trickState && trickState.team2Points > 0 && (
                    <span className="salon-score-delta">+{trickState.team2Points}</span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        <div />
      </header>

      {/* ── Felt area ── */}
      <main className="salon-felt-area">

        {/* Top opponent */}
        <div className="salon-seat salon-seat-top">
          <SeatBadge
            name={topPlayer?.profiles.display_name ?? '?'}
            team={topPlayer?.team ?? 1}
            teamName={topPlayer ? teamNames[topPlayer.team] : undefined}
            elo={topPlayer?.profiles.elo}
            avatarUrl={topPlayer?.profiles.avatar_url}
            active={isCurrentPlayerFor(topPlayer?.player_id)}
            turnLabel={turnLabelFor(topPlayer?.player_id)}
          />
          <OpponentFan count={cardCountFor(topPlayer)} orientation="top" compact={isMobile} />
        </div>

        {/* Middle row */}
        <div className="salon-middle-row">
          {/* Left opponent */}
          <div className="salon-seat salon-seat-left">
            <OpponentFan count={cardCountFor(leftPlayer)} orientation="left" compact={isMobile} />
            <SeatBadge
              name={leftPlayer?.profiles.display_name ?? '?'}
              team={leftPlayer?.team ?? 1}
              teamName={leftPlayer ? teamNames[leftPlayer.team] : undefined}
              elo={leftPlayer?.profiles.elo}
              avatarUrl={leftPlayer?.profiles.avatar_url}
              active={isCurrentPlayerFor(leftPlayer?.player_id)}
              turnLabel={turnLabelFor(leftPlayer?.player_id)}
            />
          </div>

          {/* Center: tapis */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
            <div style={{ position: 'relative' }}>
              <Tapis
                trump={tapisTrump}
                trumpCallerName={phaseState.trumpCallerId ? nameForPlayer(phaseState.trumpCallerId) : null}
                trick={displayTrick}
                ledSuit={tapisLedSuit}
                emptyState={tapisEmptyState}
                compact={isMobile}
              />
              {trickWon && trickWinner && (
                <div style={{
                  position: 'absolute', bottom: -32, left: 0, right: 0,
                  textAlign: 'center', color: 'var(--brass-soft)',
                  fontFamily: 'Fraunces, serif', fontSize: 14, fontStyle: 'italic',
                }}>
                  {trickWinner.profiles.display_name} a remporté le pli · +{trickWon.points} pts
                </div>
              )}
            </div>
            {/* Always rendered — fixed height avoids layout shift after first trick */}
            <div style={{ minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
              {lastTrick && (
                <button
                  onClick={() => setShowLastTrick(v => !v)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: showLastTrick ? 'var(--brass)' : 'var(--ink-soft)',
                    fontFamily: 'Inter, sans-serif', fontWeight: 600,
                    opacity: showLastTrick ? 1 : 0.55,
                    transition: 'color 160ms, opacity 160ms',
                    padding: '4px 10px',
                  }}
                >
                  🂠 Voir le dernier pli
                </button>
              )}
            </div>
          </div>

          {/* Right opponent */}
          <div className="salon-seat salon-seat-right">
            <OpponentFan count={cardCountFor(rightPlayer)} orientation="right" compact={isMobile} />
            <SeatBadge
              name={rightPlayer?.profiles.display_name ?? '?'}
              team={rightPlayer?.team ?? 1}
              teamName={rightPlayer ? teamNames[rightPlayer.team] : undefined}
              elo={rightPlayer?.profiles.elo}
              avatarUrl={rightPlayer?.profiles.avatar_url}
              active={isCurrentPlayerFor(rightPlayer?.player_id)}
              turnLabel={turnLabelFor(rightPlayer?.player_id)}
            />
          </div>
        </div>

        {/* My area */}
        <div className="salon-me-area">
          {me && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              {isMyTurn && (
                <span className="salon-me-tag">
                  {isMyBiddingTurn ? 'À ton tour de parler' : 'À ton tour de jouer'}
                </span>
              )}
              <div className={`salon-me-badge ${isMyTurn ? 'is-turn' : ''}`}>
                <span
                  className="salon-me-avatar"
                  title="Mon profil"
                  onClick={() => navigate('/profile')}
                  style={{
                    overflow: 'hidden',
                    padding: me.profiles.avatar_url ? 0 : undefined,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {me.profiles.avatar_url
                    ? <img src={me.profiles.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    : <PersonIcon size={22} />
                  }
                </span>
                <span className="salon-me-meta">
                  <span className="salon-me-name">{me.profiles.display_name}</span>
                  <span className="salon-me-sub">
                    <span className={`salon-team-pip salon-team-${me.team}`} />
                    {teamNames[me.team]}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--brass)', fontFamily: "'Fraunces', serif", fontWeight: 600, letterSpacing: '0.02em' }}>
                    Elo {me.profiles.elo}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Hint banner — always rendered with fixed height to avoid layout shift */}
          <div style={{ minHeight: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginBottom: 4 }}>
            {hint && (
              <span style={{ fontSize: 12, fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--brass-soft)', letterSpacing: '0.05em', textAlign: 'center', opacity: 0.85 }}>
                {hint}
              </span>
            )}
            {beloteHint && (
              <span style={{ fontSize: 12, fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--brass)', letterSpacing: '0.05em', textAlign: 'center' }}>
                {beloteHint}
              </span>
            )}
          </div>

          {/* Hand fan */}
          <div className="salon-hand-row" key={dealAnimKey}>
            {myHand.map((card, i) => {
              const N = myHand.length
              const mid = (N - 1) / 2
              const offset = i - mid
              const rot = offset * 4.5
              const ty = Math.abs(offset) * 4
              const canPlay = phaseState.phase === 'playing' && isMyPlayTurn && playableIndices.includes(i)
              const isSel = selectedCard === i
              const isDragging = dragIndex === i
              const isDropTarget = dragOverIndex === i && dragIndex !== null && dragIndex !== i
              return (
                <div
                  key={`${card.suit}-${card.value}`}
                  className="salon-hand-slot"
                  draggable={dealtAlready}
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragIndex(i) }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIndex(i) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIndex !== null && dragIndex !== i) {
                      setMyHand(prev => reorderArray(prev, dragIndex, i))
                      setSelectedCard(null)
                    }
                    setDragIndex(null)
                    setDragOverIndex(null)
                  }}
                  onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                  style={{
                    transform: `translateY(${ty}px) rotate(${rot}deg)`,
                    marginLeft: i === 0 ? 0 : (isMobile ? -28 : -22),
                    zIndex: isDragging ? 100 : (isSel ? 50 : i),
                    opacity: isDragging ? 0.35 : 1,
                    transition: isDragging ? 'none' : 'opacity 0.15s',
                  }}
                >
                  <div
                    className={i >= animateFrom ? 'salon-hand-deal' : ''}
                    style={{
                      animationDelay: i >= animateFrom
                        ? `${animateFrom === 0 ? getCardDelay(i, dealOrder) : (i - animateFrom) * 160}ms`
                        : undefined,
                      boxShadow: isDropTarget ? '0 0 0 2px var(--brass), 0 0 16px rgba(201,162,75,0.5)' : undefined,
                      borderRadius: 10,
                    }}
                  >
                    <CardFront
                      card={card}
                      size={isMobile ? 'sm' : 'lg'}
                      playable={canPlay}
                      faded={phaseState.phase === 'playing' && isMyPlayTurn && !canPlay}
                      selected={isSel}
                      onClick={canPlay ? () => setSelectedCard(i === selectedCard ? null : i) : undefined}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Action row */}
          <div className="salon-hand-actions">
            {phaseState.phase === 'playing' && isMyPlayTurn && (
              <>
                {beloteButtonLabel && (
                  <button
                    onClick={() => setBeloteEnabled(v => !v)}
                    className={beloteEnabled ? 'salon-primary-btn' : 'salon-secondary-btn'}
                    style={{ fontSize: 12, letterSpacing: '0.06em' }}
                  >
                    {beloteButtonLabel} {beloteEnabled ? '✓' : ''}
                  </button>
                )}
                <button
                  className="salon-primary-btn"
                  disabled={selectedCard == null}
                  onClick={() => selectedCard != null && playCard(selectedCard)}
                >
                  {selectedCard != null ? 'Jouer cette carte' : 'Sélectionne une carte'}
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      {/* ── Belote flash ── */}
      {beloteFlash && (
        <div style={{
          position: 'fixed', top: '28%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, pointerEvents: 'none', textAlign: 'center',
          animation: 'salonBeloteIn 0.35s cubic-bezier(.15,.85,.2,1)',
        }}>
          <div style={{
            background: 'linear-gradient(160deg, rgba(30,18,10,0.97), rgba(10,6,3,0.97))',
            border: '1px solid var(--brass)', borderRadius: 18,
            padding: '18px 40px', boxShadow: '0 0 0 1px rgba(201,162,75,0.2), 0 8px 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize: 26, fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--brass)', letterSpacing: '0.02em' }}>
              {beloteFlash.type === 'belote' ? 'Belote !' : 'Rebelote !'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6, letterSpacing: '0.06em' }}>
              {nameForPlayer(beloteFlash.playerId)}
            </div>
          </div>
        </div>
      )}

      {/* ── Aide toggle ── */}
      <label className={`salon-aide-toggle ${showAide ? 'is-active' : ''}`}>
        <input
          type="checkbox"
          checked={showAide}
          onChange={() => {
            const next = !showAide
            localStorage.setItem('belote_aide', next ? 'on' : 'off')
            setShowAide(next)
            setShowRefPanel(next)
          }}
        />
        <span className="salon-aide-joker">🃏</span>
        <span>Afficher l'aide</span>
        <span className="salon-aide-switch" />
      </label>

      {/* ── Card reference panel ── */}
      {showAide && showRefPanel && !isMobile && (
        <CardReferencePanel trump={activeTrump} onClose={() => setShowRefPanel(false)} />
      )}

      {/* ── Last trick modal ── */}
      {showLastTrick && lastTrick && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }}
          onClick={() => setShowLastTrick(false)}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #0e1a14, #060f0a)',
              border: '1px solid rgba(201,162,75,0.35)', borderRadius: 18,
              padding: isMobile ? '20px 16px' : '28px 32px',
              width: isMobile ? 'calc(100vw - 32px)' : 'auto', maxWidth: 420,
            }}
            onClick={e => e.stopPropagation()}
          >
            <p style={{ margin: '0 0 20px', textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)' }}>
              <span style={{ fontFamily: 'Fraunces, serif', color: 'var(--brass-soft)', fontWeight: 500, fontSize: 16 }}>
                {lastTrickWinnerId ? nameForPlayer(lastTrickWinnerId) : '—'}
              </span>
              {' '}a remporté le pli
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: isMobile ? 10 : 28, flexWrap: 'wrap' }}>
              {lastTrick.map(({ playerId, card }) => (
                <div key={playerId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: isMobile ? 56 : 88 }}>
                  <CardFront card={card} size={isMobile ? 'sm' : 'md'} />
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)', letterSpacing: '0.05em', width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nameForPlayer(playerId)}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowLastTrick(false)}
              className="salon-link-btn"
              style={{ display: 'block', margin: '20px auto 0', textAlign: 'center' }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Round end modal ── */}
      {roundEnd && !gameOver && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{
            background: 'linear-gradient(180deg, #0e1a14, #060f0a)',
            border: '1px solid rgba(201,162,75,0.35)', borderRadius: 22,
            padding: '36px 40px', maxWidth: 400, width: '90%', textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 12px', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--brass-soft)', fontWeight: 600 }}>
              Fin de manche
            </p>
            {(() => {
              if (roundEnd.litige) {
                return (
                  <div style={{ margin: '0 0 16px' }}>
                    <p style={{ margin: '0 0 4px', fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, color: 'var(--brass-soft)' }}>
                      Litige
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)' }}>
                      Égalité — {roundEnd.pendingLitigePoints} pts en jeu pour la prochaine manche.
                    </p>
                  </div>
                )
              }
              if (roundEnd.chute) {
                const loserTeam = roundEnd.trumpCallerTeam as 1 | 2
                return (
                  <p style={{ margin: '0 0 16px', fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, color: '#d97a4f' }}>
                    {teamNames[loserTeam]} est dedans. Cheh
                  </p>
                )
              }
              const isCapot = roundEnd.roundTeam1Points + roundEnd.roundTeam2Points > 162
              const winnerTeam = roundEnd.roundTeam1Points > roundEnd.roundTeam2Points ? 1 : 2
              if (isCapot) {
                return (
                  <p style={{ margin: '0 0 16px', fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, color: 'var(--brass)' }}>
                    {teamNames[winnerTeam]} est capot. Cheh
                  </p>
                )
              }
              return (
                <p style={{ margin: '0 0 16px', fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 500, color: 'var(--ink)' }}>
                  {teamNames[winnerTeam]} remporte la manche
                </p>
              )
            })()}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '20px 0' }}>
              <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 14, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--team1-soft)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{teamNames[1]}</p>
                <p style={{ margin: 0, fontFamily: 'Fraunces, serif', fontSize: 32, color: 'var(--ink)' }}>{roundEnd.roundTeam1Points}</p>
                {roundEnd.chute && roundEnd.trumpCallerTeam === 1 && (
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-faint)', textDecoration: 'line-through' }}>{roundEnd.team1Points}</p>
                )}
              </div>
              <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 14, padding: '14px 16px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--team2-soft)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{teamNames[2]}</p>
                <p style={{ margin: 0, fontFamily: 'Fraunces, serif', fontSize: 32, color: 'var(--ink)' }}>{roundEnd.roundTeam2Points}</p>
                {roundEnd.chute && roundEnd.trumpCallerTeam === 2 && (
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-faint)', textDecoration: 'line-through' }}>{roundEnd.team2Points}</p>
                )}
              </div>
            </div>
            <div style={{ borderTop: '1px solid rgba(201,162,75,0.20)', paddingTop: 16, marginBottom: 24 }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--ink-soft)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Total</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--team1-soft)' }}>{teamNames[1]}</p>
                  <p style={{ margin: 0, fontFamily: 'Fraunces, serif', fontSize: 24, color: 'var(--brass-soft)' }}>{roundEnd.team1Score}</p>
                </div>
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--team2-soft)' }}>{teamNames[2]}</p>
                  <p style={{ margin: 0, fontFamily: 'Fraunces, serif', fontSize: 24, color: 'var(--ink)' }}>{roundEnd.team2Score}</p>
                </div>
              </div>
            </div>
            <button className="salon-primary-btn" onClick={() => setRoundEnd(null)}>
              Continuer
            </button>
          </div>
        </div>
      )}

      {/* ── Game over modal ── */}
      {gameOver && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{
            background: 'linear-gradient(180deg, #0e1a14, #060f0a)',
            border: '1px solid var(--brass)', borderRadius: 22,
            padding: '40px 48px', maxWidth: 420, width: '90%', textAlign: 'center',
            boxShadow: '0 0 60px rgba(201,162,75,0.25)',
          }}>
            <p style={{ margin: '0 0 4px', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--brass-soft)', fontWeight: 600 }}>
              Partie terminée
            </p>
            <h2 style={{ margin: '8px 0 32px', fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 500, color: 'var(--ink)' }}>
              {teamNames[gameOver.winner]} gagne !
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
              {([1, 2] as const).map(team => (
                <div key={team} style={{
                  background: gameOver.winner === team ? (team === 1 ? 'rgba(91,155,213,0.12)' : 'rgba(82,169,106,0.12)') : 'rgba(0,0,0,0.35)',
                  border: gameOver.winner === team ? `1px solid var(--team${team})` : '1px solid rgba(246,241,227,0.08)',
                  borderRadius: 14, padding: '16px 20px',
                }}>
                  <p style={{ margin: '0 0 4px', fontSize: 11, color: `var(--team${team}-soft)`, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {teamNames[team]}
                  </p>
                  <p style={{ margin: '0 0 10px', fontFamily: 'Fraunces, serif', fontSize: 40, color: gameOver.winner === team ? `var(--team${team}-soft)` : 'var(--ink)' }}>
                    {team === 1 ? gameOver.team1Score : gameOver.team2Score}
                  </p>
                  {game.game_players.filter(p => p.team === team).map(p => {
                    const elo = eloUpdates?.find(u => u.playerId === p.player_id)
                    return (
                      <div key={p.player_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                          {p.profiles.display_name}
                        </span>
                        {elo ? (
                          <span style={{ fontSize: 12, fontFamily: 'Fraunces, serif', fontWeight: 600, color: elo.delta >= 0 ? 'var(--brass)' : '#e98e8e', flexShrink: 0, marginLeft: 6 }}>
                            {elo.delta >= 0 ? '+' : ''}{elo.delta} → {elo.newElo}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Elo…</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            {roundHistory.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <button
                  onClick={() => setShowRecap(v => !v)}
                  className="salon-ghost-btn"
                  style={{ width: '100%', justifyContent: 'center', fontSize: 12, letterSpacing: '0.08em' }}
                >
                  {showRecap ? '▲ Masquer le récap' : `▼ Voir le récap des ${roundHistory.length} manches`}
                </button>
                {showRecap && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                    {roundHistory.map(r => {
                      const callerName = r.trumpCallerId
                        ? (game.game_players.find(p => p.player_id === r.trumpCallerId)?.profiles.display_name ?? '?')
                        : '—'
                      const isCapot = r.trickCount1 === 8 || r.trickCount2 === 8
                      const isExpanded = expandedRoundIdx === r.roundIndex
                      return (
                        <div key={r.roundIndex}>
                          <div
                            onClick={() => setExpandedRoundIdx(isExpanded ? null : r.roundIndex)}
                            style={{
                              display: 'grid', gridTemplateColumns: '28px 28px 1fr auto 16px',
                              alignItems: 'center', gap: 8,
                              padding: '8px 10px', borderRadius: isExpanded ? '8px 8px 0 0' : 8,
                              background: isExpanded ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.07)',
                              borderBottom: isExpanded ? 'none' : undefined,
                              cursor: r.tricks.length > 0 ? 'pointer' : 'default',
                            }}
                          >
                            <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: "'Inter', sans-serif", textAlign: 'center' }}>
                              M{r.roundIndex}
                            </span>
                            <span style={{ fontSize: 20, textAlign: 'center', color: r.trump ? suitColor(r.trump) : 'var(--ink-faint)', lineHeight: 1 }}>
                              {r.trump ? SUIT_GLYPH[r.trump] : '—'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                              <span style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {callerName}
                              </span>
                              {r.chute && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(233,142,142,0.2)', color: '#e98e8e', flexShrink: 0 }}>CHUTE</span>}
                              {r.litige && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(201,162,75,0.2)', color: 'var(--brass)', flexShrink: 0 }}>LITIGE</span>}
                              {isCapot && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(201,162,75,0.2)', color: 'var(--brass)', flexShrink: 0 }}>CAPOT</span>}
                              {r.beloteTeam && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(167,215,164,0.2)', color: '#a7d7a4', flexShrink: 0 }}>BELOTE</span>}
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 12, fontFamily: "'Fraunces', serif" }}>
                                <span style={{ color: !r.litige && r.roundTeam1Points >= r.roundTeam2Points && !r.chute ? 'var(--brass-soft)' : 'var(--ink-soft)' }}>{r.roundTeam1Points}</span>
                                <span style={{ color: 'var(--ink-faint)', margin: '0 3px' }}>–</span>
                                <span style={{ color: !r.litige && r.roundTeam2Points > r.roundTeam1Points ? 'var(--brass-soft)' : 'var(--ink-soft)' }}>{r.roundTeam2Points}</span>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: "'Inter', sans-serif" }}>{r.team1Score} – {r.team2Score}</div>
                            </div>
                            {r.tricks.length > 0 && (
                              <span style={{ fontSize: 10, color: 'var(--ink-faint)', textAlign: 'center' }}>{isExpanded ? '▲' : '▼'}</span>
                            )}
                          </div>

                          {isExpanded && r.tricks.length > 0 && (
                            <div style={{
                              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
                              padding: '8px 10px', borderRadius: '0 0 8px 8px',
                              background: 'rgba(0,0,0,0.25)',
                              border: '1px solid rgba(255,255,255,0.07)', borderTop: 'none',
                            }}>
                              {r.tricks.map((trick, ti) => (
                                <div key={ti} style={{
                                  display: 'flex', alignItems: 'center', gap: 3,
                                  padding: '4px 5px', borderRadius: 5,
                                  background: trick.winnerTeam === 1 ? 'rgba(91,155,213,0.08)' : 'rgba(82,169,106,0.08)',
                                  border: `1px solid ${trick.winnerTeam === 1 ? 'rgba(91,155,213,0.2)' : 'rgba(82,169,106,0.2)'}`,
                                }}>
                                  <span style={{ fontSize: 9, color: 'var(--ink-faint)', width: 12, textAlign: 'center', flexShrink: 0, fontFamily: "'Inter', sans-serif" }}>
                                    {ti + 1}
                                  </span>
                                  {trick.cards.map(({ playerId, card }) => (
                                    <MicroCard key={playerId} card={card} highlighted={playerId === trick.winnerId} />
                                  ))}
                                  <span style={{ fontSize: 10, color: trick.winnerTeam === 1 ? 'var(--team1-soft)' : 'var(--team2-soft)', marginLeft: 1, flexShrink: 0, fontFamily: "'Fraunces', serif" }}>
                                    +{trick.points}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <button className="salon-primary-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/')}>
              Retour à l'accueil
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
