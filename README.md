# GoA2 Drafter

A web app for setting up a game of [**Guards of Atlantis II**](https://boardgamegeek.com/boardgame/267609/guards-of-atlantis-ii): form two teams, curate a hero pool, and draft heroes — from a one-click random deal to a full rulebook pick-and-ban.

Each player gets a private magic link to pick on their own device, with a shared live board for everyone to watch. No accounts, no logins.

**Live:** https://ludoroo.github.io/goa2-drafter/

## Draft methods

All Random · Snake · All Pick · Random Draft · Single Draft · Pick & Ban — six selection methods covering casual deals through to the official rulebook ban/pick order.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173/goa2-drafter/
```

Out of the box the app runs in **local mode** — game state lives in `localStorage`, so the full setup → draft → board flow works in a single browser (great for pass-the-device play). No backend needed.

### Other scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check + production build to `dist/` |
| `npm test` | Run the Vitest suite |
| `npm run lint` / `npm run typecheck` / `npm run format` | Lint / type-check / format |

## Multi-device play (optional Supabase)

For real cross-device play (each player on their own phone), point the app at a Supabase project:

1. Create a project at [supabase.com](https://supabase.com).
2. Run [`supabase/schema.sql`](./supabase/schema.sql) in its SQL editor.
3. Copy `.env.example` → `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Restart `npm run dev` — the app uses Supabase automatically when both vars are set.

The anon key is public by design; security comes from unguessable per-player tokens, row-level security, and `SECURITY DEFINER` RPCs. See the header of [`supabase/schema.sql`](./supabase/schema.sql) for details.

## Tech stack

React 19 · TypeScript · Vite · React Router · Tailwind CSS v4 · Supabase (optional) · Vitest.

## More

- [`AGENTS.md`](./AGENTS.md) — conventions and common tasks (incl. how to add hero art).

---

Unofficial fan tool. Guards of Atlantis II is a trademark of its respective owner.
