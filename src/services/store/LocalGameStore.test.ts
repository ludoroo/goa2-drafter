import type { CreateGameInput, GameSnapshot } from '@/types'
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
    expect(s.players).toEqual(players)
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
        const competingRecord = JSON.stringify({ snapshot: competingSnap, rev: 1 })
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
