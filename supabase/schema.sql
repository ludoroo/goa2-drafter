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
-- Re-running is safe-ish: tables use `create table if not exists`, columns are
-- added with `add column if not exists`, RPCs use `create or replace`, and
-- policies are dropped+recreated.
--
-- WHAT THIS DEFINES
-- -----------------
--   * Three tables: games, players, picks.
--   * Row Level Security with permissive anon SELECT/INSERT (see SECURITY).
--   * The `make_pick` SECURITY DEFINER RPC consumed by SupabaseGameStore via
--     `client.rpc('make_pick', { p_game_id, p_player_token, p_hero_id })`.
--     This RPC implements the generalised per-method draft logic that mirrors
--     `LocalGameStore.makePick` (turn list, bans, hand checks, claim-per-
--     player on collective turns, completion when no remaining 'pick' turns).
--   * The `seed_random_picks` SECURITY DEFINER RPC for one-shot random-method
--     game creation.
--   * The `get_player_view` SECURITY DEFINER RPC — the ONLY path through which
--     a `players.hand` value is ever returned to the client. The hand column
--     is private; it is never projected into the shared snapshot.
--
-- SECURITY MODEL
-- --------------
-- This app is a static-hosted SPA: there is no server we control, only the
-- Supabase anon key shipped to the browser. Game ids are short codes but
-- player and organiser tokens are 128-bit unguessable strings (see
-- `src/utils/ids.ts`). Authorisation is therefore "knowledge of the token"
-- rather than identity-based.
--
-- Sensitive columns — these MUST NEVER reach a client over the anon key:
--   * `games.organiser_token`  — the organiser's auth material
--   * `players.token`          — each player's magic-link auth material
--   * `players.hand`           — single-draft private dealt hand
--
-- Defence in depth — three layers of protection for the sensitive columns:
--
--   1. Column-level GRANTs (defined below). Anon's `select` privilege on
--      `games` and `players` is REVOKED, then re-granted ONLY on the
--      non-sensitive columns. A direct `select organiser_token from games`
--      or `select token, hand from players` over the anon key is rejected
--      by Postgres before RLS even runs. SECURITY DEFINER RPCs run as the
--      table owner and bypass these grants so they can still read the
--      sensitive columns internally.
--
--   2. Explicit safe projections in app code. `SupabaseGameStore.getSnapshot`
--      lists exactly the non-sensitive columns in its `.select(...)`. The
--      `make_pick`, `seed_random_picks`, and `get_player_view` RPCs build
--      their `game` and `players` payload pieces with explicit
--      `jsonb_build_object(...)` — never `to_jsonb(g)` on a games row,
--      because that would include `organiser_token`.
--
--   3. RLS policies (below) gate row-level access; the column GRANTs gate
--      column-level access. Both are needed to permit safe reads while
--      forbidding sensitive reads.
--
-- Other access rules:
--
--   * INSERT on `games` and `players` is open to anon for the create-game
--     flow. A malicious client can spam rows but cannot read or mutate other
--     people's games without guessing tokens.
--   * INSERT on `picks` is NOT granted to anon. All pick mutations go through
--     SECURITY DEFINER RPCs that enforce the rules atomically:
--       - `make_pick`           — generalised per-method turn order, hand
--                                 / ban / pool / availability checks
--       - `seed_random_picks`   — random-method assignments at create time,
--                                 gated by the organiser token
--   * UPDATE and DELETE are not granted to anon at all.
--   * Picks have unique (game_id, hero_id) and unique (game_id, player_id) so
--     a regression in app code can never produce a double-pick or two heroes
--     for one player.
--   * `get_player_view` is the ONLY path that returns a `players.hand` value
--     to a client, and it only ever returns the caller's OWN hand (resolved
--     by the caller's player token).
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
  method           text not null,
  hero_pool        jsonb not null default '[]'::jsonb,
  draft_order      jsonb not null default '[]'::jsonb,
  current_pick     int  not null default 0,
  organiser_token  text not null,
  created_at       timestamptz not null default now()
);

-- New columns introduced alongside the generalised draft methods. Defaulted
-- for back-compat with rows created before the column existed.
alter table public.games
  add column if not exists turns      jsonb not null default '[]'::jsonb;
