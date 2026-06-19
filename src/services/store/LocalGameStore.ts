import type {
  CreateGameInput,
  Game,
  GameSnapshot,
  GameStore,
  Pick,
  PickResult,
  Player,
} from '@/types'
import { buildSnakeDraftOrder, nextPickerId, randomAssignment } from '@/services/draft'
import { generateGameCode, generateToken } from '@/utils/ids'

const KEY_PREFIX = 'goa2:game:'
const ORG_SUFFIX = ':org'
const MAX_CAS_ATTEMPTS = 5

const snapshotKey = (gameId: string): string => `${KEY_PREFIX}${gameId}`
const organiserKey = (gameId: string): string => `${KEY_PREFIX}${gameId}${ORG_SUFFIX}`

/**
 * Private persisted wrapper around `GameSnapshot`. The `rev` field is a
 * monotonic version counter used for optimistic concurrency control on
 * `makePick`. Callers of `getSnapshot` never see this — only `.snapshot`.
 */
interface PersistedRecord {
  snapshot: GameSnapshot
  rev: number
}

/**
 * Minimal in-memory shim for the Web Storage API. Used as a fallback when
 * `window.localStorage` is unavailable (e.g. some Node + jsdom combinations,
 * private-mode browsers that throw on access). All real browsers will use the
 * native localStorage and persist across reloads as expected.
 */
const createMemoryStorage = (): Storage => {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length(): number {
      return map.size
    },
    clear(): void {
      map.clear()
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null
    },
    key(i: number): string | null {
      return Array.from(map.keys())[i] ?? null
    },
    removeItem(key: string): void {
      map.delete(key)
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value))
    },
  }
  return storage
}

const resolveStorage = (): Storage => {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage
    if (ls && typeof ls.getItem === 'function') {
      // probe — some implementations throw on write (e.g. Safari private mode)
      const probeKey = '__goa2_probe__'
      ls.setItem(probeKey, '1')
      ls.removeItem(probeKey)
      return ls
    }
  } catch {
    // fall through to memory shim
  }
  return createMemoryStorage()
}

const isWindowLike = (
  v: unknown,
): v is {
  addEventListener: Window['addEventListener']
  removeEventListener: Window['removeEventListener']
} => {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return typeof obj.addEventListener === 'function' && typeof obj.removeEventListener === 'function'
}

/**
 * Local, browser-only implementation of `GameStore` backed by `localStorage`.
 *
 * Persistence layout:
 *   `goa2:game:<id>`       → JSON-serialised `PersistedRecord` ({ snapshot, rev })
 *   `goa2:game:<id>:org`   → organiser token (kept separate from the snapshot
 *                             so `Game` / `GameSnapshot` stay clean)
 *
 * Concurrency: `makePick` uses optimistic concurrency control via the `rev`
 * counter. It reads the record, validates, then performs a compare-and-set
 * write that re-reads `rev` immediately before committing; if `rev` advanced
 * (another tab committed first) it retries with the fresh snapshot, up to
 * `MAX_CAS_ATTEMPTS` times. This prevents lost updates between tabs.
 *
 * Cross-tab subscribers receive updates via the `window` `storage` event
 * (which only fires in OTHER tabs, not the one that wrote the change).
 * Same-tab subscribers are notified directly from `createGame` / `makePick`
 * via an internal `Map<gameId, Set<callback>>`.
 */
export class LocalGameStore implements GameStore {
  private readonly storage: Storage
  private readonly listeners = new Map<string, Set<(snap: GameSnapshot) => void>>()

  constructor() {
    this.storage = resolveStorage()
  }

  createGame(
    input: CreateGameInput,
  ): Promise<{ game: Game; organiserToken: string; players: Player[] }> {
    // Generate a non-colliding game code.
    let id = generateGameCode()
    while (this.storage.getItem(snapshotKey(id)) !== null) {
      id = generateGameCode()
    }

    // Build players preserving the supplied seat order.
    const players: Player[] = input.players.map((p) => ({
      id: generateToken(),
      name: p.name,
      team: p.team,
      seat: p.seat,
      token: generateToken(),
    }))

    const now = Date.now()
    const organiserToken = generateToken()

    let game: Game
    let picks: Pick[]

    if (input.method === 'snake') {
      const draftOrder = buildSnakeDraftOrder(players)
      game = {
        id,
        status: 'drafting',
        playerCount: input.playerCount,
        method: 'snake',
        heroPool: [...input.heroPool],
        draftOrder,
        currentPick: 0,
        createdAt: now,
      }
      picks = []
    } else {
      const ordered = [...players].sort((a, b) => a.seat - b.seat)
      const assignment = randomAssignment(
        ordered.map((p) => p.id),
        input.heroPool,
      )
      picks = ordered.map((p) => ({
        id: generateToken(),
        playerId: p.id,
        heroId: assignment[p.id] as string,
        pickIndex: null,
        createdAt: now,
      }))
      game = {
        id,
        status: 'complete',
        playerCount: input.playerCount,
        method: 'random',
        heroPool: [...input.heroPool],
        draftOrder: [],
        currentPick: 0,
        createdAt: now,
      }
    }

    const snapshot: GameSnapshot = { game, players, picks }
    this.writeRecord(id, snapshot, 0)
    this.storage.setItem(organiserKey(id), organiserToken)
    this.notify(id, snapshot)

    return Promise.resolve({ game, organiserToken, players })
  }

