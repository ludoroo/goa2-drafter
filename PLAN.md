# Guards of Atlantis 2 — Drafter App Plan

A web app to set up a game of **Guards of Atlantis 2 (GoA2)**: assemble players,
form two teams, curate the available hero pool, then assign heroes via **snake
draft** or **random** assignment — fully **async** so each player picks on their
own device and sees the live state of both teams.

> **Update:** the four additional rulebook hero-selection methods — **all-pick**,
> **random-draft**, **single-draft**, and **pick-and-ban** — were implemented
> after this original plan (snake + random shipped first). See
> [`PLAN-draft-methods.md`](./PLAN-draft-methods.md) for that design (generalized
> `Game.turns` model, coin-flip starting team, private Single-Draft hands).

---

## 1. Goals (from brief)

1. Take a list of players; **randomize into 2 teams** OR let the organiser **set teams manually**.
2. Organiser curates the **available hero pool** — select individually or by **hero pack**.
3. Assign heroes via one of two methods:
   - **Snake draft** — standard snake order across the two teams, players pick one at a time.
   - **Random** — assign all heroes at once.
4. **Async / multi-device** — players see which heroes their team and the opposing team have picked, live.
5. Rich **hero selection screen** — all still-available heroes, filterable by complexity and stats.
6. **Slick, responsive selection UI** — slanted vertical "dominoes", each a glimpse of a hero, expanding on click.

---

## 2. Resolved Decisions (from grilling)

| Topic | Decision |
|-------|----------|
| **Persistence / async** | **Supabase** (Postgres + Realtime). Frontend stays static on GitHub Pages; Supabase holds shared mutable game state with realtime subscriptions. |
| **Snake order** | **Standard snake**: A, B, B, A, A, B, B, A … |
| **Turn enforcement** | **Enforced turn order**; only the current player can pick; UI notifies whose turn it is. |
| **Player identity** | **Per-player magic link / token** (like stationfall-helper). No accounts, no passwords. |
| **Hero artwork** | **Placeholders now** (gradient/silhouette per hero), real art dropped into `/public` later, keyed by hero id. |
| **Setup flow** | **Organiser does all setup first**, then generates per-player invite links. |
| **Complexity** | **Stars 1–4** used directly (1 = easiest, 4 = hardest). |
| **Stats display** | **Base (upgraded)** form, e.g. `Attack 5 (8)`. |
| **Heroes per team** | **Strict: 1 hero per player, even teams only** (4/6/8/10 players → 2/3/4/5 heroes per team). |
| **Pool validation** | Validate available pool ≥ heroes needed; warn otherwise. |
| **Random reveal** | **Reveal all immediately**; team rosters visible to all. |
| **Board view** | **Yes** — shared live read-only board (TV-friendly) plus per-player private screens. |
| **State adapter** | **`GameStore` interface** with two impls: a **localStorage mock** (works now, single-device, for local dev) and a **Supabase** impl (swapped in when keys land). UI/logic depend only on the interface. |
| **Git** | Local repo only, no GitHub push (personal account). |

---

## 3. Tech Stack (mirrors `../stationfall-helper`)

