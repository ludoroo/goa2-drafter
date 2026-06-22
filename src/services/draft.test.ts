import type { DraftTurn, Player, TeamId } from '@/types'
import {
  buildAllPickTurns,
  buildAlternatingOrder,
  buildPickBanTurns,
  buildSnakeDraftOrder,
  coinFlipTeam,
  dealHands,
  heroesPerTeam,
  minimumPoolSize,
  nextPickerId,
  randomAssignment,
  selectRandomDraftPool,
} from './draft'

interface MakePlayerInput {
  id: string
  team: TeamId
  seat: number
  name?: string
}

const makePlayer = ({ id, team, seat, name }: MakePlayerInput): Player => ({
  id,
  name: name ?? id,
  team,
  token: `tok-${id}`,
  seat,
})

const teamsOf = (order: string[], players: Player[]): TeamId[] => {
  const byId = new Map(players.map((p) => [p.id, p]))
  return order.map((id) => {
    const p = byId.get(id)
    if (!p) throw new Error(`unknown id: ${id}`)
    return p.team
  })
}

describe('buildSnakeDraftOrder', () => {
  it('produces the A,B,B,A,A,B team pattern for 6 players (red has lowest seat)', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
      makePlayer({ id: 'r2', team: 'red', seat: 2 }),
      makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
      makePlayer({ id: 'r4', team: 'red', seat: 4 }),
      makePlayer({ id: 'b5', team: 'blue', seat: 5 }),
    ]

    const order = buildSnakeDraftOrder(players)

    expect(order).toHaveLength(6)
    expect(teamsOf(order, players)).toEqual(['red', 'blue', 'blue', 'red', 'red', 'blue'])
  })

  it('contains every player id exactly once', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
      makePlayer({ id: 'r2', team: 'red', seat: 2 }),
      makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
      makePlayer({ id: 'r4', team: 'red', seat: 4 }),
      makePlayer({ id: 'b5', team: 'blue', seat: 5 }),
    ]

    const order = buildSnakeDraftOrder(players)

    expect([...order].sort()).toEqual(['b1', 'b3', 'b5', 'r0', 'r2', 'r4'])
  })

  it('respects seat order within each team (lowest seat picks first for that team)', () => {
    const players: Player[] = [
      makePlayer({ id: 'r-late', team: 'red', seat: 4 }),
      makePlayer({ id: 'b-mid', team: 'blue', seat: 3 }),
      makePlayer({ id: 'r-early', team: 'red', seat: 0 }),
      makePlayer({ id: 'b-late', team: 'blue', seat: 5 }),
      makePlayer({ id: 'r-mid', team: 'red', seat: 2 }),
      makePlayer({ id: 'b-early', team: 'blue', seat: 1 }),
    ]

    const order = buildSnakeDraftOrder(players)

    // Red picks at indices 0, 3, 4 (A,B,B,A,A,B). Order within red by seat: r-early, r-mid, r-late.
    expect(order[0]).toBe('r-early')
    expect(order[3]).toBe('r-mid')
    expect(order[4]).toBe('r-late')
    // Blue picks at indices 1, 2, 5. Order within blue by seat: b-early, b-mid, b-late.
    expect(order[1]).toBe('b-early')
    expect(order[2]).toBe('b-mid')
    expect(order[5]).toBe('b-late')
  })

  it('produces the A,B,B,A pattern for 4 players (red has lowest seat)', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
      makePlayer({ id: 'r2', team: 'red', seat: 2 }),
      makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
    ]

    const order = buildSnakeDraftOrder(players)

    expect(teamsOf(order, players)).toEqual(['red', 'blue', 'blue', 'red'])
  })

  it('makes blue team A when blue has the lowest seat', () => {
    const players: Player[] = [
      makePlayer({ id: 'b0', team: 'blue', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'b2', team: 'blue', seat: 2 }),
      makePlayer({ id: 'r3', team: 'red', seat: 3 }),
    ]

    const order = buildSnakeDraftOrder(players)

    expect(teamsOf(order, players)).toEqual(['blue', 'red', 'red', 'blue'])
  })

  it('breaks ties by making red team A when both teams could be first', () => {
    // Both teams have a player at seat 0 (contrived for tie-break check).
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'b0', team: 'blue', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
    ]

    const order = buildSnakeDraftOrder(players)

    expect(teamsOf(order, players)).toEqual(['red', 'blue', 'blue', 'red'])
  })

  it('throws when teams are not equal size', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'b2', team: 'blue', seat: 2 }),
    ]

    expect(() => buildSnakeDraftOrder(players)).toThrow('teams must be equal size')
  })

  it('throws when an even count produces unequal teams', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'r2', team: 'red', seat: 2 }),
      makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
    ]

    expect(() => buildSnakeDraftOrder(players)).toThrow('teams must be equal size')
  })
})

