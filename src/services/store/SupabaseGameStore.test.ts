import { describe, expect, it } from 'vitest'
import {
  gameFromRow,
  isPickError,
  pickFromRow,
  playerFromRow,
  publicPlayerFromRow,
  type GameRow,
  type PickRow,
  type PlayerRow,
  type PublicPlayerRow,
} from './SupabaseGameStore'
import type { DraftTurn } from '@/types'

// These tests deliberately avoid hitting Supabase. They exercise the pure
// snake_case → camelCase mapper layer + the runtime guard used to validate
// RPC error payloads. Anything that requires a live network call lives in
// integration testing against a real Supabase project.

const baseGameRow = (overrides: Partial<GameRow> = {}): GameRow => ({
  id: 'g-1',
  status: 'drafting',
  player_count: 4,
  method: 'snake',
  hero_pool: ['a', 'b', 'c', 'd'],
  draft_order: ['p1', 'p2', 'p3', 'p4'],
  current_pick: 0,
  turns: [],
  bans: [],
  start_team: 'red',
  organiser_token: 'tok',
  created_at: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

describe('SupabaseGameStore mappers', () => {
  describe('gameFromRow', () => {
    it('maps a full games row including turns, bans, and start_team', () => {
      const turns: DraftTurn[] = [
        { kind: 'pick', playerId: 'p1', team: 'red' },
        { kind: 'ban', playerId: null, team: 'blue' },
      ]
      const row = baseGameRow({
        method: 'pick-and-ban',
        turns,
        bans: ['hero-x'],
        start_team: 'blue',
      })

      const game = gameFromRow(row)

      expect(game.id).toBe('g-1')
      expect(game.method).toBe('pick-and-ban')
      expect(game.heroPool).toEqual(['a', 'b', 'c', 'd'])
      expect(game.draftOrder).toEqual(['p1', 'p2', 'p3', 'p4'])
      expect(game.turns).toEqual(turns)
      expect(game.bans).toEqual(['hero-x'])
      expect(game.startTeam).toBe('blue')
      expect(game.createdAt).toBe(Date.parse('2024-01-01T00:00:00.000Z'))
    })

    it('defaults turns/bans to [] and start_team to "red" when the row is legacy/null', () => {
      // Cast through unknown — legacy rows pre-date these columns, so the
      // jsonb values may arrive as null at runtime even though the typed
      // shape says otherwise.
      const row = {
        ...baseGameRow(),
        turns: null,
        bans: null,
        start_team: null,
      } as unknown as GameRow

      const game = gameFromRow(row)

      expect(game.turns).toEqual([])
      expect(game.bans).toEqual([])
      expect(game.startTeam).toBe('red')
    })

    it('returns fresh array copies (mutating game.turns does not mutate the row)', () => {
      const turns: DraftTurn[] = [{ kind: 'pick', playerId: 'p1', team: 'red' }]
      const row = baseGameRow({ turns, bans: ['x'] })

      const game = gameFromRow(row)
      game.turns.push({ kind: 'ban', playerId: null, team: 'blue' })
      game.bans.push('y')
      game.heroPool.push('z')
      game.draftOrder.push('p5')

      expect(row.turns).toHaveLength(1)
      expect(row.bans).toEqual(['x'])
      expect(row.hero_pool).toEqual(['a', 'b', 'c', 'd'])
      expect(row.draft_order).toEqual(['p1', 'p2', 'p3', 'p4'])
    })
  })

  describe('publicPlayerFromRow / playerFromRow', () => {
    const publicRow: PublicPlayerRow = {
      id: 'p1',
      game_id: 'g-1',
      name: 'Ada',
      team: 'red',
      seat: 0,
    }

    it('publicPlayerFromRow projects only id/name/team/seat', () => {
      const player = publicPlayerFromRow(publicRow)
      expect(player).toEqual({ id: 'p1', name: 'Ada', team: 'red', seat: 0 })
      // Defensive: no token / hand / game_id leakage through the public projection.
      expect(player).not.toHaveProperty('token')
      expect(player).not.toHaveProperty('hand')
      expect(player).not.toHaveProperty('game_id')
    })

    it('playerFromRow includes the token but DROPS the private hand', () => {
      const full: PlayerRow = {
        ...publicRow,
        token: 'sekrit',
        hand: ['hero-a', 'hero-b', 'hero-c'],
      }
      const player = playerFromRow(full)

      expect(player).toEqual({
        id: 'p1',
        name: 'Ada',
        team: 'red',
        seat: 0,
        token: 'sekrit',
      })
      // The hand is privately delivered via get_player_view, never via
      // playerFromRow — and the organiser-side createGame return value is
      // built from PlayerRow → Player, which intentionally omits hand.
      expect(player).not.toHaveProperty('hand')
    })

    it('playerFromRow tolerates a null hand (non single-draft methods)', () => {
      const full: PlayerRow = {
        ...publicRow,
        token: 't',
        hand: null,
      }
      const player = playerFromRow(full)
      expect(player.token).toBe('t')
      expect(player).not.toHaveProperty('hand')
    })
  })

  describe('pickFromRow', () => {
    it('maps a picks row to the domain Pick (incl. null pick_index)', () => {
      const row: PickRow = {
        id: 'pk-1',
        game_id: 'g-1',
        player_id: 'p1',
        hero_id: 'hero-a',
        pick_index: null,
        created_at: '2024-01-02T03:04:05.000Z',
      }
      expect(pickFromRow(row)).toEqual({
        id: 'pk-1',
        playerId: 'p1',
        heroId: 'hero-a',
        pickIndex: null,
        createdAt: Date.parse('2024-01-02T03:04:05.000Z'),
      })
    })
  })

  describe('isPickError', () => {
    it('accepts every PickError union member, including the 3 new codes', () => {
      expect(isPickError('not-your-turn')).toBe(true)
      expect(isPickError('hero-unavailable')).toBe(true)
      expect(isPickError('game-not-drafting')).toBe(true)
      expect(isPickError('invalid-token')).toBe(true)
      expect(isPickError('game-not-found')).toBe(true)
      // New codes introduced alongside the generalised draft methods:
      expect(isPickError('not-in-hand')).toBe(true)
      expect(isPickError('hero-banned')).toBe(true)
      expect(isPickError('not-your-team')).toBe(true)
    })

    it('rejects anything that is not a known PickError code', () => {
      expect(isPickError('')).toBe(false)
      expect(isPickError('nope')).toBe(false)
      expect(isPickError(undefined)).toBe(false)
      expect(isPickError(null)).toBe(false)
      expect(isPickError(42)).toBe(false)
      expect(isPickError({})).toBe(false)
    })
  })
})
