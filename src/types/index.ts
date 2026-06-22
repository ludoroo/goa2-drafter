/**
 * Domain model for the Guards of Atlantis 2 drafter app.
 *
 * Single source of truth — all other modules import their types from here.
 */

// ---------------------------------------------------------------------------
// Hero data
// ---------------------------------------------------------------------------

/**
 * A numeric stat parsed from CSV. `5 (8)` → `{ base: 5, upgraded: 8 }`,
 * a bare `5` → `{ base: 5 }`.
 */
export interface StatValue {
  base: number
  upgraded?: number
}

/** GoA2 hero role taxonomy (title-cased, as printed on hero cards). */
export type Role =
  | 'Tactician'
  | 'Disabler'
  | 'Durable'
  | 'Pusher'
  | 'Melee'
  | 'Farming'
  | 'Damager'
  | 'Sniper'
  | 'Healer'
  | 'Tokens'

/** Identifier for a published hero pack / expansion. */
export type HeroPackId = 'core' | 'defiant' | 'devoted' | 'renowned' | 'arcane' | 'wayward'

export interface HeroPack {
  id: HeroPackId
  name: string
  heroIds: string[]
}

/** Hero complexity rating (1 = simplest, 4 = most complex). */
export type Stars = 1 | 2 | 3 | 4

export interface HeroStats {
  attack: StatValue
  initiative: StatValue
  defense: StatValue
  movement: StatValue
  total: StatValue
}

export interface Hero {
  /** Slug, e.g. `'arien-the-tidemaster'`. */
  id: string
  name: string
  stars: Stars
  pack: HeroPackId
  /** All roles (primary + additional), normalized. */
  roles: Role[]
  /** Role 1 and Role 2 as printed on the card. */
  primaryRoles: Role[]
  stats: HeroStats
  /** Basename for `/public/heroes/<imageId>.png`; falls back to placeholder. */
  imageId: string
}

// ---------------------------------------------------------------------------
// Game / draft model
// ---------------------------------------------------------------------------

export type TeamId = 'red' | 'blue'

export type DraftMethod =
  | 'snake'
  | 'random'
  | 'all-pick'
  | 'random-draft'
  | 'single-draft'
  | 'pick-and-ban'

export type DraftTurnKind = 'pick' | 'ban'

/** One step in the ordered draft sequence — either a pick or a ban. */
export interface DraftTurn {
  kind: DraftTurnKind
  /** Player on the clock for player-pick methods; null for collective team turns (pick-and-ban). */
  playerId: string | null
  /** The team acting on this turn (always set — used for collective turns and UI highlighting). */
  team: TeamId
}

export type GameStatus = 'setup' | 'drafting' | 'complete'

/**
 * Player data safe to expose to every participant in the game (and to anyone
 * who can read a `GameSnapshot`). Notably DOES NOT include the magic-link
 * token — that field is sensitive auth material and is only ever returned
 * to the organiser by `createGame`.
 */
export interface PublicPlayer {
  id: string
  name: string
  team: TeamId
  /** Stable order within the game. */
  seat: number
}

/**
 * Full player record, including the magic-link `token`. Returned only by
 * `GameStore.createGame` so the organiser can build per-player join links.
 * Never included in `GameSnapshot` — see `PublicPlayer`.
 */
export interface Player extends PublicPlayer {
  /** Unguessable magic-link token. */
  token: string
}

export interface Pick {
  id: string
  playerId: string
  heroId: string
  /** Order in snake draft; `null` for random batch. */
  pickIndex: number | null
  createdAt: number
}

export interface Game {
  /** Short shareable code. */
  id: string
  status: GameStatus
  playerCount: number
  method: DraftMethod
  /** Hero ids available this game. */
  heroPool: string[]
  /** Ordered player ids — the snake pick sequence. */
  draftOrder: string[]
  /** Index into `draftOrder` (snake only); also indexes `turns` for new methods. */
  currentPick: number
  /** Ordered turn list (pick or ban) for new draft methods; `currentPick` indexes into this. */
  turns: DraftTurn[]
  /** Hero ids banned so far (pick-and-ban only; empty otherwise). */
  bans: string[]
  /** The coin-flip team that acts first ("Team A"). */
  startTeam: TeamId
  createdAt: number
}

/**
 * Live state aggregated for clients. `players` uses `PublicPlayer` — tokens
 * are never broadcast in the snapshot since the snapshot is read by every
 * participant. The organiser receives full `Player[]` (with tokens) once,
 * from `createGame`, to construct per-player magic links.
 */
export interface GameSnapshot {
  game: Game
  players: PublicPlayer[]
  picks: Pick[]
}

/**
 * The caller's private view of their own slot — returned only via a
 * token-gated store method; never part of the shared GameSnapshot.
 */
export interface PlayerView {
  player: PublicPlayer
  /** The player's privately dealt hand of hero ids (Single Draft); null for methods without hands. */
  hand: string[] | null
}

/** What an organiser submits to create a game. */
export interface CreateGameInput {
  playerCount: number
  method: DraftMethod
  heroPool: string[]
  players: Array<{ name: string; team: TeamId; seat: number }>
}

// ---------------------------------------------------------------------------
// Pick outcomes
// ---------------------------------------------------------------------------

export type PickError =
  | 'not-your-turn'
  | 'hero-unavailable'
  | 'game-not-drafting'
  | 'invalid-token'
  | 'game-not-found'
  | 'not-in-hand'
  | 'hero-banned'
  | 'not-your-team'

/** Discriminated result of attempting a pick. */
export type PickResult = { ok: true; snapshot: GameSnapshot } | { ok: false; error: PickError }

// ---------------------------------------------------------------------------
// Storage abstraction
// ---------------------------------------------------------------------------

/**
 * Backend abstraction. Implemented first against `localStorage`, later swappable
 * for Supabase without touching call sites.
 */
export interface GameStore {
  createGame(
    input: CreateGameInput,
  ): Promise<{ game: Game; organiserToken: string; players: Player[] }>
  getSnapshot(gameId: string): Promise<GameSnapshot | null>
  getPlayerView(gameId: string, token: string): Promise<PlayerView | null>
  makePick(gameId: string, playerToken: string, heroId: string): Promise<PickResult>
  /** Returns an unsubscribe function. */
  subscribe(gameId: string, cb: (snap: GameSnapshot) => void): () => void
}
