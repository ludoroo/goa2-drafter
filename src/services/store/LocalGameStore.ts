import type {
  CreateGameInput,
  DraftTurn,
  Game,
  GameSnapshot,
  GameStore,
  Pick,
  PickError,
  PickResult,
  PlayerView,
  Player,
  PublicPlayer,
} from '@/types'
import {
  buildAllPickTurns,
  buildPickBanTurns,
  buildSnakeTurns,
  coinFlipTeam,
  dealHands,
  handicapTeamFor,
  randomAssignment,
  selectRandomDraftPool,
} from '@/services/draft'
import { generateGameCode, generateToken } from '@/utils/ids'

const KEY_PREFIX = 'goa2:game:'
const ORG_SUFFIX = ':org'
const MAX_CAS_ATTEMPTS = 5

const snapshotKey = (gameId: string): string => `${KEY_PREFIX}${gameId}`
const organiserKey = (gameId: string): string => `${KEY_PREFIX}${gameId}${ORG_SUFFIX}`

const toPublicPlayer = (p: Player): PublicPlayer => ({
  id: p.id,
  name: p.name,
  team: p.team,
  seat: p.seat,
})

/**
 * Private persisted wrapper around `GameSnapshot`. The `rev` field is a
 * monotonic version counter used for optimistic concurrency control on
 * `makePick`. The `tokens` map keeps each player's auth token *outside* the
 * shareable `snapshot.players` projection (see `PublicPlayer` in types) — the
 * snapshot returned to callers never carries tokens, while `makePick` still
 * needs to resolve a token → player id internally.
 *
 * `hands` carries the private, per-player dealt hand of hero ids used by the
 * single-draft method. It is intentionally NOT projected into the shared
 * snapshot (snapshot.players is the public projection) and is only exposed
 * through `getPlayerView`, which requires the caller's magic-link token.
 *
 * Callers of `getSnapshot` only ever see `.snapshot`.
 */
interface PersistedRecord {
  snapshot: GameSnapshot
  tokens: Record<string, string>
  hands: Record<string, string[]>
  rev: number
}

/**
 * Normalize a possibly-legacy persisted `Game` into the current shape. Older
 * records pre-date the addition of `turns`, `bans`, `startTeam`, and
 * `handicapTeam` — we default them to empty/`red`/`null` so old games still
 * load without throwing.
 */
