import type {
  CreateGameInput,
  DraftMethod,
  DraftTurn,
  Game,
  GameSnapshot,
  GameStatus,
  GameStore,
  Pick,
  PickError,
  PickResult,
  Player,
  PlayerView,
  PublicPlayer,
  TeamId,
} from '@/types'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
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

// ---------------------------------------------------------------------------
// Database row shapes (snake_case columns as stored in Postgres)
// ---------------------------------------------------------------------------

/**
 * Token-free projection of the `games` table — every column NEEDED to build
 * a `Game`, but explicitly NOT `organiser_token`. This is the only row shape
 * that should ever be selected from the client over the anon key (see
 * `getSnapshot` and `subscribe`), and the only shape returned in RPC payloads
 * shared with all participants. The organiser token is held in memory by
 * `createGame` and never round-trips back through a snapshot read.
 */
export interface SnapshotGameRow {
  id: string
  status: GameStatus
  player_count: number
  method: DraftMethod
  hero_pool: string[]
  draft_order: string[]
  current_pick: number
  /** Ordered turn list (pick or ban) — `current_pick` indexes into this. */
  turns: DraftTurn[]
  /** Hero ids banned so far. */
  bans: string[]
  /** Coin-flip team that acts first. */
  start_team: TeamId
  /**
   * For odd player counts (5/7/9) the larger team uses Handicap cards; this is
   * that team. `null` when teams are even. Informational only.
   */
  handicap_team: TeamId | null
  created_at: string
}

/**
 * Full row shape of the `games` table — including the sensitive
 * `organiser_token`. Used only on the create-game write path. The snapshot
 * read path uses `SnapshotGameRow` so `organiser_token` is never selected
 * over the anon key. Column-level GRANTs in schema.sql additionally prevent
 * a malicious client from reading `organiser_token` directly.
 */
export interface GameRow extends SnapshotGameRow {
  organiser_token: string
}

/**
 * Row shape projected for snapshots — token AND hand are intentionally omitted
 * so neither escapes via `getSnapshot` or the `make_pick` RPC payload (see
 * `PublicPlayer` in @/types). Use `PlayerRow` only on the create-game write
 * path where the organiser-side full record is required.
 */
export interface PublicPlayerRow {
  id: string
  game_id: string
  name: string
  team: TeamId
  seat: number
}

/**
 * Full row shape of the `players` table — includes the auth `token` AND the
 * privately-dealt `hand` of hero ids (single-draft method; null otherwise).
 * Neither field is ever projected into a snapshot. The hand is only ever
 * returned through the token-gated `get_player_view` RPC.
 */
export interface PlayerRow extends PublicPlayerRow {
  token: string
  hand: string[] | null
}

