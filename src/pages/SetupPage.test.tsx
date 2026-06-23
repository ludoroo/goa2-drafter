import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SetupPage } from './SetupPage'
import { HERO_PACKS } from '@/data/packs'

/**
 * Render SetupPage (the new-game wizard) at `/setup`.
 */
function renderSetupAt(initialPath: string): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderSetup(): void {
  renderSetupAt('/setup')
}

/**
 * Click the method-card button whose title is `label`. The card's accessible
 * name is the concatenation of title + description, so we locate the title
 * `<div>` and click its closest `<button>` ancestor.
 */
async function pickMethod(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  const titleEl = screen.getByText(label, { selector: 'div' })
  const button = titleEl.closest('button')
  if (!button) throw new Error(`No button ancestor for method label "${label}"`)
  await user.click(button)
}

describe('SetupPage — Step 1 (Players)', () => {
  it('selecting 4 players shows 4 name inputs', () => {
    renderSetup()
    // Default is 4 — verify by counting the player inputs.
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(4)
    expect(screen.getByLabelText('Player 1 name')).toBeInTheDocument()
    expect(screen.getByLabelText('Player 4 name')).toBeInTheDocument()
  })

  it('switching to 6 players renders 6 name inputs', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByRole('switch', { name: /6 players/i }))
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
  })
})

describe('SetupPage — Step 2 (Teams)', () => {
  it('lets the organiser assign players to teams manually', async () => {
    const user = userEvent.setup()
    renderSetup()
    // Advance to step 2.
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    // Next is blocked until teams are balanced.
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()

    // Manually assign: 2 to Red, 2 to Blue (4 players default).
    const redChips = screen.getAllByRole('switch', { name: 'Red' })
    const blueChips = screen.getAllByRole('switch', { name: 'Blue' })
    expect(redChips).toHaveLength(4)
    await user.click(redChips[0]!)
    await user.click(redChips[1]!)
    await user.click(blueChips[2]!)
    await user.click(blueChips[3]!)

    // Balanced status + Next enabled.
    expect(screen.getByRole('status')).toHaveTextContent(/balanced/i)
    expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled()
  })

  it('randomise splits players into two equal teams', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await user.click(screen.getByRole('button', { name: /randomise teams/i }))

    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/Red:\s*2/)
    expect(status.textContent).toMatch(/Blue:\s*2/)
    expect(status.textContent).toMatch(/balanced/i)
    expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled()
  })

  it('blocks Next while teams are unbalanced', async () => {
    const user = userEvent.setup()
    renderSetup()
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    // Assign 3 of 4 players to Red — unbalanced (Red full would cap at 2, so
    // the 3rd Red click is a no-op; verify it stays unbalanced + Next disabled).
    const redChips = screen.getAllByRole('switch', { name: 'Red' })
    await user.click(redChips[0]!)
    await user.click(redChips[1]!)

    expect(screen.getByTestId('step-validation')).toHaveTextContent(/teams must be balanced/i)
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()
  })
})

describe('SetupPage — Step 3 (Method)', () => {
  it('shows all six draft method options', async () => {
    const user = userEvent.setup()
    renderSetup()

    // Step 1 → Step 2.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    // Randomise teams to satisfy step 2.
    await user.click(screen.getByRole('button', { name: /randomise teams/i }))
    // Step 2 → Step 3 (Method).
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    const labels = ['Snake', 'All Random', 'All Pick', 'Random Draft', 'Single Draft', 'Pick & Ban']
    for (const label of labels) {
      expect(screen.getByText(label, { selector: 'div' })).toBeInTheDocument()
    }

    // Six pressable method buttons exist (one per option).
    const methodButtons = screen.getAllByRole('button', { pressed: false })
    // Snake (default) is pressed, the other 5 are not.
    expect(methodButtons.length).toBeGreaterThanOrEqual(5)
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
  })
})