const normalizeGame = (raw: unknown): Game => {
  const g = raw as Partial<Game> & Record<string, unknown>
  return {
    ...(g as Game),
    turns: Array.isArray(g.turns) ? (g.turns as DraftTurn[]) : [],
    bans: Array.isArray(g.bans) ? (g.bans as string[]) : [],
    startTeam: g.startTeam === 'blue' ? 'blue' : 'red',
    handicapTeam: g.handicapTeam === 'red' || g.handicapTeam === 'blue' ? g.handicapTeam : null,
  }
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
 *   `goa2:game:<id>`       → JSON-serialised `PersistedRecord`
 *                            ({ snapshot, tokens, hands, rev })
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
    const startTeam = coinFlipTeam()
    const handicapTeam = handicapTeamFor(players)

    let game: Game
    let picks: Pick[] = []
    let hands: Record<string, string[]> = {}

    if (input.method === 'snake') {
      // Snake is COLLECTIVE: turn slots are owned by a team (A,B,B,A,…), not
      // a specific player. Any teammate may claim their team's pick turn (the
      // acting player owns the hero — uniform across collective methods).
      // `turns` is the single source of truth; `draftOrder` is legacy and
      // intentionally left empty.
      const turns = buildSnakeTurns(players, startTeam)
      game = {
        id,
        status: 'drafting',
        playerCount: input.playerCount,
        method: 'snake',
        heroPool: [...input.heroPool],
        draftOrder: [],
        currentPick: 0,
        turns,
        bans: [],
        startTeam,
        handicapTeam,
        createdAt: now,
      }
    } else if (input.method === 'random') {
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
        turns: [],
        bans: [],
        startTeam,
        handicapTeam,
        createdAt: now,
      }
    } else if (input.method === 'all-pick') {
      const turns = buildAllPickTurns(players, startTeam)
      // `turns` is the single source of truth; `draftOrder` is legacy and
      // intentionally left empty.
      game = {
        id,
        status: 'drafting',
        playerCount: input.playerCount,
        method: 'all-pick',
        heroPool: [...input.heroPool],
        draftOrder: [],
        currentPick: 0,
        turns,
        bans: [],
        startTeam,
        handicapTeam,
        createdAt: now,
      }
    } else if (input.method === 'random-draft') {
      const trimmedPool = selectRandomDraftPool(input.heroPool, input.playerCount)
      const turns = buildAllPickTurns(players, startTeam)
      // `turns` is the single source of truth; `draftOrder` is legacy and
      // intentionally left empty.
      game = {
        id,
        status: 'drafting',
        playerCount: input.playerCount,
        method: 'random-draft',
        heroPool: trimmedPool,
        draftOrder: [],
        currentPick: 0,
        turns,
        bans: [],
        startTeam,
        handicapTeam,
        createdAt: now,
      }
    } else if (input.method === 'single-draft') {
      const seatOrdered = [...players].sort((a, b) => a.seat - b.seat || a.id.localeCompare(b.id))
      hands = dealHands(
        seatOrdered.map((p) => p.id),
        input.heroPool,
        3,
      )
      // Single draft is SIMULTANEOUS: each player picks one hero from their
      // private hand at any time, in any order. There is no shared turn
      // sequence and no draft order — `makePick` handles it in a dedicated
      // branch that bypasses turn authorisation.
      game = {
        id,
        status: 'drafting',
        playerCount: input.playerCount,
        method: 'single-draft',
        heroPool: [...input.heroPool],
        draftOrder: [],
        currentPick: 0,
        turns: [],
        bans: [],
        startTeam,
        handicapTeam,
        createdAt: now,
      }
    } else {
      // pick-and-ban
      const turns = buildPickBanTurns(players, startTeam)
      game = {
        id,
        status: 'drafting',
        playerCount: input.playerCount,
        method: 'pick-and-ban',
        heroPool: [...input.heroPool],
        draftOrder: [],
        currentPick: 0,
        turns,
        bans: [],
        startTeam,
        handicapTeam,
        createdAt: now,
      }
    }

    const snapshot: GameSnapshot = { game, players: players.map(toPublicPlayer), picks }
    const tokens: Record<string, string> = {}
    for (const p of players) tokens[p.id] = p.token
    this.writeRecord(id, snapshot, tokens, hands, 0)
    this.storage.setItem(organiserKey(id), organiserToken)
    this.notify(id, snapshot)

    return Promise.resolve({ game, organiserToken, players })
  }

  getSnapshot(gameId: string): Promise<GameSnapshot | null> {
    const record = this.readRecord(gameId)
    return Promise.resolve(record ? record.snapshot : null)
  }

  getPlayerView(gameId: string, token: string): Promise<PlayerView | null> {
    const record = this.readRecord(gameId)
    if (!record) return Promise.resolve(null)
    const playerId = Object.keys(record.tokens).find((id) => record.tokens[id] === token)
    if (!playerId) return Promise.resolve(null)
    const player = record.snapshot.players.find((p) => p.id === playerId)
    if (!player) return Promise.resolve(null)
    const hand = record.hands[playerId] ?? null
    return Promise.resolve({ player, hand })
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
      // Resolve the caller's token via the private tokens map; snapshot.players
      // is intentionally token-free (see PublicPlayer in types).
      const playerId = Object.keys(record.tokens).find((id) => record.tokens[id] === playerToken)
      const caller = playerId ? snap.players.find((p) => p.id === playerId) : undefined
      if (!caller) return Promise.resolve({ ok: false, error: 'invalid-token' })

      // Single draft is simultaneous: no turn order. Each player may pick one
      // hero from their private hand at any time. We handle it entirely here
      // and never consult game.turns / game.currentPick.
      if (snap.game.method === 'single-draft') {
        const hand = record.hands[caller.id] ?? []
        if (!hand.includes(heroId)) {
          return Promise.resolve({ ok: false, error: 'not-in-hand' })
        }
        // Bans don't apply to single draft, but the guard is a cheap safety net.
        if (snap.game.bans.includes(heroId)) {
          return Promise.resolve({ ok: false, error: 'hero-banned' })
        }
        // One pick per player; a second attempt (even with a different hero
        // from their hand) is rejected as no-longer-available to them.
        const callerAlreadyPicked = snap.picks.some((pk) => pk.playerId === caller.id)
        if (callerAlreadyPicked) {
          return Promise.resolve({ ok: false, error: 'hero-unavailable' })
        }
        // Hands are disjoint so a cross-player collision shouldn't occur, but
        // keep the global availability check for safety.
        if (snap.picks.some((pk) => pk.heroId === heroId)) {
          return Promise.resolve({ ok: false, error: 'hero-unavailable' })
        }

        const pick: Pick = {
          id: generateToken(),
          playerId: caller.id,
          heroId,
          pickIndex: null,
          createdAt: Date.now(),
        }
        const nextPicks = [...snap.picks, pick]
        // Complete once every player has exactly one pick.
        const nextStatus: Game['status'] =
          nextPicks.length >= snap.players.length ? 'complete' : 'drafting'
        const nextSnap: GameSnapshot = {
          game: { ...snap.game, status: nextStatus },
          players: snap.players,
          picks: nextPicks,
        }

        if (this.casWrite(gameId, record.rev, nextSnap, record.tokens, record.hands)) {
          this.notify(gameId, nextSnap)
          return Promise.resolve({ ok: true, snapshot: nextSnap })
        }
        // CAS lost — loop to retry against fresh state.
        continue
      }

      const currentTurn = snap.game.turns[snap.game.currentPick]
      if (!currentTurn) {
        return Promise.resolve({ ok: false, error: 'game-not-drafting' })
      }

      // Authorisation: player-pick vs collective team turn.
      if (currentTurn.playerId !== null) {
        if (caller.id !== currentTurn.playerId) {
          return Promise.resolve({ ok: false, error: 'not-your-turn' })
        }
      } else {
        if (caller.team !== currentTurn.team) {
          return Promise.resolve({ ok: false, error: 'not-your-team' })
        }
      }

      // Availability — common checks first.
      const alreadyPicked = snap.picks.some((pk) => pk.heroId === heroId)
      if (alreadyPicked) {
        return Promise.resolve({ ok: false, error: 'hero-unavailable' })
      }
      if (snap.game.bans.includes(heroId)) {
        return Promise.resolve({ ok: false, error: 'hero-banned' })
      }

      if (!snap.game.heroPool.includes(heroId)) {
        return Promise.resolve({ ok: false, error: 'hero-unavailable' })
      }

      // Commit.
      let nextPicks = snap.picks
      let nextBans = snap.game.bans

      if (currentTurn.kind === 'ban') {
        nextBans = [...snap.game.bans, heroId]
      } else {
        // Determine the owning playerId.
        // UNIFORM ACTING-PLAYER-OWNS RULE: across ALL collective pick methods
        // (snake, all-pick, random-draft, pick-and-ban) the hero is claimed by
        // the player who actually clicked — `caller.id`. A player who has
        // already taken a pick in this game has "used up" their turn, so a
        // second attempt is rejected as `not-your-turn` (their team turn may
        // still be active, but it is not THEIRS to take). This guarantees
        // each teammate picks exactly once across their team's H pick turns.
        //
        // We KEEP the legacy per-player branch (currentTurn.playerId !== null)
        // for back-compat: a persisted game from before this change may still
        // carry per-player turn entries. None of the built-in builders emit
        // those anymore, but reading old records must still work.
        let ownerId: string
        if (currentTurn.playerId !== null) {
          ownerId = currentTurn.playerId
        } else {
          const callerAlreadyPicked = snap.picks.some((pk) => pk.playerId === caller.id)
          if (callerAlreadyPicked) {
            return Promise.resolve({ ok: false, error: 'not-your-turn' satisfies PickError })
          }
          ownerId = caller.id
        }
        const pick: Pick = {
          id: generateToken(),
          playerId: ownerId,
          heroId,
          pickIndex: snap.game.currentPick,
          createdAt: Date.now(),
        }
        nextPicks = [...snap.picks, pick]
      }

      const nextCurrent = snap.game.currentPick + 1
      const remainingTurns = snap.game.turns.slice(nextCurrent)
      const anyRemainingPick = remainingTurns.some((t) => t.kind === 'pick')
      const nextStatus: Game['status'] = anyRemainingPick ? 'drafting' : 'complete'

      const nextSnap: GameSnapshot = {
        game: {
          ...snap.game,
          currentPick: nextCurrent,
          status: nextStatus,
          bans: nextBans,
        },
        players: snap.players,
        picks: nextPicks,
      }

      // Compare-and-set: only commit if `rev` hasn't advanced since we read.
      if (this.casWrite(gameId, record.rev, nextSnap, record.tokens, record.hands)) {
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
      const parsed = JSON.parse(raw) as Partial<PersistedRecord> & {
        snapshot?: { game?: unknown; players?: PublicPlayer[]; picks?: Pick[] }
      }
      if (
        !parsed ||
        typeof parsed.rev !== 'number' ||
        !parsed.snapshot ||
        typeof parsed.tokens !== 'object' ||
        parsed.tokens === null
      ) {
        return null
      }
      const rawSnap = parsed.snapshot
      if (!rawSnap.game || !rawSnap.players || !rawSnap.picks) return null
      const game = normalizeGame(rawSnap.game)
      const snapshot: GameSnapshot = {
        game,
        players: rawSnap.players as PublicPlayer[],
        picks: rawSnap.picks as Pick[],
      }
      const hands =
        parsed.hands && typeof parsed.hands === 'object'
          ? (parsed.hands as Record<string, string[]>)
          : {}
      return {
        snapshot,
        tokens: parsed.tokens as Record<string, string>,
        hands,
        rev: parsed.rev,
      }
    } catch {
      return null
    }
  }

  private writeRecord(
    gameId: string,
    snapshot: GameSnapshot,
    tokens: Record<string, string>,
    hands: Record<string, string[]>,
    rev: number,
  ): void {
    const record: PersistedRecord = { snapshot, tokens, hands, rev }
    this.storage.setItem(snapshotKey(gameId), JSON.stringify(record))
  }

  /**
   * Compare-and-set write: re-reads the record immediately before writing and
   * only commits when the persisted `rev` still matches `expectedRev`.
   * Returns `true` on commit, `false` if a concurrent writer advanced `rev`.
   */
  private casWrite(
    gameId: string,
    expectedRev: number,
    nextSnapshot: GameSnapshot,
    tokens: Record<string, string>,
    hands: Record<string, string[]>,
  ): boolean {
    const current = this.readRecord(gameId)
    if (!current || current.rev !== expectedRev) return false
    this.writeRecord(gameId, nextSnapshot, tokens, hands, expectedRev + 1)
    return true
  }

  private notify(gameId: string, snap: GameSnapshot): void {
    const set = this.listeners.get(gameId)
    if (!set) return
    for (const cb of set) cb(snap)
  }

  /**
   * Detach every in-tab subscriber. Cross-tab `storage` listeners are removed
   * by each subscription's own unsubscribe; this clears the in-memory registry
   * so no same-tab callback can fire after the caller has torn down (used by
   * tests to isolate the shared singleton between cases).
   */
  clearSubscriptions(): void {
    this.listeners.clear()
  }
}