/** Row shape of the `picks` table. */
export interface PickRow {
  id: string
  game_id: string
  player_id: string
  hero_id: string
  pick_index: number | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Mappers (DB rows ⇄ domain types)
// ---------------------------------------------------------------------------

/**
 * Map a DB games row → domain `Game`. Accepts the token-free
 * `SnapshotGameRow` shape — the snapshot path explicitly never selects
 * `organiser_token`, and the full `GameRow` extends `SnapshotGameRow` so
 * write-path callers also work without a cast. Back-compat: legacy rows
 * that pre-date the addition of `turns` / `bans` / `start_team` /
 * `handicap_team` may have these as null in jsonb — default them to empty
 * arrays, 'red', and null to mirror LocalGameStore's `normalizeGame`.
 */
export const gameFromRow = (row: SnapshotGameRow): Game => ({
  id: row.id,
  status: row.status,
  playerCount: row.player_count,
  method: row.method,
  heroPool: [...row.hero_pool],
  draftOrder: [...row.draft_order],
  currentPick: row.current_pick,
  turns: Array.isArray(row.turns) ? [...row.turns] : [],
  bans: Array.isArray(row.bans) ? [...row.bans] : [],
  startTeam: row.start_team === 'blue' ? 'blue' : 'red',
  handicapTeam:
    row.handicap_team === 'red' || row.handicap_team === 'blue' ? row.handicap_team : null,
  createdAt: Date.parse(row.created_at),
})

/**
 * Map a token-free DB players row → `PublicPlayer`. Used by the snapshot
 * read path; neither tokens nor private hands leave the server through this
 * projection.
 */
export const publicPlayerFromRow = (row: PublicPlayerRow): PublicPlayer => ({
  id: row.id,
  name: row.name,
  team: row.team,
  seat: row.seat,
})

/**
 * Map a full DB players row → domain `Player` (with token). Used only on the
 * create-game return path so the organiser can build per-player magic links.
 * The private `hand` field is intentionally dropped here — it is delivered
 * to the owning player via `get_player_view` instead.
 */
export const playerFromRow = (row: PlayerRow): Player => ({
  ...publicPlayerFromRow(row),
  token: row.token,
})

/** Map a DB picks row → domain `Pick`. */
export const pickFromRow = (row: PickRow): Pick => ({
  id: row.id,
  playerId: row.player_id,
  heroId: row.hero_id,
  pickIndex: row.pick_index,
  createdAt: Date.parse(row.created_at),
})

// ---------------------------------------------------------------------------
// RPC payload shapes
// ---------------------------------------------------------------------------

interface MakePickErrorPayload {
  error: PickError
}

interface MakePickSuccessPayload {
  /** Token-free projection — see schema.sql `make_pick` (no organiser_token). */
  game: SnapshotGameRow
  /** Token-free + hand-free projection — see schema.sql `make_pick`. */
  players: PublicPlayerRow[]
  picks: PickRow[]
}

type MakePickPayload = MakePickErrorPayload | MakePickSuccessPayload

/** Shape returned by `get_player_view` on success; `null` if token invalid. */
interface PlayerViewPayload {
  player: PublicPlayerRow
  hand: string[] | null
}

export const isPickError = (value: unknown): value is PickError =>
  value === 'not-your-turn' ||
  value === 'hero-unavailable' ||
  value === 'game-not-drafting' ||
  value === 'invalid-token' ||
  value === 'game-not-found' ||
  value === 'not-in-hand' ||
  value === 'hero-banned' ||
  value === 'not-your-team'

// ---------------------------------------------------------------------------
// SupabaseGameStore
// ---------------------------------------------------------------------------

/**
 * Supabase-backed implementation of `GameStore`.
 *
 * Storage layout — three tables: `games`, `players`, `picks` (see
 * `supabase/schema.sql`). Mappers above translate snake_case columns to the
 * camelCase domain types.
 *
 * Concurrency: `makePick` delegates to a Postgres `make_pick` RPC that runs
 * with `SECURITY DEFINER` and locks the game row with `SELECT ... FOR UPDATE`,
 * giving us atomic validate-and-commit in a single round trip and returning
 * the updated snapshot in the same response.
 *
 * Realtime: `subscribe` listens to `postgres_changes` on all three tables
 * filtered by `game_id` (and `id` for the games table) and re-fetches the
 * snapshot on any event. This is simpler than reconstructing partial state
 * from change payloads and keeps the source of truth in one query path.
 *
 * Secrets hygiene: three columns are sensitive — `games.organiser_token`,
 * `players.token`, and `players.hand`. They are protected at three layers:
 *   1. Column-level GRANTs in schema.sql revoke anon's broad SELECT and
 *      re-grant ONLY the non-sensitive columns. A direct
 *      `select organiser_token from games` over the anon key is refused by
 *      Postgres before RLS runs.
 *   2. App-side projections: `getSnapshot` explicitly selects each safe
 *      column (never `*` on games), and `make_pick` / `seed_random_picks`
 *      build their `game` jsonb with explicit `jsonb_build_object(...)` —
 *      never `to_jsonb(g)` — so `organiser_token` cannot leak via an RPC
 *      payload. Player projections list `id, game_id, name, team, seat`
 *      only.
 *   3. The organiser token is returned exactly once, to the organiser,
 *      from `createGame`. Player tokens are returned only on that same
 *      create call. Hands are only ever delivered to the owning player
 *      through the token-gated `get_player_view` RPC, exposed here via
 *      `getPlayerView`.
 *
 * Pick mutations: the `picks` table is locked down (no anon INSERT) — both
 * the snake-method (`make_pick`) and random-method (`seed_random_picks`)
 * pick writes go through SECURITY DEFINER RPCs.
 *
 * NOTE on createGame atomicity: the supabase-js client cannot run a multi-table
 * transaction. We compute the per-method draft state client-side (turns,
 * bans, start team, trimmed pool, dealt hands), then insert games → players
 * (with their hand jsonb for single-draft), and finally call
 * `seed_random_picks` for the random method. If a later step fails the
 * partial rows remain; for this app's scale (a few co-located users creating
 * a single game) this is acceptable. A future hardening would fold the whole
 * create flow into one SECURITY DEFINER RPC.
 */
export class SupabaseGameStore implements GameStore {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  async createGame(
    input: CreateGameInput,
  ): Promise<{ game: Game; organiserToken: string; players: Player[] }> {
    const id = generateGameCode()
    const organiserToken = generateToken()
    const now = new Date().toISOString()
    const createdAtMs = Date.parse(now)

    const players: Player[] = input.players.map((p) => ({
      id: generateToken(),
      name: p.name,
      team: p.team,
      seat: p.seat,
      token: generateToken(),
    }))

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
      // intentionally left empty. Mirrors LocalGameStore.
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
        createdAt: createdAtMs,
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
        createdAt: createdAtMs,
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
        createdAt: createdAtMs,
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
        createdAt: createdAtMs,
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
        createdAt: createdAtMs,
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
      // sequence and no draft order — `make_pick` handles it in a dedicated
      // branch that bypasses turn authorisation. Mirrors LocalGameStore.
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
        createdAt: createdAtMs,
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
        createdAt: createdAtMs,
      }
    }