- **Framework:** React 19 + TypeScript
- **Build:** Vite 7
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`)
- **Routing:** React Router v7
- **Backend:** **Supabase** (`@supabase/supabase-js`) — Postgres + Realtime channels
- **State:** React Context + hooks (lightweight); Supabase as source of truth
- **Path alias:** `@` → `src` (matches stationfall config)
- **Lint/format:** ESLint + Prettier
- **Testing:** Vitest + React Testing Library
- **Deploy:** GitHub Pages (static frontend), `base: '/goa2-drafter/'`

> Supabase keys: the **anon public key** ships in the static bundle (safe by
> design). Security is enforced via **Row Level Security (RLS)** + the
> unguessable per-player tokens, not by hiding the key.

---

## 4. Game Domain Data

### Heroes (32 total, source: `GoA 2 Heroes - Heroes.csv`)

Each hero record:

```ts
interface Hero {
  id: string;            // slug, e.g. "arien-the-tidemaster"
  name: string;          // "Arien the Tidemaster"
  stars: 1 | 2 | 3 | 4;  // complexity
  pack: HeroPack;        // see below
  roles: Role[];         // Role 1 + Role 2 + additional, normalized
  primaryRoles: Role[];  // Role 1, Role 2
  stats: {
    attack:     StatValue;  // { base: number; upgraded?: number }
    initiative: StatValue;
    defense:    StatValue;
    movement:   StatValue;
    total:      StatValue;
  };
  imageId: string;       // file in /public/heroes/, falls back to placeholder
}
```

`StatValue` parses CSV cells like `5 (8)` → `{ base: 5, upgraded: 8 }` and `5` → `{ base: 5 }`.

### Hero Packs (CSV `Set` column → display name)

| `Set` (CSV) | Pack display name | Heroes |
|-------------|-------------------|--------|
| Base | **Core Set** | Arien, Brogan, Tigerclaw, Wasp, Sabina, Xargatha, Dodger (7) |
| Defiant | **Defiant Hero Pack** | Garrus, Bain, Cutter, Trinkets, Nebkher (5) |
| Devoted | **Devoted Hero Pack** | Whisper, Misa, Ursafar, Silverarrow, Tali (5) |
| Renown | **Renowned Hero Pack** | Min, Swift, Wuk, Hanu, Ignatia (5) |
| Arcane | **Arcane Hero Pack** | Rowenna, Mrak, Snorri, Razzle, Gydion (5) |
| Wayward | **Wayward Hero Pack** | Brynn, Mortimer, Widget & Pyro, Takahide, Emmitt (5) |

### Roles (filter facet, normalized & title-cased from CSV)

`Tactician, Disabler, Durable, Pusher, Melee, Farming, Damager, Sniper, Healer, Tokens`

### Player-count rules (from Condensed Rules)

- Teams are always **two equal teams** (red / blue) → **even player counts only**.
- 4 or 6 players → single-lane map; 8 or 10 → double-lane map.
- **Heroes per team = playerCount / 2** (each player drafts exactly one hero).

| Players | Heroes/team | Total heroes drafted |
|---------|-------------|----------------------|
| 4 | 2 | 4 |
| 6 | 3 | 6 |
| 8 | 4 | 8 |
| 10 | 5 | 10 |

---

## 5. State Layer — `GameStore` adapter

UI and hooks depend on a single interface; the backend is swappable.

```ts
interface GameStore {
  createGame(input: CreateGameInput): Promise<{ game: Game; organiserToken: string }>;
  getGame(gameId: string): Promise<GameSnapshot | null>;
  makePick(gameId: string, playerToken: string, heroId: string): Promise<PickResult>;
  subscribe(gameId: string, cb: (snap: GameSnapshot) => void): () => void; // returns unsubscribe
}
```

- **`LocalGameStore`** — localStorage-backed, `subscribe` via `storage` event +
  in-tab event bus. Lets the full flow (setup → draft → board) run **now**,
  single browser. Used as the default until keys are configured.
- **`SupabaseGameStore`** — Postgres + Realtime; `makePick` calls the atomic
  `make_pick` RPC; `subscribe` uses Realtime channels.
- Selection at runtime: if `VITE_SUPABASE_URL` is set use Supabase, else Local.

## 6. Data Model (Supabase)

```
games
  id              text  PK        -- short code, e.g. "ax7k2p"
  created_at      timestamptz
  status          text            -- 'setup' | 'drafting' | 'complete'
  player_count    int
  method          text            -- 'snake' | 'random'
  hero_pool       jsonb           -- array of hero ids available this game
  draft_order     jsonb           -- ordered array of player ids (snake sequence)
  current_pick    int             -- index into draft_order (snake only)
  organiser_token text            -- unguessable; controls/advances the game

players
  id          text PK             -- uuid
  game_id     text FK -> games.id
  name        text
  team        text                -- 'red' | 'blue'
  token       text  unique        -- unguessable magic-link token
  seat        int                 -- stable order within game

picks
  id          text PK
  game_id     text FK
  player_id   text FK
  hero_id     text
  pick_index  int                 -- order in which picked (null for random batch)
  created_at  timestamptz
