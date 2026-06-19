import type { ChangeEvent } from 'react'
import type { HeroFilterState, HeroSortKey } from '@/hooks/useHeroFilters'
import type { HeroPackId, Role, Stars } from '@/types'
import { HERO_PACKS } from '@/data/packs'
import { Button, Chip } from '@/components/ui'

export interface FilterBarProps {
  state: HeroFilterState
  onSetSearch: (s: string) => void
  onToggleStar: (s: Stars) => void
  onToggleRole: (r: Role) => void
  onTogglePack: (p: HeroPackId) => void
  onSetSort: (k: HeroSortKey) => void
  onReset: () => void
  resultCount: number
}

const ALL_STARS: readonly Stars[] = [1, 2, 3, 4] as const

const ALL_ROLES: readonly Role[] = [
  'Tactician',
  'Disabler',
  'Durable',
  'Pusher',
  'Melee',
  'Farming',
  'Damager',
  'Sniper',
  'Healer',
  'Tokens',
] as const

const SORT_KEYS: readonly { key: HeroSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'stars', label: 'Stars' },
  { key: 'attack', label: 'Atk' },
  { key: 'initiative', label: 'Init' },
  { key: 'defense', label: 'Def' },
  { key: 'movement', label: 'Mov' },
  { key: 'total', label: 'Total' },
] as const

function starsLabel(n: Stars): string {
  return '★'.repeat(n)
}

export function FilterBar({
  state,
  onSetSearch,
  onToggleStar,
  onToggleRole,
  onTogglePack,
  onSetSort,
  onReset,
  resultCount,
}: FilterBarProps) {
  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onSetSearch(e.target.value)
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-slate-100">
      {/* Search + result count */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-1 min-w-[12rem] items-center gap-2">
          <span className="sr-only">Search</span>
          <input
            type="text"
            aria-label="Search heroes"
            placeholder="Search heroes…"
            value={state.search}
            onChange={handleSearchChange}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </label>
        <span className="text-sm font-medium text-amber-300" aria-live="polite">
          {resultCount} heroes
        </span>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
      </div>

      {/* Stars */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Stars</span>
        {ALL_STARS.map((s) => (
          <Chip
            key={s}
            label={starsLabel(s)}
            tone="gold"
            selected={state.stars.includes(s)}
            onClick={() => onToggleStar(s)}
          />
        ))}
      </div>

      {/* Roles */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Roles</span>
        {ALL_ROLES.map((r) => (
          <Chip
            key={r}
            label={r}
            selected={state.roles.includes(r)}
            onClick={() => onToggleRole(r)}
          />
        ))}
      </div>

      {/* Packs */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Packs</span>
        {HERO_PACKS.map((pack) => (
          <Chip
            key={pack.id}
            label={pack.name}
            selected={state.packs.includes(pack.id)}
            onClick={() => onTogglePack(pack.id)}
          />
        ))}
      </div>

      {/* Sort */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">Sort</span>
        {SORT_KEYS.map(({ key, label }) => (
          <Chip
            key={key}
            label={label}
            tone="gold"
            selected={state.sortBy === key}
            onClick={() => onSetSort(key)}
          />
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSetSort(state.sortBy)}
          aria-label={`Sort direction: ${state.sortDir}`}
        >
          {state.sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </Button>
      </div>
    </div>
  )
}
