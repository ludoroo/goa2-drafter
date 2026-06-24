import type { DraftTurn, Player, TeamId } from '@/types'
import {
  buildAllPickTurns,
  buildPickBanTurns,
  buildSnakeTurns,
  coinFlipTeam,
  dealHands,
  handicapTeamFor,
  heroesPerTeam,
  minimumPoolSize,
  nextPickerId,
  randomAssignment,
  selectRandomDraftPool,
  teamCounts,
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

  it('works for odd player counts (5 players)', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5']
    const heroPool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']

    const result = randomAssignment(playerIds, heroPool, () => 0)

    expect(Object.keys(result).sort()).toEqual([...playerIds].sort())
    expect(new Set(Object.values(result)).size).toBe(5)
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
// Helpers
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

/** 5 players, red=2 (smaller), blue=3 (bigger). */
const fivePlayersRedSmaller = (): Player[] => [
  makePlayer({ id: 'r0', team: 'red', seat: 0 }),
  makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
  makePlayer({ id: 'r2', team: 'red', seat: 2 }),
  makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
  makePlayer({ id: 'b4', team: 'blue', seat: 4 }),
]

/** 7 players, red=3 (smaller), blue=4 (bigger). */
const sevenPlayersRedSmaller = (): Player[] => [
  makePlayer({ id: 'r0', team: 'red', seat: 0 }),
  makePlayer({ id: 'b1', team: 'blue', seat: 1 }),
  makePlayer({ id: 'r2', team: 'red', seat: 2 }),
  makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
  makePlayer({ id: 'r4', team: 'red', seat: 4 }),
  makePlayer({ id: 'b5', team: 'blue', seat: 5 }),
  makePlayer({ id: 'b6', team: 'blue', seat: 6 }),
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

// ---------------------------------------------------------------------------
// teamCounts / handicapTeamFor / splitTeams uneven behaviour
// ---------------------------------------------------------------------------

describe('teamCounts', () => {
  it('counts even teams', () => {
    expect(teamCounts(fourPlayers())).toEqual({ red: 2, blue: 2 })
    expect(teamCounts(sixPlayers())).toEqual({ red: 3, blue: 3 })
  })

  it('counts uneven teams', () => {
    expect(teamCounts(fivePlayersRedSmaller())).toEqual({ red: 2, blue: 3 })
    expect(teamCounts(sevenPlayersRedSmaller())).toEqual({ red: 3, blue: 4 })
  })
})

describe('handicapTeamFor', () => {
  it('returns null for even teams', () => {
    expect(handicapTeamFor(fourPlayers())).toBeNull()
    expect(handicapTeamFor(sixPlayers())).toBeNull()
  })

  it('returns the bigger team for uneven teams (5 players, red=2/blue=3)', () => {
    expect(handicapTeamFor(fivePlayersRedSmaller())).toBe('blue')
    // The bigger team is independent of startTeam — it's purely about sizes.
    expect(handicapTeamFor(fivePlayersRedSmaller())).toBe('blue')
  })

  it('returns the bigger team for 7 players (red=3/blue=4)', () => {
    expect(handicapTeamFor(sevenPlayersRedSmaller())).toBe('blue')
  })
})

// ---------------------------------------------------------------------------
// buildAllPickTurns
// ---------------------------------------------------------------------------

describe('buildAllPickTurns', () => {
  it('produces one collective pick turn per player alternating by team', () => {
    const players = fourPlayers()
    const turns = buildAllPickTurns(players, 'red')

    expect(turns).toHaveLength(4)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['red', 'blue', 'red', 'blue'])
  })

  it('honours startTeam=blue', () => {
    const players = fourPlayers()
    const turns = buildAllPickTurns(players, 'blue')

    expect(turns).toHaveLength(4)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['blue', 'red', 'blue', 'red'])
  })

  it('produces players.length turns alternating teams for 6 players', () => {
    const players = sixPlayers()
    const turns = buildAllPickTurns(players, 'red')

    expect(turns).toHaveLength(players.length)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['red', 'blue', 'red', 'blue', 'red', 'blue'])
  })

  it('handles uneven teams (5 players, red=2/blue=3, startTeam=red): red,blue,red,blue,blue', () => {
    const players = fivePlayersRedSmaller()
    const turns = buildAllPickTurns(players, 'red')

    expect(turns).toHaveLength(5)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['red', 'blue', 'red', 'blue', 'blue'])
  })

  it('handles uneven teams (5 players, startTeam=blue means smaller team red is non-start)', () => {
    // Here startTeam=blue (the bigger team). Alternation: blue, red, blue, red, blue (blue exhausts last)
    // Walk: A=blue,B=red. b1 r1 b2 r2 b3
    const players = fivePlayersRedSmaller()
    const turns = buildAllPickTurns(players, 'blue')

    expect(turns).toHaveLength(5)
    expect(turns.map((t) => t.team)).toEqual(['blue', 'red', 'blue', 'red', 'blue'])
  })

  it('handles 7 players (red=3/blue=4) startTeam=red totals', () => {
    const players = sevenPlayersRedSmaller()
    const turns = buildAllPickTurns(players, 'red')

    expect(turns).toHaveLength(7)
    const redCount = turns.filter((t) => t.team === 'red').length
    const blueCount = turns.filter((t) => t.team === 'blue').length
    expect(redCount).toBe(3)
    expect(blueCount).toBe(4)
    // Sequence: red,blue,red,blue,red,blue,blue (red exhausts after 3)
    expect(turns.map((t) => t.team)).toEqual([
      'red',
      'blue',
      'red',
      'blue',
      'red',
      'blue',
      'blue',
    ])
  })
})