```

### Realtime
- Clients subscribe to `games`, `players`, `picks` filtered by `game_id`.
- Any pick inserts a `picks` row + advances `games.current_pick` → all devices update live.

### Security (RLS)
- Reads: a row is readable if the request carries a valid token for that `game_id`
  (organiser token or any player token). Game state (rosters, picks) is intentionally
  shared among all participants.
- Writes:
  - `picks` insert allowed only when the requester's player token == `draft_order[current_pick]`
    and the chosen hero is in `hero_pool` and not already picked (enforced via RPC/SQL function for atomicity).
  - `games` status/pool/order writes allowed only with the organiser token.
- A Postgres **RPC function** `make_pick(game, player_token, hero_id)` does the
  validate-and-commit atomically to prevent races/double-picks.

---

## 7. Routes & Screens

```
/                                  Home — create a game or paste a join link
/setup/:gameId?t=<organiserToken>  Organiser setup wizard
/board/:gameId                     Shared live board (read-only, TV-friendly)
/play/:gameId?t=<playerToken>      Player's private draft screen
```

### Home (`/`)
- "Create new game" → generates game + organiser token, routes to setup.
- "Join with link" hint (players normally arrive via their magic link).

### Setup wizard (`/setup/:gameId`) — organiser only
1. **Players** — add names (4/6/8/10). Validate even count.
2. **Teams** — choose **Randomize** or **Manual** (drag/assign each player to red/blue, equal sizes).
3. **Hero pool** — grid of packs with select-all-pack toggles + individual hero toggles.
   Live counter: "Selected X heroes — need ≥ N". Warn if below minimum.
4. **Method** — Snake draft or Random.
5. **Generate** — creates players + tokens, computes `draft_order`, sets status.
   - Shows a table of per-player magic links to copy/share, plus the board link.
   - Snake → status `drafting`. Random → run assignment, status `complete`.

### Player screen (`/play/:gameId`)
- Header: your name, team, current game status.
- **Your turn banner** when it's your pick; otherwise "Waiting for <player> (Team X)".
- **Both team rosters** — slots filling live as picks happen.
- **Hero selection panel** (the slick UI, below) — only available heroes; pick confirms via RPC.
- After your pick / when complete: shows your assigned hero prominently.

### Board (`/board/:gameId`)
- Read-only. Two columns (Red / Blue), hero dominoes filling in live.
- Highlights whose turn it is. Great for projecting.

---

## 7. The Selection UI — "Slanted Hero Dominoes"

The signature interaction.

- **Collapsed state:** heroes rendered as **slanted vertical strips** (CSS
  `transform: skew/rotate`), side by side like leaning dominoes/cards. Each strip
  shows a sliver: hero portrait crop + name vertical + a stars pip.
- **Hover/focus:** strip straightens and widens slightly, lifts (z-index + shadow).
- **Click/expand:** selected strip expands to a full **hero detail card**:
  portrait, name, pack, stars, roles (chips), stat bars (base + upgraded), and a
  **Pick this hero** button (enabled only on your turn). Neighbors compress.
- **Keyboard / swipe** to move between heroes; expanded card is a focus trap.
- **Filter bar** above the strip:
  - Complexity (stars 1–4 multi-select)
  - Role chips (multi-select)
  - Stat sliders/sort (Attack / Initiative / Defense / Movement / Total)
  - Pack filter
  - Search by name
- **Availability:** picked heroes are removed/greyed; pool respects the game's
  curated `hero_pool`.
- **Responsive:** desktop = horizontal row of dominoes; mobile = vertically
  stacked / horizontally scrollable strip with snap. `prefers-reduced-motion`
  disables the skew animation.

Placeholder art: deterministic gradient per hero id + first-letter monogram +
silhouette, swapped for `/public/heroes/<id>.png` when present.

---

## 8. Draft Logic

### Snake order construction
Given teams A (first) and B, players per team P = playerCount/2, rounds = P:
```
order = []
for round r in 0..P-1:
  if r even: order += [A players' next pick slot, then B's two..]  // standard snake
