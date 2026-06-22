import type { JSX } from 'react'
import type { Hero, Role } from '@/types'
import { Button, Card, Chip, StatBar, cn } from '@/components/ui'
import { HERO_PACKS } from '@/data/packs'
import { heroImageUrl, heroMonogram, heroPlaceholderStyle } from '@/utils/heroArt'

export interface HeroDetailCardProps {
  hero: Hero
  canPick?: boolean
  onPick?: () => void
  onClose?: () => void
  /** Label for the primary action button. Defaults to "Pick this hero". */
  actionLabel?: string
}

function packNameFor(packId: Hero['pack']): string {
  const pack = HERO_PACKS.find((p) => p.id === packId)
  return pack?.name ?? packId
}

function isPrimary(hero: Hero, role: Role): boolean {
  return hero.primaryRoles.includes(role)
}

export function HeroDetailCard({
  hero,
  canPick = false,
  onPick,
  onClose,
  actionLabel = 'Pick this hero',
}: HeroDetailCardProps): JSX.Element {
  const placeholder = heroPlaceholderStyle(hero.id)
  const portraitUrl = heroImageUrl(hero.imageId)
  const monogram = heroMonogram(hero.name)
  const packName = packNameFor(hero.pack)

  return (
    <Card
      className={cn(
        'relative flex w-full max-w-3xl flex-col gap-6 overflow-hidden border-slate-700/60 bg-slate-900/90 p-6 text-slate-100 sm:min-h-[22rem] sm:flex-row',
      )}
    >
      <button
        type="button"
        aria-label="Close hero details"
        onClick={onClose}
        className="absolute right-3 top-3 z-20 rounded-full border border-slate-700/60 bg-slate-900/80 px-2.5 py-1 text-sm text-slate-300 shadow-md transition-colors hover:border-teal-400/70 hover:bg-slate-800 hover:text-teal-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
      >
        ×
      </button>

      {/* Portrait — fixed size (matches the 3:4 card art) so every hero's
          box is identical regardless of how much body content there is. */}
      <div className="relative aspect-[3/4] w-full shrink-0 self-start overflow-hidden rounded-lg bg-slate-950 ring-1 ring-slate-700/60 sm:w-56">
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-7xl font-black text-slate-100/30"
          style={placeholder}
        >
          {monogram}
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${portraitUrl})` }}
        />
      </div>

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight text-slate-50">{hero.name}</h2>
          <p className="text-sm uppercase tracking-[0.2em] text-teal-300/80">{packName}</p>
        </header>

        <div className="flex flex-wrap gap-2" aria-label="Roles">
          {hero.roles.map((role) => (
            <Chip
              key={role}
              label={role}
              tone={isPrimary(hero, role) ? 'gold' : 'default'}
              selected={isPrimary(hero, role)}
              static
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatBar
            label="Attack"
            value={hero.stats.attack.base}
            upgraded={hero.stats.attack.upgraded}
          />
          <StatBar
            label="Initiative"
            value={hero.stats.initiative.base}
            upgraded={hero.stats.initiative.upgraded}
          />
          <StatBar
            label="Defense"
            value={hero.stats.defense.base}
            upgraded={hero.stats.defense.upgraded}
          />
          <StatBar
            label="Movement"
            value={hero.stats.movement.base}
            upgraded={hero.stats.movement.upgraded}
          />
          <div className="sm:col-span-2">
            <StatBar
              label="Total"
              value={hero.stats.total.base}
              upgraded={hero.stats.total.upgraded}
              max={32}
            />
          </div>
        </div>

        <div className="mt-auto flex items-center justify-end gap-3 pt-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!canPick}
            onClick={canPick ? onPick : undefined}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </Card>
  )
}
