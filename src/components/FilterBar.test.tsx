import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EMPTY_FILTERS, type HeroFilterState } from '@/hooks/useHeroFilters'
import { FilterBar } from './FilterBar'

function makeProps(overrides?: { state?: Partial<HeroFilterState>; resultCount?: number }) {
  const state: HeroFilterState = { ...EMPTY_FILTERS, ...overrides?.state }
  return {
    state,
    onSetSearch: vi.fn(),
    onToggleStar: vi.fn(),
    onToggleRole: vi.fn(),
    onTogglePack: vi.fn(),
    onSetSort: vi.fn(),
    onReset: vi.fn(),
    resultCount: overrides?.resultCount ?? 0,
  }
}

describe('FilterBar', () => {
  it('renders the result count readout', () => {
    const props = makeProps({ resultCount: 7 })
    render(<FilterBar {...props} />)
    expect(screen.getByText(/7 heroes/i)).toBeInTheDocument()
  })

  it('typing in the search input calls onSetSearch', async () => {
    const user = userEvent.setup()
    const props = makeProps()
    render(<FilterBar {...props} />)
    const input = screen.getByRole('textbox', { name: /search/i })
    await user.type(input, 'b')
    expect(props.onSetSearch).toHaveBeenCalled()
    expect(props.onSetSearch).toHaveBeenCalledWith('b')
  })

  it('clicking the Healer role chip calls onToggleRole with "Healer"', async () => {
    const user = userEvent.setup()
    const props = makeProps()
    render(<FilterBar {...props} />)
    const healer = screen.getByRole('switch', { name: 'Healer' })
    await user.click(healer)
    expect(props.onToggleRole).toHaveBeenCalledTimes(1)
    expect(props.onToggleRole).toHaveBeenCalledWith('Healer')
  })

  it('clicking the reset button calls onReset', async () => {
    const user = userEvent.setup()
    const props = makeProps()
    render(<FilterBar {...props} />)
    const reset = screen.getByRole('button', { name: /reset/i })
    await user.click(reset)
    expect(props.onReset).toHaveBeenCalledTimes(1)
  })
})