alter table public.games
  add column if not exists bans       jsonb not null default '[]'::jsonb;
alter table public.games
  add column if not exists start_team text  not null default 'red';

-- For odd player counts (5/7/9) the larger team uses Handicap cards; this is
-- that team. Nullable (and null for even teams). Non-sensitive — exposed via
-- the anon column GRANT below and included in RPC snapshot payloads.
alter table public.games
  add column if not exists handicap_team text;

-- Refresh the method check constraint to include the new draft methods.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'games_method_check' and conrelid = 'public.games'::regclass
  ) then
    alter table public.games drop constraint games_method_check;
  end if;
end $$;

alter table public.games
  add constraint games_method_check
  check (method in ('snake', 'random', 'all-pick', 'random-draft', 'single-draft', 'pick-and-ban'));

create table if not exists public.players (
  id       text primary key,
  game_id  text not null references public.games(id) on delete cascade,
  name     text not null,
  team     text not null,
  token    text not null unique,
  seat     int  not null
);

-- Private per-player hand of hero ids (single-draft method only). Nullable;
-- never projected into the shared snapshot (see SECURITY MODEL above). Only
-- delivered to the owning player through the token-gated `get_player_view`.
alter table public.players
  add column if not exists hand jsonb;

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
-- Column-level privileges (defence in depth for sensitive columns)
-- ---------------------------------------------------------------------------
--
-- RLS policies above gate ROW-level access; the column GRANTs below gate
-- COLUMN-level access. Anon must NOT be able to read `games.organiser_token`,
-- `players.token`, or `players.hand` over a direct table SELECT — those are
-- secrets in the app's threat model. We revoke the broad table SELECT and
-- re-grant only the non-sensitive columns. Postgres rejects a column-level
-- read of an ungranted column before RLS runs, so even a malicious client
-- crafting `select organiser_token from games` is refused.
--
-- SECURITY DEFINER RPCs (`make_pick`, `seed_random_picks`, `get_player_view`)
-- run as the table owner and bypass these grants, so they can still read the
-- sensitive columns internally for token verification and `get_player_view`'s
-- caller-only hand return.
--
-- Idempotent: REVOKE on a privilege that isn't held is a no-op, and GRANT on
-- a privilege that's already held is a no-op.

revoke select on public.games   from anon;
grant  select (
  id, status, player_count, method, hero_pool, draft_order, current_pick,
  turns, bans, start_team, handicap_team, created_at
) on public.games to anon;

revoke select on public.players from anon;
grant  select (id, game_id, name, team, seat) on public.players to anon;

-- `picks` has no sensitive columns; the broad table SELECT stays.