  getSnapshot(gameId: string): Promise<GameSnapshot | null> {
    const record = this.readRecord(gameId)
    return Promise.resolve(record ? record.snapshot : null)
  }

  makePick(gameId: string, playerToken: string, heroId: string): Promise<PickResult> {
    // Optimistic-concurrency retry loop. Each attempt re-reads the current
    // record, re-validates, and only commits if `rev` is still what we read.
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const record = this.readRecord(gameId)
      if (!record) return Promise.resolve({ ok: false, error: 'game-not-found' })
      const snap = record.snapshot

      if (snap.game.status !== 'drafting') {
        return Promise.resolve({ ok: false, error: 'game-not-drafting' })
      }
      const player = snap.players.find((p) => p.token === playerToken)
      if (!player) return Promise.resolve({ ok: false, error: 'invalid-token' })
      if (nextPickerId(snap.game.draftOrder, snap.game.currentPick) !== player.id) {
        return Promise.resolve({ ok: false, error: 'not-your-turn' })
      }
      if (!snap.game.heroPool.includes(heroId)) {
        return Promise.resolve({ ok: false, error: 'hero-unavailable' })
      }
      if (snap.picks.some((pk) => pk.heroId === heroId)) {
        return Promise.resolve({ ok: false, error: 'hero-unavailable' })
      }

      const pick: Pick = {
        id: generateToken(),
        playerId: player.id,
        heroId,
        pickIndex: snap.game.currentPick,
        createdAt: Date.now(),
      }
      const nextCurrent = snap.game.currentPick + 1
      const nextStatus = nextCurrent >= snap.game.draftOrder.length ? 'complete' : snap.game.status
      const nextSnap: GameSnapshot = {
        game: { ...snap.game, currentPick: nextCurrent, status: nextStatus },
        players: snap.players,
        picks: [...snap.picks, pick],
      }

      // Compare-and-set: only commit if `rev` hasn't advanced since we read.
      if (this.casWrite(gameId, record.rev, nextSnap)) {
        this.notify(gameId, nextSnap)
        return Promise.resolve({ ok: true, snapshot: nextSnap })
      }
      // Otherwise loop and retry against the fresh state.
    }
    // Pathological contention — fall through with a sane error. Treat as a
    // transient unavailability of the underlying state.
    return Promise.resolve({ ok: false, error: 'game-not-drafting' })
  }

  subscribe(gameId: string, cb: (snap: GameSnapshot) => void): () => void {
    let set = this.listeners.get(gameId)
    if (!set) {
      set = new Set()
      this.listeners.set(gameId, set)
    }
    set.add(cb)

    // Cross-tab listener: storage events only fire in OTHER tabs, so this
    // complements (does not duplicate) the same-tab notification path above.
    const w = (globalThis as { window?: unknown }).window
    let storageHandler: ((e: StorageEvent) => void) | null = null
    if (isWindowLike(w)) {
      const key = snapshotKey(gameId)
      storageHandler = (e: StorageEvent): void => {
        if (e.key !== key || e.newValue === null) return
        try {
          const parsed = JSON.parse(e.newValue) as PersistedRecord
          if (parsed && parsed.snapshot) cb(parsed.snapshot)
        } catch {
          // ignore malformed payloads
        }
      }
      w.addEventListener('storage', storageHandler)
    }

    return (): void => {
      const current = this.listeners.get(gameId)
      if (current) {
        current.delete(cb)
        if (current.size === 0) this.listeners.delete(gameId)
      }
      if (storageHandler && isWindowLike(w)) {
        w.removeEventListener('storage', storageHandler)
      }
    }
  }

  private readRecord(gameId: string): PersistedRecord | null {
    const raw = this.storage.getItem(snapshotKey(gameId))
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as PersistedRecord
      if (!parsed || typeof parsed.rev !== 'number' || !parsed.snapshot) return null
      return parsed
    } catch {
      return null
    }
  }

  private writeRecord(gameId: string, snapshot: GameSnapshot, rev: number): void {
    const record: PersistedRecord = { snapshot, rev }
    this.storage.setItem(snapshotKey(gameId), JSON.stringify(record))
  }

  /**
   * Compare-and-set write: re-reads the record immediately before writing and
   * only commits when the persisted `rev` still matches `expectedRev`.
   * Returns `true` on commit, `false` if a concurrent writer advanced `rev`.
   */
  private casWrite(gameId: string, expectedRev: number, nextSnapshot: GameSnapshot): boolean {
    const current = this.readRecord(gameId)
    if (!current || current.rev !== expectedRev) return false
    this.writeRecord(gameId, nextSnapshot, expectedRev + 1)
    return true
  }

  private notify(gameId: string, snap: GameSnapshot): void {
    const set = this.listeners.get(gameId)
    if (!set) return
    for (const cb of set) cb(snap)
  }
}
