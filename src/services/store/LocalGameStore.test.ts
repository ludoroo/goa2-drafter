import type { CreateGameInput, DraftMethod, GameSnapshot, TeamId } from '@/types'
import { heroesPerTeam, nextPickerId } from '@/services/draft'
import { LocalGameStore } from './LocalGameStore'

const clearStorage = (): void => {
  // jsdom in some Node versions exposes window.localStorage as undefined;
  // the LocalGameStore falls back to an in-memory shim, so simply skip when
  // real localStorage isn't available.
  const ls = (globalThis as { localStorage?: Storage }).localStorage
  if (ls) ls.clear()
}

const fourPlayerInput = (): CreateGameInput => ({
  playerCount: 4,
  method: 'snake',
  heroPool: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  players: [
    { name: 'Alice', team: 'red', seat: 0 },
    { name: 'Bob', team: 'blue', seat: 1 },
    { name: 'Carol', team: 'red', seat: 2 },
    { name: 'Dan', team: 'blue', seat: 3 },
  ],
})

const randomFourPlayerInput = (): CreateGameInput => ({
  ...fourPlayerInput(),
  method: 'random',
})

describe('LocalGameStore.createGame — snake', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('creates a snake-draft game with status drafting and a 4-entry draft order', async () => {
    const store = new LocalGameStore()

    const { game, organiserToken, players } = await store.createGame(fourPlayerInput())

    expect(game.status).toBe('drafting')
    expect(game.method).toBe('snake')
    expect(game.draftOrder).toHaveLength(4)
    expect(game.currentPick).toBe(0)
    expect(game.heroPool).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    expect(game.playerCount).toBe(4)

    expect(players).toHaveLength(4)
    const tokens = players.map((p) => p.token)
    expect(new Set(tokens).size).toBe(4)
    for (const tok of tokens) expect(tok.length).toBeGreaterThan(0)

    expect(typeof organiserToken).toBe('string')
    expect(organiserToken.length).toBeGreaterThan(0)

    // seats preserved as supplied
    const bySeat = [...players].sort((a, b) => a.seat - b.seat)
    expect(bySeat.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Carol', 'Dan'])
  })

  it('persists the snapshot so getSnapshot returns equal game/players/picks', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())

    const snap = await store.getSnapshot(game.id)
    expect(snap).not.toBeNull()
    const s = snap as GameSnapshot
    expect(s.game).toEqual(game)
    // GameSnapshot.players is the public projection — no token field is exposed.
    const publicPlayers = players.map(({ id, name, team, seat }) => ({ id, name, team, seat }))
    expect(s.players).toEqual(publicPlayers)
    for (const sp of s.players) {
      expect(sp).not.toHaveProperty('token')
    }
    expect(s.picks).toEqual([])
  })
})

describe('LocalGameStore.createGame — random', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('produces a complete game with one pick per player from the pool', async () => {
    const store = new LocalGameStore()

    const { game, players } = await store.createGame(randomFourPlayerInput())

    expect(game.status).toBe('complete')
    expect(game.method).toBe('random')
    expect(game.draftOrder).toEqual([])
    expect(game.currentPick).toBe(0)

    const snap = await store.getSnapshot(game.id)
    const picks = (snap as GameSnapshot).picks

    expect(picks).toHaveLength(4)
    // every pick's heroId is from the pool
    for (const pk of picks) {
      expect(game.heroPool).toContain(pk.heroId)
      expect(pk.pickIndex).toBeNull()
    }
    // distinct heroes
    expect(new Set(picks.map((p) => p.heroId)).size).toBe(4)
    // one pick per player
    expect(new Set(picks.map((p) => p.playerId)).size).toBe(4)
    expect(new Set(picks.map((p) => p.playerId))).toEqual(new Set(players.map((p) => p.id)))
  })
})