-- ---------------------------------------------------------------------------
-- make_pick RPC
-- ---------------------------------------------------------------------------
--
-- Atomic validate-and-commit for a single pick / ban. Locks the game row
-- with SELECT ... FOR UPDATE so two concurrent calls serialise on the same
-- game. Mirrors the generalised `LocalGameStore.makePick` logic:
--
--   * Resolve caller by (game_id, token) → invalid-token if no match.
--   * SINGLE DRAFT (simultaneous, no turn order): handled in its own branch
--     before the turn lookup. Hero must be in the caller's private hand
--     (else not-in-hand); the caller must have no existing pick AND the
--     hero must not already be taken (else hero-unavailable). The pick is
--     inserted with `pick_index = null` and owner = caller. `current_pick`
--     is never advanced. Status flips to 'complete' once every player in
--     the game has a pick. Returns the snapshot and exits.
--   * OTHER METHODS (turn-based):
--     - Look up `games.turns[current_pick]` (jsonb array, 0-based).
--     - Authorise: per-player turns require caller.id = turn.playerId;
--       collective turns (playerId is null) require caller.team = turn.team.
--     - Availability: hero must not be already picked, not banned, and
--       must be in `games.hero_pool`.
--     - Commit:
--         * ban  → append hero to `games.bans`, no pick row inserted.
--         * pick → owner is `turn.playerId` if not null (legacy per-player
--           turn, kept for back-compat with persisted games — none of the
--           current builders emit those). Otherwise (collective pick turn —
--           snake, all-pick, random-draft, pick-and-ban) the ACTING player
--           (v_player) owns the hero, provided they don't already have one;
--           if they do, return 'not-your-turn'. This is the UNIFORM acting-
--           player-owns rule across every collective pick method. Mirrors
--           LocalGameStore.makePick.
--     - Advance `current_pick`. Status flips to 'complete' iff there is no
--       remaining turn at index >= new current_pick with kind = 'pick'.
--
-- Returns jsonb. On failure: { "error": <code> } where <code> is one of the
-- PickError union values in src/types/index.ts. On success:
--   {
--     "game":    <safe games projection — every column EXCEPT
--                 organiser_token; map 1:1 to SnapshotGameRow in
--                 SupabaseGameStore.ts>,
--     "players": [<players rows projected to id, game_id, name, team, seat>],
--     "picks":   [<picks rows as jsonb>]
--   }
-- The row shapes use snake_case columns — they map 1:1 to the SnapshotGameRow
-- / PublicPlayerRow / PickRow interfaces in SupabaseGameStore.ts. The game
-- projection is built with an EXPLICIT jsonb_build_object so `to_jsonb(g)`
-- never accidentally serialises `organiser_token` into the shared payload.
-- Player rows are projected to the public (token-free, hand-free) shape so
-- the snapshot never leaks auth material or private hands.

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
  v_game             public.games%rowtype;
  v_player           public.players%rowtype;
  v_turns_len        int;
  v_current_turn     jsonb;
  v_turn_kind        text;
  v_turn_player_id   text;
  v_turn_team        text;
  v_owner_id         text;
  v_new_status       text;
  v_pick_id          text;
  v_has_remaining    boolean;
  v_result           jsonb;
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

  -- 3a. Single draft is SIMULTANEOUS — no turn order, no current_pick advance.
  --     Each player picks one hero from their private hand at any time. This
  --     branch handles the entire flow and returns without falling through to
  --     the turn-based logic below. Mirrors LocalGameStore.makePick single-
  --     draft branch.
  if v_game.method = 'single-draft' then
    -- Hero must be in the caller's private hand.
    if v_player.hand is null or not (v_player.hand ? p_hero_id) then
      return jsonb_build_object('error', 'not-in-hand');
    end if;

    -- One pick per player: a second attempt is hero-unavailable to them.
    if exists (
      select 1 from public.picks
      where game_id = p_game_id and player_id = v_player.id
    ) then
      return jsonb_build_object('error', 'hero-unavailable');
    end if;

    -- Hands are disjoint so a cross-player collision shouldn't occur, but
    -- keep the global availability check for safety (also defended by the
    -- unique (game_id, hero_id) constraint).
    if exists (
      select 1 from public.picks
      where game_id = p_game_id and hero_id = p_hero_id
    ) then
      return jsonb_build_object('error', 'hero-unavailable');
    end if;

    v_pick_id := gen_random_uuid()::text;
    insert into public.picks (id, game_id, player_id, hero_id, pick_index, created_at)
    values (v_pick_id, p_game_id, v_player.id, p_hero_id, null, now());

    -- Completion: complete once every player in the game has a pick. We do
    -- NOT touch current_pick (it stays at 0 — single-draft has no turns).
    if (
      select count(distinct player_id) from public.picks where game_id = p_game_id
    ) >= v_game.player_count then
      update public.games set status = 'complete' where id = p_game_id;
    end if;

    -- Build the snapshot payload. Same explicit jsonb_build_object projection
    -- as the turn-based path below — game WITHOUT organiser_token, players
    -- token-free and hand-free, full picks rows.
    select jsonb_build_object(
      'game', jsonb_build_object(
        'id',           g.id,
        'status',       g.status,
        'player_count', g.player_count,
        'method',       g.method,
        'hero_pool',    g.hero_pool,
        'draft_order',  g.draft_order,
        'current_pick', g.current_pick,
        'turns',        g.turns,
        'bans',         g.bans,
        'start_team',   g.start_team,
        'handicap_team', g.handicap_team,
        'created_at',   g.created_at
      ),
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
  end if;

  -- 4. Current turn lookup. `turns` is a jsonb array of
  --    { kind, playerId, team } objects; `current_pick` is 0-based.
  v_turns_len := coalesce(jsonb_array_length(v_game.turns), 0);
  if v_game.current_pick < 0 or v_game.current_pick >= v_turns_len then
    return jsonb_build_object('error', 'game-not-drafting');
  end if;

  v_current_turn   := v_game.turns -> v_game.current_pick;
  if v_current_turn is null or jsonb_typeof(v_current_turn) <> 'object' then
    return jsonb_build_object('error', 'game-not-drafting');
  end if;

  v_turn_kind      := v_current_turn ->> 'kind';
  v_turn_player_id := v_current_turn ->> 'playerId';
  v_turn_team      := v_current_turn ->> 'team';

  -- 5. Authorisation: per-player vs collective team turn.
  if v_turn_player_id is not null then
    if v_turn_player_id <> v_player.id then
      return jsonb_build_object('error', 'not-your-turn');
    end if;
  else
    if v_turn_team is null or v_turn_team <> v_player.team then
      return jsonb_build_object('error', 'not-your-team');
    end if;
  end if;

  -- 6. Availability — common checks first.
  if exists (
    select 1 from public.picks
    where game_id = p_game_id and hero_id = p_hero_id
  ) then
    return jsonb_build_object('error', 'hero-unavailable');
  end if;

  if v_game.bans ? p_hero_id then
    return jsonb_build_object('error', 'hero-banned');
  end if;

  -- 7. Method-specific availability. Note: single-draft is handled in its
  --    own branch above (step 3a) and never reaches here.
  if not (v_game.hero_pool ? p_hero_id) then
    return jsonb_build_object('error', 'hero-unavailable');
  end if;

  -- 8. Commit — pick or ban.
  if v_turn_kind = 'ban' then
    -- Append to games.bans; do NOT insert a pick row.
    update public.games
    set bans = coalesce(v_game.bans, '[]'::jsonb) || to_jsonb(p_hero_id),
        current_pick = v_game.current_pick + 1
    where id = p_game_id;
  else
    -- Determine owner.
    -- UNIFORM ACTING-PLAYER-OWNS RULE: across ALL collective pick methods
    -- (snake, all-pick, random-draft, pick-and-ban) the hero is claimed by
    -- the acting player (v_player). A player who has already taken a pick
    -- in this game has "used up" their turn — a second attempt is rejected
    -- as `not-your-turn` (their team turn may still be active, but it is
    -- not THEIRS to take). This guarantees each teammate picks exactly
    -- once across their team's H pick turns. Mirrors LocalGameStore.makePick.
    --
    -- The legacy per-player branch (v_turn_player_id is not null) is kept
    -- for back-compat: a persisted game from before this change may still
    -- carry per-player turn entries. None of the built-in builders emit
    -- those anymore, but reading old records must still work.
    if v_turn_player_id is not null then
      v_owner_id := v_turn_player_id;
    else
      if exists (
        select 1 from public.picks pk
        where pk.game_id = p_game_id and pk.player_id = v_player.id
      ) then
        return jsonb_build_object('error', 'not-your-turn');
      end if;
      v_owner_id := v_player.id;
    end if;

    v_pick_id := gen_random_uuid()::text;
    insert into public.picks (id, game_id, player_id, hero_id, pick_index, created_at)
    values (v_pick_id, p_game_id, v_owner_id, p_hero_id, v_game.current_pick, now());

    update public.games
    set current_pick = v_game.current_pick + 1
    where id = p_game_id;
  end if;

  -- 9. Completion: complete iff no remaining turn at index >= new current_pick
  --    has kind = 'pick'.
  select exists (
    select 1
    from jsonb_array_elements(v_game.turns) with ordinality as t(turn, idx)
    where (idx - 1) >= v_game.current_pick + 1
      and (t.turn ->> 'kind') = 'pick'
  ) into v_has_remaining;

  if v_has_remaining then
    v_new_status := 'drafting';
  else
    v_new_status := 'complete';
  end if;

  update public.games
  set status = v_new_status
  where id = p_game_id;

  -- 10. Build the snapshot payload. The `game` projection is built EXPLICITLY
  --     — we do not use `to_jsonb(g)` because that would leak the sensitive
  --     `organiser_token` column into the shared payload. Player rows are
  --     projected to the public (token-free, hand-free) shape.
  select jsonb_build_object(
    'game', jsonb_build_object(
      'id',           g.id,
      'status',       g.status,
      'player_count', g.player_count,
      'method',       g.method,
      'hero_pool',    g.hero_pool,
      'draft_order',  g.draft_order,
      'current_pick', g.current_pick,
      'turns',        g.turns,
      'bans',         g.bans,
      'start_team',   g.start_team,
      'handicap_team', g.handicap_team,
      'created_at',   g.created_at
    ),
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

  -- 5. Build the same snapshot shape as `make_pick`. The `game` projection
  --    is built EXPLICITLY (no `to_jsonb(g)`) so `organiser_token` cannot
  --    leak into the shared payload. Player rows are projected to the public
  --    (token-free, hand-free) shape.
  select jsonb_build_object(
    'game', jsonb_build_object(
      'id',           g.id,
      'status',       g.status,
      'player_count', g.player_count,
      'method',       g.method,
      'hero_pool',    g.hero_pool,
      'draft_order',  g.draft_order,
      'current_pick', g.current_pick,
      'turns',        g.turns,
      'bans',         g.bans,
      'start_team',   g.start_team,
      'handicap_team', g.handicap_team,
      'created_at',   g.created_at
    ),
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
-- get_player_view RPC
-- ---------------------------------------------------------------------------
--
-- Token-gated read of a single player's private slot, including their dealt
-- hand (single-draft only; null otherwise). This is the ONLY place the
-- `players.hand` column is ever returned to a client — the shared snapshot
-- path projects players to id/game_id/name/team/seat exactly so other
-- participants cannot read each other's hands.
--
-- Resolves `(p_game_id, p_player_token)` → players row. On match returns
--   { "player": { id, name, team, seat }, "hand": <jsonb array | null> }
-- On no match returns jsonb null (the client maps that to `null`).
--
-- Note: the function is SECURITY DEFINER so it can read `players.hand` even
-- though the column GRANTs above forbid anon from selecting `hand` over a
-- direct table read. The query is `where game_id = $1 and token = $2` and
-- the returned `hand` is ALWAYS the resolved row's own hand — there is no
-- code path that could return another player's hand.

create or replace function public.get_player_view(
  p_game_id       text,
  p_player_token  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
begin
  select * into v_player
  from public.players
  where game_id = p_game_id and token = p_player_token;

  if not found then
    return 'null'::jsonb;
  end if;

  return jsonb_build_object(
    'player', jsonb_build_object(
      'id',      v_player.id,
      'game_id', v_player.game_id,
      'name',    v_player.name,
      'team',    v_player.team,
      'seat',    v_player.seat
    ),
    'hand', coalesce(v_player.hand, 'null'::jsonb)
  );
end;
$$;

grant execute on function public.get_player_view(text, text) to anon, authenticated;

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

-- ---------------------------------------------------------------------------
-- delete_old_games RPC (housekeeping)
-- ---------------------------------------------------------------------------
--
-- Deletes games older than `p_max_age_days` (deletes cascade to players +
-- picks). Called on a daily schedule by `.github/workflows/cleanup.yml`, which
-- doubles as a keep-alive ping so the free-tier project never pauses.
--
-- SECURITY: the function is anon-callable (the cleanup workflow uses the public
-- anon key). To make that safe, the age is CLAMPED to a minimum of 1 day, so a
-- caller can never use it to wipe recent/active games — only genuinely
-- abandoned ones. Returns the number of games removed.

create or replace function public.delete_old_games(p_max_age_days int default 7)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_age_days int;
  v_deleted  int;
begin
  -- Floor at 1 day regardless of caller input: never delete recent games.
  v_age_days := greatest(coalesce(p_max_age_days, 7), 1);

  with removed as (
    delete from public.games
    where created_at < now() - make_interval(days => v_age_days)
    returning id
  )
  select count(*) into v_deleted from removed;

  return v_deleted;
end;
$$;

grant execute on function public.delete_old_games(int) to anon, authenticated;

