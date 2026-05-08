import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useSocket } from '../hooks/useSocket'
import type { Card, Suit } from '../types'
import { CardFront, CardBack, OpponentStack, SUIT_GLYPH, SUIT_LABEL, suitColor } from '../components/table/Card'
import { SeatBadge } from '../components/table/SeatBadge'
import { Tapis } from '../components/table/Tapis'
import type { TrickCard as TapisTrickCard } from '../components/table/Tapis'
import { CardReferencePanel } from '../components/table/CardReferencePanel'

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

const ALL_SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

function PassIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 20 22"
      fill="currentColor" aria-hidden="true"
      style={{ display: 'inline-block', flexShrink: 0 }}>
      <path d="M2,22 L2,5 Q2,3 3.5,3 Q5,3 5,5 L5,13 Q5,15 5.75,15 Q6.5,15 6.5,13 L6.5,2 Q6.5,0.5 8,0.5 Q9.5,0.5 9.5,2 L9.5,13 Q9.5,15 10.25,15 Q11,15 11,13 L11,3.5 Q11,2 12.5,2 Q14,2 14,3.5 L14,13 Q14,15 14.75,15 Q15.5,15 15.5,13 L15.5,6 Q15.5,4.5 17,4.5 Q18.5,4.5 18.5,6 L18.5,22 Z"/>
    </svg>
  )
}

function CuttingPanel({ onCut }: { onCut: (pos: number) => void }) {
  const [pos, setPos] = useState(16)
  const top = pos
  const bottom = 32 - pos
  const Pile = ({ count }: { count: number }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: 52, height: 80 }}>
        {[2, 1, 0].map(layer => (
          <div key={layer} style={{ position: 'absolute', bottom: layer * 3, left: 0 }}>
            <CardBack width={52} />
          </div>
        ))}
      </div>
      <span style={{ fontSize: 13, color: 'var(--brass)', fontFamily: 'Fraunces, serif', fontWeight: 600 }}>{count}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600 }}>
        Choisir où couper
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
        <Pile count={top} />
        <span style={{ fontSize: 18, color: 'var(--brass-soft)', marginBottom: 24, opacity: 0.7 }}>✂</span>
        <Pile count={bottom} />
      </div>
      <input type="range" min={6} max={26} step={1} value={pos}
        onChange={e => setPos(Number(e.target.value))}
        style={{ width: 140, accentColor: 'var(--brass)', cursor: 'pointer' }}
      />
      <button onClick={() => onCut(pos)} className="salon-primary-btn">Couper</button>
    </div>
  )
}