describe('LocalGameStore.makePick', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('accepts the current picker choosing an available hero, advances currentPick', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())

    const currentPickerId = nextPickerId(game.draftOrder, 0)
    const picker = players.find((p) => p.id === currentPickerId)
    expect(picker).toBeDefined()

    const result = await store.makePick(game.id, picker!.token, 'h1')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.snapshot.picks).toHaveLength(1)
    expect(result.snapshot.picks[0]?.heroId).toBe('h1')
    expect(result.snapshot.picks[0]?.playerId).toBe(picker!.id)
    expect(result.snapshot.picks[0]?.pickIndex).toBe(0)
    expect(result.snapshot.game.currentPick).toBe(1)
    expect(result.snapshot.game.status).toBe('drafting')
  })

  it('rejects a pick when it is not the requesting player\u2019s turn', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())

    const currentPickerId = nextPickerId(game.draftOrder, 0)
    const wrong = players.find((p) => p.id !== currentPickerId)
    expect(wrong).toBeDefined()

    const result = await store.makePick(game.id, wrong!.token, 'h1')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toBe('not-your-turn')
  })

  it('rejects an unknown player token', async () => {
    const store = new LocalGameStore()
    const { game } = await store.createGame(fourPlayerInput())

    const result = await store.makePick(game.id, 'not-a-real-token', 'h1')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toBe('invalid-token')
  })

  it('rejects a hero not in the pool as hero-unavailable', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())

    const picker = players.find((p) => p.id === nextPickerId(game.draftOrder, 0))!

    const result = await store.makePick(game.id, picker.token, 'not-a-hero')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toBe('hero-unavailable')
  })

  it('rejects a hero already picked as hero-unavailable', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())

    const picker0 = players.find((p) => p.id === nextPickerId(game.draftOrder, 0))!
    const ok = await store.makePick(game.id, picker0.token, 'h1')
    expect(ok.ok).toBe(true)

    // Second picker tries to take h1 again.
    const snap1 = (await store.getSnapshot(game.id)) as GameSnapshot
    const picker1 = players.find((p) => p.id === nextPickerId(snap1.game.draftOrder, 1))!
    const result = await store.makePick(game.id, picker1.token, 'h1')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toBe('hero-unavailable')
  })

  it('rejects picks once the draft is complete with game-not-drafting', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())

    // Play the snake to completion.
    const heroes = ['h1', 'h2', 'h3', 'h4']
    let snap = (await store.getSnapshot(game.id)) as GameSnapshot
    for (let i = 0; i < snap.game.draftOrder.length; i++) {
      const pickerId = nextPickerId(snap.game.draftOrder, snap.game.currentPick)
      const picker = players.find((p) => p.id === pickerId)!
      const r = await store.makePick(game.id, picker.token, heroes[i]!)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('expected ok')
      snap = r.snapshot
    }
    expect(snap.game.status).toBe('complete')

    // Any further pick attempt — even by a real player with a real hero — must be rejected.
    const player = players[0]!
    const result = await store.makePick(game.id, player.token, 'h5')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toBe('game-not-drafting')
  })

  it('rejects picks for an unknown game with game-not-found', async () => {
    const store = new LocalGameStore()
    const result = await store.makePick('does-not-exist', 'tok', 'h1')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toBe('game-not-found')
  })
})

describe('LocalGameStore — full snake playthrough', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('completes a 4-player snake draft with each team holding heroesPerTeam heroes', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())
    const heroes = ['h1', 'h2', 'h3', 'h4']

    let snap = (await store.getSnapshot(game.id)) as GameSnapshot
    for (let i = 0; i < snap.game.draftOrder.length; i++) {
      const pickerId = nextPickerId(snap.game.draftOrder, snap.game.currentPick)!
      const picker = players.find((p) => p.id === pickerId)!
      const r = await store.makePick(game.id, picker.token, heroes[i]!)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('expected ok')
      snap = r.snapshot
    }

    expect(snap.game.status).toBe('complete')
    expect(snap.game.currentPick).toBe(snap.game.draftOrder.length)

    const playersById = new Map(players.map((p) => [p.id, p]))
    const perTeam: Record<'red' | 'blue', number> = { red: 0, blue: 0 }
    for (const pk of snap.picks) {
      const owner = playersById.get(pk.playerId)!
      perTeam[owner.team]++
    }
    expect(perTeam.red).toBe(heroesPerTeam(4))
    expect(perTeam.blue).toBe(heroesPerTeam(4))
  })
})

