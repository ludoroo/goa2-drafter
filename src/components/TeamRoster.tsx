import type { JSX } from 'react'
import type { Hero, Pick, PublicPlayer, TeamId } from '@/types'
import { getHeroById } from '@/data/heroes'
import { Card, cn } from '@/components/ui'

export interface TeamRosterProps {
  team: TeamId
  players: PublicPlayer[]
  picks: Pick[]
  heroesPerTeam: number
  currentPlayerId?: string | null
  title?: string
  handicap?: boolean
}

const TEAM_DEFAULT_TITLE: Record<TeamId, string> = {
  red: 'Red Team',
  blue: 'Blue Team',
}

const TEAM_ACCENT: Record<TeamId, { border: string; heading: string; dot: string }> = {
  red: {
    border: 'border-red-500/50',
    heading: 'text-red-300',
    dot: 'bg-red-500',
  },
  blue: {
    border: 'border-blue-500/50',
    heading: 'text-blue-300',
    dot: 'bg-blue-500',
  },
}

function starsLabel(n: number): string {
  return '★'.repeat(n)
}

function HeroLine({ hero }: { hero: Hero }): JSX.Element {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="truncate text-sm font-medium text-slate-100">{hero.name}</span>
      <span
        className="shrink-0 text-xs text-amber-300"
        aria-label={`${hero.stars} star complexity`}
      >
        {starsLabel(hero.stars)}
      </span>
    </div>
  )
}

function EmptySlot(): JSX.Element {
  return <span className="text-sm italic text-slate-500">drafting…</span>
}

export function TeamRoster({
  team,
  players,
  picks,
  heroesPerTeam,
  currentPlayerId = null,
  title,
  handicap = false,
}: TeamRosterProps): JSX.Element {
  const accent = TEAM_ACCENT[team]
  const headingTitle = title ?? TEAM_DEFAULT_TITLE[team]

  const teamPlayers = players
    .filter((p) => p.team === team)
    .slice()
    .sort((a, b) => a.seat - b.seat)

  const pickByPlayerId = new Map<string, Pick>()
  for (const pick of picks) {
    pickByPlayerId.set(pick.playerId, pick)
  }

  const pickedCount = teamPlayers.reduce((acc, p) => acc + (pickByPlayerId.has(p.id) ? 1 : 0), 0)

  return (
    <Card
      className={cn('flex flex-col gap-3 border-2', accent.border)}
      aria-label={`${headingTitle} roster`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('h-2.5 w-2.5 rounded-full', accent.dot)} aria-hidden="true" />
          <h2
            className={cn(
              'truncate text-base font-semibold uppercase tracking-wide',
              accent.heading,
            )}
          >
            {headingTitle}
          </h2>
          {handicap ? (
            <span
              data-testid="handicap-badge"
              aria-label="Larger team replaces a basic card with a Handicap card."
              title="Larger team replaces a basic card with a Handicap card."
              className="shrink-0 rounded-full border border-amber-400/70 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200"
            >
              ⚑ Handicap cards
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-400">
          {pickedCount} / {heroesPerTeam} picked
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {teamPlayers.map((player) => {
          const pick = pickByPlayerId.get(player.id)
          const hero = pick ? getHeroById(pick.heroId) : undefined
          const isCurrent = currentPlayerId != null && player.id === currentPlayerId

          return (
            <li
              key={player.id}
              data-testid={`roster-slot-${player.id}`}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors',
                isCurrent
                  ? cn(
                      'border-amber-400/70 bg-amber-500/10 shadow-md shadow-amber-900/30',
                      'animate-pulse motion-reduce:animate-none',
                    )
                  : 'border-slate-700/60 bg-slate-900/40',
              )}
            >
              <div className="flex flex-col min-w-0">
                <span className="truncate text-sm font-medium text-slate-200">{player.name}</span>
                <div className="mt-0.5 min-w-0">
                  {hero ? <HeroLine hero={hero} /> : <EmptySlot />}
                </div>
              </div>
              {isCurrent ? (
                <span
                  className="shrink-0 rounded-full border border-amber-400/70 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200"
                  aria-label="on the clock"
                >
                  On the clock
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