describe('randomAssignment', () => {
  it('assigns exactly one distinct hero per player', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4']
    const heroPool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

    const result = randomAssignment(playerIds, heroPool, () => 0)

    expect(Object.keys(result).sort()).toEqual([...playerIds].sort())
    const assigned = playerIds.map((id) => result[id])
    expect(new Set(assigned).size).toBe(playerIds.length)
    for (const heroId of assigned) {
      expect(heroPool).toContain(heroId)
    }
  })

  it('is deterministic given a stubbed rng', () => {
    const playerIds = ['p1', 'p2', 'p3']
    const heroPool = ['h1', 'h2', 'h3', 'h4', 'h5']

    const a = randomAssignment(playerIds, heroPool, () => 0)
    const b = randomAssignment(playerIds, heroPool, () => 0)

    expect(a).toEqual(b)
  })

  it('produces different results for different rngs', () => {
    const playerIds = ['p1', 'p2', 'p3']
    const heroPool = ['h1', 'h2', 'h3', 'h4', 'h5']

    const zero = randomAssignment(playerIds, heroPool, () => 0)
    // 0.999... will pick the last index in Fisher-Yates each step.
    const high = randomAssignment(playerIds, heroPool, () => 0.999999)

    expect(zero).not.toEqual(high)
  })

  it('throws when the hero pool is too small', () => {
    expect(() => randomAssignment(['p1', 'p2', 'p3'], ['h1', 'h2'])).toThrow(
      'not enough heroes in pool',
    )
  })

  it('works when pool size equals player count', () => {
    const playerIds = ['p1', 'p2']
    const heroPool = ['h1', 'h2']

    const result = randomAssignment(playerIds, heroPool, () => 0)

    expect(Object.keys(result).sort()).toEqual(['p1', 'p2'])
    expect(new Set(Object.values(result)).size).toBe(2)
  })
})

describe('heroesPerTeam', () => {
  it('returns playerCount / 2 for even counts', () => {
    expect(heroesPerTeam(4)).toBe(2)
    expect(heroesPerTeam(6)).toBe(3)
    expect(heroesPerTeam(8)).toBe(4)
    expect(heroesPerTeam(10)).toBe(5)
  })

  it('throws on odd player counts', () => {
    expect(() => heroesPerTeam(5)).toThrow('player count must be even')
    expect(() => heroesPerTeam(7)).toThrow('player count must be even')
  })
})

describe('minimumPoolSize', () => {
  it('equals the player count', () => {
    expect(minimumPoolSize(4)).toBe(4)
    expect(minimumPoolSize(6)).toBe(6)
    expect(minimumPoolSize(10)).toBe(10)
  })
})