describe('LocalGameStore.subscribe', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('fires same-tab subscribers when makePick mutates the game, and stops after unsubscribe', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())

    const calls: GameSnapshot[] = []
    const unsubscribe = store.subscribe(game.id, (snap) => {
      calls.push(snap)
    })

    const picker = players.find((p) => p.id === nextPickerId(game.draftOrder, 0))!
    const r = await store.makePick(game.id, picker.token, 'h1')
    expect(r.ok).toBe(true)

    expect(calls.length).toBeGreaterThanOrEqual(1)
    const last = calls[calls.length - 1]!
    expect(last.picks).toHaveLength(1)
    expect(last.picks[0]?.heroId).toBe('h1')
    expect(last.game.currentPick).toBe(1)

    unsubscribe()

    // Another valid pick should NOT call the callback again.
    const before = calls.length
    const snap1 = (await store.getSnapshot(game.id)) as GameSnapshot
    const picker1 = players.find((p) => p.id === nextPickerId(snap1.game.draftOrder, 1))!
    const r2 = await store.makePick(game.id, picker1.token, 'h2')
    expect(r2.ok).toBe(true)

    expect(calls.length).toBe(before)
  })
})

describe('LocalGameStore.getSnapshot', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('returns null for an unknown game id', async () => {
    const store = new LocalGameStore()
    expect(await store.getSnapshot('no-such-game')).toBeNull()
  })
})

