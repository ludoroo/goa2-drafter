import { useCallback, useMemo, useState } from 'react'
import type { Hero, HeroPackId, Role, Stars } from '@/types'

export type HeroSortKey =
  | 'name'
  | 'stars'
  | 'attack'
  | 'initiative'
  | 'defense'
  | 'movement'
  | 'total'

export interface HeroFilterState {
  search: string
  stars: Stars[]
  roles: Role[]
  packs: HeroPackId[]
  sortBy: HeroSortKey
  sortDir: 'asc' | 'desc'
}

export const EMPTY_FILTERS: HeroFilterState = {
  search: '',
  stars: [],
  roles: [],
  packs: [],
  sortBy: 'name',
  sortDir: 'asc',
}

const STAT_KEYS: readonly HeroSortKey[] = [
  'attack',
  'initiative',
  'defense',
  'movement',
  'total',
] as const

function compareHeroes(a: Hero, b: Hero, key: HeroSortKey): number {
  if (key === 'name') return a.name.localeCompare(b.name)
  if (key === 'stars') return a.stars - b.stars
  // Stat keys — compare StatValue.base
  return a.stats[key].base - b.stats[key].base
}

/**
 * Pure: filter and sort heroes according to `state`.
 * Returns a new array; does not mutate input. Sort is stable (uses index
 * tie-breaker when comparator returns 0).
 */
export function filterAndSortHeroes(heroes: Hero[], state: HeroFilterState): Hero[] {
  const needle = state.search.trim().toLowerCase()

  const filtered = heroes.filter((h) => {
    if (needle.length > 0 && !h.name.toLowerCase().includes(needle)) return false
    if (state.stars.length > 0 && !state.stars.includes(h.stars)) return false
    if (state.roles.length > 0 && !state.roles.some((r) => h.roles.includes(r))) return false
    if (state.packs.length > 0 && !state.packs.includes(h.pack)) return false
    return true
  })

  // Stable sort via decorate-sort-undecorate.
  const decorated = filtered.map((h, i) => ({ h, i }))
  const dir = state.sortDir === 'asc' ? 1 : -1
  decorated.sort((a, b) => {
    const cmp = compareHeroes(a.h, b.h, state.sortBy)
    if (cmp !== 0) return cmp * dir
    return a.i - b.i
  })
  return decorated.map((d) => d.h)
}

export interface UseHeroFiltersResult {
  state: HeroFilterState
  setState: (next: HeroFilterState) => void
  setSearch: (s: string) => void
  toggleStar: (s: Stars) => void
  toggleRole: (r: Role) => void
  togglePack: (p: HeroPackId) => void
  setSort: (k: HeroSortKey) => void
  reset: () => void
  results: Hero[]
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function useHeroFilters(
  allHeroes: Hero[],
  initial?: Partial<HeroFilterState>,
): UseHeroFiltersResult {
  const [state, setState] = useState<HeroFilterState>(() => ({ ...EMPTY_FILTERS, ...initial }))

  const setSearch = useCallback((s: string): void => {
    setState((prev) => ({ ...prev, search: s }))
  }, [])

  const toggleStar = useCallback((s: Stars): void => {
    setState((prev) => ({ ...prev, stars: toggle(prev.stars, s) }))
  }, [])

  const toggleRole = useCallback((r: Role): void => {
    setState((prev) => ({ ...prev, roles: toggle(prev.roles, r) }))
  }, [])

  const togglePack = useCallback((p: HeroPackId): void => {
    setState((prev) => ({ ...prev, packs: toggle(prev.packs, p) }))
  }, [])

  const setSort = useCallback((k: HeroSortKey): void => {
    setState((prev) => {
      if (prev.sortBy === k) {
        return { ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' }
      }
      return { ...prev, sortBy: k, sortDir: 'asc' }
    })
  }, [])

  const reset = useCallback((): void => {
    setState(EMPTY_FILTERS)
  }, [])

  const results = useMemo(() => filterAndSortHeroes(allHeroes, state), [allHeroes, state])

  return { state, setState, setSearch, toggleStar, toggleRole, togglePack, setSort, reset, results }
}

// Re-exported for downstream callers that want to know which keys are stat-backed.
export { STAT_KEYS }
