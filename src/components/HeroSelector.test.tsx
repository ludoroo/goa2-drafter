import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HeroSelector } from './HeroSelector'
import { HEROES } from '@/data/heroes'

const POOL = HEROES.slice(0, 8)

describe('HeroSelector', () => {
  it('renders one domino per filtered hero', () => {
    render(<HeroSelector heroes={POOL} />)
    for (const hero of POOL) {
      expect(screen.getByRole('button', { name: hero.name })).toBeInTheDocument()
    }
  })

  it('opens the HeroDetailCard when a domino is clicked', async () => {
    const user = userEvent.setup()
    render(<HeroSelector heroes={POOL} />)
    const target = POOL[0]
    await user.click(screen.getByRole('button', { name: target.name }))
    expect(screen.getByRole('heading', { name: target.name })).toBeInTheDocument()
  })

  it('calls onPick with the hero id and closes the card when Pick is clicked', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<HeroSelector heroes={POOL} canPick onPick={onPick} />)
    const target = POOL[1]
    await user.click(screen.getByRole('button', { name: target.name }))
    expect(screen.getByRole('heading', { name: target.name })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /pick this hero/i }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(target.id)
    // Card closed → heading no longer present.
    expect(screen.queryByRole('heading', { name: target.name })).not.toBeInTheDocument()
  })

  it('disables the Pick button when canPick is false', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<HeroSelector heroes={POOL} canPick={false} onPick={onPick} />)
    const target = POOL[2]
    await user.click(screen.getByRole('button', { name: target.name }))
    const pick = screen.getByRole('button', { name: /pick this hero/i })
    expect(pick).toBeDisabled()
    await user.click(pick)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('renders picked heroes as disabled and does not open detail when clicked', async () => {
    const user = userEvent.setup()
    const target = POOL[3]
    render(<HeroSelector heroes={POOL} pickedHeroIds={[target.id]} canPick />)
    const domino = screen.getByRole('button', { name: target.name })
    expect(domino).toBeDisabled()
    expect(domino).toHaveAttribute('aria-disabled', 'true')
    await user.click(domino)
    // Detail heading for target should NOT appear.
    expect(screen.queryByRole('heading', { name: target.name })).not.toBeInTheDocument()
  })

  it('filters dominoes via the search box', async () => {
    const user = userEvent.setup()
    render(<HeroSelector heroes={POOL} />)
    // Sanity: starts at full pool.
    expect(screen.getAllByRole('listitem')).toHaveLength(POOL.length)

    const target = POOL[0] // Arien the Tidemaster — unique substring "Arien".
    const search = screen.getByRole('textbox', { name: /search heroes/i })
    await user.type(search, 'Arien')

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: target.name })).toBeInTheDocument()
  })

  it('closes the detail card when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(<HeroSelector heroes={POOL} />)
    const target = POOL[4]
    await user.click(screen.getByRole('button', { name: target.name }))
    expect(screen.getByRole('heading', { name: target.name })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: target.name })).not.toBeInTheDocument()
  })

  it('moves focus into the dialog panel when a domino is opened', async () => {
    const user = userEvent.setup()
    render(<HeroSelector heroes={POOL} />)
    const target = POOL[5]
    await user.click(screen.getByRole('button', { name: target.name }))

    const dialog = await screen.findByRole('dialog', { name: /details/i })
    expect(dialog).toHaveFocus()
  })

  it('exposes the dialog with the hero name as its accessible name', async () => {
    const user = userEvent.setup()
    render(<HeroSelector heroes={POOL} />)
    const target = POOL[6]
    await user.click(screen.getByRole('button', { name: target.name }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', `${target.name} details`)
  })

  it('restores focus to the triggering domino when closed via Escape', async () => {
    const user = userEvent.setup()
    render(<HeroSelector heroes={POOL} />)
    const target = POOL[2]
    const trigger = screen.getByRole('button', { name: target.name })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('restores focus to the triggering domino when closed via the Back button', async () => {
    const user = userEvent.setup()
    render(<HeroSelector heroes={POOL} />)
    const target = POOL[1]
    const trigger = screen.getByRole('button', { name: target.name })
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('restores focus to the triggering domino after a successful Pick', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<HeroSelector heroes={POOL} canPick onPick={onPick} />)
    const target = POOL[0]
    const trigger = screen.getByRole('button', { name: target.name })
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: /pick this hero/i }))
    expect(onPick).toHaveBeenCalledWith(target.id)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