describe('LocalGameStore.makePick — optimistic concurrency', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('does not lose updates when a competing writer commits between read and write', async () => {
    const store = new LocalGameStore()
    const { game, players } = await store.createGame(fourPlayerInput())
    const snapAtStart = (await store.getSnapshot(game.id)) as GameSnapshot

    // Picker for slot 0 (player A) and slot 1 (player B). Snake order means
    // these are different players, so the second pick is legitimately allowed
    // once it is correctly re-validated against fresh state.
    const playerA = players.find((p) => p.id === nextPickerId(snapAtStart.game.draftOrder, 0))!
    const playerB = players.find((p) => p.id === nextPickerId(snapAtStart.game.draftOrder, 1))!

    // Simulate a competing tab that commits player A's pick of `h1` AFTER
    // our about-to-run makePick has read the record but BEFORE it writes.
    // We do this by intercepting the internal storage's `getItem`: the FIRST
    // call (the initial read) returns the original record; the SECOND call
    // (the CAS re-read just before write) returns a record with rev+1
    // already in place, simulating the competing commit. Subsequent calls
    // fall through to the real storage, which by then has been updated by us
    // to reflect the competing commit so the retry sees consistent state.
    const internal = (store as unknown as { storage: Storage }).storage
    const realGet = internal.getItem.bind(internal)
    const realSet = internal.setItem.bind(internal)
    const key = `goa2:game:${game.id}`

    let getCount = 0
    const competingPickHero = 'h1'
    let competingCommitted = false

    internal.getItem = (k: string): string | null => {
      if (k !== key) return realGet(k)
      getCount += 1
      // 1st call: initial read inside makePick → original snapshot (rev=0).
      if (getCount === 1) return realGet(k)
      // 2nd call: the CAS re-read → return a version with rev advanced and
      // h1 already taken, then also actually persist that to storage so the
      // retry path sees the same state.
      if (getCount === 2 && !competingCommitted) {
        const competingPick = {
          id: 'competing-pick',
          playerId: playerA.id,
          heroId: competingPickHero,
          pickIndex: 0,
          createdAt: Date.now(),
        }
        const competingSnap: GameSnapshot = {
          game: { ...snapAtStart.game, currentPick: 1 },
          players: snapAtStart.players,
          picks: [competingPick],
        }
        // The persisted record carries a private token map alongside the
        // shared snapshot — see PersistedRecord in LocalGameStore.ts. The
        // fake competing record must include it or readRecord will reject
        // the row as malformed and the retry path can't resolve A's token.
        const competingTokens: Record<string, string> = {}
        for (const p of players) competingTokens[p.id] = p.token
        const competingRecord = JSON.stringify({
          snapshot: competingSnap,
          tokens: competingTokens,
          rev: 1,
        })
        realSet(k, competingRecord)
        competingCommitted = true
        return competingRecord
      }
      return realGet(k)
    }

    // Player A attempts to pick h1. Read sees rev=0 (no picks). Validation
    // passes. The CAS check then sees rev=1 (competing commit took h1) and
    // forces a retry. On retry, A is no longer the current picker (currentPick
    // moved to 1, where B is expected) so A's retried attempt is rejected
    // with `not-your-turn` rather than producing a double-commit.
    const result = await store.makePick(game.id, playerA.token, competingPickHero)

    // Restore real getter so subsequent reads work normally.
    internal.getItem = realGet

    // No double-commit and no invariant broken: storage reflects exactly the
    // competing commit's state (one pick of h1, currentPick=1).
    const final = (await store.getSnapshot(game.id)) as GameSnapshot
    expect(final.picks).toHaveLength(1)
    expect(final.picks[0]?.heroId).toBe(competingPickHero)
    expect(final.game.currentPick).toBe(1)

    // The retried attempt either failed cleanly or was redirected by the
    // re-validation; in any case we did not lose the competing update.
    if (result.ok) {
      // Should not have succeeded as A — A is no longer current picker.
      throw new Error('expected stale write to be rejected on retry')
    }
    expect(['not-your-turn', 'hero-unavailable']).toContain(result.error)

    // And the next legitimate pick (player B picking h2) succeeds normally.
    const r2 = await store.makePick(game.id, playerB.token, 'h2')
    expect(r2.ok).toBe(true)
    if (!r2.ok) throw new Error('expected ok')
    expect(r2.snapshot.picks).toHaveLength(2)
    expect(r2.snapshot.game.currentPick).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// New draft methods (T3): all-pick, random-draft, single-draft, pick-and-ban,
// plus back-compat for legacy persisted records.
// ---------------------------------------------------------------------------

const fourPlayerInputFor = (method: DraftMethod, heroPool: string[]): CreateGameInput => ({
  playerCount: 4,
  method,
  heroPool,
  players: [
    { name: 'Alice', team: 'red', seat: 0 },
    { name: 'Bob', team: 'blue', seat: 1 },
    { name: 'Carol', team: 'red', seat: 2 },
    { name: 'Dan', team: 'blue', seat: 3 },
  ],
})

describe('LocalGameStore — all-pick', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('runs a full all-pick playthrough following game.turns', async () => {
    const store = new LocalGameStore()
    const pool = ['ha', 'hb', 'hc', 'hd', 'he', 'hf']
    const { game, players } = await store.createGame(fourPlayerInputFor('all-pick', pool))

    expect(game.method).toBe('all-pick')
    expect(game.status).toBe('drafting')
    expect(game.turns).toHaveLength(4)
    expect(game.bans).toEqual([])
    expect(game.currentPick).toBe(0)
    for (const t of game.turns) {
      expect(t.kind).toBe('pick')
      expect(typeof t.playerId).toBe('string')
    }

    // Each turn's team matches the player's team.
    const playersById = new Map(players.map((p) => [p.id, p]))
    for (const t of game.turns) {
      const p = playersById.get(t.playerId as string)
      expect(p).toBeDefined()
      expect(t.team).toBe(p!.team)
    }

    let snap = (await store.getSnapshot(game.id)) as GameSnapshot
    const remainingPool = [...pool]
    for (let i = 0; i < snap.game.turns.length; i++) {
      const turn = snap.game.turns[snap.game.currentPick]!
      const picker = players.find((p) => p.id === turn.playerId)!
      const heroId = remainingPool.shift()!
      const r = await store.makePick(game.id, picker.token, heroId)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('expected ok')
      snap = r.snapshot
      expect(snap.game.currentPick).toBe(i + 1)
    }

    expect(snap.game.status).toBe('complete')
    expect(snap.picks).toHaveLength(4)
    const perTeam: Record<TeamId, number> = { red: 0, blue: 0 }
    for (const pk of snap.picks) {
      const owner = playersById.get(pk.playerId)!
      perTeam[owner.team]++
    }
    expect(perTeam.red).toBe(2)
    expect(perTeam.blue).toBe(2)
  })

  it('rejects a pick by a player whose turn it is not with not-your-turn', async () => {
    const store = new LocalGameStore()
    const pool = ['ha', 'hb', 'hc', 'hd', 'he', 'hf']
    const { game, players } = await store.createGame(fourPlayerInputFor('all-pick', pool))

    const currentTurn = game.turns[0]!
    const wrong = players.find((p) => p.id !== currentTurn.playerId)!
    const result = await store.makePick(game.id, wrong.token, 'ha')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error).toBe('not-your-turn')
  })
})

describe('LocalGameStore — random-draft', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('trims the hero pool to playerCount+2 and rejects picks outside it', async () => {
    const store = new LocalGameStore()
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10']
    const { game, players } = await store.createGame(fourPlayerInputFor('random-draft', pool))

    expect(game.method).toBe('random-draft')
    expect(game.status).toBe('drafting')
    expect(game.heroPool).toHaveLength(6)
    // trimmed pool is a subset of input
    for (const h of game.heroPool) expect(pool).toContain(h)
    expect(game.turns).toHaveLength(4)

    // A hero from the original pool that is NOT in the trimmed pool must be rejected.
    const excluded = pool.find((h) => !game.heroPool.includes(h))!
    const firstTurn = game.turns[0]!
    const firstPicker = players.find((p) => p.id === firstTurn.playerId)!
    const reject = await store.makePick(game.id, firstPicker.token, excluded)
    expect(reject.ok).toBe(false)
    if (reject.ok) throw new Error('expected error')
    expect(reject.error).toBe('hero-unavailable')

    // Full playthrough using the trimmed pool.
    let snap = (await store.getSnapshot(game.id)) as GameSnapshot
    const remaining = [...snap.game.heroPool]
    for (let i = 0; i < snap.game.turns.length; i++) {
      const turn = snap.game.turns[snap.game.currentPick]!
      const picker = players.find((p) => p.id === turn.playerId)!
      const heroId = remaining.shift()!
      const r = await store.makePick(game.id, picker.token, heroId)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('expected ok')
      snap = r.snapshot
    }
    expect(snap.game.status).toBe('complete')
    expect(snap.picks).toHaveLength(4)
  })
})