    // Insert sequentially. See class-level NOTE on atomicity.
    const gameRow: GameRow = {
      id: game.id,
      status: game.status,
      player_count: game.playerCount,
      method: game.method,
      hero_pool: game.heroPool,
      draft_order: game.draftOrder,
      current_pick: game.currentPick,
      turns: game.turns,
      bans: game.bans,
      start_team: game.startTeam,
      handicap_team: game.handicapTeam,
      organiser_token: organiserToken,
      created_at: now,
    }
    const { error: gameErr } = await this.client.from('games').insert(gameRow)
    if (gameErr) throw new Error(`createGame: failed to insert game: ${gameErr.message}`)

    const playerRows: PlayerRow[] = players.map((p) => ({
      id: p.id,
      game_id: game.id,
      name: p.name,
      team: p.team,
      token: p.token,
      seat: p.seat,
      // Only single-draft populates the private hand; null for everything else.
      hand: input.method === 'single-draft' ? (hands[p.id] ?? null) : null,
    }))
    const { error: playersErr } = await this.client.from('players').insert(playerRows)
    if (playersErr) throw new Error(`createGame: failed to insert players: ${playersErr.message}`)

    if (picks.length > 0) {
      // Random-method picks are inserted via a SECURITY DEFINER RPC rather
      // than a direct table insert. The `picks` table is locked down — anon
      // INSERT is intentionally not granted (see schema.sql). Other methods
      // start with zero picks; picks are made later via `make_pick`.
      const assignments = picks.map((pk) => ({ player_id: pk.playerId, hero_id: pk.heroId }))
      const { error: seedErr } = await this.client.rpc('seed_random_picks', {
        p_game_id: game.id,
        p_organiser_token: organiserToken,
        p_assignments: assignments,
      })
      if (seedErr) throw new Error(`createGame: failed to seed random picks: ${seedErr.message}`)
    }

