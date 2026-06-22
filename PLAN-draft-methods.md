# Implementation Plan — Additional Draft Methods

Add the rulebook's hero-selection methods to the GoA2 Drafter. Current: `snake`
(house variant, kept) + `random` (All Random). Add: **All Pick**, **Random
Draft**, **Single Draft**, **Pick and Ban**.

## Resolved decisions

- Implement all four new methods + keep snake.
- Starting team = **random coin flip** at game creation (simulates Tie Breaker coin).
- **Single Draft**: each player privately dealt 3 heroes; hand is **private**
  (delivered via their magic link, like tokens; not in the shared snapshot).
- **Pick & Ban**: each ban/pick is a **collective team action** performed by
  **any player on the active team**; picks are **claimed per player** as they're
  made (the acting player's pick fills one of that team's slots, in seat order);
  interleaved **rulebook order** (1st Ban A,B; 1st Pick A,B; 2nd Ban B,A; 2nd
  Pick B,A; …) repeating until every player has a hero.

## Method mechanics (authoritative, from condensed rules)

| Method | Pool each picker draws from | Turn order | Bans |
|--------|------------------------------|------------|------|
| `random` (All Random) | — (auto-dealt) | — | — |
| `snake` (house) | full `heroPool` | A,B,B,A,A,B… (existing) | — |
| `all-pick` | full `heroPool` | A,B,A,B… alternating, start = coin team | — |
| `random-draft` | shared pool of `playerCount+2` random heroes | A,B,A,B… | — |
| `single-draft` | the picker's **own private hand of 3** | A,B,A,B… | — |
| `pick-and-ban` | full `heroPool` minus banned/picked | team turn list (below) | yes |

Pick & Ban turn list (teams A/B; A = coin team). Repeat the 4-beat block
`[Ban A, Ban B, Pick A, Pick B]`? — No. Rulebook is explicit and *alternates the
leader each round*:
```
1st Ban:  A, B
1st Pick: A, B
2nd Ban:  B, A
2nd Pick: B, A
3rd Ban:  A, B
3rd Pick: A, B
...
```
Continue until each team has `heroesPerTeam` picks. Number of ban rounds =
number of pick rounds (they interleave 1:1). A "round" = 2 picks/team-beat. With
`heroesPerTeam = H`, there are `H` pick-beats per team and `H` ban-beats per
team (each round = 1 ban each + 1 pick each). Total turns = `4H`.

## Data model changes (`src/types/index.ts`)

- Extend `DraftMethod`:
  `'snake' | 'random' | 'all-pick' | 'random-draft' | 'single-draft' | 'pick-and-ban'`.
- Add a generalized **turn** type:
  ```ts
  export type DraftTurnKind = 'pick' | 'ban'
  export interface DraftTurn {
    kind: DraftTurnKind
    /** Player on the clock for player-pick methods. Null for collective team turns (pick-and-ban). */
    playerId: string | null
    /** Active team. Always set (used by collective turns + UI highlighting). */
    team: TeamId
  }
  ```
- `Game` gains:
  - `turns: DraftTurn[]` — the full ordered turn list (replaces reliance on bare
    `draftOrder` for the new methods; `draftOrder` retained for back-compat /
    snake + simple player methods, but `turns` is the new source of truth for
    "who's up / pick or ban"). `currentPick` indexes into `turns`.
  - `bans: string[]` — hero ids banned so far (pick-and-ban).
  - `startTeam: TeamId` — the coin-flip team (A).
- `Pick` gains nothing (already has playerId/heroId/pickIndex). For pick-and-ban
  "claim per player", the acting player is recorded as `playerId`.
- **Private hands** (single-draft): NOT in `GameSnapshot`. Stored alongside
  tokens (private map `playerId -> string[]`). Exposed only through a new
  store method `getPlayerView(gameId, token)` returning the caller's hand.
  - Add `PlayerView` type: `{ player: PublicPlayer; hand: string[] | null }`.

> Back-compat: existing snake/random games persisted with no `turns/bans/
> startTeam` must still load. Mappers default `turns: []`, `bans: []`,
> `startTeam: 'red'` when absent.

## Pure logic (`src/services/draft.ts`)

New pure, unit-tested helpers (rng injectable where randomness is involved):

- `coinFlipTeam(rng?): TeamId` — random A team.
- `buildAlternatingOrder(players, startTeam): string[]` — A,B,A,B by seat within
  team. (Used by all-pick, random-draft, single-draft.)
- `buildAllPickTurns(players, startTeam): DraftTurn[]` — picks only, alternating.
- `buildPickBanTurns(players, startTeam): DraftTurn[]` — the interleaved
  ban/pick team-turn list above. Player-claim resolution happens at commit time
  (next seat-ordered player on the acting team without a hero yet).
- `selectRandomDraftPool(heroPool, playerCount, rng?): string[]` — pick
  `playerCount+2` random heroes from the pool (throws if pool too small).
- `dealHands(playerIds, heroPool, handSize=3, rng?): Record<string,string[]>` —
  deal disjoint hands of N (throws if `pool < playerIds*handSize`).
- Keep existing `buildSnakeDraftOrder`, `randomAssignment`, `heroesPerTeam`,
  `minimumPoolSize`, `nextPickerId`.