describe('LocalGameStore — single-draft', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('deals disjoint 3-card hands with no turn sequence (simultaneous draft)', async () => {
    const store = new LocalGameStore()
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    const { game, players } = await store.createGame(fourPlayerInputFor('single-draft', pool))

    expect(game.method).toBe('single-draft')
    expect(game.status).toBe('drafting')
    // Single draft is simultaneous: no turn sequence, no draft order.
    expect(game.turns).toEqual([])
    expect(game.draftOrder).toEqual([])
    expect(game.currentPick).toBe(0)
    expect(game.bans).toEqual([])
    expect(game.heroPool).toEqual(pool)

    // Each player has a 3-card hand and hands are disjoint.
    const hands: Record<string, string[]> = {}
    for (const p of players) {
      const view = await store.getPlayerView(game.id, p.token)
      expect(view).not.toBeNull()
      expect(view!.player.id).toBe(p.id)
      expect(view!.hand).not.toBeNull()
      expect(view!.hand!).toHaveLength(3)
      hands[p.id] = view!.hand!
    }
    const allDealt = Object.values(hands).flat()
    expect(new Set(allDealt).size).toBe(allDealt.length)
    for (const h of allDealt) expect(pool).toContain(h)

    // Snapshot does NOT expose hands on players.
    const snap = (await store.getSnapshot(game.id)) as GameSnapshot
    for (const sp of snap.players) {
      expect(sp).not.toHaveProperty('hand')
    }
  })

  it('allows simultaneous out-of-order picking by every player from their own hand', async () => {
    const store = new LocalGameStore()
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    const { game, players } = await store.createGame(fourPlayerInputFor('single-draft', pool))

    // Capture each player's hand via their token-gated view.
    const hands: Record<string, string[]> = {}
    for (const p of players) {
      const view = await store.getPlayerView(game.id, p.token)
      hands[p.id] = view!.hand!
    }

    // Arbitrary out-of-order picking: player[2], player[0], player[3], player[1].
    const order = [players[2]!, players[0]!, players[3]!, players[1]!]
    let snap = (await store.getSnapshot(game.id)) as GameSnapshot
    for (let i = 0; i < order.length; i++) {
      const picker = order[i]!
      const hero = hands[picker.id]![0]!
      const r = await store.makePick(game.id, picker.token, hero)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error(`expected ok for picker ${picker.name}, got ${r.error}`)
      snap = r.snapshot
    }

    expect(snap.game.status).toBe('complete')
    expect(snap.picks).toHaveLength(4)
    // Simultaneous draft has no pick order index.
    for (const pk of snap.picks) {
      expect(pk.pickIndex).toBeNull()
    }
    // Each player owns exactly one pick.
    expect(new Set(snap.picks.map((pk) => pk.playerId))).toEqual(new Set(players.map((p) => p.id)))
    // currentPick stays untouched (unused for single-draft).
    expect(snap.game.currentPick).toBe(0)
  })

  it('rejects picking a hero not in the caller\u2019s hand with not-in-hand', async () => {
    const store = new LocalGameStore()
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    const { game, players } = await store.createGame(fourPlayerInputFor('single-draft', pool))

    const hands: Record<string, string[]> = {}
    for (const p of players) {
      const view = await store.getPlayerView(game.id, p.token)
      hands[p.id] = view!.hand!
    }

    const caller = players[0]!
    const other = players[1]!
    const notInHand = hands[other.id]![0]!
    expect(hands[caller.id]).not.toContain(notInHand)

    const r = await store.makePick(game.id, caller.token, notInHand)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected error')
    expect(r.error).toBe('not-in-hand')
  })

  it('rejects a second pick by the same player with hero-unavailable', async () => {
    const store = new LocalGameStore()
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    const { game, players } = await store.createGame(fourPlayerInputFor('single-draft', pool))

    const caller = players[0]!
    const view = await store.getPlayerView(game.id, caller.token)
    const hand = view!.hand!

    const r1 = await store.makePick(game.id, caller.token, hand[0]!)
    expect(r1.ok).toBe(true)
    if (!r1.ok) throw new Error('expected ok')

    // Same caller attempts a second pick (a different hero from their hand).
    const r2 = await store.makePick(game.id, caller.token, hand[1]!)
    expect(r2.ok).toBe(false)
    if (r2.ok) throw new Error('expected error')
    expect(r2.error).toBe('hero-unavailable')
  })
})

