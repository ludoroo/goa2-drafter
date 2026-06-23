# GoA2 Drafter

A web app for setting up a game of [**Guards of Atlantis II**](https://www.woodenleopard.com/guards-of-atlantis): pick your players, form two teams, curate the available hero pool, then assign heroes via any of six selection methods — from a one-click random deal to a full rulebook pick-and-ban. Fully **async / multi-device** when Supabase is configured — every player picks on their own phone or laptop and watches the shared board update live — and a built-in **single-device localStorage** mode lets you run a pass-the-device draft with zero setup.

## Features

- **Teams** — randomize into two even teams, or assign players manually.
- **Hero pool** — pick whole hero packs (Core, Defiant, Devoted, Renowned, Arcane, Wayward) or toggle individual heroes.
- **Six hero-selection methods** (see below) — covering everything from "just deal me a hero" to the full rulebook pick-and-ban.
- **Async multiplayer** — per-player magic links; rosters and picks update live on every device, plus a TV-friendly board view.
- **Single-device fallback** — works offline out of the box via localStorage; great for in-person play.
- **Hero selection UI** — slanted "domino" strips that expand to a full hero card, with filters by complexity (★1–4), role, pack, search, and stat sort.

### Hero-selection methods

| Method | One-liner |
| ------ | --------- |
| **All Random** | Everyone is dealt a random hero from the curated pool in one shot. |
| **Snake** | Turn-based `A, B, B, A, A, B, B, A …` draft (house variant). |
| **All Pick** | Teams alternate one pick at a time from the full pool until everyone has a hero. |
| **Random Draft** | A shared pool of `players + 2` random heroes is revealed; teams alternate picks from it. |
| **Single Draft** | Each player is privately dealt a hand of 3 heroes (via their magic link) and picks one. |
| **Pick & Ban** | Teams alternately **ban** and **pick** in the rulebook order (`Ban A,B · Pick A,B · Ban B,A · Pick B,A · …`). |

The starting team ("Team A") is chosen by a **coin flip** at game creation. In **Single Draft**, each player's hand is private — it's never part of the shared snapshot and is only delivered to the owner via their magic-link token.

## Tech stack

- **React 19** + **TypeScript** + **Vite 7**
- **React Router v7**
- **Tailwind CSS v4** (`@tailwindcss/vite`)
- **Supabase** (`@supabase/supabase-js`) — Postgres + Realtime, optional
- **Vitest** + **React Testing Library**
- **ESLint** + **Prettier**

## Getting started

### Prerequisites

- **Node 20** or **22** (matches the GitHub Actions deploy)
- **npm** (the repo ships a `package-lock.json`)

### Install and run

```bash
npm install
npm run dev          # starts Vite on http://localhost:5173/goa2-drafter/
```

The dev server serves under the `/goa2-drafter/` base path (matching production), so make sure to visit `http://localhost:5173/goa2-drafter/` rather than the bare root.

### Other scripts

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `npm run build`      | Type-check (`tsc -b`) then produce a `dist/` build |
| `npm run preview`    | Serve the production build locally                 |
| `npm run lint`       | ESLint over the repo                               |
| `npm run typecheck`  | `tsc --noEmit`                                     |
| `npm test`           | Run Vitest once                                    |
| `npm run test:watch` | Run Vitest in watch mode                           |
| `npm run format`     | Prettier write across the repo                     |

## Run modes

The app picks its storage backend at runtime based on environment variables (see `src/services/store/index.ts`).

### Local mode (default — no setup)

If neither `VITE_SUPABASE_URL` nor `VITE_SUPABASE_ANON_KEY` is set, the app uses `LocalGameStore`, which keeps all game state in `localStorage`. Everything works in a single browser:

- Create a game, set up players + teams + pool, generate the draft.
- Open the magic links in different tabs (or pass the device around) to take each pick.
- Subscriptions fire on the `storage` event, so multiple tabs of the same browser stay in sync.

This is the recommended mode for a couch / kitchen-table draft.

### Async multiplayer (Supabase)

For real multi-device play (each player on their own phone), point the app at a Supabase project:

1. Create a project at [supabase.com](https://supabase.com).
2. In the project's **SQL editor**, paste and run [`supabase/schema.sql`](./supabase/schema.sql). This creates the `games`, `players`, and `picks` tables, RLS policies, and the `make_pick` / `seed_random_picks` RPCs.
3. Copy `.env.example` to `.env.local` and fill in:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-public-key>
   ```
4. Restart `npm run dev`. With both vars set, `getGameStore()` swaps in `SupabaseGameStore` automatically.

#### Security model (short version)

- The Supabase **anon public key** ships in the static bundle — that's by design.
- Authorisation is via **unguessable tokens**: every game has an organiser token and every player has their own magic-link token (128-bit, generated client-side).
- **RLS** allows anon `SELECT` on shared rows so participants can read snapshots, but **`UPDATE`/`DELETE` are not granted at all**, and **`INSERT` on `picks` is forbidden to anon**.
- All pick mutations go through the **`make_pick`** and **`seed_random_picks`** **`SECURITY DEFINER`** RPCs, which validate the token + turn order + hero availability atomically (with `SELECT … FOR UPDATE` on the game row).
- The shared snapshot path projects player rows to a token-free shape, so participants can never read each other's tokens.

See the comments at the top of [`supabase/schema.sql`](./supabase/schema.sql) for the full model.

## How it works

### Routes

| Route                            | Purpose                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `/`                              | Home — create a new game.                                                     |
| `/setup`                         | Organiser's setup wizard (players → teams → method → pool → generate links).  |
| `/play/:gameId?t=<playerToken>`  | A player's draft screen — board + hero selector to pick on their turn.        |
| `/play/:gameId`                  | Same page WITHOUT a token: a shared, read-only live board (great for a TV).    |
| `/board/:gameId`                 | Legacy alias — redirects to `/play/:gameId`.                                  |

### Magic links

When the organiser finishes setup, the app generates one magic link per player (`/play/:gameId?t=<token>`). Anyone with the link is that player; the same URL without the `?t=` token is the shared read-only board for spectators.

### Snake order

Snake order is built once at setup. Within each team, players are shuffled into a fixed seat order; the team sequence then alternates `A, B, B, A, A, B, B, A …` until every seat has been filled. The pure logic lives in `src/services/draft.ts`.

## Hero artwork

By default, each hero renders as a **deterministic placeholder** (gradient + monogram) keyed by the hero id. To use real art, drop a PNG into `public/heroes/<hero-id>.png` — the ids are the slugified names exported from `src/data/heroes.ts` (e.g. `arien-the-tidemaster.png`). Missing files automatically fall back to the placeholder.

## Deployment

The repo ships a GitHub Actions workflow at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) that builds the app and publishes `dist/` to GitHub Pages on every push to `main` / `master` (and on manual `workflow_dispatch`).

To enable it in a fresh fork:

1. Push to `main`.
2. **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. *(Optional, for Supabase mode)* **Settings → Secrets and variables → Actions → New repository secret** for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The workflow injects them as build-time env vars; if absent, the deployed site falls back to local mode.

Vite is configured with `base: '/goa2-drafter/'` (see `vite.config.ts`), so the deployed site lives at `https://<user>.github.io/goa2-drafter/`. If you fork under a different repo name, update `base` to match.

## Project structure

```
goa2-drafter/
├── public/
│   └── heroes/                 # drop real hero art here (<id>.png)
├── scripts/
│   ├── build-heroes.ts         # CSV → src/data/heroes.ts
│   └── heroes-source.csv
├── src/
│   ├── components/             # HeroDomino, HeroSelector, FilterBar, ...
│   │   └── ui/
│   ├── pages/                  # Home / Setup / Player / Board / NotFound
│   ├── hooks/                  # useGame, useHeroFilters, ...
│   ├── services/
│   │   ├── store/              # GameStore interface + Local/Supabase impls
│   │   ├── supabase.ts         # Supabase client (lazy, env-gated)
│   │   └── draft.ts            # pure snake / random helpers (unit-tested)
│   ├── data/                   # heroes.ts (generated), packs.ts
│   ├── types/                  # shared types
│   ├── utils/                  # ids, shuffle, ...
│   ├── test/setup.ts           # Vitest setup (localStorage polyfill)
│   ├── App.tsx
│   └── main.tsx
├── supabase/
│   └── schema.sql              # tables + RLS + make_pick / seed_random_picks RPCs
├── .github/workflows/deploy.yml
├── .env.example
├── PLAN.md                     # full design / decisions
├── AGENTS.md                   # guidance for AI coding agents
├── README.md
└── (vite.config.ts, tsconfig*.json, eslint.config.js, ...)
```

## Further reading

- [`PLAN.md`](./PLAN.md) — full design, resolved decisions, data model, and build phases.
- [`AGENTS.md`](./AGENTS.md) — conventions and common tasks for AI coding agents.
- [`.env.example`](./.env.example) — environment variable template.
