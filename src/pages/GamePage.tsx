import { useCallback, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import type {
  DraftTurn,
  GameStatus,
  Hero,
  PickError,
  PublicPlayer,
  TeamId,
} from '@/types'
import { useGame } from '@/hooks/useGame'
import { getHeroById } from '@/data/heroes'
import { heroesPerTeam } from '@/services/draft'
import { HeroSelector } from '@/components/HeroSelector'
import { TeamRoster } from '@/components/TeamRoster'
import { Card, cn } from '@/components/ui'

/**
 * GamePage — a single screen for the whole group, used at `/play/:gameId`.
 *
 * - WITHOUT a `?t=<token>` query param it is the shared, read-only **board**:
 *   live team rosters + whose turn it is, plus the public hero pool for
 *   methods that have one (snake / all-pick / random-draft / pick-and-ban) —
 *   the Pick/Ban action is disabled for spectators. Great for projecting on a TV.
 * - WITH a valid `?t=<token>` it is additionally a **player's draft screen**:
 *   the holder can pick (or ban) when it's their turn.
 *
 * Pool visibility: the pool is public for snake / all-pick / random-draft /
 * pick-and-ban (shown to everyone). Only **single-draft** is private — each
 * player sees only their own dealt hand, token-gated via `getPlayerView`.
 *
 * Generalised across draft methods (T7):
 * - `snake` / `all-pick` / `random-draft` / `single-draft` — player picks on
 *   the active turn (`currentTurn.playerId`).
 * - `pick-and-ban` — collective team turns (`currentTurn.playerId === null`);
 *   the banner shows the acting team + action kind. Bans appear in a
 *   dedicated "Bans" section and disable those heroes in the selector.
 * - `random` — no turns; the page just renders the final rosters.
 *
 * Self-identification note: `GameSnapshot.players` is the token-free
 * `PublicPlayer` projection, so the page cannot resolve `t=...` → "which
 * player am I?". We treat `makePick(token, …)` as the authoritative gate and
 * surface its `PickError` results as friendly messages.
 */

const TEAM_TEXT: Record<TeamId, string> = {
  red: 'text-red-300',
  blue: 'text-blue-300',
}

const TEAM_DOT: Record<TeamId, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
}

const TEAM_LABEL: Record<TeamId, string> = {
  red: 'Team Red',
  blue: 'Team Blue',
}

const STATUS_LABEL: Record<GameStatus, string> = {
  setup: 'Setup',
  drafting: 'Drafting',
  complete: 'Complete',
}

const STATUS_BADGE: Record<GameStatus, string> = {
  setup: 'border-slate-500/60 bg-slate-700/40 text-slate-200',
  drafting: 'border-amber-400/70 bg-amber-500/20 text-amber-200',
  complete: 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200',
}

/** Map a `PickError` to user-facing copy. Pure + testable. */
const pickErrorMessage = (err: PickError): string => {
  switch (err) {
    case 'not-your-turn':
      return "It's not your turn yet."
    case 'hero-unavailable':
      return 'That hero was just taken.'
    case 'game-not-drafting':
      return 'This game is no longer accepting picks.'
    case 'invalid-token':
      return 'Your player link is invalid.'
    case 'game-not-found':
      return 'Game not found.'
    case 'not-in-hand':
      return "That hero isn't in your hand."
    case 'hero-banned':
      return 'That hero is banned.'
    case 'not-your-team':
      return "It's the other team's turn."
    default:
      return 'Could not make that pick.'
  }
}

interface FlashMessage {
  kind: 'error' | 'success'
  text: string
}

function StatusBadge({ status }: { status: GameStatus }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold uppercase tracking-wider',
        STATUS_BADGE[status],
      )}
      data-testid="status-badge"
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

interface TurnBannerProps {
  currentTurn: DraftTurn | null
  picker: PublicPlayer | null
  isComplete: boolean
}

/**
 * Generalised "current turn" indicator. Handles all draft methods:
 * - `isComplete` → "Draft Complete".
 * - No `currentTurn` → "Waiting…".
 * - Player-pick turn → action + player name, team-coloured.
 * - Collective pick turn (pick-and-ban PICK) → action + team name.
 * - Ban turn → action + team name, amber/red accent.
 *
 * The existing `data-testid="on-the-clock-banner"` is preserved; the
 * `data-testid="current-pick-banner"` span continues to carry the active
 * label (player name for player turns, team label for collective turns).
 */
