import type { Server, Socket } from 'socket.io'
import { supabase } from '../lib/supabase'
import { completeDeal, dealFromDeck, shuffleDeck, createDeck } from '../game/deck'
import type { Card, Suit, DealOrder } from '../game/deck'
import { getPlayableIndices, getTrickWinner, getTrickPoints } from '../game/rules'
import type { TrickCard } from '../game/rules'

interface OnlinePlayer {
  id: string
  display_name: string
  elo: number
}

type Phase = 'waiting' | 'bidding' | 'playing' | 'cutting' | 'dealing'

interface PlayPhase {
  currentPlayerIndex: number
  trick: TrickCard[]
  trickLeaderIndex: number
  tricksPlayed: number
  team1Points: number
  team2Points: number
  team1Tricks: number
  team2Tricks: number
}

interface GameState {
  hands: Map<string, Card[]>
  playerOrder: string[]
  playerTeams: Record<string, 1 | 2>
  createdBy: string
  phase: Phase
  biddingTurnIndex: number
  biddingRound: 1 | 2
  passCount: number
  trump: Suit | null
  trumpCallerId: string | null
  retourne: Card | null
  remainingDeck: Card[]
  play: PlayPhase | null
  // Scores cumulatifs
  team1Score: number
  team2Score: number
  // Points en attente suite à un litige (mis en jeu à la prochaine manche)
  litigePoints: number
  // Deck persisté entre manches (jamais mélangé)
  persistedDeck: Card[]
  currentRoundCards: Card[]
  dealOrder: DealOrder
  // Belote/Rebelote tracking
  belotePlayerId: string | null
  beloteCount: 0 | 1 | 2
  targetScore: number
}

// socketId -> userId
const socketToUser = new Map<string, string>()
// userId -> Set<socketId>
const userToSockets = new Map<string, Set<string>>()
// userId -> { player, connectionCount }
const onlineUsers = new Map<string, { player: OnlinePlayer; count: number }>()
// gameId -> GameState
const gameStates = new Map<string, GameState>()
// gameId -> team names
const gameTeamNames = new Map<string, { 1: string; 2: string }>()

function sendHands(
  io: Server,
  playerOrder: string[],
  hands: Map<string, Card[]>,
  userToSockets: Map<string, Set<string>>,
  dealOrder?: DealOrder
) {
  for (const playerId of playerOrder) {
    const cards = hands.get(playerId)
    if (!cards) continue
    const sockets = userToSockets.get(playerId)
    if (sockets) {
      for (const socketId of sockets) {
        io.to(socketId).emit('game:hand', { playerId, cards, ...(dealOrder ? { dealOrder } : {}) })
      }
    }
  }
}

function broadcastOnlinePlayers(io: Server) {
  const players = Array.from(onlineUsers.values()).map((e) => e.player)
  io.emit('players:online', players)
}

function broadcastTrickState(io: Server, state: GameState) {
  if (!state.play) return
  broadcastToGame(io, state, 'game:trick_update', {
    trick: state.play.trick,
    currentPlayer: state.playerOrder[state.play.currentPlayerIndex],
    team1Points: state.play.team1Points,
    team2Points: state.play.team2Points,
  })
  for (const playerId of state.playerOrder) {
    const hand = state.hands.get(playerId) ?? []
    const myTeam = state.playerTeams[playerId]
    const playableIdx = getPlayableIndices(hand, state.play.trick, state.trump!, myTeam, state.playerTeams)
    const playableCards = playableIdx.map(i => ({ suit: hand[i].suit, value: hand[i].value }))
    const sockets = userToSockets.get(playerId)
    if (sockets) {
      for (const socketId of sockets) {
        io.to(socketId).emit('game:playable', playableCards)
      }
    }
  }
}

function broadcastToGame(io: Server, state: GameState, event: string, data: unknown) {
  for (const playerId of state.playerOrder) {
    const sockets = userToSockets.get(playerId)
    if (sockets) {
      for (const socketId of sockets) {
        io.to(socketId).emit(event, data)
      }
    }
  }
}

