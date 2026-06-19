/**
 * SetupPage — supports TWO routes (both must be registered in the app router):
 *
 *   1. `/setup`                            → fresh wizard for a new game
 *   2. `/setup/:gameId?t=<organiserToken>` → organiser dashboard for an
 *                                            already-created game (re-renders
 *                                            shareable links without re-running
 *                                            the wizard)
 *
 * Mode is selected by the presence of the `:gameId` URL param. The dashboard
 * branch loads the public snapshot via `gameStore.getSnapshot` and shows the
 * board link + organiser link + player roster. Per-player magic-link tokens
 * are intentionally NOT reconstructed — they are private auth material that
 * `getSnapshot` never returns. Players who lost their link must ask the
 * organiser, who saw the full link list at creation time.
 */
import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import type {
  CreateGameInput,
  DraftMethod,
  Game,
  GameSnapshot,
  Player,
  PublicPlayer,
  TeamId,
} from '@/types'
import { HERO_PACKS } from '@/data/packs'
import { HEROES } from '@/data/heroes'
import { minimumPoolSize } from '@/services/draft'
import { gameStore } from '@/services/store'
import { shuffleArray } from '@/utils/shuffle'
import { Button, Card, Chip, cn } from '@/components/ui'

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const PLAYER_COUNTS = [4, 6, 8, 10] as const
type PlayerCount = (typeof PLAYER_COUNTS)[number]

interface PlayerDraft {
  name: string
  team: TeamId | null
}

/**
 * Build a shareable absolute URL for a router-relative path. Strips the leading
 * slash so the result composes correctly with the Vite `BASE_URL` (which
 * always has a trailing slash).
 */
function buildShareUrl(path: string): string {
  const base = import.meta.env.BASE_URL
  const trimmedPath = path.startsWith('/') ? path.slice(1) : path
  return `${window.location.origin}${base}${trimmedPath}`
}

const HERO_NAMES_BY_ID: ReadonlyMap<string, string> = new Map(
  HEROES.map((h) => [h.id, h.name]),
)

// ---------------------------------------------------------------------------
// Result of a successful createGame call — what the final wizard step renders.
// ---------------------------------------------------------------------------

interface CreatedGame {
  game: Game
  organiserToken: string
  players: Player[]
}

// ---------------------------------------------------------------------------
// Step 1: Players
// ---------------------------------------------------------------------------

interface Step1Props {
  playerCount: PlayerCount
  setPlayerCount: (n: PlayerCount) => void
  players: PlayerDraft[]
  setPlayers: (next: PlayerDraft[]) => void
}

