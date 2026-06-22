import type { GameSnapshot, GameStore } from '@/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock both modules that the lazy wrapper dynamically imports. We never let
// the real `@supabase/supabase-js` be loaded, so these tests stay
// network-free and don't need env vars.

const mockSubscribeUnsubscribe = vi.fn()
const mockSubscribe = vi.fn(() => mockSubscribeUnsubscribe)
const mockGetSnapshot = vi.fn<(id: string) => Promise<GameSnapshot | null>>()
const mockMakePick = vi.fn()
const mockCreateGame = vi.fn()
const mockGetPlayerView = vi.fn()

class MockSupabaseGameStore implements GameStore {
  createGame = mockCreateGame
  getSnapshot = mockGetSnapshot
  makePick = mockMakePick
  subscribe = mockSubscribe
  getPlayerView = mockGetPlayerView
}

vi.mock('./SupabaseGameStore', () => ({
  SupabaseGameStore: MockSupabaseGameStore,
}))

vi.mock('@/services/supabase', () => ({
  isSupabaseConfigured: (): boolean => true,
  createSupabaseClient: vi.fn(async () => ({})),
}))

// Import AFTER vi.mock declarations so the lazy wrapper picks up the mocks.
const importLazy = async (): Promise<typeof import('./LazySupabaseGameStore')> =>
  import('./LazySupabaseGameStore')

describe('LazySupabaseGameStore', () => {
  beforeEach(() => {
    mockSubscribeUnsubscribe.mockClear()
    mockSubscribe.mockClear()
    mockGetSnapshot.mockClear()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('subscribe(): unsubscribing before the dynamic import resolves does not attach a real subscription', async () => {
    const { LazySupabaseGameStore } = await importLazy()
    const store = new LazySupabaseGameStore()

    const unsubscribe = store.subscribe('game-1', () => {})
    // Tear down immediately, before the in-flight dynamic import has a chance
    // to settle its microtasks.
    unsubscribe()

    // Let any pending microtasks (the import + then-callback) run.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(mockSubscribeUnsubscribe).not.toHaveBeenCalled()
  })

  it('subscribe(): unsubscribing after the import resolves tears down the real subscription', async () => {
    const { LazySupabaseGameStore } = await importLazy()
    const store = new LazySupabaseGameStore()

    const unsubscribe = store.subscribe('game-1', () => {})

    // Wait for the dynamic import + .then callback chain to complete.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(mockSubscribe).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(mockSubscribeUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('async methods delegate to the loaded SupabaseGameStore', async () => {
    const { LazySupabaseGameStore } = await importLazy()
    const store = new LazySupabaseGameStore()

    mockGetSnapshot.mockResolvedValueOnce(null)
    const snap = await store.getSnapshot('game-2')

    expect(snap).toBeNull()
    expect(mockGetSnapshot).toHaveBeenCalledWith('game-2')
  })
})