interface SimultaneousBannerProps {
  pendingPlayers: PublicPlayer[]
}

/**
 * Banner for the simultaneous Single Draft mode — there's no turn order, so
 * we surface WHO is still on the clock (everyone who hasn't picked yet).
 * Team-colours each name chip for glanceability.
 */
function SimultaneousBanner({ pendingPlayers }: SimultaneousBannerProps): JSX.Element {
  return (
    <Card
      data-testid="on-the-clock-banner"
      className="flex flex-col items-center justify-center gap-3 border-2 border-amber-400/70 bg-amber-500/10 py-6 sm:flex-row sm:gap-4"
    >
      <span
        data-testid="turn-action"
        className="text-sm font-bold uppercase tracking-widest text-amber-200 sm:text-base"
      >
        Choosing
      </span>
      {pendingPlayers.length === 0 ? (
        <span
          data-testid="pending-pickers"
          className="text-2xl font-extrabold uppercase tracking-wide text-amber-200 sm:text-3xl"
        >
          Choosing…
        </span>
      ) : (
        <ul
          data-testid="pending-pickers"
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {pendingPlayers.map((p) => (
            <li
              key={p.id}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-base font-bold uppercase tracking-wide sm:text-lg',
                p.team === 'red'
                  ? 'border-red-500/60 bg-red-500/10 text-red-200'
                  : 'border-blue-500/60 bg-blue-500/10 text-blue-200',
              )}
            >
              <span
                className={cn('h-2.5 w-2.5 rounded-full', TEAM_DOT[p.team])}
                aria-hidden="true"
              />
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function TurnBanner({ currentTurn, picker, isComplete }: TurnBannerProps): JSX.Element {
  if (isComplete) {
    return (
      <Card
        data-testid="on-the-clock-banner"
        className="flex items-center justify-center border-2 border-emerald-400/70 bg-emerald-500/10 py-6"
      >
        <span className="text-3xl font-extrabold uppercase tracking-widest text-emerald-200 sm:text-4xl">
          Draft Complete
        </span>
      </Card>
    )
  }

  if (!currentTurn) {
    return (
      <Card
        data-testid="on-the-clock-banner"
        className="flex items-center justify-center border-2 border-slate-600/60 bg-slate-800/40 py-6"
      >
        <span className="text-2xl font-bold uppercase tracking-widest text-slate-300 sm:text-3xl">
          Waiting to start…
        </span>
      </Card>
    )
  }

  const isBan = currentTurn.kind === 'ban'
  const isPlayerTurn = currentTurn.kind === 'pick' && picker !== null
  const team = currentTurn.team
  // Ban turns get a red/rose accent (matches the BansSection styling); pick
  // turns keep the amber "on the clock" accent.
  const banner = isBan
    ? 'border-rose-500/70 bg-rose-500/10'
    : 'border-amber-400/70 bg-amber-500/10'
  const actionLabel = isBan ? 'BAN' : 'PICK'
  const actionTone = isBan ? 'text-rose-200' : 'text-amber-200'
  const targetLabel = isPlayerTurn ? picker.name : TEAM_LABEL[team]

  return (
    <Card
      data-testid="on-the-clock-banner"
      className={cn(
        'flex flex-col items-center justify-center gap-2 border-2 py-6 sm:flex-row sm:gap-4',
        banner,
      )}
    >
      <span
        data-testid="turn-action"
        className={cn(
          'text-sm font-bold uppercase tracking-widest sm:text-base',
          actionTone,
        )}
      >
        {actionLabel}
      </span>
      <span className="flex items-center gap-3">
        <span className={cn('h-3 w-3 rounded-full', TEAM_DOT[team])} aria-hidden="true" />
        <span
          className={cn(
            'text-3xl font-extrabold uppercase tracking-wide sm:text-5xl',
            TEAM_TEXT[team],
          )}
          data-testid="current-pick-banner"
        >
          {targetLabel}
        </span>
      </span>
    </Card>
  )
}

interface BansSectionProps {
  bans: string[]
}

/** Glanceable list of banned heroes — only rendered when there are any. */
function BansSection({ bans }: BansSectionProps): JSX.Element | null {
  if (bans.length === 0) return null
  const heroes = bans.map((id) => ({ id, hero: getHeroById(id) }))
  return (
    <section
      aria-label="Banned heroes"
      data-testid="bans-section"
      className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3"
    >
      <h2 className="text-xs font-bold uppercase tracking-widest text-red-300">Bans</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {heroes.map(({ id, hero }) => (
          <li
            key={id}
            data-testid="ban-item"
            className="rounded-full border border-red-500/40 bg-red-950/40 px-3 py-1 text-sm text-red-200/80 line-through"
          >
            {hero ? hero.name : id}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function GamePage(): JSX.Element {
  const { gameId } = useParams<{ gameId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')
  const hasToken = token != null && token !== ''

  const {
    snapshot,
    loading,
    error,
    currentPickerId,
    currentTurn,
    bans,
    playerView,
    playerViewStatus,
    isComplete,
    makePick,
  } = useGame(gameId, undefined, token ?? undefined)

  const [flash, setFlash] = useState<FlashMessage | null>(null)

  // The full game hero pool (used for all methods except single-draft where
  // the selector is constrained to the caller's private hand).
  const gamePoolHeroes = useMemo<Hero[]>(() => {
    if (!snapshot) return []
    const out: Hero[] = []
    for (const id of snapshot.game.heroPool) {
      const hero = getHeroById(id)
      if (hero) out.push(hero)
    }
    return out
  }, [snapshot])

  // Single-draft players see only their hand — never the full pool.
  const handHeroes = useMemo<Hero[] | null>(() => {
    if (!playerView || playerView.hand == null) return null
    const out: Hero[] = []
    for (const id of playerView.hand) {
      const hero = getHeroById(id)
      if (hero) out.push(hero)
    }
    return out
  }, [playerView])

  // Banned heroes count as "taken" in the selector too.
  const disabledHeroIds = useMemo<string[]>(
    () => (snapshot ? [...snapshot.picks.map((p) => p.heroId), ...bans] : []),
    [snapshot, bans],
  )

  const onPick = useCallback(
    async (heroId: string): Promise<void> => {
      if (!hasToken) return
      // Capture the turn kind BEFORE the call so the flash reflects what
      // actually happened (the snapshot advances after a successful action).
      const wasBan = currentTurn?.kind === 'ban'
      const result = await makePick(token, heroId)
      if (result.ok) {
        const hero = getHeroById(heroId)
        const name = hero ? hero.name : heroId
        setFlash({
          kind: 'success',
          text: wasBan ? `Banned ${name}.` : `Picked ${name}.`,
        })
      } else {
        setFlash({ kind: 'error', text: pickErrorMessage(result.error) })
      }
    },
    [hasToken, token, makePick, currentTurn],
  )

  if (gameId === undefined || gameId === '') {
    return (
      <PageShell>
        <Card>
          <h1 className="text-lg font-semibold text-slate-100">Game not found</h1>
          <p className="mt-2 text-sm text-slate-400">No game id was provided in the URL.</p>
        </Card>
      </PageShell>
    )
  }

  if (loading) {
    return (
      <PageShell>
        <Card aria-label="loading">
          <p className="text-sm text-slate-300" role="status">
            Loading game…
          </p>
        </Card>
      </PageShell>
    )
  }

  if (error !== null || snapshot === null) {
    return (
      <PageShell>
        <Card aria-label="game error" className="border-2 border-red-500/60 bg-red-950/30">
          <h1 className="text-lg font-semibold text-red-300">Game not found</h1>
          <p className="mt-2 text-sm text-slate-400">{error ?? 'No game matches this code.'}</p>
        </Card>
      </PageShell>
    )
  }

  const { game, players, picks } = snapshot
  const perTeam = heroesPerTeam(game.playerCount)
  const picker = currentPickerId ? (players.find((p) => p.id === currentPickerId) ?? null) : null

  // Simultaneous Single Draft: every player picks from their own hand whenever
  // they want, so the "on the clock" surface lists EVERY player who hasn't
  // picked yet (ordered by seat for a stable display).
  const pickedPlayerIds = new Set(picks.map((p) => p.playerId))
  const pendingPlayers: PublicPlayer[] = [...players]
    .filter((p) => !pickedPlayerIds.has(p.id))
    .sort((a, b) => a.seat - b.seat)

  // Selector source depends on method:
  //  - single-draft: the caller's PRIVATE hand only (token-gated; spectators
  //    and other players must never see it).
  //  - random / all-random: no selector (heroes are auto-dealt).
  //  - everything else (snake, all-pick, random-draft, pick-and-ban): the pool
  //    is PUBLIC information, so show it to everyone — board and all players —
  //    regardless of token. Picking is still gated by `canPick` below, so
  //    spectators see the pool but the Pick/Ban button is disabled for them.
  const isSingleDraft = game.method === 'single-draft'

  // Single-draft hand panel state (only relevant for a token holder during an
  // active single-draft game): spinner while fetching, error card on failure /
  // "no hand", otherwise the hand renders.
  let selectorHeroes: Hero[] | null = null
  let handPending = false
  let handError = false
  if (isSingleDraft) {
    if (hasToken && !isComplete) {
      if (playerViewStatus === 'loading') {
        handPending = true
      } else if (
        playerViewStatus === 'error' ||
        playerView === null ||
        playerView.hand === null ||
        handHeroes === null ||
        handHeroes.length === 0
      ) {
        handError = true
      } else {
        selectorHeroes = handHeroes
      }
    }
    // single-draft without a token (board view) → no selector (can't show a
    // private hand); the board still shows rosters + turn.
  } else if (game.method !== 'random' && !isComplete && gamePoolHeroes.length > 0) {
    // Public-pool methods: show the pool to everyone.
    selectorHeroes = gamePoolHeroes
  }

  const isBanTurn = currentTurn?.kind === 'ban'
  const detailActionLabel = isBanTurn ? 'Ban this hero' : 'Pick this hero'

  // During an active draft, allow the user to attempt an action. The store
  // is the authoritative gate (player-turn / team-turn / hand). We surface
  // its friendly errors via the flash.
  const canPick = hasToken && game.status === 'drafting' && !isComplete

  return (
    <PageShell>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-extrabold uppercase tracking-wide text-slate-100 sm:text-4xl">
            Guards of Atlantis II
          </h1>
          <div className="flex items-center gap-3 text-slate-400">
            <span className="text-sm font-semibold uppercase tracking-widest">Game</span>
            <code
              data-testid="game-code"
              className="rounded bg-slate-800/80 px-3 py-1 font-mono text-lg font-bold text-teal-300"
            >
              {game.id}
            </code>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={game.status} />
          <span
            data-testid="pick-progress"
            className="rounded-full border border-slate-700/60 bg-slate-800/60 px-3 py-1 text-sm font-semibold uppercase tracking-wider text-slate-200"
          >
            Pick {picks.length} of {game.playerCount}
          </span>
        </div>
      </header>

      {!isComplete && game.method === 'single-draft' ? (
        <SimultaneousBanner pendingPlayers={pendingPlayers} />
      ) : (
        <TurnBanner currentTurn={currentTurn} picker={picker} isComplete={isComplete} />
      )}

      {flash ? (
        <div
          role="alert"
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            flash.kind === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-200'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
          )}
        >
          {flash.text}
        </div>
      ) : null}

      <BansSection bans={bans} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TeamRoster
          team="red"
          players={players}
          picks={picks}
          heroesPerTeam={perTeam}
          currentPlayerId={currentPickerId}
        />
        <TeamRoster
          team="blue"
          players={players}
          picks={picks}
          heroesPerTeam={perTeam}
          currentPlayerId={currentPickerId}
        />
      </section>

      {handPending ? (
        <p
          data-testid="hand-pending"
          role="status"
          className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300"
        >
          Loading your hand…
        </p>
      ) : null}

      {handError ? (
        <Card
          aria-label="hand error"
          data-testid="hand-error"
          className="border-2 border-red-500/60 bg-red-950/30"
        >
          <h2 className="text-base font-semibold text-red-300">Couldn't load your hand</h2>
          <p className="mt-1 text-sm text-slate-300">
            We couldn't load your hand — check your player link.
          </p>
        </Card>
      ) : null}

      {selectorHeroes !== null ? (
        <section aria-label="hero selector">
          <HeroSelector
            heroes={selectorHeroes}
            pickedHeroIds={disabledHeroIds}
            canPick={canPick}
            actionLabel={detailActionLabel}
            onPick={(heroId) => {
              void onPick(heroId)
            }}
          />
        </section>
      ) : null}
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 bg-slate-950 p-4 text-slate-100 sm:p-6">
      {children}
    </main>
  )
}
