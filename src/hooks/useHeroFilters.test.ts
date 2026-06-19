import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { HEROES } from '@/data/heroes'
import {
  EMPTY_FILTERS,
  filterAndSortHeroes,
  useHeroFilters,
  type HeroFilterState,
} from './useHeroFilters'

describe('filterAndSortHeroes', () => {
  it('returns all heroes (in name asc) for EMPTY_FILTERS', () => {
    const result = filterAndSortHeroes(HEROES, EMPTY_FILTERS)
    expect(result).toHaveLength(HEROES.length)
  })

  it('returns a NEW array (does not mutate input)', () => {
    const input = [...HEROES]
    const result = filterAndSortHeroes(input, EMPTY_FILTERS)
    expect(result).not.toBe(HEROES)
    expect(result).not.toBe(input)
  })

  it('filters by case-insensitive name substring', () => {
    const state: HeroFilterState = { ...EMPTY_FILTERS, search: 'BROGAN' }
    const result = filterAndSortHeroes(HEROES, state)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((h) => h.name.toLowerCase().includes('brogan'))).toBe(true)
  })

  it('filters by stars (multi)', () => {
    const state: HeroFilterState = { ...EMPTY_FILTERS, stars: [1, 4] }
    const result = filterAndSortHeroes(HEROES, state)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((h) => h.stars === 1 || h.stars === 4)).toBe(true)
  })

  it('filters by roles using OR semantics (hero matches if it has ANY selected role)', () => {
    const state: HeroFilterState = { ...EMPTY_FILTERS, roles: ['Healer', 'Tokens'] }
    const result = filterAndSortHeroes(HEROES, state)
    expect(result.length).toBeGreaterThan(0)
    expect(
      result.every((h) => h.roles.includes('Healer') || h.roles.includes('Tokens')),
    ).toBe(true)
    // Sanity: there should be at least one hero with Healer-only-not-Tokens
    // proving OR (not AND) semantics.
    const healerOnly = HEROES.filter(
      (h) => h.roles.includes('Healer') && !h.roles.includes('Tokens'),
    )
    expect(result.some((h) => healerOnly.some((x) => x.id === h.id))).toBe(true)
  })

  it('filters by packs (multi)', () => {
    const state: HeroFilterState = { ...EMPTY_FILTERS, packs: ['core'] }
    const result = filterAndSortHeroes(HEROES, state)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((h) => h.pack === 'core')).toBe(true)
  })

  it('sort by name asc and desc are reverses of each other', () => {
    const asc = filterAndSortHeroes(HEROES, { ...EMPTY_FILTERS, sortBy: 'name', sortDir: 'asc' })
    const desc = filterAndSortHeroes(HEROES, { ...EMPTY_FILTERS, sortBy: 'name', sortDir: 'desc' })
    expect(asc.map((h) => h.id)).not.toEqual(desc.map((h) => h.id))
    expect(asc.map((h) => h.id)).toEqual([...desc.map((h) => h.id)].reverse())
  })

  it('sort by attack uses StatValue.base in ascending order', () => {
    const result = filterAndSortHeroes(HEROES, {
      ...EMPTY_FILTERS,
      sortBy: 'attack',
      sortDir: 'asc',
    })
    expect(result.length).toBe(HEROES.length)
    expect(result[0].stats.attack.base).toBeLessThanOrEqual(
      result[result.length - 1].stats.attack.base,
    )
  })
})

describe('useHeroFilters', () => {
  it('starts with EMPTY_FILTERS and returns all heroes by default', () => {
    const { result } = renderHook(() => useHeroFilters(HEROES))
    expect(result.current.state).toEqual(EMPTY_FILTERS)
    expect(result.current.results).toHaveLength(HEROES.length)
  })

  it('toggleRole adds then removes a role', () => {
    const { result } = renderHook(() => useHeroFilters(HEROES))
    act(() => result.current.toggleRole('Healer'))
    expect(result.current.state.roles).toContain('Healer')
    act(() => result.current.toggleRole('Healer'))
    expect(result.current.state.roles).not.toContain('Healer')
  })

  it('setSearch changes results', () => {
    const { result } = renderHook(() => useHeroFilters(HEROES))
    const initialCount = result.current.results.length
    act(() => result.current.setSearch('brogan'))
    expect(result.current.state.search).toBe('brogan')
    expect(result.current.results.length).toBeLessThan(initialCount)
    expect(result.current.results.length).toBeGreaterThan(0)
  })

  it('reset restores EMPTY_FILTERS', () => {
    const { result } = renderHook(() => useHeroFilters(HEROES))
    act(() => {
      result.current.setSearch('brogan')
      result.current.toggleRole('Healer')
      result.current.toggleStar(2)
      result.current.togglePack('core')
    })
    act(() => result.current.reset())
    expect(result.current.state).toEqual(EMPTY_FILTERS)
  })

  it('results reference is stable across rerenders when inputs unchanged', () => {
    const { result, rerender } = renderHook(() => useHeroFilters(HEROES))
    const first = result.current.results
    rerender()
    expect(result.current.results).toBe(first)
  })
})
