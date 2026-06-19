import type { GameStore } from '@/types'
import { LocalGameStore } from './LocalGameStore'

// TODO: return SupabaseGameStore when VITE_SUPABASE_URL is set
export function getGameStore(): GameStore {
  return new LocalGameStore()
}

export const gameStore = getGameStore()
