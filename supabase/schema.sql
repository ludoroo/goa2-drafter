-- ============================================================================
-- goa2-drafter — Supabase schema
-- ============================================================================
--
-- HOW TO APPLY
-- ------------
-- Option A (recommended for hosted Supabase):
--   1. Open the project at https://app.supabase.com
--   2. SQL editor → New query → paste this entire file → Run.
--
-- Option B (psql against the project's connection string):
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--
-- Re-running is safe-ish: tables use `create table if not exists`, the RPC
-- uses `create or replace`, and policies are dropped+recreated.
--
-- WHAT THIS DEFINES
-- -----------------
--   * Three tables: games, players, picks.
--   * Row Level Security with permissive anon SELECT/INSERT (see SECURITY).
--   * The `make_pick` SECURITY DEFINER RPC consumed by SupabaseGameStore via
--     `client.rpc('make_pick', { p_game_id, p_player_token, p_hero_id })`.
--
-- SECURITY MODEL
-- --------------
-- This app is a static-hosted SPA: there is no server we control, only the
-- Supabase anon key shipped to the browser. Game ids are short codes but
-- player and organiser tokens are 128-bit unguessable strings (see
-- `src/utils/ids.ts`). Authorisation is therefore "knowledge of the token"
-- rather than identity-based:
--
--   * SELECT is open to anon — anyone with a game id can fetch the snapshot.
--     The shared snapshot path (`SupabaseGameStore.getSnapshot`) only selects
--     non-token columns from `players`, so participants cannot read each
--     other's `players.token`. The `make_pick` RPC verifies a token without
--     leaking it.
--   * INSERT on `games` and `players` is open to anon for the create-game
--     flow. A malicious client can spam rows but cannot read or mutate other
--     people's games without guessing tokens.
--   * INSERT on `picks` is NOT granted to anon. All pick mutations go through
--     SECURITY DEFINER RPCs that enforce the rules atomically:
--       - `make_pick`           — snake-draft turn order + hero availability
--       - `seed_random_picks`   — random-method assignments at create time,
--                                 gated by the organiser token
--   * UPDATE and DELETE are not granted to anon at all.
--   * Picks have unique (game_id, hero_id) and unique (game_id, player_id) so
--     a regression in app code can never produce a double-pick or two heroes
--     for one player.
--
-- A stricter model (auth-backed identities, per-row policies tying writes to
-- the caller's player token, moving the entire create flow into a SECURITY
-- DEFINER RPC) is a future enhancement.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.games (
  id               text primary key,
  status           text not null check (status in ('setup', 'drafting', 'complete')),
  player_count     int  not null,
  method           text not null check (method in ('snake', 'random')),
  hero_pool        jsonb not null default '[]'::jsonb,
  draft_order      jsonb not null default '[]'::jsonb,
  current_pick     int  not null default 0,
  organiser_token  text not null,
  created_at       timestamptz not null default now()
);

create table if not exists public.players (
  id       text primary key,
  game_id  text not null references public.games(id) on delete cascade,
  name     text not null,
  team     text not null,
  token    text not null unique,
  seat     int  not null
);

create index if not exists players_game_id_idx on public.players(game_id);

create table if not exists public.picks (
  id          text primary key,
  game_id     text not null references public.games(id) on delete cascade,
  player_id   text not null references public.players(id) on delete cascade,
  hero_id     text not null,
  pick_index  int,
  created_at  timestamptz not null default now()
);

create index if not exists picks_game_id_idx on public.picks(game_id);

-- Defence-in-depth: even if app code regresses, the database refuses a
-- second pick of the same hero in a game, or a second pick by the same
-- player in a game (this app assigns exactly one hero per player).
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'picks_game_hero_unique'
  ) then
    alter table public.picks
      add constraint picks_game_hero_unique unique (game_id, hero_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'picks_game_player_unique'
  ) then
    alter table public.picks
      add constraint picks_game_player_unique unique (game_id, player_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.games   enable row level security;
alter table public.players enable row level security;
alter table public.picks   enable row level security;

-- Drop-then-create so this file is rerunnable.
drop policy if exists games_anon_select   on public.games;
drop policy if exists games_anon_insert   on public.games;
drop policy if exists players_anon_select on public.players;
drop policy if exists players_anon_insert on public.players;
drop policy if exists picks_anon_select   on public.picks;
drop policy if exists picks_anon_insert   on public.picks;

create policy games_anon_select   on public.games   for select to anon using (true);
create policy games_anon_insert   on public.games   for insert to anon with check (true);

create policy players_anon_select on public.players for select to anon using (true);
create policy players_anon_insert on public.players for insert to anon with check (true);

create policy picks_anon_select   on public.picks   for select to anon using (true);

-- INTENTIONAL: NO anon INSERT/UPDATE/DELETE policy on `picks`.
-- All pick writes flow through SECURITY DEFINER RPCs (`make_pick`,
-- `seed_random_picks`) so validation cannot be bypassed by a malicious
-- client crafting raw INSERT requests against the table.

-- No UPDATE / DELETE policies for anon. Mutations during a draft must go
-- through the make_pick RPC below, which bypasses RLS via SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- make_pick RPC
-- ---------------------------------------------------------------------------
--
-- Atomic validate-and-commit for a single pick. Locks the game row with
-- SELECT ... FOR UPDATE so two concurrent calls serialise on the same game.
--
-- Returns jsonb. On failure: { "error": <code> } where <code> is one of the
-- PickError union values in src/types/index.ts. On success:
--   {
--     "game":    <games row as jsonb>,
--     "players": [<players rows as jsonb>],
--     "picks":   [<picks rows as jsonb>]
--   }
-- The row shapes use snake_case columns — they map 1:1 to the GameRow /
-- PlayerRow / PickRow interfaces in SupabaseGameStore.ts.

create or replace function public.make_pick(
  p_game_id       text,
  p_player_token  text,
  p_hero_id       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game        public.games%rowtype;
  v_player      public.players%rowtype;
  v_order_len   int;
  v_expected_id text;
  v_pick_index  int;
  v_new_status  text;
  v_pick_id     text;
  v_result      jsonb;
begin
  -- 1. Lock the game row.
  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    return jsonb_build_object('error', 'game-not-found');
  end if;

  -- 2. Status gate.
  if v_game.status <> 'drafting' then
    return jsonb_build_object('error', 'game-not-drafting');
  end if;

  -- 3. Resolve player by token, scoped to this game.
  select * into v_player
  from public.players
  where game_id = p_game_id and token = p_player_token;

  if not found then
    return jsonb_build_object('error', 'invalid-token');
  end if;

  -- 4. Turn check — draft_order is a jsonb array of player ids, 0-based.
  v_order_len := jsonb_array_length(v_game.draft_order);
  v_expected_id := v_game.draft_order ->> v_game.current_pick;

  if v_expected_id is null or v_expected_id <> v_player.id then
    return jsonb_build_object('error', 'not-your-turn');
  end if;

  -- 5. Hero availability — must be in the pool and not already picked.
  if not (v_game.hero_pool ? p_hero_id) then
    return jsonb_build_object('error', 'hero-unavailable');
  end if;

  if exists (
    select 1 from public.picks
    where game_id = p_game_id and hero_id = p_hero_id
  ) then
    return jsonb_build_object('error', 'hero-unavailable');
  end if;

  -- 6. Commit the pick.
  v_pick_index := v_game.current_pick;
  v_pick_id := gen_random_uuid()::text;

  insert into public.picks (id, game_id, player_id, hero_id, pick_index, created_at)
  values (v_pick_id, p_game_id, v_player.id, p_hero_id, v_pick_index, now());

  -- 7. Advance the draft, completing if we've consumed every slot.
  if v_pick_index + 1 >= v_order_len then
    v_new_status := 'complete';
  else
    v_new_status := 'drafting';
  end if;

  update public.games
  set current_pick = v_pick_index + 1,
      status       = v_new_status
  where id = p_game_id;

  -- 8. Build the snapshot payload. Player rows are projected to the public
  -- (token-free) shape so the snapshot never leaks auth material.
  select jsonb_build_object(
    'game', to_jsonb(g),
    'players', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'game_id', p.game_id,
            'name', p.name,
            'team', p.team,
            'seat', p.seat
          ) order by p.seat
        )
        from public.players p
        where p.game_id = p_game_id
      ),
      '[]'::jsonb
    ),
    'picks', coalesce(
      (select jsonb_agg(to_jsonb(pk) order by pk.pick_index nulls last, pk.created_at) from public.picks pk where pk.game_id = p_game_id),
      '[]'::jsonb
    )
  ) into v_result
  from public.games g
  where g.id = p_game_id;

  return v_result;