describe('nextPickerId', () => {
  it('returns the player id at the current pick', () => {
    const order = ['p1', 'p2', 'p3', 'p4']

    expect(nextPickerId(order, 0)).toBe('p1')
    expect(nextPickerId(order, 2)).toBe('p3')
    expect(nextPickerId(order, 3)).toBe('p4')
  })

  it('returns null when the draft is complete or out of range', () => {
    const order = ['p1', 'p2', 'p3']

    expect(nextPickerId(order, 3)).toBeNull()
    expect(nextPickerId(order, 99)).toBeNull()
    expect(nextPickerId(order, -1)).toBeNull()
  })

  it('returns null for an empty order', () => {
    expect(nextPickerId([], 0)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// New helpers (T2)
// ---------------------------------------------------------------------------

/** Build a sequenced rng that yields the provided values, looping at end. */
const seq = (values: number[]): (() => number) => {
  let i = 0
  return () => {
    const v = values[i % values.length]
    i++
    return v
  }
}

const fourPlayers = (): Player[] => [
  makePlayer({ id: 'r0', team: 'red', seat: 0 }),
  makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
  makePlayer({ id: 'r2', team: 'red', seat: 2 }),
  makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
]

const sixPlayers = (): Player[] => [
  makePlayer({ id: 'r0', team: 'red', seat: 0 }),
  makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
  makePlayer({ id: 'r2', team: 'red', seat: 2 }),
  makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
  makePlayer({ id: 'r4', team: 'red', seat: 4 }),
  makePlayer({ id: 'b5', team: 'blue', seat: 5 }),
]

describe('coinFlipTeam', () => {
  it('returns red when rng yields a value below 0.5', () => {
    expect(coinFlipTeam(() => 0)).toBe('red')
    expect(coinFlipTeam(() => 0.49)).toBe('red')
  })

  it('returns blue when rng yields a value at or above 0.5', () => {
    expect(coinFlipTeam(() => 0.5)).toBe('blue')
    expect(coinFlipTeam(() => 0.9)).toBe('blue')
  })

  it('defaults to Math.random when no rng provided', () => {
    const result = coinFlipTeam()
    expect(result === 'red' || result === 'blue').toBe(true)
  })
})

describe('buildAlternatingOrder', () => {
  it('alternates red,blue,red,blue when startTeam is red (4 players)', () => {
    const players = fourPlayers()
    const order = buildAlternatingOrder(players, 'red')

    expect(order).toHaveLength(4)
    expect(teamsOf(order, players)).toEqual(['red', 'blue', 'red', 'blue'])
    // Within each team, lowest seat first.
    expect(order[0]).toBe('r0')
    expect(order[2]).toBe('r2')
    expect(order[1]).toBe('b1')
    expect(order[3]).toBe('b3')
  })

  it('alternates blue,red,blue,red when startTeam is blue (4 players)', () => {
    const players = fourPlayers()
    const order = buildAlternatingOrder(players, 'blue')

    expect(order).toHaveLength(4)
    expect(teamsOf(order, players)).toEqual(['blue', 'red', 'blue', 'red'])
    expect(order[0]).toBe('b1')
    expect(order[2]).toBe('b3')
    expect(order[1]).toBe('r0')
    expect(order[3]).toBe('r2')
  })

  it('contains every player id exactly once', () => {
    const players = sixPlayers()
    const order = buildAlternatingOrder(players, 'red')

    expect([...order].sort()).toEqual(['b1', 'b3', 'b5', 'r0', 'r2', 'r4'])
  })

  it('throws when teams are not equal size', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'b2', team: 'blue', seat: 2 }),
    ]

    expect(() => buildAlternatingOrder(players, 'red')).toThrow('teams must be equal size')
  })
})

describe('buildAllPickTurns', () => {
  it('produces one pick turn per player in alternating order', () => {
    const players = fourPlayers()
    const turns = buildAllPickTurns(players, 'red')

    expect(turns).toHaveLength(4)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.map((t) => t.playerId)).toEqual(['r0', 'b1', 'r2', 'b3'])
    expect(turns.map((t) => t.team)).toEqual(['red', 'blue', 'red', 'blue'])
  })

  it('honours startTeam=blue', () => {
    const players = fourPlayers()
    const turns = buildAllPickTurns(players, 'blue')

    expect(turns.map((t) => t.playerId)).toEqual(['b1', 'r0', 'b3', 'r2'])
    expect(turns.map((t) => t.team)).toEqual(['blue', 'red', 'blue', 'red'])
  })

  it('matches buildAlternatingOrder by playerId and team', () => {
    const players = sixPlayers()
    const order = buildAlternatingOrder(players, 'red')
    const turns = buildAllPickTurns(players, 'red')

    expect(turns).toHaveLength(order.length)
    const byId = new Map(players.map((p) => [p.id, p]))
    turns.forEach((t, i) => {
      expect(t.kind).toBe('pick')
      expect(t.playerId).toBe(order[i])
      expect(t.team).toBe(byId.get(order[i])!.team)
    })
  })
})

describe('buildPickBanTurns', () => {
  it('produces the exact rulebook sequence for H=2 (4 players), startTeam=red', () => {
    const players = fourPlayers()
    const turns = buildPickBanTurns(players, 'red')

    // ban A, ban B, pick A, pick B, ban B, ban A, pick B, pick A
    const expected: Array<[DraftTurn['kind'], TeamId]> = [
      ['ban', 'red'],
      ['ban', 'blue'],
      ['pick', 'red'],
      ['pick', 'blue'],
      ['ban', 'blue'],
      ['ban', 'red'],
      ['pick', 'blue'],
      ['pick', 'red'],
    ]
    expect(turns).toHaveLength(expected.length)
    turns.forEach((t, i) => {
      expect(t.kind).toBe(expected[i][0])
      expect(t.team).toBe(expected[i][1])
      expect(t.playerId).toBeNull()
    })
  })

  it('mirrors the sequence when startTeam=blue (4 players)', () => {
    const players = fourPlayers()
    const turns = buildPickBanTurns(players, 'blue')

    const expected: Array<[DraftTurn['kind'], TeamId]> = [
      ['ban', 'blue'],
      ['ban', 'red'],
      ['pick', 'blue'],
      ['pick', 'red'],
      ['ban', 'red'],
      ['ban', 'blue'],
      ['pick', 'red'],
      ['pick', 'blue'],
    ]
    expect(turns).toHaveLength(expected.length)
    turns.forEach((t, i) => {
      expect(t.kind).toBe(expected[i][0])
      expect(t.team).toBe(expected[i][1])
      expect(t.playerId).toBeNull()
    })
  })

  it('produces the correct first round and totals for H=3 (6 players)', () => {
    const players = sixPlayers()
    const turns = buildPickBanTurns(players, 'red')

    // 4*H = 12 turns total.
    expect(turns).toHaveLength(12)

    // First 4 (round 0 even — leader A=red): ban red, ban blue, pick red, pick blue.
    expect(turns[0]).toMatchObject({ kind: 'ban', team: 'red', playerId: null })
    expect(turns[1]).toMatchObject({ kind: 'ban', team: 'blue', playerId: null })
    expect(turns[2]).toMatchObject({ kind: 'pick', team: 'red', playerId: null })
    expect(turns[3]).toMatchObject({ kind: 'pick', team: 'blue', playerId: null })

    const picks = turns.filter((t) => t.kind === 'pick')
    const bans = turns.filter((t) => t.kind === 'ban')
    expect(picks).toHaveLength(players.length)
    expect(bans).toHaveLength(players.length)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
  })

  it('throws when teams are not equal size', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'b2', team: 'blue', seat: 2 }),
    ]

    expect(() => buildPickBanTurns(players, 'red')).toThrow('teams must be equal size')
  })
})

