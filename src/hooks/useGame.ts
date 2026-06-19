import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameSnapshot, GameStore, PickResult } from '@/types'
import { gameStore as defaultStore } from '@/services/store'
import { nextPickerId } from '@/services/draft'

export interface UseGameResult {
  snapshot: GameSnapshot | null
  loading: boolean
  error: string | null
  currentPickerId: string | null
  isComplete: boolean
  makePick: (playerToken: string, heroId: string) => Promise<PickResult>
  refresh: () => Promise<void>
}

const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'Unknown error'
}

interface LoadState {
  /** Identity of the gameId this state belongs to. `null` when no game. */
  gameId: string | null
  snapshot: GameSnapshot | null
  loading: boolean
  error: string | null
}

const idleState = (gameId: string | undefined): LoadState => ({
  gameId: gameId ?? null,
  snapshot: null,
  loading: gameId !== undefined,
  error: null,
})

/**
 * React hook that subscribes to a `GameStore` for live snapshot updates.
 *
 * - Loads the snapshot on mount / when `gameId` changes.
 * - Subscribes to the store so external picks (other tabs, other clients)
 *   propagate into local state.
 * - `makePick` and `refresh` route through the same store, keeping state
 *   consistent without a manual reload.
 *
 * The `store` argument is optional — defaults to the singleton `gameStore`.
 * Tests inject a fresh `LocalGameStore` instance for isolation.
 *
 * Concurrency: every state application is tagged with a monotonically
 * increasing `applyVersion`. A late-arriving `getSnapshot` cannot overwrite a
 * newer subscription/makePick result; conversely a fresh subscription update
 * always wins over an older in-flight load. Each load/refresh captures its
 * sequence number at start; subscription and makePick callbacks mint a fresh
 * sequence at apply time so they reflect "newest information wins".
 */
export function useGame(gameId: string | undefined, store?: GameStore): UseGameResult {
  const activeStore = store ?? defaultStore

  // Single combined state keyed by gameId. Resetting during render when the
  // gameId prop changes avoids the React 19 lint rule against synchronously
  // calling setState inside an effect.
  const [state, setState] = useState<LoadState>(() => idleState(gameId))
  if (state.gameId !== (gameId ?? null)) {
    setState(idleState(gameId))
  }

  // Track mount state to guard against late async resolutions writing to
  // unmounted hooks (and to ignore results from a stale gameId).
  const mountedRef = useRef<boolean>(true)
  useEffect(() => {
    mountedRef.current = true
    return (): void => {
      mountedRef.current = false
    }
  }, [])

  // Monotonic guard. `latestAppliedRef` holds the seq of the last state
  // application; only writes carrying a strictly greater seq are accepted.
  // `nextSeqRef` mints fresh increasing sequence numbers.
  const latestAppliedRef = useRef<number>(0)
  const nextSeqRef = useRef<number>(0)
  const mintSeq = useCallback((): number => {
    nextSeqRef.current += 1
    return nextSeqRef.current
  }, [])

  /**
   * Apply a new state snapshot iff `seq` is the newest seen so far AND the
   * caller's `targetGameId` still matches the active prop. Out-of-order
   * resolutions (e.g. a slow initial load resolving after a subscription
   * update) are dropped on the floor.
   */
  const applyState = useCallback(
    (seq: number, targetGameId: string, next: Omit<LoadState, 'gameId'>): void => {
      if (!mountedRef.current) return
      if (seq <= latestAppliedRef.current) return
      latestAppliedRef.current = seq
      setState((prev) =>
        prev.gameId === targetGameId ? { gameId: targetGameId, ...next } : prev,
      )
    },
    [],
  )

  // Load + subscribe on gameId change. The `cancelled` flag scopes the
  // SUBSCRIPTION lifetime to this effect run; the seq guard handles ordering
  // independently so async resolutions are filtered by version, not just by
  // effect-run identity.
  useEffect(() => {
    if (gameId === undefined) return

    let cancelled = false
    const loadSeq = mintSeq()

    void (async (): Promise<void> => {
      try {
        const snap = await activeStore.getSnapshot(gameId)
        if (cancelled) return
        if (snap === null) {
          applyState(loadSeq, gameId, { snapshot: null, loading: false, error: 'Game not found' })
        } else {
          applyState(loadSeq, gameId, { snapshot: snap, loading: false, error: null })
        }
      } catch (e: unknown) {
        if (cancelled) return
        applyState(loadSeq, gameId, {
          snapshot: null,
          loading: false,
          error: errorMessage(e),
        })
      }
    })()

    const unsubscribe = activeStore.subscribe(gameId, (snap) => {
      if (cancelled) return
      // Mint a FRESH seq at apply time so subscription updates always win
      // against any older in-flight load/refresh.
      applyState(mintSeq(), gameId, { snapshot: snap, loading: false, error: null })
    })

    return (): void => {
      cancelled = true
      unsubscribe()
    }
  }, [gameId, activeStore, applyState, mintSeq])

  const makePick = useCallback(
    async (playerToken: string, heroId: string): Promise<PickResult> => {
      if (gameId === undefined) {
        return { ok: false, error: 'game-not-found' }
      }
      const result = await activeStore.makePick(gameId, playerToken, heroId)
      if (result.ok) {
        // Mint at apply time — pick results carry the freshest server state.
        applyState(mintSeq(), gameId, {
          snapshot: result.snapshot,
          loading: false,
          error: null,
        })
      }
      return result
    },
    [gameId, activeStore, applyState, mintSeq],
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (gameId === undefined) return
    // Loading transition: mint its own seq so it's filtered by the guard
    // (a newer subscription update can still preempt it).
    applyState(mintSeq(), gameId, {
      snapshot: state.snapshot,
      loading: true,
      error: null,
    })
    try {
      const snap = await activeStore.getSnapshot(gameId)
      // Mint a FRESH seq at apply time so a subscription update that landed
      // while we were awaiting can still win, but a stale earlier load
      // (with a smaller seq) cannot overwrite this result.
      if (snap === null) {
        applyState(mintSeq(), gameId, {
          snapshot: null,
          loading: false,
          error: 'Game not found',
        })
      } else {
        applyState(mintSeq(), gameId, { snapshot: snap, loading: false, error: null })
      }
    } catch (e: unknown) {
      applyState(mintSeq(), gameId, {
        snapshot: null,
        loading: false,
        error: errorMessage(e),
      })
    }
  }, [gameId, activeStore, applyState, mintSeq, state.snapshot])

  const currentPickerId = useMemo<string | null>(() => {
    if (!state.snapshot) return null
    if (state.snapshot.game.status !== 'drafting') return null
    return nextPickerId(state.snapshot.game.draftOrder, state.snapshot.game.currentPick)
  }, [state.snapshot])

  const isComplete = state.snapshot?.game.status === 'complete'

  return {
    snapshot: state.snapshot,
    loading: state.loading,
    error: state.error,
    currentPickerId,
    isComplete,
    makePick,
    refresh,
  }
}
