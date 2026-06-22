import type {
  CreateGameInput,
  Game,
  GameSnapshot,
  GameStore,
  PickResult,
  Player,
  PlayerView,
} from '@/types'
import { createSupabaseClient } from '@/services/supabase'

/**
 * Lazy proxy for `SupabaseGameStore`. Defers loading both the supabase-js SDK
 * AND the `SupabaseGameStore` implementation until the first method call, so
 * the main bundle stays free of supabase code when callers never reach the
 * Supabase path (e.g. tests, local-only play, the brief moment between page
 * load and the first store interaction).
 *
 * Implementation notes:
 *
 * - Async methods: trivial — await the memoised dynamic import, then delegate.
 *
 * - `subscribe` is sync and must return an unsubscribe callback synchronously,
 *   which is the tricky bit. We kick off the dynamic import immediately, and
 *   when it resolves we call into the real `subscribe` and stash the resulting
 *   teardown. The returned unsubscribe sets a `cancelled` flag and, if the
 *   import already finished, runs the real teardown. If the caller unsubscribes
 *   BEFORE the dynamic import resolves, the flag prevents `subscribe` from
 *   ever being attached — no leaked channel, no callback fired.
 */
export class LazySupabaseGameStore implements GameStore {
  private real: Promise<GameStore> | null = null

  private async load(): Promise<GameStore> {
    if (this.real) return this.real
    this.real = (async (): Promise<GameStore> => {
      const [client, { SupabaseGameStore }] = await Promise.all([
        createSupabaseClient(),
        import('./SupabaseGameStore'),
      ])
      return new SupabaseGameStore(client)
    })()
    return this.real
  }

  async createGame(
    input: CreateGameInput,
  ): Promise<{ game: Game; organiserToken: string; players: Player[] }> {
    const store = await this.load()
    return store.createGame(input)
  }

  async getSnapshot(gameId: string): Promise<GameSnapshot | null> {
    const store = await this.load()
    return store.getSnapshot(gameId)
  }

  async makePick(gameId: string, playerToken: string, heroId: string): Promise<PickResult> {
    const store = await this.load()
    return store.makePick(gameId, playerToken, heroId)
  }

  async getPlayerView(gameId: string, token: string): Promise<PlayerView | null> {
    const store = await this.load()
    return store.getPlayerView(gameId, token)
  }

  subscribe(gameId: string, cb: (snap: GameSnapshot) => void): () => void {
    let cancelled = false
    let realUnsubscribe: (() => void) | null = null

    void this.load().then((store) => {
      if (cancelled) return
      realUnsubscribe = store.subscribe(gameId, cb)
    })

    return (): void => {
      cancelled = true
      if (realUnsubscribe) {
        realUnsubscribe()
        realUnsubscribe = null
      }
    }
  }
}