- `minimumPoolSize` becomes method-aware:
  - all-pick / snake / random / random-draft: `playerCount` (random-draft needs
    `playerCount+2` available to *select* from, so min = `playerCount+2`).
  - single-draft: `playerCount * 3`.
  - pick-and-ban: `playerCount + totalBans` where totalBans = `2*heroesPerTeam`
    (each round bans 2). So min = `playerCount + playerCount = 2*playerCount`.
  - Add `minimumPoolSize(playerCount, method)`.

## Store changes (both impls + schema)

### `GameStore` interface
- Add `getPlayerView(gameId: string, token: string): Promise<PlayerView | null>`.
- `makePick` semantics generalized to consult `turns[currentPick]`:
  - Validate the caller may act on this turn:
    - player-pick turn → caller's playerId === turn.playerId.
    - collective turn (pick-and-ban) → caller is on `turn.team`.
  - `single-draft` → heroId must be in caller's private hand.
  - `random-draft` → heroId must be in the (trimmed) heroPool.
  - `all-pick` / `snake` → heroId in heroPool, not already picked.
  - `pick-and-ban`:
    - ban turn → heroId in heroPool, not banned, not picked → push to `bans`.
    - pick turn → not banned, not picked → create Pick claimed by the next
      seat-ordered player on `turn.team` who has no hero yet.
  - Advance `currentPick`; status → `complete` when no more pick-turns remain.
- New error codes (extend `PickError`):
  `'not-in-hand' | 'hero-banned' | 'not-your-team'`.

### `LocalGameStore`
- `createGame`: branch per method to build `turns`, `bans`, `startTeam`, trimmed
  pool (random-draft), hands (single-draft, stored in private map). Random stays
  one-shot complete.
- `getPlayerView`: resolve token → hand from private map.
- `makePick`: implement generalized validation above (keep CAS retry loop).

### `SupabaseGameStore` + `supabase/schema.sql`
- Add columns: `games.turns jsonb`, `games.bans jsonb`, `games.start_team text`;
  `players.hand jsonb` (private — NOT selected in snapshot projection).
- New RPC `make_pick` logic mirrors the generalized rules (turn list, bans,
  hand check, team check, claim-per-player). Update `seed_random_picks` only if
  needed (random unchanged).
- New RPC `get_player_view(p_game_id, p_player_token)` returning the caller's
  hand (token-gated; never exposes others' hands).
- Realtime unchanged (already covers games/players/picks).

## UI changes

### Setup wizard (`SetupPage.tsx`) — method step
- Replace the 2-option (snake/random) step with all 6, each with a short
  description. Pool-size validation uses `minimumPoolSize(count, method)`.
- Coin flip is automatic; show "starting team decided at random" note.

### Game screen (`GamePage.tsx`)
- Generalize the "current pick" banner to "current turn": show **PICK** or
  **BAN** and the team (and player name for player-pick methods).
- `single-draft`: the selector shows **only the player's hand** (from
  `getPlayerView`), not the full pool.
- `pick-and-ban`:
  - Any player on the active team can act (canAct = my team === turn.team).
  - Ban turns: selector action label becomes "Ban this hero"; banned heroes show
    a struck-through/greyed "BANNED" state in the roster/board.
  - Show a ban log.
- `random-draft` / `all-pick`: selector shows the (trimmed or full) pool; simple
  alternation banner.
- Board view (no token): shows turns, bans, picks live; no selector.

### `useGame` hook
- Expose `currentTurn` (kind/team/playerId), `bans`, and a `playerView`
  (hand) fetch when a token is present.

## Tasks & ordering

**Group A (types + pure logic) — parallel-safe, foundational**
- T1 `types/index.ts`: DraftMethod union, DraftTurn, Game.turns/bans/startTeam,
  PlayerView, PickError additions, GameStore.getPlayerView.
- T2 `services/draft.ts`: coinFlipTeam, buildAlternatingOrder, buildAllPickTurns,
  buildPickBanTurns, selectRandomDraftPool, dealHands, method-aware
  minimumPoolSize (+ unit tests).

**Group B (stores) — after A**
- T3 `LocalGameStore`: createGame per-method, getPlayerView, generalized
  makePick (+ tests for every method incl. ban/hand/team errors).
- T4 `SupabaseGameStore` + `schema.sql`: columns, generalized make_pick RPC,
  get_player_view RPC, mappers (+ mapper tests, network-free).

**Group C (hook + UI) — after B**
- T5 `useGame`: currentTurn, bans, playerView.
- T6 `SetupPage`: 6-method step + validation.
- T7 `GamePage`: turn banner, ban UI/log, single-draft hand selector,
  per-method selector source (+ tests).

**Group D**
- T8 docs (README/AGENTS/PLAN) + any deferred polish.

## Test focus
- `draft.test.ts`: each builder's order/structure; pick-and-ban interleave for
  H=2/3; random-draft pool size = count+2; dealHands disjoint & sized; coin flip
  deterministic with stub rng; method-aware minimums.
- `LocalGameStore.test.ts`: full playthrough per method to completion; hand
  enforcement (not-in-hand); ban enforcement (hero-banned); team enforcement
  (not-your-team); claim-per-player fills seats correctly; back-compat load of a
  legacy snake/random snapshot.
- UI: setup shows 6 methods + validation; GamePage ban label + banned display;
  single-draft shows only hand.

## Back-compat / migration
- Persisted games without `turns/bans/startTeam/hand` still load (mapper
  defaults). Live games created pre-change keep working (snake/random paths
  unchanged). Supabase schema uses `add column if not exists`.