describe('LocalGameStore — pick-and-ban', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('runs a rulebook pick-and-ban draft with collective team turns', async () => {
    const store = new LocalGameStore()
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']
    const { game, players } = await store.createGame(fourPlayerInputFor('pick-and-ban', pool))

    expect(game.method).toBe('pick-and-ban')
    expect(game.status).toBe('drafting')
    // H = 2 → 4*H = 8 turns total (4 bans + 4 picks).
    expect(game.turns).toHaveLength(8)
    expect(game.currentPick).toBe(0)
    expect(game.draftOrder).toEqual([])
    expect(game.bans).toEqual([])
    // All turns have playerId === null (collective).
    for (const t of game.turns) expect(t.playerId).toBeNull()

    const playersById = new Map(players.map((p) => [p.id, p]))
    const byTeam: Record<TeamId, typeof players> = {
      red: players.filter((p) => p.team === 'red'),
      blue: players.filter((p) => p.team === 'blue'),
    }
    let snap = (await store.getSnapshot(game.id)) as GameSnapshot

    // Walk the turns; remaining hero ids tracked locally.
    const remaining = [...pool]
    for (let i = 0; i < snap.game.turns.length; i++) {
      const turn = snap.game.turns[snap.game.currentPick]!
      const actingTeam = turn.team
      const otherTeam: TeamId = actingTeam === 'red' ? 'blue' : 'red'

      // A player on the OTHER team should be rejected with not-your-team.
      const wrong = byTeam[otherTeam][0]!
      const wrongAttempt = await store.makePick(game.id, wrong.token, remaining[0]!)
      expect(wrongAttempt.ok).toBe(false)
      if (wrongAttempt.ok) throw new Error('expected error')
      expect(wrongAttempt.error).toBe('not-your-team')

      // Pick any player on the acting team to perform the action.
      const actor = byTeam[actingTeam][0]!
      const target = remaining.shift()!
      const r = await store.makePick(game.id, actor.token, target)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('expected ok')
      snap = r.snapshot
      expect(snap.game.currentPick).toBe(i + 1)

      if (turn.kind === 'ban') {
        expect(snap.game.bans).toContain(target)
        // No pick row was added for this ban.
        expect(snap.picks.find((pk) => pk.heroId === target)).toBeUndefined()
      } else {
        // The pick row exists and was claimed by a player on the acting team.
        const pickRow = snap.picks.find((pk) => pk.heroId === target)
        expect(pickRow).toBeDefined()
        const owner = playersById.get(pickRow!.playerId)!
        expect(owner.team).toBe(actingTeam)
      }
    }

    expect(snap.game.status).toBe('complete')
    expect(snap.picks).toHaveLength(4)
    expect(snap.game.bans).toHaveLength(4)
    const perTeam: Record<TeamId, number> = { red: 0, blue: 0 }
    for (const pk of snap.picks) {
      const owner = playersById.get(pk.playerId)!
      perTeam[owner.team]++
    }
    expect(perTeam.red).toBe(2)
    expect(perTeam.blue).toBe(2)
  })

  it('rejects banning an already-banned hero', async () => {
    const store = new LocalGameStore()
    const pool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']
    const { game, players } = await store.createGame(fourPlayerInputFor('pick-and-ban', pool))

    const firstTurn = game.turns[0]!
    expect(firstTurn.kind).toBe('ban')
    const actor = players.find((p) => p.team === firstTurn.team)!
    const r1 = await store.makePick(game.id, actor.token, 'h1')
    expect(r1.ok).toBe(true)
    if (!r1.ok) throw new Error('expected ok')

    // The second turn is also a ban (by the other team). Try to ban h1 again.
    const snap = r1.snapshot
    const turn2 = snap.game.turns[snap.game.currentPick]!
    const actor2 = players.find((p) => p.team === turn2.team)!
    const r2 = await store.makePick(game.id, actor2.token, 'h1')
    expect(r2.ok).toBe(false)
    if (r2.ok) throw new Error('expected error')
    expect(r2.error).toBe('hero-banned')
  })
})

