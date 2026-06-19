import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { LocalGameStore } from '@/services/store/LocalGameStore'
import { HEROES } from '@/data/heroes'
import { nextPickerId } from '@/services/draft'
import type {
  CreateGameInput,
  Game,
  GameSnapshot,
  GameStore,
  PickResult,
  Player,
} from '@/types'
import { useGame } from './useGame'

interface CreatedGame {
  game: Game
  organiserToken: string
  players: Player[]
}

const heroPool = (): string[] => HEROES.slice(0, 12).map((h) => h.id)

const fourPlayerInput = (): CreateGameInput => ({
  playerCount: 4,
  method: 'snake',
  heroPool: heroPool(),
  players: [
    { name: 'Alice', team: 'red', seat: 1 },
    { name: 'Bob', team: 'blue', seat: 2 },
    { name: 'Carol', team: 'red', seat: 3 },
    { name: 'Dave', team: 'blue', seat: 4 },
  ],
})

const tokenForPlayer = (created: CreatedGame, playerId: string): string => {
  const p = created.players.find((x) => x.id === playerId)
  if (!p) throw new Error('player not found')
  return p.token
}

const pickAvailable = (created: CreatedGame, usedHeroIds: Set<string>): string => {
  const next = created.game.heroPool.find((id) => !usedHeroIds.has(id))
  if (!next) throw new Error('no heroes left in pool')
  return next
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('useGame', () => {
  it('loads the snapshot and exposes the first picker', async () => {
    const store = new LocalGameStore()
    const created = await store.createGame(fourPlayerInput())

    const { result } = renderHook(() => useGame(created.game.id, store))

    expect(result.current.loading).toBe(true)
    expect(result.current.snapshot).toBeNull()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.snapshot).not.toBeNull()
    })

    expect(result.current.error).toBeNull()
    expect(result.current.snapshot?.game.id).toBe(created.game.id)
    expect(result.current.currentPickerId).toBe(created.game.draftOrder[0])
    expect(result.current.isComplete).toBe(false)
  })

  it('makePick by the wrong player returns ok:false and snapshot is unchanged', async () => {
    const store = new LocalGameStore()
    const created = await store.createGame(fourPlayerInput())

    const { result } = renderHook(() => useGame(created.game.id, store))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())

    const wrongPlayerId = created.game.draftOrder[1]
    const wrongToken = tokenForPlayer(created, wrongPlayerId)
    const heroId = created.game.heroPool[0]

    let res
    await act(async () => {
      res = await result.current.makePick(wrongToken, heroId)
    })

    expect(res).toEqual({ ok: false, error: 'not-your-turn' })
    expect(result.current.currentPickerId).toBe(created.game.draftOrder[0])
    expect(result.current.snapshot?.picks).toHaveLength(0)
  })

  it('makePick by the current picker advances the snapshot', async () => {
    const store = new LocalGameStore()
    const created = await store.createGame(fourPlayerInput())

    const { result } = renderHook(() => useGame(created.game.id, store))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())

    const correctPlayerId = created.game.draftOrder[0]
    const correctToken = tokenForPlayer(created, correctPlayerId)
    const heroId = created.game.heroPool[0]

    let res
    await act(async () => {
      res = await result.current.makePick(correctToken, heroId)
    })

    expect(res?.ok).toBe(true)
    await waitFor(() => {
      expect(result.current.snapshot?.picks).toHaveLength(1)
      expect(result.current.currentPickerId).toBe(created.game.draftOrder[1])
    })
  })

  it('subscribes to the same store: external picks update the hook snapshot', async () => {
    const store = new LocalGameStore()
    const created = await store.createGame(fourPlayerInput())

    const { result } = renderHook(() => useGame(created.game.id, store))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())

    const firstPickerId = created.game.draftOrder[0]
    const firstToken = tokenForPlayer(created, firstPickerId)
    const heroId = created.game.heroPool[0]

    await act(async () => {
      await store.makePick(created.game.id, firstToken, heroId)
    })

    await waitFor(() => {
      expect(result.current.snapshot?.picks).toHaveLength(1)
      expect(result.current.currentPickerId).toBe(created.game.draftOrder[1])
    })
  })

  it('returns an error for an unknown gameId', async () => {
    const store = new LocalGameStore()
    const { result } = renderHook(() => useGame('NOPE-NOT-REAL', store))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.snapshot).toBeNull()
    expect(result.current.error).toMatch(/not found/i)
  })

  it('does nothing when gameId is undefined', async () => {
    const store = new LocalGameStore()
    const { result } = renderHook(() => useGame(undefined, store))

    expect(result.current.snapshot).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.currentPickerId).toBeNull()
    expect(result.current.isComplete).toBe(false)

    // makePick with no gameId resolves with a not-found result.
    let res
    await act(async () => {
      res = await result.current.makePick('any', 'any')
    })
    expect(res).toEqual({ ok: false, error: 'game-not-found' })
  })

  it('flips isComplete=true after a full snake playthrough', async () => {
    const store = new LocalGameStore()
    const created = await store.createGame(fourPlayerInput())

    const { result } = renderHook(() => useGame(created.game.id, store))
    await waitFor(() => expect(result.current.snapshot).not.toBeNull())

    const used = new Set<string>()
    for (let i = 0; i < created.game.draftOrder.length; i++) {
      const pickerId = nextPickerId(created.game.draftOrder, i)
      if (!pickerId) throw new Error('expected a picker')
      const token = tokenForPlayer(created, pickerId)
      const heroId = pickAvailable(created, used)
      used.add(heroId)
      let res
      await act(async () => {
        res = await result.current.makePick(token, heroId)
      })
      expect(res?.ok).toBe(true)
    }

    await waitFor(() => {
      expect(result.current.isComplete).toBe(true)
    })
    expect(result.current.currentPickerId).toBeNull()
    expect(result.current.snapshot?.picks).toHaveLength(created.game.draftOrder.length)
  })

  it('refresh re-fetches the snapshot independently of subscription', async () => {
    // Use a stub store with a NO-OP subscribe so the only path that can
    // update state is `refresh()`. `getSnapshot` returns A first, then B on
    // every subsequent call. Without refresh(), the hook would stay on A.
    const created = await new LocalGameStore().createGame(fourPlayerInput())
    const snapA: GameSnapshot = {
      game: { ...created.game },
      players: created.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        seat: p.seat,
      })),
      picks: [],
    }
    const snapB: GameSnapshot = {
      ...snapA,
      game: { ...snapA.game, currentPick: 1 },
      picks: [
        {
          id: 'pick-b',
          playerId: created.game.draftOrder[0],
          heroId: created.game.heroPool[0],
          pickIndex: 0,
          createdAt: 1,
        },
      ],
    }

    let getCalls = 0
    const stub: GameStore = {
      createGame: () => Promise.reject(new Error('not implemented')),
      getSnapshot: (): Promise<GameSnapshot | null> => {
        getCalls += 1
        return Promise.resolve(getCalls === 1 ? snapA : snapB)
      },
      makePick: (): Promise<PickResult> =>
        Promise.resolve({ ok: false, error: 'game-not-drafting' }),
      // No-op subscribe — never invokes the callback. Refresh is the ONLY
      // path that can mutate hook state in this test.
      subscribe: () => () => {},
    }

    const { result } = renderHook(() => useGame(created.game.id, stub))

    // Initial load shows snapshot A.
    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull()
    })
    expect(result.current.snapshot?.picks).toHaveLength(0)
    expect(result.current.snapshot?.game.currentPick).toBe(0)
    expect(getCalls).toBe(1)

    // Without refresh, state would remain at A — there is no subscription
    // path. After refresh(), the hook must reflect snapshot B.
    await act(async () => {
      await result.current.refresh()
    })

    expect(getCalls).toBe(2)
    expect(result.current.snapshot?.picks).toHaveLength(1)
    expect(result.current.snapshot?.game.currentPick).toBe(1)
  })
})