function BiddingPanel({ isMyTurn, onBid, allPassed, retourne, biddingRound }: {
  isMyTurn: boolean
  onBid: (action: 'pass' | 'take', suit?: Suit) => void
  allPassed: boolean
  retourne: Card | null
  biddingRound: 1 | 2
}) {
  if (allPassed) {
    return <p style={{ color: 'var(--brass-soft)', fontSize: 13 }}>Redistribution…</p>
  }
  if (!isMyTurn) {
    return retourne && biddingRound === 1 ? <CardFront card={retourne} /> : null
  }
  if (biddingRound === 2) {
    const choices = ALL_SUITS.filter(s => s !== retourne?.suit)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <p style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--brass-soft)', fontWeight: 600, margin: 0 }}>2ème tour</p>
        <div className="salon-bid-suits">
          {choices.map(s => (
            <button key={s} onClick={() => onBid('take', s)} className="salon-bid-suit-btn" style={{ color: suitColor(s) }}>
              <span className="salon-bid-suit-glyph">{SUIT_GLYPH[s]}</span>
              <span className="salon-bid-suit-name">{SUIT_LABEL[s]}</span>
            </button>
          ))}
        </div>
        <button onClick={() => onBid('pass')} className="salon-ghost-btn" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <PassIcon size={13} />
          Deux
        </button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {retourne && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>
            Prendre à{' '}
            <span style={{ color: suitColor(retourne.suit), fontFamily: 'Fraunces, serif', fontSize: 15 }}>
              {SUIT_GLYPH[retourne.suit]} {SUIT_LABEL[retourne.suit]}
            </span> ?
          </p>
          <CardFront card={retourne} />
        </div>
      )}
      <div className="salon-bid-actions">
        <button onClick={() => onBid('take')} className="salon-primary-btn">Prendre</button>
        <button onClick={() => onBid('pass')} className="salon-secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
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

  const storageKey = id ? `belote_game_${id}` : null

  const [game, setGame] = useState<GameData | null>(null)
  const [myHand, setMyHand] = useState<Card[]>(() => {
    if (!storageKey) return []
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}').hand ?? [] } catch { return [] }
  })
  const [opponentCardCounts, setOpponentCardCounts] = useState<Record<string, number>>({})
  const [selectedCard, setSelectedCard] = useState<number | null>(null)
  const [phaseState, setPhaseState] = useState<PhaseState>(() => {
    const defaults: PhaseState = { phase: 'waiting', currentPlayer: null, trump: null, trumpCallerId: null, team1Score: 0, team2Score: 0, biddingRound: 1, retourneSuit: null }
    if (!storageKey) return defaults
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '{}').phaseState ?? defaults } catch { return defaults }
  })
  const [stateLost, setStateLost] = useState(false)
  const [retourne, setRetourne] = useState<Card | null>(null)
  const [allPassed, setAllPassed] = useState(false)
  const [trickState, setTrickState] = useState<{
    trick: Array<{ playerId: string; card: Card }>
    currentPlayer: string
    team1Points: number
    team2Points: number
  } | null>(null)
  const [playableCards, setPlayableCards] = useState<Array<{ suit: Suit; value: string }>>([])
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
  const [showRefPanel, setShowRefPanel] = useState(false)
  const [showHint, setShowHint] = useState(true)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const didDragRef = useRef(false)
  const [myBeloteCount, setMyBeloteCount] = useState<0 | 1 | 2>(0)
  const [beloteEnabled, setBeloteEnabled] = useState(false)
  const [beloteFlash, setBeloteFlash] = useState<{ playerId: string; type: 'belote' | 'rebelote' } | null>(null)
  const [roundHistory, setRoundHistory] = useState<RoundSummary[]>([])
  const [showRecap, setShowRecap] = useState(false)
  const [teamNames, setTeamNames] = useState<{ 1: string; 2: string }>(
    (location.state as { teamNames?: { 1: string; 2: string } } | null)?.teamNames ?? { 1: 'Équipe 1', 2: 'Équipe 2' }
  )
  const roundTricksRef = useRef<TrickRecord[]>([])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Persist hand + phase to localStorage so refresh / back-and-return restores quickly
  useEffect(() => {
    if (!storageKey || myHand.length === 0) return
    try { localStorage.setItem(storageKey, JSON.stringify({ hand: myHand, phaseState })) } catch { /* ignore */ }
  }, [storageKey, myHand, phaseState])

  const fetchGame = useCallback(async () => {
    if (!id) return
    const { data } = await supabase
      .from('games')
      .select('id, status, created_by, game_players(player_id, position, team, profiles(id, display_name, elo, avatar_url))')
      .eq('id', id)
      .single()
    if (data) setGame(data as unknown as GameData)
  }, [id])

  const fetchGameRef = useRef(fetchGame)
  fetchGameRef.current = fetchGame

  useEffect(() => { fetchGame() }, [fetchGame])

  useEffect(() => {
    if (!socket || !id) return

    socket.on('game:hand', ({ playerId, cards, dealOrder: order, replace }: { playerId: string; cards: Card[]; dealOrder?: DealOrder; replace?: boolean }) => {
      if (playerId === user?.id) {
        if (order) setDealOrder(order)
        setAllPassed(false)
        if (replace) {
          // Reconnect / server-authoritative restore — replace hand as-is
          setMyHand(cards)
        } else if (cards.length === 5) {
          setLastTrick(null); setLastTrickWinnerId(null); setShowLastTrick(false)
          setTrickState(null); setPlayableCards([])
          setMyBeloteCount(0); setBeloteEnabled(false)
          if (order) {
            // Staged deal animation: show first batch then the rest after a delay
            const firstCount = order === '3-2' ? 3 : 2
            setMyHand(cards.slice(0, firstCount))
            setTimeout(() => setMyHand(cards), 1200)
          } else {
            setMyHand(cards)
          }
        } else {
          // Adding cards after bidding take (merge to avoid duplicates)
          setMyHand(prev => {
            const newCards = cards.filter(c => !prev.some(p => p.suit === c.suit && p.value === c.value))
            return [...prev, ...newCards]
          })
        }
      }
    })

    socket.on('game:card_count', ({ playerId, count }: { playerId: string; count: number }) => {
      if (playerId !== user?.id) setOpponentCardCounts(prev => ({ ...prev, [playerId]: count }))
    })

    socket.on('game:phase', (state: PhaseState) => { setPhaseState(state) })
    socket.on('game:retourne', (card: Card) => { setRetourne(card) })
    socket.on('game:all_passed', () => { setAllPassed(true); setTimeout(() => setAllPassed(false), 1500) })

    socket.on('game:trick_update', (state: {
      trick: Array<{ playerId: string; card: Card }>
      currentPlayer: string; team1Points: number; team2Points: number
    }) => { setTrickState(state) })

    socket.on('game:playable', (cards: Array<{ suit: Suit; value: string }>) => { setPlayableCards(cards) })

    socket.on('game:trick_won', (data: {
      winnerId: string; winnerTeam: 1 | 2; points: number
      trick: Array<{ playerId: string; card: Card }>
      team1Points: number; team2Points: number
    }) => {
      roundTricksRef.current.push({ cards: data.trick, winnerId: data.winnerId, winnerTeam: data.winnerTeam, points: data.points })
      setLastTrick(data.trick); setLastTrickWinnerId(data.winnerId)
      setTrickWon({ winnerId: data.winnerId, winnerTeam: data.winnerTeam, points: data.points })
      setTrickState(prev => prev ? { ...prev, trick: data.trick, team1Points: data.team1Points, team2Points: data.team2Points, currentPlayer: '' } : null)
      setPlayableCards([])
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
        roundIndex: prev.length + 1, trump: data.trump, trumpCallerId: data.trumpCallerId,
        roundTeam1Points: data.roundTeam1Points, roundTeam2Points: data.roundTeam2Points,
        team1Score: data.team1Score, team2Score: data.team2Score,
        chute: data.chute, litige: data.litige, beloteTeam: data.beloteTeam,
        trickCount1: tricks.filter(t => t.winnerTeam === 1).length,
        trickCount2: tricks.filter(t => t.winnerTeam === 2).length,
        tricks,
      }])
      setLastTrick(null); setLastTrickWinnerId(null); setShowLastTrick(false)
      setTimeout(() => { setTrickState(null); setRetourne(null); setRoundEnd(data) }, 3200)
    })

    socket.on('game:game_over', (data: { winner: 1 | 2; team1Score: number; team2Score: number }) => {
      if (id) try { localStorage.removeItem(`belote_game_${id}`) } catch { /* ignore */ }
      setTimeout(() => setGameOver(data), 3200)
    })

    socket.on('game:state_lost', () => setStateLost(true))

    socket.on('game:elo_update', (data: { updates: Array<{ playerId: string; delta: number; newElo: number }> }) => {
      setEloUpdates(data.updates)
    })

    socket.on('game:team_names', ({ gameId: gid, names }: { gameId: string; names: { 1: string; 2: string } }) => {
      if (gid === id) setTeamNames(names)
    })

    socket.on('game:lobby_updated', () => { fetchGameRef.current() })

    socket.emit('game:join', id)
    socket.emit('game:request_hand', id)

    return () => {
      socket.off('game:hand'); socket.off('game:card_count'); socket.off('game:phase')
      socket.off('game:retourne'); socket.off('game:all_passed'); socket.off('game:trick_update')
      socket.off('game:playable'); socket.off('game:trick_won'); socket.off('game:elo_update')
      socket.off('game:belote_announced'); socket.off('game:round_end'); socket.off('game:game_over')
      socket.off('game:team_names'); socket.off('game:lobby_updated'); socket.off('game:state_lost')
      socket.emit('game:leave', id)
    }
  }, [socket, id, user?.id])

  // Hooks before early return
  const isMyPlayTurn = phaseState.phase === 'playing' && trickState?.currentPlayer === user?.id

  // Derive playable indices from card identities — survives hand reordering
  const playableIndices = useMemo(
    () => myHand.reduce<number[]>((acc, card, i) => {
      if (playableCards.some(pc => pc.suit === card.suit && pc.value === card.value)) acc.push(i)
      return acc
    }, []),
    [myHand, playableCards]
  )

  const playCard = (cardIndex: number) => {
    if (!playableIndices.includes(cardIndex)) return
    if (trickState?.currentPlayer !== user?.id) return
    const card = myHand[cardIndex]
    socket?.emit('game:play_card', id, { suit: card.suit, value: card.value }, beloteEnabled || undefined)
    setBeloteEnabled(false)
    setMyHand(prev => prev.filter((_, i) => i !== cardIndex))
    setPlayableCards([])
    setSelectedCard(null)
  }

  const partnerIds = useMemo(() => {
    if (!game) return []
    const me = game.game_players.find(p => p.player_id === user?.id)
    if (!me) return []
    return game.game_players.filter(p => p.team === me.team && p.player_id !== user?.id).map(p => p.player_id)
  }, [game, user?.id])

  const hint = useMemo(() => {
    if (!isMyPlayTurn) return null
    return computeHint(playableIndices, myHand, phaseState.trump, trickState?.trick ?? [], partnerIds)
  }, [isMyPlayTurn, playableIndices, myHand, phaseState.trump, trickState?.trick, partnerIds])

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

  if (stateLost) {
    return (
      <div className="salon-root salon-loader-root">
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>La partie n'est plus disponible sur le serveur.</p>
          <button onClick={() => navigate('/')} className="salon-secondary-btn">Retour au salon</button>
        </div>
      </div>
    )
  }

  if (!game) {
    return (
      <div className="salon-root salon-loader-root">
        <div className="salon-loader-spinner" />
      </div>
    )
  }

  const byPosition = Object.fromEntries(game.game_players.map(p => [p.position, p]))
  const me = game.game_players.find(p => p.player_id === user?.id)
  const myPosition = me?.position ?? 1
  const meTeam = me?.team ?? 1

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

  const nameForPlayer = (playerId: string) =>
    game.game_players.find(p => p.player_id === playerId)?.profiles.display_name ?? '?'

  const trickLeaderId = getTrickLeaderId(trickState?.trick ?? [], phaseState.trump)
  const slotForPlayer = (playerId: string): 'top' | 'left' | 'right' | 'bottom' => {
    if (playerId === user?.id) return 'bottom'
    if (playerByPos('top')?.player_id === playerId) return 'top'
    if (playerByPos('left')?.player_id === playerId) return 'left'
    return 'right'
  }

  const displayTrick: TapisTrickCard[] = (trickState?.trick ?? []).map(({ playerId, card }) => ({
    playerId, card,
    fromSlot: slotForPlayer(playerId),
    playerName: nameForPlayer(playerId),
    isMaster: playerId === trickLeaderId,
  }))

  const ledSuit = trickState?.trick?.[0]?.card?.suit ?? null
  const tapisTrump = phaseState.phase === 'playing' ? phaseState.trump : null
  const tapisLedSuit = trickState && trickState.trick.length > 0 && trickState.trick.length < 4 ? ledSuit : null

  const topPlayer = playerByPos('top')
  const leftPlayer = playerByPos('left')
  const rightPlayer = playerByPos('right')

  const isMyCut = phaseState.phase === 'cutting' && phaseState.currentPlayer === user?.id
  const cutter = game.game_players.find(p => p.player_id === phaseState.currentPlayer)

  const fanSpread = Math.min(28, myHand.length * 4)

  // Tapis center content by phase
  const tapisCenter = (() => {
    if (phaseState.phase === 'cutting') {
      return isMyCut
        ? <CuttingPanel onCut={pos => socket?.emit('game:cut_deck', id, pos)} />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ transform: `rotate(${(i - 2) * 4}deg)`, marginLeft: i > 0 ? -20 : 0 }}>
                  <CardBack width={52} />
                </div>
              ))}
            </div>
            <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>{cutter?.profiles.display_name ?? '?'} coupe…</p>
          </div>
        )
    }
    if (phaseState.phase === 'dealing') {
      const isMyDeal = phaseState.currentPlayer === user?.id
      const dealer = game.game_players.find(p => p.player_id === phaseState.currentPlayer)
      if (isMyDeal) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 600 }}>Ordre de distribution</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['3-2', '3 puis 2'], ['2-3', '2 puis 3']] as [DealOrder, string][]).map(([o, label]) => (
                <button key={o} onClick={() => setDealOrder(o)}
                  className={dealOrder === o ? 'salon-primary-btn' : 'salon-secondary-btn'}
                  style={{ padding: '8px 16px' }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => socket?.emit('game:deal', id, dealOrder)} className="salon-primary-btn">Distribuer</button>
          </div>
        )
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ transform: `rotate(${(i - 2) * 4}deg)`, marginLeft: i > 0 ? -20 : 0 }}>
                <CardBack width={52} />
              </div>
            ))}
          </div>
          <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 13 }}>{dealer?.profiles.display_name ?? '?'} distribue…</p>
        </div>
      )
    }
    if (phaseState.phase === 'bidding') {
      return (
        <BiddingPanel
          isMyTurn={isMyBiddingTurn}
          onBid={(action, suit) => socket?.emit('game:bid', id, action, suit)}
          allPassed={allPassed}
          retourne={retourne}
          biddingRound={phaseState.biddingRound}
        />
      )
    }
    if (phaseState.phase === 'playing') {
      return (
        <Tapis
          trump={tapisTrump}
          trumpCallerName={phaseState.trumpCallerId ? nameForPlayer(phaseState.trumpCallerId) : null}
          trick={displayTrick}
          ledSuit={tapisLedSuit}
          compact={false}
        />
      )
    }
    return <span style={{ color: 'var(--ink-soft)', fontSize: 13, fontStyle: 'italic' }}>En attente…</span>
  })()

  const myScore = meTeam === 1 ? phaseState.team1Score : phaseState.team2Score
  const oppScore = meTeam === 1 ? phaseState.team2Score : phaseState.team1Score
  const myRoundPoints = meTeam === 1 ? trickState?.team1Points : trickState?.team2Points
  const oppRoundPoints = meTeam === 1 ? trickState?.team2Points : trickState?.team1Points

  return (
    <div className="salon-root salon-game-root">
      {/* Top bar — margin-top keeps it inside the decorative border */}
      <div className="salon-score-strip">
        <button className="salon-back-btn" onClick={() => navigate('/')}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5"/></svg>
          <span className="salon-hide-xs">Salon</span>
        </button>
      </div>

      {/* Felt */}
      <main className="salon-game-felt">

        {/* Scores — top-right corner of the felt grid */}
        <div className="salon-felt-score-row">
          <div className={`salon-score salon-score-brass ${trickWon?.winnerTeam === meTeam ? 'salon-score-flash' : ''}`}>
            <span className="salon-score-label">{teamNames[meTeam]}</span>
            <span className="salon-score-num">
              {myScore}
              {myRoundPoints != null && myRoundPoints > 0 && (
                <span style={{ fontSize: 12, color: 'var(--brass)', marginLeft: 4 }}>+{myRoundPoints}</span>
              )}
            </span>
          </div>
          <span className="salon-score-sep">–</span>
          <div className={`salon-score ${trickWon && trickWon.winnerTeam !== meTeam ? 'salon-score-flash' : ''}`}>
            <span className="salon-score-label">{teamNames[meTeam === 1 ? 2 : 1]}</span>
            <span className="salon-score-num">
              {oppScore}
              {oppRoundPoints != null && oppRoundPoints > 0 && (
                <span style={{ fontSize: 12, color: 'var(--ink-dim)', marginLeft: 4 }}>+{oppRoundPoints}</span>
              )}
            </span>
          </div>
        </div>

        {/* Top (partner) */}
        <div className="salon-game-seat--n">
          {topPlayer && (
            <>
              <SeatBadge
                name={topPlayer.profiles.display_name}
                team={topPlayer.team}
                elo={topPlayer.profiles.elo}
                active={isCurrentPlayerFor(topPlayer.player_id)}
              />
              {cardCountFor(topPlayer) > 0 && (
                <div className="salon-game-stack salon-game-stack--n">
                  <OpponentStack count={Math.min(cardCountFor(topPlayer), 8)} orientation="row" />
                </div>
              )}
            </>
          )}
        </div>

        {/* Left */}
        <div className="salon-game-seat--w">
          {leftPlayer && (
            <>
              <SeatBadge
                name={leftPlayer.profiles.display_name}
                team={leftPlayer.team}
                elo={leftPlayer.profiles.elo}
                active={isCurrentPlayerFor(leftPlayer.player_id)}
              />
              {cardCountFor(leftPlayer) > 0 && (
                <div className="salon-game-stack salon-game-stack--w">
                  <OpponentStack count={Math.min(cardCountFor(leftPlayer), 8)} orientation="row" cardWidth={30} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Center */}
        <div className="salon-game-center">
          <div className="salon-game-center-inner">
            {tapisCenter}
            {trickWon && (
              <div className="salon-trick-won-flash" data-team={trickWon.winnerTeam}>
                <p style={{ margin: 0 }}>+{trickWon.points} pts · {nameForPlayer(trickWon.winnerId)}</p>
              </div>
            )}
          </div>
          {lastTrick && (
            <button onClick={() => setShowLastTrick(s => !s)} className="salon-last-trick-btn">
              {showLastTrick ? 'Masquer le pli' : 'Dernier pli'}
            </button>
          )}
        </div>

        {/* Right */}
        <div className="salon-game-seat--e">
          {rightPlayer && (
            <>
              <SeatBadge
                name={rightPlayer.profiles.display_name}
                team={rightPlayer.team}
                elo={rightPlayer.profiles.elo}
                active={isCurrentPlayerFor(rightPlayer.player_id)}
              />
              {cardCountFor(rightPlayer) > 0 && (
                <div className="salon-game-stack salon-game-stack--e">
                  <OpponentStack count={Math.min(cardCountFor(rightPlayer), 8)} orientation="row" cardWidth={30} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Me */}
        <div className="salon-game-me">
          {me && (
            <div className="salon-me-badge-row">
              <div className={`salon-me-badge ${isMyTurn ? 'is-turn' : ''}`}>
                <span className="salon-me-avatar">{me.profiles.display_name[0]?.toUpperCase()}</span>
                <span className="salon-me-meta">
                  {isMyTurn && (
                    <span className="salon-me-turn-inline">
                      {isMyBiddingTurn ? 'À toi de parler' : 'À toi de jouer'}
                    </span>
                  )}
                  <span className="salon-me-name">{me.profiles.display_name}</span>
                  <span className="salon-me-sub">
                    <span className={`salon-team-pip salon-team-${me.team}`} />
                    {teamNames[me.team]}
                  </span>
                  <span className="salon-me-elo">{me.profiles.elo} Elo</span>
                </span>
              </div>
            </div>
          )}

          {/* Always reserve hint space so layout doesn't shift */}
          <p className="salon-hint-text" style={{ visibility: (showHint && !!hint) ? 'visible' : 'hidden' }}>
            {hint || ' '}
          </p>

          {/* Hand fan */}
          <div className="salon-hand-row"
            style={{ '--fan-spread': `${fanSpread}deg`, '--hand-count': myHand.length } as React.CSSProperties}>
            {myHand.map((card, i) => {
              const angle = myHand.length > 1
                ? (i - (myHand.length - 1) / 2) * (fanSpread / Math.max(myHand.length - 1, 1))
                : 0
              const lift = Math.abs(angle) * 0.6
              const canPlay = phaseState.phase === 'playing' && isMyPlayTurn && playableIndices.includes(i)
              const isSel = selectedCard === i
              const isDragging = dragIndex === i
              const isDropTarget = dragOverIndex === i && dragIndex !== null && dragIndex !== i
              return (
                <div
                  key={`${card.suit}-${card.value}`}
                  className="salon-hand-slot"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragIndex(i); didDragRef.current = true }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIndex(i) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIndex !== null && dragIndex !== i) {
                      setMyHand(prev => reorderArray(prev, dragIndex, i))
                      setSelectedCard(null)
                    }
                    setDragIndex(null); setDragOverIndex(null)
                  }}
                  onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                  style={{
                    transform: `rotate(${angle}deg) translateY(${lift}px)`,
                    marginLeft: i === 0 ? 0 : 'calc(var(--card-w) * -0.40)',
                    zIndex: isDragging ? 100 : (isSel ? 50 : i),
                    opacity: isDragging ? 0.35 : 1,
                    boxShadow: isDropTarget ? '0 0 0 2px var(--brass), 0 0 16px rgba(201,162,75,0.5)' : undefined,
                    borderRadius: 8,
                    animationDelay: `${i * 110}ms`,
                  }}
                >
                  <CardFront
                    card={card}
                    playable={canPlay}
                    faded={phaseState.phase === 'playing' && isMyPlayTurn && !canPlay}
                    selected={isSel}
                    onClick={canPlay ? () => {
                    if (didDragRef.current) { didDragRef.current = false; return }
                    setSelectedCard(i === selectedCard ? null : i)
                  } : undefined}
                  />
                </div>
              )
            })}
          </div>

          {/* Actions */}
          <div className="salon-hand-actions">
            {phaseState.phase === 'playing' && isMyPlayTurn && (
              <>
                {beloteButtonLabel && (
                  <button
                    onClick={() => setBeloteEnabled(v => !v)}
                    className={beloteEnabled ? 'salon-primary-btn' : 'salon-secondary-btn'}
                    style={{ fontSize: 12 }}
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

      {/* Bottom-left corner stack: card reference + aide toggle */}
      <div className="salon-corner-stack">
        {showRefPanel && (
          <CardReferencePanel trump={phaseState.trump} onClose={() => setShowRefPanel(false)} />
        )}
        <div className="salon-corner-btns">
          <button
            className={`salon-ref-corner-btn ${showRefPanel ? 'is-active' : ''}`}
            onClick={() => setShowRefPanel(s => !s)}
            title="Valeur des cartes"
            aria-label="Valeur des cartes"
          >
            <span className="salon-ref-corner-suit">A</span>
            <span className="salon-ref-corner-glyph">♠</span>
          </button>
          <button
            role="switch"
            aria-checked={showHint}
            className={`salon-aide-toggle ${showHint ? 'is-active' : ''}`}
            onClick={() => setShowHint(v => !v)}
            title={showHint ? 'Masquer les conseils' : 'Afficher les conseils'}
          >
            <span className="salon-aide-track"><span className="salon-aide-knob" /></span>
            <span className="salon-aide-label">Aide</span>
          </button>
        </div>
      </div>

      {/* Belote flash */}
      {beloteFlash && (
        <div style={{
          position: 'fixed', top: '28%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, pointerEvents: 'none', textAlign: 'center',
          animation: 'salonDealIn 0.35s cubic-bezier(.15,.85,.2,1)',
        }}>
          <div style={{
            background: 'linear-gradient(160deg, rgba(30,18,10,0.97), rgba(10,6,3,0.97))',
            border: '1px solid var(--brass)', borderRadius: 18,
            padding: '16px 36px', boxShadow: '0 0 0 1px rgba(201,162,75,0.2), 0 8px 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize: 24, fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--brass)', letterSpacing: '0.02em' }}>
              {beloteFlash.type === 'belote' ? 'Belote !' : 'Rebelote !'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>{nameForPlayer(beloteFlash.playerId)}</div>
          </div>
        </div>
      )}

      {/* Last trick modal */}
      {showLastTrick && lastTrick && (
        <div className="salon-modal-overlay" onClick={() => setShowLastTrick(false)}>
          <div className="salon-modal" onClick={e => e.stopPropagation()}>
            <h3 className="salon-modal-title">
              {lastTrickWinnerId ? nameForPlayer(lastTrickWinnerId) : '—'} a remporté le pli
            </h3>
            <div className="salon-modal-trick">
              {lastTrick.map(({ playerId, card }) => (
                <div key={playerId} className="salon-trick-slot">
                  <CardFront card={card} />
                  <span className="salon-trick-label">{nameForPlayer(playerId)}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setShowLastTrick(false)} className="salon-secondary-btn">Fermer</button>
          </div>
        </div>
      )}

      {/* Round end modal */}
      {roundEnd && !gameOver && (
        <div className="salon-modal-overlay">
          <div className="salon-modal">
            <h3 className="salon-modal-title">
              {roundEnd.litige ? 'Litige' : roundEnd.chute ? `${teamNames[roundEnd.trumpCallerTeam as 1|2]} est dedans` : 'Manche terminée'}
            </h3>
            {roundEnd.litige && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-soft)' }}>
                Égalité — {roundEnd.pendingLitigePoints} pts en jeu pour la prochaine manche.
              </p>
            )}
            <div className="salon-round-grid">
              <div className="salon-round-col">
                <span className="salon-score-label">{teamNames[1]}</span>
                <span className="salon-score-num">{roundEnd.roundTeam1Points}</span>
                <span className="salon-round-cumul">Total · {roundEnd.team1Score}</span>
              </div>
              <div className="salon-round-col">
                <span className="salon-score-label">{teamNames[2]}</span>
                <span className="salon-score-num">{roundEnd.roundTeam2Points}</span>
                <span className="salon-round-cumul">Total · {roundEnd.team2Score}</span>
              </div>
            </div>
            {roundHistory.length > 0 && (
              <div style={{ width: '100%' }}>
                <button onClick={() => setShowRecap(v => !v)} className="salon-link-btn" style={{ width: '100%', justifyContent: 'center' }}>
                  <span className="salon-link-bullet" />
                  {showRecap ? 'Masquer le récap' : `Récap des ${roundHistory.length} manches`}
                </button>
                {showRecap && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {roundHistory.map(r => (
                      <div key={r.roundIndex}
                        style={{ display: 'grid', gridTemplateColumns: '24px 24px 1fr auto', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <span style={{ fontSize: 9, color: 'var(--ink-faint)', textAlign: 'center' }}>M{r.roundIndex}</span>
                        <span style={{ fontSize: 18, color: r.trump ? suitColor(r.trump) : 'var(--ink-faint)', textAlign: 'center' }}>{r.trump ? SUIT_GLYPH[r.trump] : '—'}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.trumpCallerId ? nameForPlayer(r.trumpCallerId) : '—'}
                          {r.chute && <span style={{ marginLeft: 4, fontSize: 9, color: '#e98e8e', fontWeight: 700 }}>CHUTE</span>}
                          {r.litige && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--brass)', fontWeight: 700 }}>LITIGE</span>}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'Fraunces, serif', textAlign: 'right' }}>
                          <span style={{ color: 'var(--brass-soft)' }}>{r.roundTeam1Points}</span>
                          <span style={{ color: 'var(--ink-faint)', margin: '0 3px' }}>–</span>
                          <span style={{ color: 'var(--ink-soft)' }}>{r.roundTeam2Points}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button className="salon-primary-btn" onClick={() => setRoundEnd(null)}>Continuer</button>
          </div>
        </div>
      )}

      {/* Game over modal */}
      {gameOver && (
        <div className="salon-modal-overlay">
          <div className="salon-modal salon-modal--end">
            <p className="salon-game-end-eyebrow">{gameOver.winner === meTeam ? '🏆 Victoire !' : 'Défaite'}</p>
            <h3 className="salon-modal-title">{teamNames[gameOver.winner]} gagne !</h3>
            <div className="salon-round-grid">
              {([1, 2] as const).map(team => (
                <div key={team} className="salon-round-col" style={{ border: gameOver.winner === team ? '1px solid var(--brass)' : undefined }}>
                  <span className="salon-score-label">{teamNames[team]}</span>
                  <span className="salon-score-num" style={{ color: gameOver.winner === team ? 'var(--brass-soft)' : 'var(--ink)' }}>
                    {team === 1 ? gameOver.team1Score : gameOver.team2Score}
                  </span>
                  {game.game_players.filter(p => p.team === team).map(p => {
                    const elo = eloUpdates?.find(u => u.playerId === p.player_id)
                    return (
                      <div key={p.player_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.profiles.display_name}
                        </span>
                        {elo && (
                          <span style={{ fontSize: 12, fontFamily: 'Fraunces, serif', fontWeight: 600, color: elo.delta >= 0 ? 'var(--brass)' : '#e98e8e', flexShrink: 0 }}>
                            {elo.delta >= 0 ? '+' : ''}{elo.delta}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <button className="salon-primary-btn" onClick={() => navigate('/')}>Retour au salon</button>
          </div>
        </div>
      )}
    </div>
  )
}