function phasePayload(state: GameState) {
  return {
    phase: state.phase,
    currentPlayer:
      state.phase === 'bidding' ? state.playerOrder[state.biddingTurnIndex] :
      state.phase === 'playing' ? (state.play ? state.playerOrder[state.play.currentPlayerIndex] : null) :
      state.phase === 'cutting' ? state.playerOrder[state.playerOrder.length - 1] :
      state.phase === 'dealing' ? state.playerOrder[0] :
      null,
    trump: state.trump,
    trumpCallerId: state.trumpCallerId,
    team1Score: state.team1Score,
    team2Score: state.team2Score,
    biddingRound: state.biddingRound,
    retourneSuit: state.retourne?.suit ?? null,
  }
}

function broadcastPhase(io: Server, _gameId: string, state: GameState) {
  broadcastToGame(io, state, 'game:phase', phasePayload(state))
}

function startBidding(io: Server, gameId: string, state: GameState) {
  state.phase = 'bidding'
  state.biddingTurnIndex = 1  // Premier enchérisseur = à gauche du donneur (playerOrder[0])
  state.passCount = 0
  state.biddingRound = 1
  broadcastPhase(io, gameId, state)
}

// Reconstruit le deck ordonné depuis les mains actuelles (utilisé avant couper/redistribuer)
function buildDeckFromHands(state: GameState): Card[] {
  return [
    ...state.playerOrder.flatMap(id => [...(state.hands.get(id) ?? [])]),
    ...(state.retourne ? [state.retourne] : []),
    ...state.remainingDeck,
  ]
}

function emptyGameState(
  ordered: { player_id: string; position: number; team: 1 | 2 }[],
  playerTeams: Record<string, 1 | 2>,
  createdBy: string,
  existingScores?: { team1Score: number; team2Score: number; litigePoints: number; persistedDeck: Card[] }
): GameState {
  return {
    hands: new Map(),
    playerOrder: ordered.map((p) => p.player_id),
    playerTeams,
    createdBy,
    phase: 'waiting',
    biddingTurnIndex: 1,
    biddingRound: 1,
    passCount: 0,
    trump: null,
    trumpCallerId: null,
    retourne: null,
    remainingDeck: [],
    play: null,
    team1Score: existingScores?.team1Score ?? 0,
    team2Score: existingScores?.team2Score ?? 0,
    litigePoints: existingScores?.litigePoints ?? 0,
    persistedDeck: existingScores?.persistedDeck ?? [],
    currentRoundCards: [],
    dealOrder: '3-2',
    belotePlayerId: null,
    beloteCount: 0,
    targetScore: 1000,
  }
}

async function updateEloAndFinishGame(io: Server, state: GameState, gameId: string, winner: 1 | 2) {
  const { data: gamePlayers } = await (supabase
    .from('game_players') as any)
    .select('player_id, team, elo_before, profiles(games_played, games_won)')
    .eq('game_id', gameId)

  if (!gamePlayers || gamePlayers.length === 0) return

  const team1 = gamePlayers.filter((p: any) => p.team === 1)
  const team2 = gamePlayers.filter((p: any) => p.team === 2)
  if (team1.length === 0 || team2.length === 0) return

  const avgElo1 = team1.reduce((s: number, p: any) => s + (p.elo_before ?? 1000), 0) / team1.length
  const avgElo2 = team2.reduce((s: number, p: any) => s + (p.elo_before ?? 1000), 0) / team2.length

  const K = 32
  const expected1 = 1 / (1 + Math.pow(10, (avgElo2 - avgElo1) / 400))
  const delta1 = Math.round(K * ((winner === 1 ? 1 : 0) - expected1))
  const delta2 = -delta1

  const eloUpdates: Array<{ playerId: string; delta: number; newElo: number }> = []

  for (const p of gamePlayers as any[]) {
    const delta = p.team === 1 ? delta1 : delta2
    const newElo = Math.max(100, (p.elo_before ?? 1000) + delta)
    eloUpdates.push({ playerId: p.player_id, delta, newElo })

    const gamesPlayed = (p.profiles?.games_played ?? 0) + 1
    const gamesWon = (p.profiles?.games_won ?? 0) + (p.team === winner ? 1 : 0)

    await supabase.from('profiles')
      .update({ elo: newElo, games_played: gamesPlayed, games_won: gamesWon })
      .eq('id', p.player_id)

    await supabase.from('game_players' as any)
      .update({ elo_after: newElo })
      .eq('game_id', gameId)
      .eq('player_id', p.player_id)
  }

  await (supabase.from('games') as any).update({
    status: 'finished',
    winning_team: winner,
    finished_at: new Date().toISOString(),
    team1_score: state.team1Score,
    team2_score: state.team2Score,
  }).eq('id', gameId)

  broadcastToGame(io, state, 'game:elo_update', { updates: eloUpdates })
}

