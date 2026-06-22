# AGENTS.md — GoA2 Drafter

Guidance for AI coding agents working on this codebase. Keep edits faithful to the conventions documented here; if you change a convention, update this file in the same PR.

## Project overview

**GoA2 Drafter** is a static SPA for setting up a game of **Guards of Atlantis II**. It handles:

- Forming two even teams from a roster of 4/6/8/10 players (random or manual).
- Curating the available hero pool by pack and/or individual hero.
- Drafting heroes via six selection methods: **snake**, **all-random**, **all-pick**, **random-draft**, **single-draft**, and **pick-and-ban** (turn-enforced + async where applicable).
- Serving each player a private screen via an unguessable magic-link token, plus a shared read-only board.

The app is deployed as static assets to **GitHub Pages** under base path `/goa2-drafter/`. There is no server we control; **Supabase** (Postgres + Realtime) is the optional backend for shared mutable state. When Supabase env vars are absent, the app falls back to a fully working **localStorage** store for single-device play.

The full design lives in [`PLAN.md`](./PLAN.md). This file is the day-to-day reference for agents.

## Tech stack

- **React 19** + **TypeScript** (`strict`, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`).
- **Vite 7** as the build tool; `base: '/goa2-drafter/'`; path alias `@` → `src`.
- **React Router v7** (`react-router-dom`).
- **Tailwind CSS v4** via `@tailwindcss/vite` (no `tailwind.config.js` needed in v4).
- **Supabase** (`@supabase/supabase-js`) — optional, env-gated.
- **Vitest** + **React Testing Library** + **`@testing-library/jest-dom`** + **jsdom**.
- **ESLint 9** (flat config) + **Prettier**.

## Build / lint / test commands

```bash
npm install               # one-time

npm run dev               # Vite dev server at /goa2-drafter/
npm run build             # tsc -b && vite build  → dist/
npm run preview           # serve dist/ locally
npm run lint              # eslint .
npm run typecheck         # tsc --noEmit
npm test                  # vitest run (one shot)
npm run test:watch        # vitest in watch mode
npm run format            # prettier --write .
```

There is **no `lint -- --fix`** alias; run `eslint . --fix` directly if you need it. Tests are co-located (`*.test.ts(x)` next to the file under test) — there is no top-level `tests/` directory.

## Project structure

```
goa2-drafter/
├── public/
│   └── heroes/                 # real hero PNGs go here, keyed by hero id
├── scripts/
│   ├── build-heroes.ts         # CSV → src/data/heroes.ts (committed output)
│   └── heroes-source.csv
├── src/
│   ├── components/
│   │   ├── ui/                 # primitives (Button, Card, Chip, ...)
│   │   ├── HeroDomino.tsx
│   │   ├── HeroDetailCard.tsx
│   │   ├── HeroSelector.tsx
│   │   ├── FilterBar.tsx
│   │   ├── TeamRoster.tsx
│   │   └── ErrorBoundary.tsx
│   ├── pages/
│   │   ├── HomePage.tsx
│   │   ├── SetupPage.tsx       # organiser wizard
│   │   ├── GamePage.tsx       # board (no token) + player draft screen (with ?t=)
│   │   └── NotFoundPage.tsx
│   ├── hooks/                  # useGame, useHeroFilters, ...
│   ├── services/
│   │   ├── store/
│   │   │   ├── LocalGameStore.ts
│   │   │   ├── SupabaseGameStore.ts
│   │   │   └── index.ts        # selects backend from env
│   │   ├── supabase.ts         # lazy, memoised client + isSupabaseConfigured()
│   │   └── draft.ts            # pure snake / random helpers
│   ├── data/
│   │   ├── heroes.ts           # generated; do not hand-edit
│   │   └── packs.ts
│   ├── types/                  # GameStore interface, shared domain types
│   ├── utils/                  # ids, shuffle, parsing helpers
│   ├── test/setup.ts           # Vitest setup (localStorage polyfill)
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css               # Tailwind v4 entry + tokens
├── supabase/
│   └── schema.sql              # tables + RLS + RPCs
├── .github/workflows/deploy.yml
├── .env.example
├── PLAN.md
├── AGENTS.md
└── README.md
```

## Code style

### Formatting (Prettier, enforced)

- **No semicolons.**
- **Single quotes** for strings.
- **Trailing commas** wherever Prettier defaults allow (functions, objects, arrays).
- 2-space indent. Run `npm run format` before committing if in doubt.

### TypeScript

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `verbatimModuleSyntax: true`.
- **Never use `any`.** Use `unknown` and narrow, or define a proper type.
- **Type-only imports must use `import type`** (verbatim mode enforces this):
  ```ts
  import { createClient, type SupabaseClient } from '@supabase/supabase-js'
  import type { GameStore } from '@/types'
  ```
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Add explicit return types on exported functions; let TypeScript infer locals.
- Use the `@/` alias for cross-directory imports (`@/services/...`, `@/types`). Co-located imports stay relative.

### Modules and exports

- **Named exports only** for components, hooks, services, and utilities. Avoid `default export`.
- One component per file; the file name matches the export (`HeroDomino.tsx` exports `HeroDomino`).

### React

- Functional components with hooks, never classes (the existing `ErrorBoundary` is the deliberate exception).
- Keep components focused; extract reused logic into `src/hooks/`.
- Co-locate small subcomponents next to their parent if not reused.

### File / symbol naming

| Element              | Convention             | Example                  |
| -------------------- | ---------------------- | ------------------------ |
| Components           | `PascalCase.tsx`       | `HeroDomino.tsx`         |
| Hooks                | `useCamelCase.ts`      | `useGame.ts`             |
| Utilities / services | `camelCase.ts`         | `draft.ts`, `shuffle.ts` |
| Types / interfaces   | `PascalCase`           | `GameStore`, `Hero`      |
| Constants            | `SCREAMING_SNAKE_CASE` | `MAX_PLAYERS`            |
| Tests                | `*.test.ts(x)`         | `draft.test.ts`          |

### Comments

Prefer self-documenting code. Use JSDoc on exported APIs and on anything non-obvious (the existing `supabase.ts` and `schema.sql` show the bar). Inline `// TODO(scope): …` is fine.

## The `GameStore` abstraction

UI and hooks **must not** import Supabase or `localStorage` directly. They depend on the `GameStore` interface in `src/types/`, and resolve the concrete impl through:

```ts
// src/services/store/index.ts
export function getGameStore(): GameStore {
  if (isSupabaseConfigured()) return new SupabaseGameStore()
  return new LocalGameStore()
}
export const gameStore = getGameStore()
```

- `isSupabaseConfigured()` (in `src/services/supabase.ts`) returns true iff both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are non-empty strings.
- `LocalGameStore` keeps state in `localStorage` and implements `subscribe` via the `storage` event plus an in-tab event bus — multiple tabs of the same browser stay in sync.
- `SupabaseGameStore` reads via `select` (token-free projection) and mutates **only via the `make_pick` and `seed_random_picks` RPCs** defined in `supabase/schema.sql`.

When adding a new feature that touches game state, **add the method to the `GameStore` interface first**, then implement it in both stores. Tests for `LocalGameStore` live next to it (`LocalGameStore.test.ts`); the Supabase impl is exercised through integration testing against a real project.

## Draft logic

All hero-selection logic is **pure** and lives in `src/services/draft.ts`, with unit tests in `src/services/draft.test.ts`. **Do not** put draft rules inside React components or stores — keep them in `draft.ts` so they can be unit-tested without a backend.

**Six selection methods** are supported: `random` (All Random, one-shot), `snake` (house A-B-B-A), `all-pick`, `random-draft` (shared pool of `players+2`), `single-draft` (private hand of 3 per player), and `pick-and-ban` (rulebook ban/pick order). The starting team ("Team A") is a **coin flip** (`coinFlipTeam`) at game creation.

**Generalized turn model.** Turn-based methods are an ordered `Game.turns: DraftTurn[]` where each `DraftTurn` is `{ kind: 'pick' | 'ban', playerId: string | null, team: TeamId }` — `playerId` is set for player-pick turns, `null` for collective team turns (pick-and-ban). `Game.currentPick` indexes into `turns`. `Game.bans` holds banned hero ids. The pure builders are `buildSnakeDraftOrder`, `buildAlternatingOrder`, `buildAllPickTurns`, `buildPickBanTurns`, plus `selectRandomDraftPool` and `dealHands`. Pool minimums are method-aware via `minimumPoolSize(count, method)`.

**Private hands (Single Draft).** A player's dealt hand is **never** in the shared `GameSnapshot`. It's stored alongside tokens (local) / in `players.hand` (Supabase, column-GRANT protected) and exposed only through the token-gated `GameStore.getPlayerView` (`get_player_view` RPC).

`make_pick` is now **turn-aware**: it reads `turns[currentPick]`, authorizes per-player (`not-your-turn`) or per-team (`not-your-team`), enforces hand membership (`not-in-hand`) for single-draft and ban state (`hero-banned`), commits a ban (append to `bans`) or a pick (claimed by the acting player, or for collective pick-and-ban the lowest-seat player on the team without a hero yet), and completes when no `pick` turns remain.

## Hero data

The hero list is **generated**, not hand-written:

1. Source of truth: `scripts/heroes-source.csv`.
2. `scripts/build-heroes.ts` parses the CSV into `src/data/heroes.ts` (committed).
3. `src/data/packs.ts` groups heroes by pack.

Don't edit `src/data/heroes.ts` by hand. To change hero data:

1. Edit `scripts/heroes-source.csv`.
2. Re-run `scripts/build-heroes.ts` (e.g. `npx tsx scripts/build-heroes.ts`).
3. Commit both files.
4. Run `npm test` — `src/data/heroes.test.ts` and `packs.test.ts` will catch most regressions.

`StatValue` cells like `5 (8)` parse to `{ base: 5, upgraded: 8 }`; bare numbers parse to `{ base: 5 }`.

## Testing approach

- **Vitest + React Testing Library**, configured in `vite.config.ts`'s `test` block (`globals: true`, `environment: 'jsdom'`, `setupFiles: './src/test/setup.ts'`).
- **Co-located** tests: `Foo.test.ts(x)` sits next to `Foo.ts(x)`.
- `src/test/setup.ts` polyfills `localStorage` for jsdom (the bundled jsdom version doesn't ship a working one), so anything that touches `LocalGameStore` works under test. **Don't remove this polyfill** without replacing it.
- Test **user-visible behavior**, not implementation details (RTL queries, not snapshot dumps of internals).
- Use `@testing-library/user-event` for interaction tests.
- Unit-test pure logic (`draft.ts`, hero parsing) directly.

## Common tasks

### Add a new hero

1. Add a row to `scripts/heroes-source.csv`.
2. Re-run `scripts/build-heroes.ts` to regenerate `src/data/heroes.ts`.
3. *(Optional)* drop art at `public/heroes/<hero-id>.png`.
4. `npm test && npm run lint && npm run typecheck`.

### Add a new route / page

1. Create `src/pages/MyPage.tsx` (named export, `PascalCase.tsx`).
2. Register the route in `src/App.tsx` alongside the existing `Routes`.
3. Add a co-located `MyPage.test.tsx` covering at least the happy path.
4. If the page needs a backend method, extend `GameStore` first (see above).

### Modify draft logic

Change **only** `src/services/draft.ts` and update `src/services/draft.test.ts`. Do not duplicate the rules into components or stores. If the change affects how picks are committed (turn checks, availability, completion), the corresponding logic in `LocalGameStore` and **both** Supabase RPCs (`make_pick`, `seed_random_picks` in `supabase/schema.sql`) must be updated in lockstep — they are the canonical enforcement points.

### Swap or update hero artwork

- Drop a PNG at `public/heroes/<hero-id>.png` (id == slug from `src/data/heroes.ts`). Files are served at `/goa2-drafter/heroes/<id>.png` in production thanks to the Vite `base`.
- Missing files automatically fall back to the deterministic placeholder, so you can ship art incrementally.
- Don't reach into `src/components/HeroDomino.tsx` to hard-code paths; the lookup is centralised.

### Add or change a Supabase column / RPC

1. Edit `supabase/schema.sql` (the file is rerunnable — tables use `if not exists`, the RPCs use `create or replace`, policies are dropped + recreated).
2. Apply it via the Supabase SQL editor or `psql` (see the header comment in `schema.sql`).
3. Update the matching row interface in `src/services/store/SupabaseGameStore.ts`.
4. If you add a new mutation, **make it a `SECURITY DEFINER` RPC**; do not grant `INSERT`/`UPDATE`/`DELETE` directly to anon (see security notes below).

## Security notes

The deployed app is a static SPA. The Supabase **anon** key is in the bundle by design — security comes from tokens + RLS, not from hiding the key. When making changes:

- **Never expose `players.token`, `players.hand`, or `games.organiser_token`** to other participants. Three layers protect them: (1) **column-level GRANTs** — anon has `SELECT` only on the non-sensitive columns of `games`/`players`, so a raw `select token/hand/organiser_token` over the anon key is refused by Postgres; (2) `SupabaseGameStore.getSnapshot()` selects explicit safe columns; (3) RPC payloads build the snapshot with explicit `jsonb_build_object(...)` (never `to_jsonb(g)`). Single-draft hands are returned only by the token-gated `get_player_view` RPC (`GameStore.getPlayerView`).
- All pick mutations go through **`make_pick`** and **`seed_random_picks`** (both `SECURITY DEFINER`). Anon does **not** have `INSERT` on `picks`, and no anon `UPDATE`/`DELETE` exists on any table. Don't add direct table-level write policies — funnel new mutations through new RPCs.
- Tokens (organiser + player) are 128-bit, generated client-side via `src/utils/ids.ts`. Use the existing helper rather than rolling your own.
- Defense-in-depth lives in the database too: `picks` has unique `(game_id, hero_id)` and `(game_id, player_id)` constraints, so even a regression in app code can't double-pick a hero.
- **Tests force the local store** via `test.env` in `vite.config.ts` (empties the `VITE_SUPABASE_*` vars) so the suite never touches a real Supabase project.

If a future change requires a stricter model (e.g. auth-backed identities, per-row token policies, full create flow inside a `SECURITY DEFINER` RPC), update both `schema.sql` and this section.

## Deployment

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on push to `main` / `master` (and via `workflow_dispatch`). It injects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from repo secrets at build time; both are optional — without them the deployed site uses local mode. The repo's GitHub Pages source must be set to **GitHub Actions** in **Settings → Pages**.