```
Concretely the team sequence is `A,B,B,A,A,B,B,A,...`. Within a team, the
specific player for each pick is assigned a fixed slot at setup (shuffled once),
so the "random player from the team picks" requirement is satisfied deterministically
and fairly. Current pick = `draft_order[current_pick]`.

### make_pick (RPC, atomic)
1. Verify token == `draft_order[current_pick]`.
2. Verify hero ∈ `hero_pool` and not already in `picks`.
3. Insert pick; increment `current_pick`; if last → status `complete`.

### Random method
At generation: shuffle pool, deal `playerCount` heroes round-robin to seats,
insert all `picks`, status `complete`, reveal immediately.

---

## 9. Project Structure

```
goa2-drafter/
├── public/
│   └── heroes/                 # drop real art here later (<id>.png)
├── src/
│   ├── components/
│   │   ├── ui/                 # Button, Card, Chip, StatBar, ...
│   │   ├── HeroDomino.tsx      # collapsed slanted strip
│   │   ├── HeroDetailCard.tsx  # expanded card
│   │   ├── HeroSelector.tsx    # domino row + filters
│   │   ├── TeamRoster.tsx
│   │   └── FilterBar.tsx
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── SetupPage.tsx
│   │   ├── PlayerPage.tsx
│   │   └── BoardPage.tsx
│   ├── hooks/
│   │   ├── useGame.ts          # subscribe to game/players/picks
│   │   └── useHeroFilters.ts
│   ├── services/
│   │   ├── store/
│   │   │   ├── GameStore.ts        # interface + types
│   │   │   ├── LocalGameStore.ts   # localStorage impl (default, works now)
│   │   │   ├── SupabaseGameStore.ts# Supabase impl (needs keys)
│   │   │   └── index.ts            # selects impl from env
│   │   ├── supabase.ts         # supabase client init
│   │   └── draft.ts            # snake order + random helpers (pure, unit-tested)
│   ├── data/
│   │   ├── heroes.ts           # generated from CSV
│   │   └── packs.ts
│   ├── types/index.ts
│   ├── utils/                  # shuffle, ids, csv-derived parsing helpers
│   ├── App.tsx
│   └── main.tsx
├── supabase/
│   ├── schema.sql              # tables + RLS + make_pick RPC
│   └── seed/                   # optional
├── scripts/
│   └── build-heroes.ts         # CSV → src/data/heroes.ts (one-off / committed output)
├── PLAN.md
├── AGENTS.md
└── (vite/ts/eslint/tailwind config mirroring stationfall-helper)
```

---

## 10. Build Phases

1. **Scaffold** — Vite + React 19 + TS + Tailwind v4 + Router, `@` alias, GH Pages base. Mirror stationfall configs.
2. **Hero data** — parse CSV → `src/data/heroes.ts` (stats base/upgraded, roles, pack). Unit-test the parser. Build `packs.ts`.
3. **Pure draft logic** — `draft.ts` snake-order + random helpers, fully unit-tested (no backend).
4. **Supabase** — `schema.sql` (tables, RLS, `make_pick` RPC), `supabase.ts` client, env wiring.
5. **Setup wizard** — players → teams (random/manual) → pool (packs + individual + validation) → method → generate links.
6. **Player screen** — live game subscription, turn enforcement, roster display.
7. **Hero selector UI** — domino strips + expand + filters (complexity/roles/stats/search). The visual centrepiece.
8. **Board view** — read-only live board.
9. **Random method** — batch assign + reveal.
10. **Polish** — responsive, reduced-motion, error/empty states, copy-link UX, art-swap fallback.
11. **Deploy** — GitHub Actions → GitHub Pages; document Supabase setup in README/AGENTS.

---

## 11. Open / Deferred

- **Real hero artwork** — placeholders until assets provided; filenames keyed by hero id.
- **Reconnect / token loss** — magic links are the recovery mechanism; consider localStorage cache of last token.
- **Multiple concurrent games** — supported (each its own `game_id`); no cleanup job yet (consider TTL on `created_at`).
- **House rules** (uneven teams, >1 hero/player) — out of scope for v1 (strict rules only).
- **Map/lane setup helper** — out of scope (this app is drafting only).