export function registerSocketHandlers(io: Server) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) {
      next(new Error('Authentication required'))
      return
    }

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) {
      next(new Error('Invalid token'))
      return
    }

    socket.data.userId = user.id
    next()
  })

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string

    // Register immediately so broadcastToGame reaches this player before the async profile fetch.
    socketToUser.set(socket.id, userId)
    const initSockets = userToSockets.get(userId) ?? new Set()
    initSockets.add(socket.id)
    userToSockets.set(userId, initSockets)

    // Register all handlers synchronously so events emitted immediately on connection
    // (e.g. game:join buffered by Socket.IO during handshake) are not dropped.
    socket.on('games:refresh', () => {
      io.emit('games:updated')
    })

    socket.on('game:join', async (gameId: string) => {
      socket.join(`game:${gameId}`)
      io.to(`game:${gameId}`).emit('game:lobby_updated')
      const state = gameStates.get(gameId)
      if (state) {
        socket.emit('game:phase', phasePayload(state))
        const cards = state.hands.get(userId)
        if (cards) socket.emit('game:hand', { playerId: userId, cards, replace: true })
        if (state.retourne) socket.emit('game:retourne', state.retourne)
        for (const playerId of state.playerOrder) {
          const count = state.hands.get(playerId)?.length ?? 0
          socket.emit('game:card_count', { playerId, count })
        }
        if (state.phase === 'playing' && state.play && state.trump) {
          socket.emit('game:trick_update', {
            trick: state.play.trick,
            currentPlayer: state.playerOrder[state.play.currentPlayerIndex],
            team1Points: state.play.team1Points,
            team2Points: state.play.team2Points,
          })
          const hand = state.hands.get(userId) ?? []
          const myTeam = state.playerTeams[userId]
          const playableIdx = getPlayableIndices(hand, state.play.trick, state.trump, myTeam, state.playerTeams)
          socket.emit('game:playable', playableIdx.map(i => ({ suit: hand[i].suit, value: hand[i].value })))
        }
      }
      let teamNames = gameTeamNames.get(gameId)
      if (!teamNames) {
        const { data: gameRow } = await supabase.from('games').select('team1_name, team2_name').eq('id', gameId).single()
        teamNames = { 1: gameRow?.team1_name ?? 'Équipe 1', 2: gameRow?.team2_name ?? 'Équipe 2' }
        gameTeamNames.set(gameId, teamNames)
      }
      socket.emit('game:team_names', { gameId, names: teamNames })
    })

    socket.on('game:leave', (gameId: string) => {
      socket.leave(`game:${gameId}`)
      io.to(`game:${gameId}`).emit('game:lobby_updated')
      io.emit('games:updated')
    })

    socket.on('game:delete', async (gameId: string) => {
      const { data: game } = await supabase.from('games').select('created_by').eq('id', gameId).single()
      if (!game || game.created_by !== userId) return
      await supabase.from('game_players').delete().eq('game_id', gameId)
      await supabase.from('games').delete().eq('id', gameId)
      io.to(`game:${gameId}`).emit('game:lobby_updated')
      io.emit('games:updated')
    })

    socket.on('game:leave_seat', async (gameId: string) => {
      await supabase.from('game_players').delete().eq('game_id', gameId).eq('player_id', userId)
      const { data: game } = await supabase.from('games').select('created_by').eq('id', gameId).single()
      if (game?.created_by === userId) {
        await supabase.from('games').delete().eq('id', gameId)
      }
      socket.leave(`game:${gameId}`)
      io.to(`game:${gameId}`).emit('game:lobby_updated')
      io.emit('games:updated')
    })

    socket.on('game:join_seat', async (gameId: string, position: 1 | 2 | 3 | 4) => {
      // Check if seat is already taken by someone else
      const { data: occupant } = await supabase
        .from('game_players')
        .select('player_id')
        .eq('game_id', gameId)
        .eq('position', position)
        .maybeSingle()
      if (occupant && occupant.player_id !== userId) return

      const team: 1 | 2 = ([1, 3] as number[]).includes(position) ? 1 : 2
      await supabase.from('game_players').delete().eq('game_id', gameId).eq('player_id', userId)
      const { data: profile } = await supabase.from('profiles').select('elo').eq('id', userId).single()
      const { error } = await supabase.from('game_players').insert({
        game_id: gameId, player_id: userId, team, position, elo_before: profile?.elo ?? 1000,
      })
      if (!error) {
        io.to(`game:${gameId}`).emit('game:lobby_updated')
        io.emit('games:updated')
      }
    })

    socket.on('game:move_seat', async (gameId: string, playerId: string, position: number, team: number, eloBefore: number) => {
      await supabase.from('game_players').delete().eq('game_id', gameId).eq('player_id', playerId)
      await supabase.from('game_players').insert({ game_id: gameId, player_id: playerId, position, team, elo_before: eloBefore })
      io.emit('games:updated')
      io.to(`game:${gameId}`).emit('game:lobby_updated')
    })

    socket.on('game:swap_seats', async (gameId: string, player1Id: string, player2Id: string) => {
      const { data: rows } = await supabase
        .from('game_players')
        .select('player_id, position, team, elo_before')
        .eq('game_id', gameId)
        .in('player_id', [player1Id, player2Id])
      if (!rows || rows.length !== 2) return
      const r1 = rows.find((r: any) => r.player_id === player1Id)
      const r2 = rows.find((r: any) => r.player_id === player2Id)
      if (!r1 || !r2) return
      await supabase.from('game_players').delete().eq('game_id', gameId).in('player_id', [player1Id, player2Id])
      await supabase.from('game_players').insert([
        { game_id: gameId, player_id: player1Id, position: r2.position, team: r2.team, elo_before: r1.elo_before },
        { game_id: gameId, player_id: player2Id, position: r1.position, team: r1.team, elo_before: r2.elo_before },
      ])
      io.emit('games:updated')
      io.to(`game:${gameId}`).emit('game:lobby_updated')
    })

    socket.on('game:set_team_names', (gameId: string, names: { 1: string; 2: string }) => {
      gameTeamNames.set(gameId, names)
      io.emit('game:team_names', { gameId, names })
    })

    socket.on('game:start', async (gameId: string, targetScore?: number) => {
      const { data: game } = await supabase
        .from('games')
        .select('created_by, game_players(player_id, position, team)')
        .eq('id', gameId)
        .single()

      if (game) {
        const baseOrdered = [...game.game_players].sort((a, b) => a.position - b.position)
        const baseIds = baseOrdered.map(p => p.player_id)
        const creatorIdx = baseIds.indexOf(game.created_by)

        // Rotate so creator is at index 3 (cutter), person after creator at index 0 (first dealer)
        const rotatedIds = [
          ...baseIds.slice(creatorIdx + 1),
          ...baseIds.slice(0, creatorIdx + 1),
        ]
        const playerTeams: Record<string, 1 | 2> = {}
        for (const p of game.game_players) playerTeams[p.player_id] = p.team

        const ordered = rotatedIds.map((id, i) => ({ player_id: id, position: i + 1, team: playerTeams[id] as 1 | 2 }))
        const state = emptyGameState(ordered, playerTeams, game.created_by)
        state.persistedDeck = shuffleDeck(createDeck())
        state.phase = 'cutting'
        state.targetScore = typeof targetScore === 'number' && targetScore >= 100 ? targetScore : 1000

        gameStates.set(gameId, state)
        await supabase.from('games').update({ status: 'in_progress' }).eq('id', gameId)
      }

      const teamNames = gameTeamNames.get(gameId) ?? { 1: 'Équipe 1', 2: 'Équipe 2' }
      io.to(`game:${gameId}`).emit('game:started', teamNames)
      io.emit('games:updated')
    })

    socket.on('game:deal', (gameId: string, requestedOrder?: DealOrder) => {
      const state = gameStates.get(gameId)
      if (!state || state.phase !== 'dealing') return
      if (state.playerOrder[0] !== userId) return

      if (requestedOrder === '3-2' || requestedOrder === '2-3') {
        state.dealOrder = requestedOrder
      }

      const { hands, retourne, remainingDeck } = dealFromDeck(state.persistedDeck, state.playerOrder, state.dealOrder)
      state.hands = hands
      state.retourne = retourne
      state.remainingDeck = remainingDeck
      state.currentRoundCards = []
      state.belotePlayerId = null
      state.beloteCount = 0

      sendHands(io, state.playerOrder, hands, userToSockets, state.dealOrder)
      for (const playerId of state.playerOrder) {
        broadcastToGame(io, state, 'game:card_count', { playerId, count: 5 })
      }
      broadcastToGame(io, state, 'game:retourne', retourne)

      startBidding(io, gameId, state)
    })

    socket.on('game:request_hand', (gameId: string) => {
      const state = gameStates.get(gameId)
      if (!state) {
        socket.emit('game:state_lost', { gameId })
        return
      }
      if (state.hands.size === 0) return
      const cards = state.hands.get(userId)
      if (cards) socket.emit('game:hand', { playerId: userId, cards, replace: true })
      if (state.retourne) socket.emit('game:retourne', state.retourne)
      for (const playerId of state.playerOrder) {
        const count = state.hands.get(playerId)?.length ?? 0
        socket.emit('game:card_count', { playerId, count })
      }
      socket.emit('game:phase', phasePayload(state))
      // Sync trick state pour les reconnexions en cours de manche
      if (state.phase === 'playing' && state.play && state.trump) {
        socket.emit('game:trick_update', {
          trick: state.play.trick,
          currentPlayer: state.playerOrder[state.play.currentPlayerIndex],
          team1Points: state.play.team1Points,
          team2Points: state.play.team2Points,
        })
        const hand = state.hands.get(userId) ?? []
        const myTeam = state.playerTeams[userId]
        const playableIdx = getPlayableIndices(hand, state.play.trick, state.trump, myTeam, state.playerTeams)
        socket.emit('game:playable', playableIdx.map(i => ({ suit: hand[i].suit, value: hand[i].value })))
      }
    })

    socket.on('game:bid', (gameId: string, action: 'pass' | 'take', suit?: Suit) => {
      const state = gameStates.get(gameId)
      if (!state || state.phase !== 'bidding' || !state.retourne) return
      if (state.playerOrder[state.biddingTurnIndex] !== userId) return

      if (action === 'take') {
        // Tour 1 : atout = couleur de la retourne
        // Tour 2 : atout = couleur choisie (pas celle de la retourne)
        const chosenSuit = state.biddingRound === 1 ? state.retourne.suit : suit
        if (!chosenSuit) return
        if (state.biddingRound === 2 && chosenSuit === state.retourne.suit) return

        state.trump = chosenSuit
        state.trumpCallerId = userId

        const fullHands = completeDeal(state.hands, state.remainingDeck, state.retourne, userId, state.playerOrder)
        state.hands = fullHands

        sendHands(io, state.playerOrder, fullHands, userToSockets)
        for (const playerId of state.playerOrder) {
          broadcastToGame(io, state, 'game:card_count', { playerId, count: 8 })
        }

        state.phase = 'playing'
        state.play = {
          currentPlayerIndex: 1,
          trick: [],
          trickLeaderIndex: 1,
          tricksPlayed: 0,
          team1Points: 0,
          team2Points: 0,
          team1Tricks: 0,
          team2Tricks: 0,
        }
        broadcastPhase(io, gameId, state)
        broadcastTrickState(io, state)
        return
      }

      // Passer
      state.passCount++
      if (state.passCount === 4) {
        if (state.biddingRound === 1) {
          // Passer au 2ème tour sans redistribuer
          state.biddingRound = 2
          state.biddingTurnIndex = 1
          state.passCount = 0
          broadcastPhase(io, gameId, state)
          return
        }

        // 2ème tour : tout le monde a passé → couper et redistribuer
        // Reconstituer le deck depuis les mains si pas encore persisté
        if (state.persistedDeck.length !== 32) {
          state.persistedDeck = buildDeckFromHands(state)
        }
        // Tourner le donneur
        state.playerOrder = [...state.playerOrder.slice(1), state.playerOrder[0]]
        state.phase = 'cutting'
        state.trump = null
        state.trumpCallerId = null
        state.retourne = null
        broadcastToGame(io, state, 'game:all_passed', null)
        broadcastPhase(io, gameId, state)
        return
      }

      state.biddingTurnIndex = (state.biddingTurnIndex + 1) % 4
      broadcastPhase(io, gameId, state)
    })

    socket.on('game:cut_deck', (gameId: string, cutPoint: number) => {
      const state = gameStates.get(gameId)
      if (!state || state.phase !== 'cutting') return
      if (state.playerOrder[state.playerOrder.length - 1] !== userId) return

      const deck = state.persistedDeck
      const cut = Math.max(3, Math.min(Math.round(cutPoint), deck.length - 3))
      state.persistedDeck = [...deck.slice(cut), ...deck.slice(0, cut)]

      state.phase = 'dealing'
      broadcastPhase(io, gameId, state)
    })

    socket.on('game:play_card', (gameId: string, cardId: { suit: Suit; value: string }, announceBelote?: boolean) => {
      const state = gameStates.get(gameId)
      if (!state || state.phase !== 'playing' || !state.play || !state.trump) return
      if (state.playerOrder[state.play.currentPlayerIndex] !== userId) return

      const hand = state.hands.get(userId)
      if (!hand) return

      const cardIndex = hand.findIndex(c => c.suit === cardId.suit && c.value === cardId.value)
      if (cardIndex < 0) return

      const myTeam = state.playerTeams[userId]
      const playable = getPlayableIndices(hand, state.play.trick, state.trump, myTeam, state.playerTeams)
      if (!playable.includes(cardIndex)) return

      const card = hand[cardIndex]

      // Belote/Rebelote announcement (before modifying hand)
      if (announceBelote && state.trump) {
        const trump = state.trump
        if (card.suit === trump && (card.value === 'K' || card.value === 'Q')) {
          const hasOther = card.value === 'K'
            ? hand.some(c => c.suit === trump && c.value === 'Q')
            : hand.some(c => c.suit === trump && c.value === 'K')
          if (state.beloteCount === 0 && hasOther) {
            state.belotePlayerId = userId
            state.beloteCount = 1
            broadcastToGame(io, state, 'game:belote_announced', { playerId: userId, type: 'belote' })
          } else if (state.beloteCount === 1 && state.belotePlayerId === userId) {
            state.beloteCount = 2
            broadcastToGame(io, state, 'game:belote_announced', { playerId: userId, type: 'rebelote' })
          }
        }
      }

      const newHand = hand.filter((_, i) => i !== cardIndex)
      state.hands.set(userId, newHand)
      state.play.trick.push({ playerId: userId, card })

      broadcastToGame(io, state, 'game:card_count', { playerId: userId, count: newHand.length })

      if (state.play.trick.length === 4) {
        const winnerId = getTrickWinner(state.play.trick, state.trump)
        const isLastTrick = state.play.tricksPlayed === 7
        const points = getTrickPoints(state.play.trick, state.trump) + (isLastTrick ? 10 : 0)
        const winnerTeam = state.playerTeams[winnerId]

        // Accumuler les cartes du pli pour le jeu persisté
        for (const tc of state.play.trick) state.currentRoundCards.push(tc.card)

        if (winnerTeam === 1) {
          state.play.team1Points += points
          state.play.team1Tricks++
        } else {
          state.play.team2Points += points
          state.play.team2Tricks++
        }

        broadcastToGame(io, state, 'game:trick_won', {
          winnerId,
          winnerTeam,
          trick: state.play.trick,
          points,
          team1Points: state.play.team1Points,
          team2Points: state.play.team2Points,
        })

        state.play.tricksPlayed++

        if (isLastTrick) {
          // Calcul avec vérification de chute
          const callerTeam = state.trumpCallerId ? state.playerTeams[state.trumpCallerId] : null
          const rawTeam1 = state.play.team1Points
          const rawTeam2 = state.play.team2Points

          let roundTeam1Points = rawTeam1
          let roundTeam2Points = rawTeam2
          let chute = false
          let litige = false

          if (callerTeam) {
            const callerPoints = callerTeam === 1 ? rawTeam1 : rawTeam2
            const opponentPoints = callerTeam === 1 ? rawTeam2 : rawTeam1
            if (callerPoints === opponentPoints) {
              // Litige : personne ne marque, les points s'accumulent pour la prochaine manche
              litige = true
              state.litigePoints += 162
              roundTeam1Points = 0
              roundTeam2Points = 0
            } else if (callerPoints < opponentPoints) {
              chute = true
              // L'équipe adverse récupère tout + les points en litige
              const bonus = state.litigePoints
              state.litigePoints = 0
              roundTeam1Points = callerTeam === 1 ? 0 : 162 + bonus
              roundTeam2Points = callerTeam === 1 ? 162 + bonus : 0
            } else {
              // Victoire normale : le gagnant récupère ses points + les points en litige
              const bonus = state.litigePoints
              state.litigePoints = 0
              if (bonus > 0) {
                roundTeam1Points = callerTeam === 1 ? rawTeam1 + bonus : rawTeam1
                roundTeam2Points = callerTeam === 2 ? rawTeam2 + bonus : rawTeam2
              }
            }
          }

          // Belote bonus — 20pts toujours attribués à l'équipe qui a belote/rebelote
          const beloteTeam = state.beloteCount === 2 && state.belotePlayerId
            ? state.playerTeams[state.belotePlayerId]
            : null
          if (beloteTeam === 1) roundTeam1Points += 20
          else if (beloteTeam === 2) roundTeam2Points += 20

          state.team1Score += roundTeam1Points
          state.team2Score += roundTeam2Points

          // Persister le jeu et faire tourner le donneur
          state.persistedDeck = [...state.currentRoundCards]
          state.currentRoundCards = []
          state.playerOrder = [...state.playerOrder.slice(1), state.playerOrder[0]]

          broadcastToGame(io, state, 'game:round_end', {
            team1Points: rawTeam1,
            team2Points: rawTeam2,
            roundTeam1Points,
            roundTeam2Points,
            team1Score: state.team1Score,
            team2Score: state.team2Score,
            trumpCallerId: state.trumpCallerId,
            trumpCallerTeam: state.trumpCallerId ? state.playerTeams[state.trumpCallerId] : null,
            trump: state.trump,
            chute,
            litige,
            pendingLitigePoints: state.litigePoints,
            beloteTeam,
          })

          state.play = null

          if (state.team1Score >= state.targetScore || state.team2Score >= state.targetScore) {
            const winner = state.team1Score >= state.team2Score ? 1 : 2
            broadcastToGame(io, state, 'game:game_over', {
              winner,
              team1Score: state.team1Score,
              team2Score: state.team2Score,
            })
            state.phase = 'waiting'
            state.trump = null
            state.trumpCallerId = null
            state.retourne = null
            updateEloAndFinishGame(io, state, gameId, winner)
            gameStates.delete(gameId)
            gameTeamNames.delete(gameId)
            return
          }

          // Phase coupe : le coupeur (playerOrder[last] = ancien donneur) coupe
          state.phase = 'cutting'
          state.trump = null
          state.trumpCallerId = null
          state.retourne = null
          broadcastPhase(io, gameId, state)
          return
        }

        // Prochain pli
        const winnerIndex = state.playerOrder.indexOf(winnerId)
        state.play.trick = []
        state.play.currentPlayerIndex = winnerIndex
        state.play.trickLeaderIndex = winnerIndex

        setTimeout(() => broadcastTrickState(io, state), 3000)
      } else {
        state.play.currentPlayerIndex = (state.play.currentPlayerIndex + 1) % 4
        broadcastTrickState(io, state)
      }
    })

    socket.on('disconnect', () => {
      socketToUser.delete(socket.id)
      const sockets = userToSockets.get(userId)
      if (sockets) {
        sockets.delete(socket.id)
        if (sockets.size === 0) userToSockets.delete(userId)
      }
      const entry = onlineUsers.get(userId)
      if (entry) {
        if (entry.count <= 1) {
          onlineUsers.delete(userId)
        } else {
          onlineUsers.set(userId, { ...entry, count: entry.count - 1 })
        }
      }
      broadcastOnlinePlayers(io)
    })

    // Profile fetch for online-players display (non-blocking — socket already in userToSockets above)
    supabase
      .from('profiles')
      .select('id, display_name, elo')
      .eq('id', userId)
      .single()
      .then(({ data: profile }) => {
        if (profile) {
          const existing = onlineUsers.get(userId)
          onlineUsers.set(userId, { player: profile, count: (existing?.count ?? 0) + 1 })
          broadcastOnlinePlayers(io)
          socket.emit('players:online', Array.from(onlineUsers.values()).map((e) => e.player))
        }
      })
  })
}