describe('selectRandomDraftPool', () => {
  it('returns playerCount + 2 distinct heroes from the pool', () => {
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']
    const result = selectRandomDraftPool(pool, 4, () => 0)

    expect(result).toHaveLength(6)
    expect(new Set(result).size).toBe(6)
    for (const heroId of result) {
      expect(pool).toContain(heroId)
    }
  })

  it('is deterministic given a stubbed rng', () => {
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']
    const a = selectRandomDraftPool(pool, 4, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.5]))
    const b = selectRandomDraftPool(pool, 4, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.5]))

    expect(a).toEqual(b)
  })

  it('throws when the pool is too small', () => {
    expect(() => selectRandomDraftPool(['h1', 'h2', 'h3', 'h4', 'h5'], 4)).toThrow(
      'not enough heroes in pool',
    )
  })

  it('works when pool size equals playerCount + 2', () => {
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
    const result = selectRandomDraftPool(pool, 4, () => 0)

    expect(result).toHaveLength(6)
    expect(new Set(result).size).toBe(6)
  })
})

describe('dealHands', () => {
  it('deals a hand of handSize to each player', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4']
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    const hands = dealHands(playerIds, pool, 3, () => 0)

    expect(Object.keys(hands).sort()).toEqual([...playerIds].sort())
    for (const id of playerIds) {
      expect(hands[id]).toHaveLength(3)
    }
  })

  it('produces disjoint hands across players', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4']
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    const hands = dealHands(playerIds, pool, 3, () => 0)

    const all = playerIds.flatMap((id) => hands[id])
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(playerIds.length * 3)
  })

  it('throws when the pool is too small', () => {
    expect(() => dealHands(['p1', 'p2'], ['h1', 'h2', 'h3'], 3)).toThrow(
      'not enough heroes in pool',
    )
  })

  it('is deterministic given a stubbed rng', () => {
    const playerIds = ['p1', 'p2', 'p3']
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9']
    const a = dealHands(playerIds, pool, 3, seq([0.2, 0.5, 0.1, 0.8, 0.3, 0.6, 0.4, 0.9]))
    const b = dealHands(playerIds, pool, 3, seq([0.2, 0.5, 0.1, 0.8, 0.3, 0.6, 0.4, 0.9]))

    expect(a).toEqual(b)
  })
})

describe('minimumPoolSize (method-aware)', () => {
  it('returns playerCount when no method or for snake/random/all-pick', () => {
    expect(minimumPoolSize(6)).toBe(6)
    expect(minimumPoolSize(6, undefined)).toBe(6)
    expect(minimumPoolSize(6, 'snake')).toBe(6)
    expect(minimumPoolSize(6, 'random')).toBe(6)
    expect(minimumPoolSize(6, 'all-pick')).toBe(6)
  })

  it('returns playerCount + 2 for random-draft', () => {
    expect(minimumPoolSize(4, 'random-draft')).toBe(6)
    expect(minimumPoolSize(6, 'random-draft')).toBe(8)
    expect(minimumPoolSize(10, 'random-draft')).toBe(12)
  })

  it('returns playerCount * 3 for single-draft', () => {
    expect(minimumPoolSize(4, 'single-draft')).toBe(12)
    expect(minimumPoolSize(6, 'single-draft')).toBe(18)
    expect(minimumPoolSize(10, 'single-draft')).toBe(30)
  })

  it('returns 2 * playerCount for pick-and-ban', () => {
    expect(minimumPoolSize(4, 'pick-and-ban')).toBe(8)
    expect(minimumPoolSize(6, 'pick-and-ban')).toBe(12)
    expect(minimumPoolSize(10, 'pick-and-ban')).toBe(20)
  })
})