    return { game, organiserToken, players }
  }

  async getSnapshot(gameId: string): Promise<GameSnapshot | null> {
    // SECURITY: explicitly list every NON-sensitive column. We do NOT select
    // `organiser_token` — even though `gameFromRow` would drop it, picking
    // it up over the anon key leaks the organiser's auth material into the
    // browser response. The column-level GRANTs in schema.sql additionally
    // prevent direct anon SELECT of `organiser_token`.
    const { data: gameRow, error: gameErr } = await this.client
      .from('games')
      .select(
        'id, status, player_count, method, hero_pool, draft_order, current_pick, turns, bans, start_team, handicap_team, created_at',
      )
      .eq('id', gameId)
      .maybeSingle<SnapshotGameRow>()
    if (gameErr) throw new Error(`getSnapshot: ${gameErr.message}`)
    if (!gameRow) return null

    // Token-free + hand-free projection — never expose `players.token` or
    // `players.hand` to the shared snapshot. Column-level GRANTs in
    // schema.sql additionally prevent direct anon SELECT of these columns.
    const { data: playerRows, error: playersErr } = await this.client
      .from('players')
      .select('id, game_id, name, team, seat')
      .eq('game_id', gameId)
    if (playersErr) throw new Error(`getSnapshot players: ${playersErr.message}`)

    const { data: pickRows, error: picksErr } = await this.client
      .from('picks')
      .select('*')
      .eq('game_id', gameId)
    if (picksErr) throw new Error(`getSnapshot picks: ${picksErr.message}`)

    return {
      game: gameFromRow(gameRow),
      players: ((playerRows as PublicPlayerRow[] | null) ?? []).map(publicPlayerFromRow),
      picks: ((pickRows as PickRow[] | null) ?? []).map(pickFromRow),
    }
  }

  async getPlayerView(gameId: string, token: string): Promise<PlayerView | null> {
    // The `players.hand` column is never selected directly from the client —
    // it is delivered through a token-gated RPC so other players' hands stay
    // private. The RPC returns jsonb `null` when the token doesn't match.
    const { data, error } = await this.client.rpc('get_player_view', {
      p_game_id: gameId,
      p_player_token: token,
    })
    if (error) throw new Error(`getPlayerView rpc: ${error.message}`)

    const payload = data as PlayerViewPayload | null
    if (!payload || !payload.player) return null

    return {
      player: publicPlayerFromRow(payload.player),
      hand: payload.hand ?? null,
    }
  }

  async makePick(gameId: string, playerToken: string, heroId: string): Promise<PickResult> {
    const { data, error } = await this.client.rpc('make_pick', {
      p_game_id: gameId,
      p_player_token: playerToken,
      p_hero_id: heroId,
    })
    if (error) throw new Error(`makePick rpc: ${error.message}`)

    const payload = data as MakePickPayload | null
    if (!payload) throw new Error('makePick: empty rpc response')

    if ('error' in payload) {
      const code: unknown = payload.error
      if (isPickError(code)) return { ok: false, error: code }
      throw new Error(`makePick: unknown error code from rpc: ${String(code)}`)
    }

    const snapshot: GameSnapshot = {
      game: gameFromRow(payload.game),
      players: payload.players.map(publicPlayerFromRow),
      picks: payload.picks.map(pickFromRow),
    }
    return { ok: true, snapshot }
  }

  subscribe(gameId: string, cb: (snap: GameSnapshot) => void): () => void {
    let cancelled = false

    const refetch = (): void => {
      void this.getSnapshot(gameId).then((snap) => {
        if (!cancelled && snap) cb(snap)
      })
    }

    const channel: RealtimeChannel = this.client
      .channel(`game:${gameId}`)
      // The `postgres_changes` filter type isn't fully captured by supabase-js
      // generics; the runtime accepts the union of options used here.
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        refetch,
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` },
        refetch,
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'picks', filter: `game_id=eq.${gameId}` },
        refetch,
      )
      .subscribe()

    return (): void => {
      cancelled = true
      void this.client.removeChannel(channel)
    }
  }
}