describe('SetupPage — Step 4 (Hero pool)', () => {
  it("a pack's Select all selects all heroes in that pack and updates the counter", async () => {
    const user = userEvent.setup()
    renderSetup()

    // Step 1 → Step 2.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    // Randomize teams to satisfy step 2.
    await user.click(screen.getByRole('button', { name: /randomise teams/i }))
    // Step 2 → Step 3 (Method).
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    // Step 3 → Step 4 (Hero pool) — snake is the default, no change needed.
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    // Counter starts at 0.
    expect(screen.getByText(/Selected 0 \/ need >= 4/i)).toBeInTheDocument()

    // Generate disabled (Next here is the wizard Next, but we're on step 3 → Next).
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()

    // Click "Select all" for the Core pack.
    const corePack = HERO_PACKS.find((p) => p.id === 'core')
    expect(corePack).toBeTruthy()
    const coreCount = corePack ? corePack.heroIds.length : 0
    expect(coreCount).toBeGreaterThanOrEqual(4)

    await user.click(screen.getByRole('button', { name: /select all in core set/i }))

    // Counter reflects count.
    expect(
      screen.getByText(new RegExp(`Selected ${coreCount} / need >= 4`, 'i')),
    ).toBeInTheDocument()

    // Next now enabled.
    expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled()
  })

  it('selecting Single Draft raises the minimum to 3 heroes per player', async () => {
    const user = userEvent.setup()
    renderSetup()

    // Step 1 → Step 2.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /randomise teams/i }))
    // Step 2 → Step 3 (Method).
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    // Pick Single Draft.
    await pickMethod(user, 'Single Draft')

    // Step 3 → Step 4 (Hero pool).
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    // 4 players × 3 = 12.
    expect(screen.getByText(/Selected 0 \/ need >= 12/i)).toBeInTheDocument()
    // Method hint surfaces.
    expect(screen.getByText(/single draft needs 3 heroes per player/i)).toBeInTheDocument()

    // Next is blocked until 12 heroes are selected.
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()

    // Selecting Core alone (7 heroes) is not enough — Next stays disabled.
    await user.click(screen.getByRole('button', { name: /select all in core set/i }))
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()

    // Selecting every hero clears the requirement.
    await user.click(screen.getByRole('button', { name: /select all heroes/i }))
    const totalHeroes = HERO_PACKS.reduce((sum, p) => sum + p.heroIds.length, 0)
    expect(totalHeroes).toBeGreaterThanOrEqual(12)
    expect(
      screen.getByText(new RegExp(`Selected ${totalHeroes} / need >= 12`, 'i')),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled()
  })
})

describe('SetupPage — Step 5 (Generate)', () => {
  it('generates a game and renders share links: a shared board link plus per-player links', async () => {
    const user = userEvent.setup()
    renderSetup()

    // Step 1 → 2
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    // Randomise teams
    await user.click(screen.getByRole('button', { name: /randomise teams/i }))
    // Step 2 → 3 (Method)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    // Pick All Pick to verify a non-default method generates correctly.
    await pickMethod(user, 'All Pick')
    // Step 3 → 4 (Hero pool)
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    // Select Core pack
    await user.click(screen.getByRole('button', { name: /select all in core set/i }))
    // Step 4 → 5 (Generate)
    await user.click(screen.getByRole('button', { name: /^next$/i }))

    // Generate.
    await user.click(screen.getByRole('button', { name: /generate game/i }))

    // Results panel.
    expect(await screen.findByText(/game created/i)).toBeInTheDocument()

    // The shared board link points at /play/<id> WITHOUT a token.
    expect(screen.getByText((content) => /\/play\/[a-z0-9-]+$/i.test(content))).toBeInTheDocument()

    // 4 player links are shown (one per player), each containing /play/ and a token.
    const playLinks = screen.getAllByText((content) => /\/play\/[^\s?]+\?t=/i.test(content))
    expect(playLinks.length).toBe(4)

    // No organiser link is shown — it was removed (the board link is the way back).
    expect(screen.queryByText(/organiser link/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText((content) => /\/setup\/[^\s?]+\?t=/i.test(content)),
    ).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Copy handler — clipboard success / failure / unavailable
// ---------------------------------------------------------------------------

interface ClipboardLike {
  writeText: (text: string) => Promise<void>
}

function setClipboard(value: ClipboardLike | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  })
}

describe('SetupPage — share-link copy handler', () => {
  // Save & restore navigator.clipboard between tests so we don't leak state.
  let originalClipboard: PropertyDescriptor | undefined

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  })

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    } else {
      // jsdom started without a clipboard prop — remove what we added.
      delete (navigator as { clipboard?: unknown }).clipboard
    }
  })

  /**
   * Drive the wizard to the success screen so a real ShareLinkRow exists.
   * Returns a userEvent instance for the caller to keep clicking with.
   *
   * IMPORTANT: `userEvent.setup()` installs its own clipboard stub on
   * `navigator.clipboard`. We must call any test-specific `setClipboard(...)`
   * AFTER this helper returns so our mock isn't clobbered.
   */
  async function mountSuccessScreen(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    renderSetup()

    // Players → Teams.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /randomise teams/i }))
    // Teams → Method.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    // Method → Hero pool (snake is the default).
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /select all in core set/i }))
    // Hero pool → Generate.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /generate game/i }))

    expect(await screen.findByText(/game created/i)).toBeInTheDocument()
    return user
  }

  it('shows "Copied!" after a successful clipboard write', async () => {
    const user = await mountSuccessScreen()

    // Override user-event's clipboard stub AFTER setup so our spy is the one
    // that gets called by the component.
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })

    const copyButtons = screen.getAllByRole('button', { name: /copy .* link/i })
    expect(copyButtons.length).toBeGreaterThan(0)

    await user.click(copyButtons[0]!)

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/play/'))
    expect(await screen.findByText(/^copied!$/i)).toBeInTheDocument()
  })

  it('shows the fallback message when writeText rejects', async () => {
    const user = await mountSuccessScreen()

    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    setClipboard({ writeText })

    const copyButtons = screen.getAllByRole('button', { name: /copy .* link/i })
    await user.click(copyButtons[0]!)

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/copy failed/i)).toBeInTheDocument()
  })
})