// ---------------------------------------------------------------------------
// buildSnakeTurns
// ---------------------------------------------------------------------------

describe('buildSnakeTurns', () => {
  it('produces collective snake turns with team pattern [red,blue,blue,red] for 4 players startTeam=red', () => {
    const players = fourPlayers()
    const turns = buildSnakeTurns(players, 'red')

    expect(turns).toHaveLength(players.length)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['red', 'blue', 'blue', 'red'])
  })

  it('produces team pattern [red,blue,blue,red,red,blue] for 6 players startTeam=red', () => {
    const players = sixPlayers()
    const turns = buildSnakeTurns(players, 'red')

    expect(turns).toHaveLength(players.length)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['red', 'blue', 'blue', 'red', 'red', 'blue'])
  })

  it('flips A/B when startTeam=blue (4 players)', () => {
    const players = fourPlayers()
    const turns = buildSnakeTurns(players, 'blue')

    expect(turns).toHaveLength(players.length)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['blue', 'red', 'red', 'blue'])
  })

  it('flips A/B when startTeam=blue (6 players)', () => {
    const players = sixPlayers()
    const turns = buildSnakeTurns(players, 'blue')

    expect(turns.map((t) => t.team)).toEqual(['blue', 'red', 'red', 'blue', 'blue', 'red'])
  })

  // Uneven snake (5 players, red=2/blue=3, startTeam=red).
  // Base snake (A=red, B=blue): A,B,B,A,A → red,blue,blue,red,red
  //   i=0 red  -> red:1
  //   i=1 blue -> blue:1
  //   i=2 blue -> blue:2
  //   i=3 red  -> red:2 (FULL)
  //   i=4 base would be red, but red is full → fall to blue → blue:3 (FULL)
  // Result: [red, blue, blue, red, blue]
  it('handles uneven teams (5 players, red=2/blue=3, startTeam=red): [red,blue,blue,red,blue]', () => {
    const players = fivePlayersRedSmaller()
    const turns = buildSnakeTurns(players, 'red')

    expect(turns).toHaveLength(5)
    expect(turns.every((t) => t.kind === 'pick')).toBe(true)
    expect(turns.every((t) => t.playerId === null)).toBe(true)
    expect(turns.map((t) => t.team)).toEqual(['red', 'blue', 'blue', 'red', 'blue'])
  })

  it('handles uneven teams when startTeam=blue (5 players, red=2/blue=3)', () => {
    // Base snake (A=blue, B=red): A,B,B,A,A → blue,red,red,blue,blue
    //   i=0 blue -> blue:1
    //   i=1 red  -> red:1
    //   i=2 red  -> red:2 (FULL)
    //   i=3 blue -> blue:2
    //   i=4 blue -> blue:3 (FULL)
    // Result: [blue, red, red, blue, blue]
    const players = fivePlayersRedSmaller()
    const turns = buildSnakeTurns(players, 'blue')

    expect(turns).toHaveLength(5)
    expect(turns.map((t) => t.team)).toEqual(['blue', 'red', 'red', 'blue', 'blue'])
  })

  it('handles 7 players (red=3/blue=4, startTeam=red) totals and length', () => {
    // Base snake (A=red,B=blue): A,B,B,A,A,B,B → red,blue,blue,red,red,blue,blue
    //   i=0 red  -> red:1
    //   i=1 blue -> blue:1
    //   i=2 blue -> blue:2
    //   i=3 red  -> red:2
    //   i=4 red  -> red:3 (FULL)
    //   i=5 blue -> blue:3
    //   i=6 blue -> blue:4 (FULL)
    // Result: [red,blue,blue,red,red,blue,blue]
    const players = sevenPlayersRedSmaller()
    const turns = buildSnakeTurns(players, 'red')

    expect(turns).toHaveLength(7)
    expect(turns.filter((t) => t.team === 'red')).toHaveLength(3)
    expect(turns.filter((t) => t.team === 'blue')).toHaveLength(4)
    expect(turns.map((t) => t.team)).toEqual([
      'red',
      'blue',
      'blue',
      'red',
      'red',
      'blue',
      'blue',
    ])
  })

  it('throws when teams differ by more than one player', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'r2', team: 'red', seat: 2 }),
      makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
    ]

    expect(() => buildSnakeTurns(players, 'red')).toThrow(
      'teams must differ by at most one player',
    )
  })

  it('does NOT throw when teams differ by exactly one player', () => {
    const players = fivePlayersRedSmaller()
    expect(() => buildSnakeTurns(players, 'red')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// buildPickBanTurns
// ---------------------------------------------------------------------------

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

  // Uneven pick-and-ban (5 players, red=2/blue=3, startTeam=red).
  // banRounds = min(red,blue) = min(2,3) = 2.
  //   round 0 (leader=A=red): ban red, ban blue
  //   round 1 (leader=B=blue): ban blue, ban red
  //   → 4 bans (2 each).
  // Pick phase alternates A,B,A,B... while each team still has slots:
  //   pick red (red:1), pick blue (blue:1), pick red (red:2 FULL),
  //   pick blue (blue:2), pick blue (blue:3 FULL)
  //   → 5 picks: red, blue, red, blue, blue
  // Total turns = 4 bans + 5 picks = 9.
  it('handles uneven teams (5 players, red=2/blue=3, startTeam=red)', () => {
    const players = fivePlayersRedSmaller()
    const turns = buildPickBanTurns(players, 'red')

    const expected: Array<[DraftTurn['kind'], TeamId]> = [
      // banRounds = 2
      ['ban', 'red'],
      ['ban', 'blue'],
      ['ban', 'blue'],
      ['ban', 'red'],
      // picks
      ['pick', 'red'],
      ['pick', 'blue'],
      ['pick', 'red'],
      ['pick', 'blue'],
      ['pick', 'blue'],
    ]
    expect(turns).toHaveLength(expected.length)
    turns.forEach((t, i) => {
      expect(t.kind).toBe(expected[i][0])
      expect(t.team).toBe(expected[i][1])
      expect(t.playerId).toBeNull()
    })

    const picks = turns.filter((t) => t.kind === 'pick')
    const bans = turns.filter((t) => t.kind === 'ban')
    expect(picks).toHaveLength(5)
    expect(bans).toHaveLength(4)
    expect(bans.filter((b) => b.team === 'red')).toHaveLength(2)
    expect(bans.filter((b) => b.team === 'blue')).toHaveLength(2)
    expect(picks.filter((p) => p.team === 'red')).toHaveLength(2)
    expect(picks.filter((p) => p.team === 'blue')).toHaveLength(3)
  })

  it('handles uneven teams (7 players, red=3/blue=4, startTeam=red) totals', () => {
    // banRounds = min(3,4) = 3. 6 bans (3 each). 7 picks (red 3, blue 4).
    const players = sevenPlayersRedSmaller()
    const turns = buildPickBanTurns(players, 'red')

    const bans = turns.filter((t) => t.kind === 'ban')
    const picks = turns.filter((t) => t.kind === 'pick')
    expect(bans).toHaveLength(6)
    expect(picks).toHaveLength(7)
    expect(bans.filter((b) => b.team === 'red')).toHaveLength(3)
    expect(bans.filter((b) => b.team === 'blue')).toHaveLength(3)
    expect(picks.filter((p) => p.team === 'red')).toHaveLength(3)
    expect(picks.filter((p) => p.team === 'blue')).toHaveLength(4)
    expect(turns).toHaveLength(13)
  })

  it('throws when teams differ by more than one player', () => {
    const players: Player[] = [
      makePlayer({ id: 'r0', team: 'red', seat: 0 }),
      makePlayer({ id: 'r1', team: 'red', seat: 1 }),
      makePlayer({ id: 'r2', team: 'red', seat: 2 }),
      makePlayer({ id: 'b3', team: 'blue', seat: 3 }),
    ]

    expect(() => buildPickBanTurns(players, 'red')).toThrow(
      'teams must differ by at most one player',
    )
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

  it('works for odd player counts (5)', () => {
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']
    const result = selectRandomDraftPool(pool, 5, () => 0)

    expect(result).toHaveLength(7)
    expect(new Set(result).size).toBe(7)
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

  it('works for 5 players (odd)', () => {
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5']
    const pool = Array.from({ length: 15 }, (_, i) => `h${i + 1}`)
    const hands = dealHands(playerIds, pool, 3, () => 0)

    expect(Object.keys(hands).sort()).toEqual([...playerIds].sort())
    const all = playerIds.flatMap((id) => hands[id])
    expect(new Set(all).size).toBe(15)
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

  it('returns 2 * playerCount for pick-and-ban (even)', () => {
    expect(minimumPoolSize(4, 'pick-and-ban')).toBe(8)
    expect(minimumPoolSize(6, 'pick-and-ban')).toBe(12)
    expect(minimumPoolSize(10, 'pick-and-ban')).toBe(20)
  })

  it('handles odd player counts correctly', () => {
    // 5 players, all-pick/snake: 5
    expect(minimumPoolSize(5)).toBe(5)
    expect(minimumPoolSize(5, 'snake')).toBe(5)
    expect(minimumPoolSize(5, 'all-pick')).toBe(5)
    expect(minimumPoolSize(5, 'random')).toBe(5)
    // random-draft: 5 + 2 = 7
    expect(minimumPoolSize(5, 'random-draft')).toBe(7)
    // single-draft: 5 * 3 = 15
    expect(minimumPoolSize(5, 'single-draft')).toBe(15)
    // pick-and-ban: 5 + 2*floor(5/2) = 5 + 4 = 9
    expect(minimumPoolSize(5, 'pick-and-ban')).toBe(9)
    // 7 players, pick-and-ban: 7 + 2*3 = 13
    expect(minimumPoolSize(7, 'pick-and-ban')).toBe(13)
    // 9 players, pick-and-ban: 9 + 2*4 = 17
    expect(minimumPoolSize(9, 'pick-and-ban')).toBe(17)
  })
})