function Step1Players({
  playerCount,
  setPlayerCount,
  players,
  setPlayers,
}: Step1Props): JSX.Element {
  return (
    <Card>
      <h2 className="mb-4 text-xl font-semibold text-teal-300">Step 1 — Players</h2>
      <p className="mb-3 text-sm text-slate-400">
        Even-numbered groups only. Pick a count, then enter each player&apos;s name.
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        {PLAYER_COUNTS.map((n) => (
          <Chip
            key={n}
            label={`${n} players`}
            selected={playerCount === n}
            onClick={() => {
              setPlayerCount(n)
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {players.map((p, i) => (
          <label key={i} className="flex flex-col gap-1 text-sm text-slate-300">
            <span className="font-medium">Player {i + 1}</span>
            <input
              type="text"
              value={p.name}
              onChange={(e) => {
                const next = players.slice()
                next[i] = { ...p, name: e.target.value }
                setPlayers(next)
              }}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-teal-500"
              aria-label={`Player ${i + 1} name`}
            />
          </label>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Teams
// ---------------------------------------------------------------------------

interface Step2Props {
  players: PlayerDraft[]
  setPlayers: (next: PlayerDraft[]) => void
}

function Step2Teams({ players, setPlayers }: Step2Props): JSX.Element {
  const redCount = players.filter((p) => p.team === 'red').length
  const blueCount = players.filter((p) => p.team === 'blue').length
  const target = players.length / 2
  const balanced = redCount === target && blueCount === target

  const randomise = (): void => {
    const indexes = shuffleArray(players.map((_, i) => i))
    const half = players.length / 2
    const next = players.map((p) => ({ ...p, team: null as TeamId | null }))
    for (let k = 0; k < indexes.length; k++) {
      const idx = indexes[k] as number
      next[idx] = { ...(next[idx] as PlayerDraft), team: k < half ? 'red' : 'blue' }
    }
    setPlayers(next)
  }

  const assign = (index: number, team: TeamId): void => {
    const next = players.slice()
    const current = next[index] as PlayerDraft
    // Toggle off if tapping the team the player is already on.
    next[index] = { ...current, team: current.team === team ? null : team }
    setPlayers(next)
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-teal-300">Step 2 — Teams</h2>
        <Button variant="secondary" size="sm" onClick={randomise}>
          Randomise teams
        </Button>
      </div>
      <p className="mb-6 text-sm text-slate-400">
        Assign each player to Red or Blue, or hit randomise for an even split. Each team needs{' '}
        {target} players.
      </p>

      <div className="space-y-2">
        {players.map((p, i) => {
          const redFull = redCount >= target && p.team !== 'red'
          const blueFull = blueCount >= target && p.team !== 'blue'
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-900/50 p-3"
            >
              <span className="font-medium text-slate-200">{p.name || `Player ${i + 1}`}</span>
              <div className="flex gap-2">
                <Chip
                  label="Red"
                  tone="red"
                  selected={p.team === 'red'}
                  onClick={() => {
                    if (!redFull) assign(i, 'red')
                  }}
                />
                <Chip
                  label="Blue"
                  tone="blue"
                  selected={p.team === 'blue'}
                  onClick={() => {
                    if (!blueFull) assign(i, 'blue')
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div
        className={cn(
          'mt-4 rounded-md border p-3 text-sm',
          balanced
            ? 'border-teal-700 bg-teal-950/40 text-teal-200'
            : 'border-amber-700 bg-amber-950/40 text-amber-200',
        )}
        role="status"
      >
        Red: {redCount} &middot; Blue: {blueCount}{' '}
        {balanced ? '— teams are balanced.' : `— assign ${target} players to each side.`}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 3: Hero pool
// ---------------------------------------------------------------------------

interface Step3Props {
  selected: Set<string>
  setSelected: (next: Set<string>) => void
  minimum: number
}

function Step3HeroPool({ selected, setSelected, minimum }: Step3Props): JSX.Element {
  const togglePack = (heroIds: string[], allOn: boolean): void => {
    const next = new Set(selected)
    if (allOn) {
      for (const id of heroIds) next.delete(id)
    } else {
      for (const id of heroIds) next.add(id)
    }
    setSelected(next)
  }

  const toggleHero = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const allHeroIds = useMemo(() => HERO_PACKS.flatMap((pack) => pack.heroIds), [])
  const allSelected = allHeroIds.length > 0 && allHeroIds.every((id) => selected.has(id))

  const selectAll = (): void => {
    setSelected(new Set(allHeroIds))
  }

  const clearAll = (): void => {
    setSelected(new Set())
  }

  const enough = selected.size >= minimum

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-teal-300">Step 3 — Hero pool</h2>
        <p
          className={cn('text-sm font-medium', enough ? 'text-teal-300' : 'text-amber-300')}
          aria-live="polite"
        >
          Selected {selected.size} / need &gt;= {minimum}
        </p>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        Add every hero, whole packs, or pick individuals. A small buffer over the minimum keeps the
        draft interesting.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={allSelected ? clearAll : selectAll}
          aria-label={allSelected ? 'Clear all heroes' : 'Select all heroes'}
        >
          {allSelected ? 'Clear all heroes' : 'Select all heroes'}
        </Button>
        {selected.size > 0 && !allSelected && (
          <Button variant="ghost" size="sm" onClick={clearAll} aria-label="Clear all heroes">
            Clear all
          </Button>
        )}
      </div>

      <div className="space-y-5">
        {HERO_PACKS.map((pack) => {
          const allOn =
            pack.heroIds.length > 0 && pack.heroIds.every((id) => selected.has(id))
          return (
            <div key={pack.id} className="rounded-lg border border-slate-700 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-semibold text-slate-100">{pack.name}</h3>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    togglePack(pack.heroIds, allOn)
                  }}
                  aria-label={`${allOn ? 'Deselect' : 'Select'} all in ${pack.name}`}
                >
                  {allOn ? 'Deselect all' : 'Select all'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {pack.heroIds.map((id) => {
                  const name = HERO_NAMES_BY_ID.get(id) ?? id
                  return (
                    <Chip
                      key={id}
                      label={name}
                      selected={selected.has(id)}
                      onClick={() => {
                        toggleHero(id)
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 4: Method
// ---------------------------------------------------------------------------

interface Step4Props {
  method: DraftMethod
  setMethod: (m: DraftMethod) => void
}

function Step4Method({ method, setMethod }: Step4Props): JSX.Element {
  return (
    <Card>
      <h2 className="mb-4 text-xl font-semibold text-teal-300">Step 4 — Draft method</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setMethod('snake')
          }}
          className={cn(
            'rounded-lg border p-4 text-left transition-colors',
            method === 'snake'
              ? 'border-teal-400 bg-teal-950/40'
              : 'border-slate-700 bg-slate-900/50 hover:border-slate-500',
          )}
          aria-pressed={method === 'snake'}
        >
          <div className="text-lg font-semibold text-teal-200">Snake</div>
          <p className="mt-1 text-sm text-slate-400">
            Players take turns picking heroes in A-B-B-A order. Best for the full GoA2 experience.
          </p>
        </button>
        <button
          type="button"
          onClick={() => {
            setMethod('random')
          }}
          className={cn(
            'rounded-lg border p-4 text-left transition-colors',
            method === 'random'
              ? 'border-amber-400 bg-amber-950/40'
              : 'border-slate-700 bg-slate-900/50 hover:border-slate-500',
          )}
          aria-pressed={method === 'random'}
        >
          <div className="text-lg font-semibold text-amber-200">Random</div>
          <p className="mt-1 text-sm text-slate-400">
            Each player is dealt a random hero from the pool &mdash; instant lineup, no drafting.
          </p>
        </button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 5: Generate / share
// ---------------------------------------------------------------------------

type CopyState = 'idle' | 'copied' | 'failed'

interface ShareLinkRowProps {
  label: string
  path: string
}

/**
 * A single shareable link with a Copy button. The copy handler is async and
 * fully error-handled: on success we flash "Copied!" for ~2s; on failure (or
 * when `navigator.clipboard` is unavailable) we surface a fallback message
 * telling the user to copy manually. No unhandled rejections, ever.
 */
function ShareLinkRow({ label, path }: ShareLinkRowProps): JSX.Element {
  const url = buildShareUrl(path)
  const [state, setState] = useState<CopyState>('idle')
  const clipboardAvailable =
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'

  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => {
      setState('idle')
    }, 2000)
    return () => {
      clearTimeout(t)
    }
  }, [state])

  const handleCopy = async (): Promise<void> => {
    if (!clipboardAvailable) {
      setState('failed')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-700 bg-slate-900/50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-slate-100">{label}</div>
        <div className="truncate text-xs text-slate-400">{url}</div>
        {state === 'copied' && (
          <div className="mt-1 text-xs font-medium text-teal-300" role="status">
            Copied!
          </div>
        )}
        {state === 'failed' && (
          <div className="mt-1 text-xs font-medium text-amber-300" role="status">
            Copy failed — select and copy manually.
          </div>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void handleCopy()
        }}
        disabled={!clipboardAvailable}
        aria-label={`Copy ${label} link`}
      >
        Copy
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wizard success panel — full per-player magic links (we still have tokens).
// ---------------------------------------------------------------------------

interface WizardSuccessProps {
  created: CreatedGame
}

function WizardSuccess({ created }: WizardSuccessProps): JSX.Element {
  const { game, organiserToken, players } = created
  return (
    <Card>
      <h2 className="mb-2 text-xl font-semibold text-teal-300">Game created!</h2>
      <p className="mb-4 text-sm text-slate-400">
        Game code <span className="font-mono text-amber-300">{game.id}</span>. Share these links
        with your group &mdash; anyone with a link can join.
      </p>

      <h3 className="mt-4 mb-2 font-semibold text-slate-100">Board</h3>
      <ShareLinkRow label="Shared board view" path={`/play/${game.id}`} />

      <h3 className="mt-6 mb-2 font-semibold text-slate-100">
        {game.method === 'random' ? 'Player links (heroes already assigned)' : 'Player links'}
      </h3>
      <div className="space-y-2">
        {players.map((p) => (
          <ShareLinkRow
            key={p.id}
            label={`${p.name} (${p.team})`}
            path={`/play/${game.id}?t=${p.token}`}
          />
        ))}
      </div>

      <h3 className="mt-6 mb-2 font-semibold text-slate-100">Organiser</h3>
      <ShareLinkRow
        label="Organiser link (keep private)"
        path={`/setup/${game.id}?t=${organiserToken}`}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Organiser dashboard — for `/setup/:gameId`. Re-renders share links from
// the public snapshot. Per-player tokens are NOT available from a snapshot
// (they're private), so we show the player roster and a note explaining
// where the magic links came from.
// ---------------------------------------------------------------------------

type DashboardLoad =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'ready'; snapshot: GameSnapshot }

interface OrganiserDashboardProps {
  gameId: string
  organiserToken: string | null
}

function OrganiserDashboard({ gameId, organiserToken }: OrganiserDashboardProps): JSX.Element {
  // The parent passes `key={gameId}` so this component remounts when gameId
  // changes — that means initial state ('loading') is the correct value for
  // every gameId without a manual reset inside the effect.
  const [load, setLoad] = useState<DashboardLoad>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void gameStore
      .getSnapshot(gameId)
      .then((snap) => {
        if (cancelled) return
        if (!snap) setLoad({ status: 'not-found' })
        else setLoad({ status: 'ready', snapshot: snap })
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'not-found' })
      })
    return () => {
      cancelled = true
    }
  }, [gameId])

  if (load.status === 'loading') {
    return (
      <Card>
        <p className="text-sm text-slate-300">Loading game…</p>
      </Card>
    )
  }

  if (load.status === 'not-found') {
    return (
      <Card>
        <h2 className="mb-2 text-xl font-semibold text-amber-300">Game not found</h2>
        <p className="text-sm text-slate-300">
          We couldn&apos;t find a game with code{' '}
          <span className="font-mono text-amber-200">{gameId}</span>. Double-check the link, or
          start a new game from the home page.
        </p>
      </Card>
    )
  }

  const { snapshot } = load
  const orderedPlayers: PublicPlayer[] = [...snapshot.players].sort((a, b) => a.seat - b.seat)

  return (
    <Card>
      <h2 className="mb-2 text-xl font-semibold text-teal-300">Organiser dashboard</h2>
      <p className="mb-4 text-sm text-slate-400">
        Game code <span className="font-mono text-amber-300">{snapshot.game.id}</span> &mdash;
        method <span className="text-slate-200">{snapshot.game.method}</span>, status{' '}
        <span className="text-slate-200">{snapshot.game.status}</span>.
      </p>

      <h3 className="mt-4 mb-2 font-semibold text-slate-100">Board</h3>
      <ShareLinkRow label="Shared board view" path={`/play/${snapshot.game.id}`} />

      <h3 className="mt-6 mb-2 font-semibold text-slate-100">Organiser</h3>
      {organiserToken ? (
        <ShareLinkRow
          label="Organiser link (keep private)"
          path={`/setup/${snapshot.game.id}?t=${organiserToken}`}
        />
      ) : (
        <p className="text-sm text-amber-300">
          Organiser token missing from this URL. The board link above still works.
        </p>
      )}

      <h3 className="mt-6 mb-2 font-semibold text-slate-100">Players</h3>
      <p className="mb-2 text-xs text-slate-400">
        Per-player magic links were shown once at creation time and aren&apos;t recoverable here
        for security reasons. If a player lost their link, regenerate the game.
      </p>
      <ul className="space-y-1">
        {orderedPlayers.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm"
          >
            <span className="font-medium text-slate-100">{p.name}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-semibold',
                p.team === 'red'
                  ? 'bg-red-900/50 text-red-200'
                  : 'bg-blue-900/50 text-blue-200',
              )}
            >
              {p.team}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Wizard branch — the original 5-step flow.
// ---------------------------------------------------------------------------

const STEP_LABELS = ['Players', 'Teams', 'Hero pool', 'Method', 'Generate'] as const

function buildInitialPlayers(count: PlayerCount): PlayerDraft[] {
  return Array.from({ length: count }, (_, i) => ({ name: `Player ${i + 1}`, team: null }))
}

function SetupWizard(): JSX.Element {
  const [step, setStep] = useState(0)
  const [playerCount, setPlayerCountState] = useState<PlayerCount>(4)
  const [players, setPlayers] = useState<PlayerDraft[]>(() => buildInitialPlayers(4))
  const [selectedHeroes, setSelectedHeroes] = useState<Set<string>>(new Set())
  const [method, setMethod] = useState<DraftMethod>('snake')
  const [created, setCreated] = useState<CreatedGame | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const minimum = useMemo(() => minimumPoolSize(playerCount), [playerCount])

  const setPlayerCount = (n: PlayerCount): void => {
    setPlayerCountState(n)
    setPlayers(buildInitialPlayers(n))
  }

  // ---- step validation --------------------------------------------------

  const step1Valid = players.every((p) => p.name.trim().length > 0)

  const redCount = players.filter((p) => p.team === 'red').length
  const blueCount = players.filter((p) => p.team === 'blue').length
  const teamsBalanced = redCount === playerCount / 2 && blueCount === playerCount / 2
  const step2Valid = teamsBalanced

  const step3Valid = selectedHeroes.size >= minimum

  const stepValid = [step1Valid, step2Valid, step3Valid, true, true]

  // ---- generate ---------------------------------------------------------

  const generate = async (): Promise<void> => {
    setIsGenerating(true)
    setError(null)
    try {
      // Shuffle seat order so snake pick order isn't trivially the input order.
      const seatOrder = shuffleArray(players.map((_, i) => i))
      const built: CreateGameInput = {
        playerCount,
        method,
        heroPool: Array.from(selectedHeroes),
        players: players.map((p, i) => ({
          name: p.name.trim() || `Player ${i + 1}`,
          team: (p.team ?? 'red') as TeamId,
          seat: seatOrder.indexOf(i),
        })),
      }
      const result = await gameStore.createGame(built)
      setCreated(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      setError(`Could not create game: ${message}`)
    } finally {
      setIsGenerating(false)
    }
  }

  // ---- render -----------------------------------------------------------

  const renderStep = (): JSX.Element => {
    if (created) return <WizardSuccess created={created} />
    switch (step) {
      case 0:
        return (
          <Step1Players
            playerCount={playerCount}
            setPlayerCount={setPlayerCount}
            players={players}
            setPlayers={setPlayers}
          />
        )
      case 1:
        return <Step2Teams players={players} setPlayers={setPlayers} />
      case 2:
        return (
          <Step3HeroPool
            selected={selectedHeroes}
            setSelected={setSelectedHeroes}
            minimum={minimum}
          />
        )
      case 3:
        return <Step4Method method={method} setMethod={setMethod} />
      case 4:
      default:
        return (
          <Card>
            <h2 className="mb-3 text-xl font-semibold text-teal-300">Step 5 — Generate</h2>
            <p className="mb-4 text-sm text-slate-300">Review your setup, then create the game.</p>
            <ul className="mb-4 space-y-1 text-sm text-slate-300">
              <li>
                <span className="text-slate-400">Players:</span> {playerCount}
              </li>
              <li>
                <span className="text-slate-400">Method:</span> {method}
              </li>
              <li>
                <span className="text-slate-400">Hero pool size:</span> {selectedHeroes.size}
              </li>
            </ul>
            {error && (
              <div
                role="alert"
                className="mb-3 rounded-md border border-red-700 bg-red-950/50 p-3 text-sm text-red-200"
              >
                {error}
              </div>
            )}
            <Button
              onClick={() => {
                void generate()
              }}
              disabled={isGenerating || !step1Valid || !step2Valid || !step3Valid}
            >
              {isGenerating ? 'Generating…' : 'Generate game'}
            </Button>
          </Card>
        )
    }
  }

  const showWizardChrome = !created

  return (
    <>
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-teal-300">Set up a new game</h1>
        {showWizardChrome && (
          <ol className="mt-3 flex flex-wrap gap-2 text-xs">
            {STEP_LABELS.map((label, i) => (
              <li
                key={label}
                className={cn(
                  'rounded-full border px-2 py-0.5',
                  i === step
                    ? 'border-teal-400 bg-teal-950/60 text-teal-200'
                    : i < step
                      ? 'border-slate-600 bg-slate-800 text-slate-300'
                      : 'border-slate-700 bg-slate-900 text-slate-500',
                )}
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        )}
      </header>

      {renderStep()}

      {showWizardChrome && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              setStep((s) => Math.max(0, s - 1))
            }}
            disabled={step === 0}
          >
            Back
          </Button>
          {!stepValid[step] && (
            <p role="alert" className="text-sm text-amber-300" data-testid="step-validation">
              {step === 0 && 'Every player needs a name.'}
              {step === 1 &&
                `Teams must be balanced — assign ${playerCount / 2} players to each side.`}
              {step === 2 &&
                `Select at least ${minimum} heroes (currently ${selectedHeroes.size}).`}
            </p>
          )}
          {step < 4 ? (
            <Button
              onClick={() => {
                setStep((s) => Math.min(4, s + 1))
              }}
              disabled={!stepValid[step]}
            >
              Next
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Top-level component — branches between wizard and dashboard by URL param.
// ---------------------------------------------------------------------------

export function SetupPage(): JSX.Element {
  const params = useParams<{ gameId?: string }>()
  const [searchParams] = useSearchParams()
  const gameId = params.gameId
  const organiserToken = searchParams.get('t')

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {gameId ? (
          <OrganiserDashboard
            key={gameId}
            gameId={gameId}
            organiserToken={organiserToken}
          />
        ) : (
          <SetupWizard />
        )}
      </div>
    </div>
  )
}
