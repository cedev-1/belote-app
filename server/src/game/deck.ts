export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type CardValue = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'
export type DealOrder = '3-2' | '2-3'

export interface Card {
  suit: Suit
  value: CardValue
}

export interface InitialDeal {
  hands: Map<string, Card[]>  // 5 cartes par joueur
  retourne: Card               // la carte retournée
  remainingDeck: Card[]        // 11 cartes restantes
}

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const VALUES: CardValue[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => VALUES.map((value) => ({ suit, value })))
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function shuffleDeck(deck: Card[]): Card[] {
  return shuffle(deck)
}

// Distribue 5 cartes par joueur selon l'ordre choisi (3+2 ou 2+3)
function distribute(deck: Card[], playerIds: string[], dealOrder: DealOrder): Map<string, Card[]> {
  const [first, second] = dealOrder === '3-2' ? [3, 2] : [2, 3]
  const hands = new Map<string, Card[]>()

  // Premier lot
  playerIds.forEach((id, i) => {
    hands.set(id, deck.slice(i * first, (i + 1) * first))
  })
  // Second lot
  const offset = playerIds.length * first
  playerIds.forEach((id, i) => {
    hands.get(id)!.push(...deck.slice(offset + i * second, offset + (i + 1) * second))
  })

  return hands
}

// Phase 1 : mélange unique (première donne de la partie)
export function initialDeal(playerIds: string[], dealOrder: DealOrder = '3-2'): InitialDeal {
  const deck = shuffle(createDeck())
  return dealFromDeck(deck, playerIds, dealOrder)
}

// Distribue depuis un jeu existant (sans mélanger)
export function dealFromDeck(deck: Card[], playerIds: string[], dealOrder: DealOrder = '3-2'): InitialDeal {
  const hands = distribute(deck, playerIds, dealOrder)
  const retourne = deck[20]
  const remainingDeck = deck.slice(21)
  return { hands, retourne, remainingDeck }
}

// Phase 2 : après prise, compléter les mains à 8 cartes
export function completeDeal(
  hands: Map<string, Card[]>,
  remainingDeck: Card[],
  retourne: Card,
  trumpCallerId: string,
  playerOrder: string[]
): Map<string, Card[]> {
  const updatedHands = new Map(Array.from(hands.entries()).map(([k, v]) => [k, [...v]]))
  let deckIdx = 0

  for (const playerId of playerOrder) {
    const hand = updatedHands.get(playerId)!
    if (playerId === trumpCallerId) {
      hand.push(retourne)
      hand.push(remainingDeck[deckIdx++])
      hand.push(remainingDeck[deckIdx++])
    } else {
      hand.push(remainingDeck[deckIdx++])
      hand.push(remainingDeck[deckIdx++])
      hand.push(remainingDeck[deckIdx++])
    }
  }

  return updatedHands
}
