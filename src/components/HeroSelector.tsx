import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Hero } from '@/types'
import { useHeroFilters } from '@/hooks/useHeroFilters'
import { FilterBar } from './FilterBar'
import { HeroDomino } from './HeroDomino'
import { HeroDetailCard } from './HeroDetailCard'
import { Button } from './ui'

export interface HeroSelectorProps {
  /** Available pool for this game (already filtered to the game's hero_pool by the caller). */
  heroes: Hero[]
  /** Heroes already taken — rendered disabled and not selectable. */
  pickedHeroIds?: string[]
  /** Whether the current user may pick right now. */
  canPick?: boolean
  /** Called when the user confirms a pick in the detail card. */
  onPick?: (heroId: string) => void
  /** Label for the detail card's primary action. Defaults to "Pick this hero". */
  actionLabel?: string
}

/**
 * Accessibility note (Option A): the expanded HeroDetailCard is presented as a
 * non-modal dialog. We move focus into the panel container on open, and restore
 * focus to the triggering domino on close (Escape, Back, or after Pick). The
 * dialog has an accessible name via aria-labelledby pointing at the heading
 * inside HeroDetailCard.
 */
export function HeroSelector({
  heroes,
  pickedHeroIds,
  canPick = false,
  onPick,
  actionLabel,
}: HeroSelectorProps): JSX.Element {
  const { state, setSearch, toggleStar, toggleRole, togglePack, setSort, reset, results } =
    useHeroFilters(heroes)

  const [expandedHeroId, setExpandedHeroId] = useState<string | null>(null)

  const pickedSet = new Set(pickedHeroIds ?? [])
  const expandedHero = expandedHeroId
    ? (heroes.find((h) => h.id === expandedHeroId) ?? null)
    : null

  // Refs for focus management.
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  // Hero id whose trigger should regain focus after the dialog closes.
  const lastTriggerIdRef = useRef<string | null>(null)
  // Tracks whether we have a deferred focus-restore pending after close.
  const restoreFocusPendingRef = useRef<boolean>(false)

  const registerTrigger = useCallback(
    (heroId: string) =>
      (el: HTMLButtonElement | null): void => {
        const map = triggerRefs.current
        if (el == null) {
          map.delete(heroId)
        } else {
          map.set(heroId, el)
        }
      },
    [],
  )

  const closeDetail = useCallback((): void => {
    restoreFocusPendingRef.current = true
    setExpandedHeroId(null)
  }, [])

  // Escape closes the detail card.
  useEffect(() => {
    if (expandedHero == null) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        restoreFocusPendingRef.current = true
        setExpandedHeroId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return (): void => {
      window.removeEventListener('keydown', handler)
    }
  }, [expandedHero])

  // On open: move focus into the dialog container.
  useEffect(() => {
    if (expandedHero != null && dialogRef.current != null) {
      dialogRef.current.focus()
    }
  }, [expandedHero])

  // On close: restore focus to the triggering domino if one was tracked.
  useEffect(() => {
    if (expandedHero != null) return
    if (!restoreFocusPendingRef.current) return
    restoreFocusPendingRef.current = false
    const id = lastTriggerIdRef.current
    if (id == null) return
    const trigger = triggerRefs.current.get(id)
    if (trigger != null) trigger.focus()
  }, [expandedHero])

  const handleDominoClick = (hero: Hero): void => {
    if (pickedSet.has(hero.id)) return
    lastTriggerIdRef.current = hero.id
    setExpandedHeroId(hero.id)
  }

  const handlePick = (): void => {
    if (expandedHero == null) return
    onPick?.(expandedHero.id)
    restoreFocusPendingRef.current = true
    setExpandedHeroId(null)
  }

  const detailCanPick = canPick && expandedHero != null && !pickedSet.has(expandedHero.id)

  // Stable id used to wire aria-labelledby → the hero name heading inside HeroDetailCard.
  // HeroDetailCard renders an <h2> with the hero name, queryable by role; the dialog
  // wrapper uses aria-label as a robust fallback so the accessible name is always set.
  const dialogLabel = expandedHero != null ? `${expandedHero.name} details` : undefined

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        state={state}
        onSetSearch={setSearch}
        onToggleStar={toggleStar}
        onToggleRole={toggleRole}
        onTogglePack={togglePack}
        onSetSort={setSort}
        onReset={reset}
        resultCount={results.length}
      />

      {results.length === 0 ? (
        <div
          role="status"
          className="flex flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-300"
        >
          <p className="text-base font-medium">No heroes match your filters</p>
          <Button variant="secondary" size="sm" onClick={reset}>
            Reset filters
          </Button>
        </div>
      ) : (
        <div
          role="list"
          aria-label="Hero selection"
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-6 pt-8 sm:flex-wrap sm:justify-center sm:gap-3 sm:overflow-visible"
        >
          {results.map((hero, idx) => (
            <div role="listitem" key={hero.id} className="snap-start">
              <HeroDominoTrigger
                hero={hero}
                index={idx}
                selected={expandedHeroId === hero.id}
                disabled={pickedSet.has(hero.id)}
                onClick={() => handleDominoClick(hero)}
                buttonRef={registerTrigger(hero.id)}
              />
            </div>
          ))}
        </div>
      )}

      {expandedHero != null ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="false"
          aria-label={dialogLabel}
          tabIndex={-1}
          className="flex justify-center outline-none"
        >
          <HeroDetailCard
            hero={expandedHero}
            canPick={detailCanPick}
            onPick={handlePick}
            onClose={closeDetail}
            actionLabel={actionLabel}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Thin wrapper around HeroDomino that captures the underlying <button> ref
 * (HeroDomino doesn't accept a ref directly). We render HeroDomino inside a
 * span and grab the first button child so we can restore focus to it on close.
 */
interface HeroDominoTriggerProps {
  hero: Hero
  index: number
  selected: boolean
  disabled: boolean
  onClick: () => void
  buttonRef: (el: HTMLButtonElement | null) => void
}

function HeroDominoTrigger({
  hero,
  index,
  selected,
  disabled,
  onClick,
  buttonRef,
}: HeroDominoTriggerProps): JSX.Element {
  const wrapperRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (wrapper == null) {
      buttonRef(null)
      return
    }
    const btn = wrapper.querySelector('button')
    buttonRef(btn instanceof HTMLButtonElement ? btn : null)
    return (): void => {
      buttonRef(null)
    }
  }, [buttonRef])

  return (
    <span ref={wrapperRef} className="contents">
      <HeroDomino
        hero={hero}
        index={index}
        selected={selected}
        disabled={disabled}
        onClick={onClick}
      />
    </span>
  )
}