end;
$$;

-- Allow the browser (anon) and any logged-in user to invoke the RPC. The
-- function itself runs as the definer (table owner) and bypasses RLS.
grant execute on function public.make_pick(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- seed_random_picks RPC
-- ---------------------------------------------------------------------------
--
-- Seeds the `picks` table for a random-method game at create time. Anon does
-- not have INSERT on `picks` directly (see SECURITY MODEL), so this RPC is
-- the sole entry point for the random create flow.
--
-- Authorisation: the caller must present `p_organiser_token` matching the
-- `games.organiser_token` for `p_game_id`. The function refuses to run if
-- any picks already exist for the game (replay protection) or if the game
-- is already in `'drafting'` status.
--
-- Input: `p_assignments` is a jsonb array of objects of the form
--        `[{ "player_id": "...", "hero_id": "..." }, ...]`.
--
-- The function generates pick ids server-side, sets pick_index = null
-- (mirroring the LocalGameStore semantics for the random method), and
-- returns the resulting snapshot in the same jsonb shape as `make_pick`.

create or replace function public.seed_random_picks(
  p_game_id          text,
  p_organiser_token  text,
  p_assignments      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game     public.games%rowtype;
  v_existing int;
  v_result   jsonb;
begin
  -- 1. Lock + load the game.
  select * into v_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    return jsonb_build_object('error', 'game-not-found');
  end if;

  -- 2. Verify organiser token.
  if v_game.organiser_token is null or v_game.organiser_token <> p_organiser_token then
    return jsonb_build_object('error', 'invalid-token');
  end if;

  -- 3. Refuse if picks already exist for this game.
  select count(*) into v_existing
  from public.picks
  where game_id = p_game_id;

  if v_existing > 0 then
    return jsonb_build_object('error', 'already-seeded');
  end if;

  -- 4. Insert the assignments. Pick ids are generated server-side; the
  -- unique constraints on (game_id, hero_id) and (game_id, player_id)
  -- enforce one-hero-per-player and no-duplicate-heroes.
  insert into public.picks (id, game_id, player_id, hero_id, pick_index, created_at)
  select
    gen_random_uuid()::text,
    p_game_id,
    (a ->> 'player_id'),
    (a ->> 'hero_id'),
    null,
    now()
  from jsonb_array_elements(p_assignments) as a;

  -- 5. Build the same snapshot shape as `make_pick`, with token-free players.
  select jsonb_build_object(
    'game', to_jsonb(g),
    'players', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'game_id', p.game_id,
            'name', p.name,
            'team', p.team,
            'seat', p.seat
          ) order by p.seat
        )
        from public.players p
        where p.game_id = p_game_id
      ),
      '[]'::jsonb
    ),
    'picks', coalesce(
      (select jsonb_agg(to_jsonb(pk) order by pk.pick_index nulls last, pk.created_at) from public.picks pk where pk.game_id = p_game_id),
      '[]'::jsonb
    )
  ) into v_result
  from public.games g
  where g.id = p_game_id;

  return v_result;
end;
$$;

grant execute on function public.seed_random_picks(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- `SupabaseGameStore.subscribe` listens to `postgres_changes` on games,
-- players, and picks. For those events to be delivered, the tables MUST be
-- members of the `supabase_realtime` publication. On hosted Supabase the
-- publication already exists; we add our tables idempotently.
--
-- `picks` and `games` also get REPLICA IDENTITY FULL so UPDATE/DELETE change
-- payloads carry the full old row (not strictly required here since the store
-- re-fetches the snapshot on any event, but it makes the change feed complete
-- and future-proofs partial-update consumers).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Add tables to the publication only if not already members (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'picks'
  ) then
    alter publication supabase_realtime add table public.picks;
  end if;
end $$;

alter table public.games  replica identity full;
alter table public.picks  replica identity full;