describe('LocalGameStore — back-compat with legacy persisted records', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('reads a legacy record (no turns/bans/startTeam, no hands) and fills defaults', async () => {
    const store = new LocalGameStore()
    const gameId = 'legacy1'

    // Hand-write a record shaped like the OLD format.
    const legacyGame = {
      id: gameId,
      status: 'drafting' as const,
      playerCount: 4,
      method: 'snake' as const,
      heroPool: ['h1', 'h2', 'h3', 'h4'],
      draftOrder: ['p1', 'p2', 'p3', 'p4'],
      currentPick: 0,
      createdAt: 1,
    }
    const legacyRecord = {
      snapshot: {
        game: legacyGame,
        players: [
          { id: 'p1', name: 'A', team: 'red', seat: 0 },
          { id: 'p2', name: 'B', team: 'blue', seat: 1 },
          { id: 'p3', name: 'C', team: 'red', seat: 2 },
          { id: 'p4', name: 'D', team: 'blue', seat: 3 },
        ],
        picks: [],
      },
      tokens: { p1: 't1', p2: 't2', p3: 't3', p4: 't4' },
      rev: 0,
    }
    const internal = (store as unknown as { storage: Storage }).storage
    internal.setItem(`goa2:game:${gameId}`, JSON.stringify(legacyRecord))

    const snap = await store.getSnapshot(gameId)
    expect(snap).not.toBeNull()
    expect(snap!.game.turns).toEqual([])
    expect(snap!.game.bans).toEqual([])
    expect(snap!.game.startTeam).toBe('red')
  })
})

describe('LocalGameStore — coin flip & startTeam recorded', () => {
  beforeEach(() => {
    clearStorage()
  })

  it('records a startTeam on every method', async () => {
    const store = new LocalGameStore()
    const methods: DraftMethod[] = [
      'snake',
      'random',
      'all-pick',
      'random-draft',
      'single-draft',
      'pick-and-ban',
    ]
    const bigPool = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12']
    for (const method of methods) {
      const { game } = await store.createGame(fourPlayerInputFor(method, bigPool))
      expect(game.startTeam === 'red' || game.startTeam === 'blue').toBe(true)
    }
  })
})
