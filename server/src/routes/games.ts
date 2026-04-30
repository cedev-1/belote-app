import { Router } from 'express'
import { supabase } from '../lib/supabase'
import type { AuthRequest } from '../middleware/auth'

export const gamesRouter = Router()

gamesRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('games')
    .select('*, game_players(*, profiles(*))')
    .in('status', ['waiting', 'in_progress'])
    .order('created_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

gamesRouter.post('/', async (req: AuthRequest, res) => {
  const { data: game, error } = await supabase
    .from('games')
    .insert({ status: 'waiting', team1_score: 0, team2_score: 0, winning_team: null, created_by: req.userId })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  await supabase.from('game_players').insert({
    game_id: game.id,
    player_id: req.userId,
    team: 1,
    position: 1,
    elo_before: 1000,
  })

  res.status(201).json(game)
})

gamesRouter.post('/:id/join', async (req: AuthRequest, res) => {
  const { id } = req.params

  const { data: game } = await supabase
    .from('games')
    .select('*, game_players(*)')
    .eq('id', id)
    .single()

  if (!game) {
    res.status(404).json({ error: 'Game not found' })
    return
  }

  const playerCount = game.game_players?.length ?? 0
  if (playerCount >= 4) {
    res.status(400).json({ error: 'Game is full' })
    return
  }

  const position = (playerCount + 1) as 1 | 2 | 3 | 4
  const team: 1 | 2 = ([1, 3] as number[]).includes(position) ? 1 : 2

  await supabase.from('game_players').insert({
    game_id: id,
    player_id: req.userId,
    team,
    position,
    elo_before: 1000,
  })

  if (playerCount === 3) {
    await supabase.from('games').update({ status: 'in_progress' }).eq('id', id)
  }

  res.json({ joined: true })
})
