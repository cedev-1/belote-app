export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string
          avatar_url: string | null
          elo: number
          games_played: number
          games_won: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          display_name: string
          avatar_url?: string | null
          elo?: number
          games_played?: number
          games_won?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          display_name?: string
          avatar_url?: string | null
          elo?: number
          games_played?: number
          games_won?: number
          created_at?: string
          updated_at?: string
        }
      }
      games: {
        Row: {
          id: string
          status: 'waiting' | 'in_progress' | 'finished'
          team1_score: number
          team2_score: number
          winning_team: 1 | 2 | null
          created_by: string
          created_at: string
          finished_at: string | null
          team1_name: string
          team2_name: string
        }
        Insert: {
          id?: string
          status: 'waiting' | 'in_progress' | 'finished'
          team1_score?: number
          team2_score?: number
          winning_team?: 1 | 2 | null
          created_by: string
          created_at?: string
          finished_at?: string | null
          team1_name?: string
          team2_name?: string
        }
        Update: {
          id?: string
          status?: 'waiting' | 'in_progress' | 'finished'
          team1_score?: number
          team2_score?: number
          winning_team?: 1 | 2 | null
          created_by?: string
          created_at?: string
          finished_at?: string | null
          team1_name?: string
          team2_name?: string
        }
      }
      game_players: {
        Row: {
          id: string
          game_id: string
          player_id: string
          team: 1 | 2
          position: 1 | 2 | 3 | 4
          elo_before: number
          elo_after: number | null
        }
        Insert: {
          id?: string
          game_id: string
          player_id: string
          team: 1 | 2
          position: 1 | 2 | 3 | 4
          elo_before: number
          elo_after?: number | null
        }
        Update: {
          id?: string
          game_id?: string
          player_id?: string
          team?: 1 | 2
          position?: 1 | 2 | 3 | 4
          elo_before?: number
          elo_after?: number | null
        }
      }
      rounds: {
        Row: {
          id: string
          game_id: string
          round_number: number
          trump_suit: 'hearts' | 'diamonds' | 'clubs' | 'spades'
          trump_caller_id: string
          team1_points: number
          team2_points: number
          team1_announcements: number
          team2_announcements: number
          capot: boolean
          belote_team: 1 | 2 | null
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          round_number: number
          trump_suit: 'hearts' | 'diamonds' | 'clubs' | 'spades'
          trump_caller_id: string
          team1_points: number
          team2_points: number
          team1_announcements?: number
          team2_announcements?: number
          capot?: boolean
          belote_team?: 1 | 2 | null
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          round_number?: number
          trump_suit?: 'hearts' | 'diamonds' | 'clubs' | 'spades'
          trump_caller_id?: string
          team1_points?: number
          team2_points?: number
          team1_announcements?: number
          team2_announcements?: number
          capot?: boolean
          belote_team?: 1 | 2 | null
          created_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
