import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GamePage } from './GamePage'
import { gameStore } from '@/services/store'
import type { CreateGameInput, DraftMethod, GameStore, Player } from '@/types'
import { buildSnakeDraftOrder } from '@/services/draft'
import { getHeroById } from '@/data/heroes'

const clearStorage = (): void => {
  const ls = (globalThis as { localStorage?: Storage }).localStorage
  if (ls) ls.clear()
}

/** Detach any in-tab subscriptions left on the shared singleton store. */
const clearStoreSubscriptions = (): void => {
  const s = gameStore as { clearSubscriptions?: () => void }
  s.clearSubscriptions?.()
}

type CreatedGameResult = Awaited<ReturnType<GameStore['createGame']>>

// A small fixed hero pool from the real data set, used by the snake/all-pick
// flows that only need `playerCount` heroes minimum.
const POOL = [
  'arien-the-tidemaster',
  'brogan-the-destroyer',
  'tigerclaw-the-cutpurse',
  'wasp-the-warmaiden',
  'sabina-the-gunslinger',
  'xargatha-the-changed',
]

// Larger pool — needed by single-draft (4 * 3 = 12) and comfortably covers
// pick-and-ban (4 + 2 * 2 = 8) too.
const LARGE_POOL = [
  'arien-the-tidemaster',
  'brogan-the-destroyer',
  'tigerclaw-the-cutpurse',
  'wasp-the-warmaiden',
  'sabina-the-gunslinger',
  'xargatha-the-changed',
  'dodger-the-warlock',
  'rowenna-the-vanguard',
  'garrus-the-gladiator',
  'bain-the-bountyhunter',
  'whisper-the-outcast',
  'misa-the-samurai',
]

const FOUR_PLAYERS: CreateGameInput['players'] = [
  { name: 'Alice', team: 'red', seat: 0 },
  { name: 'Bob', team: 'blue', seat: 1 },
  { name: 'Cara', team: 'blue', seat: 2 },
  { name: 'Dan', team: 'red', seat: 3 },
]

async function createGameWith(
  method: DraftMethod,
  heroPool: string[],
): Promise<CreatedGameResult> {
  return gameStore.createGame({
    playerCount: 4,
    method,
    heroPool,
    players: FOUR_PLAYERS,
  })
}

async function createSnakeGame(): Promise<CreatedGameResult> {
  return createGameWith('snake', POOL)
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/play/:gameId" element={<GamePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GamePage', () => {
  beforeEach(() => {
    clearStoreSubscriptions()
    clearStorage()
  })
  afterEach(() => {
    cleanup()
    clearStoreSubscriptions()
  })

  it('renders the read-only board (no selector) when no token is present', async () => {
    const created = await createSnakeGame()
    renderAt(`/play/${created.game.id}`)

    // Both team rosters render (Alice appears at least once — she's also the
    // first picker so may also show in the on-the-clock banner).
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0)
    expect(screen.getByText('Bob')).toBeInTheDocument()
    // On-the-clock banner names the first picker.
    expect(screen.getByTestId('on-the-clock-banner')).toBeInTheDocument()
    // No hero selector without a token.
    expect(screen.queryByLabelText('hero selector')).not.toBeInTheDocument()
  })

  it('shows the hero selector when a valid token is present and the game is drafting', async () => {
    const created = await createSnakeGame()
    const someToken = created.players[0]!.token
    renderAt(`/play/${created.game.id}?t=${someToken}`)

    await screen.findAllByText('Alice')
    expect(screen.getByLabelText('hero selector')).toBeInTheDocument()
  })

  it("surfaces 'not your turn' when the wrong player tries to pick", async () => {
    const created = await createSnakeGame()
    // Determine the FIRST picker, then use a DIFFERENT player's token.
    const order = buildSnakeDraftOrder(created.players)
    const firstPickerId = order[0]
    const wrongPlayer = created.players.find((p: Player) => p.id !== firstPickerId)!
    renderAt(`/play/${created.game.id}?t=${wrongPlayer.token}`)

    const user = userEvent.setup()
    // Open a domino and attempt a pick.
    const firstDomino = await screen.findByRole('button', { name: /arien the tidemaster/i })
    await user.click(firstDomino)
    const pickButton = await screen.findByRole('button', { name: /pick this hero/i })
    await user.click(pickButton)

    expect(await screen.findByText(/not your turn/i)).toBeInTheDocument()
  })

  it('lets the current picker pick, advancing the board live', async () => {
    const created = await createSnakeGame()
    const order = buildSnakeDraftOrder(created.players)
    const firstPicker = created.players.find((p: Player) => p.id === order[0])!
    renderAt(`/play/${created.game.id}?t=${firstPicker.token}`)

    const user = userEvent.setup()
    const domino = await screen.findByRole('button', { name: /arien the tidemaster/i })
    await user.click(domino)
    const pickButton = await screen.findByRole('button', { name: /pick this hero/i })
    await user.click(pickButton)

    // Success flash, and the pick progress advances.
    expect(await screen.findByText(/picked arien the tidemaster/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('pick-progress')).toHaveTextContent(/pick 1 of 4/i)
    })
  })

  it('shows a not-found message for an unknown game id', async () => {
    renderAt('/play/does-not-exist')
    expect(
      await screen.findByRole('heading', { name: /game not found/i }),
    ).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // T7: generalized for all methods
  // -------------------------------------------------------------------------

  describe('all-pick', () => {
    it("banner shows 'PICK' + the active player's name; selector is visible", async () => {
      const created = await createGameWith('all-pick', POOL)
      const firstTurn = created.game.turns[0]!
      const firstPicker = created.players.find((p: Player) => p.id === firstTurn.playerId)!
      renderAt(`/play/${created.game.id}?t=${firstPicker.token}`)

      // Banner: PICK action + the player's name in the team-coloured span.
      const banner = await screen.findByTestId('on-the-clock-banner')
      expect(within(banner).getByTestId('turn-action')).toHaveTextContent(/^PICK$/)
      expect(within(banner).getByTestId('current-pick-banner')).toHaveTextContent(firstPicker.name)
      // Selector visible (token holder, active draft).
      expect(screen.getByLabelText('hero selector')).toBeInTheDocument()
    })
  })

  describe('pick-and-ban', () => {
    it("banner shows 'BAN' + Team <team> initially (no player name); detail action reads 'Ban this hero'", async () => {
      const created = await createGameWith('pick-and-ban', LARGE_POOL)
      const firstTurn = created.game.turns[0]!
      expect(firstTurn.kind).toBe('ban')
      expect(firstTurn.playerId).toBeNull()

      const activeTeamPlayer = created.players.find(
        (p: Player) => p.team === firstTurn.team,
      )!
      renderAt(`/play/${created.game.id}?t=${activeTeamPlayer.token}`)

      const banner = await screen.findByTestId('on-the-clock-banner')
      expect(within(banner).getByTestId('turn-action')).toHaveTextContent(/^BAN$/)
      // No player name — it's a collective team turn, so the banner names the team.
      expect(within(banner).getByTestId('current-pick-banner')).toHaveTextContent(/team/i)
      expect(within(banner).getByTestId('current-pick-banner')).not.toHaveTextContent(
        activeTeamPlayer.name,
      )

      // Open a hero and confirm the action button is labelled for banning.
      const user = userEvent.setup()
      const firstHeroId = created.game.heroPool[0]!
      const firstHero = getHeroById(firstHeroId)!
      await user.click(screen.getByRole('button', { name: firstHero.name }))
      expect(
        await screen.findByRole('button', { name: /ban this hero/i }),
      ).toBeInTheDocument()
    })

    it("banning advances the banner and lists the hero under 'Bans'; that hero is then disabled", async () => {
      const created = await createGameWith('pick-and-ban', LARGE_POOL)
      const firstTurn = created.game.turns[0]!
      const activeTeamPlayer = created.players.find(
        (p: Player) => p.team === firstTurn.team,
      )!
      renderAt(`/play/${created.game.id}?t=${activeTeamPlayer.token}`)

      const user = userEvent.setup()
      const targetId = created.game.heroPool[0]!
      const targetHero = getHeroById(targetId)!
      // The selector renders one button per hero in the pool — find by name.
      const domino = await screen.findByRole('button', { name: targetHero.name })
      await user.click(domino)
      await user.click(await screen.findByRole('button', { name: /ban this hero/i }))

      // Success flash uses ban copy.
      expect(
        await screen.findByText(new RegExp(`banned ${targetHero.name}`, 'i')),
      ).toBeInTheDocument()

      // Bans section appears and lists the hero.
      const bans = await screen.findByTestId('bans-section')
      expect(within(bans).getByText(targetHero.name)).toBeInTheDocument()

      // The banner has advanced — currentPick incremented, so the second turn
      // (still a ban, by the OTHER team) is now active.
      const banner = screen.getByTestId('on-the-clock-banner')
      expect(within(banner).getByTestId('turn-action')).toHaveTextContent(/^BAN$/)

      // The just-banned hero is disabled in the selector now.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: targetHero.name })).toBeDisabled()
      })
    })

    it("rejects an attempt by a player on the OTHER team with the 'other team's turn' message", async () => {
      const created = await createGameWith('pick-and-ban', LARGE_POOL)
      const firstTurn = created.game.turns[0]!
      const otherTeam = firstTurn.team === 'red' ? 'blue' : 'red'
      const wrongTeamPlayer = created.players.find((p: Player) => p.team === otherTeam)!
      renderAt(`/play/${created.game.id}?t=${wrongTeamPlayer.token}`)

      const user = userEvent.setup()
      const targetId = created.game.heroPool[0]!
      const targetHero = getHeroById(targetId)!
      await user.click(await screen.findByRole('button', { name: targetHero.name }))
      await user.click(await screen.findByRole('button', { name: /ban this hero/i }))

      expect(await screen.findByText(/other team's turn/i)).toBeInTheDocument()
    })
  })

  describe('single-draft', () => {
    it("selector shows only the player's 3-card hand, and picking from the hand succeeds", async () => {
      const created = await createGameWith('single-draft', LARGE_POOL)
      const firstTurn = created.game.turns[0]!
      const firstPicker = created.players.find((p: Player) => p.id === firstTurn.playerId)!

      // Fetch the player's private hand via the store (the page does the same
      // through useGame + getPlayerView).
      const view = await gameStore.getPlayerView(created.game.id, firstPicker.token)
      expect(view).not.toBeNull()
      expect(view!.hand).not.toBeNull()
      const hand = view!.hand!
      expect(hand).toHaveLength(3)

      renderAt(`/play/${created.game.id}?t=${firstPicker.token}`)

      // Wait for the selector to mount with the hand.
      await waitFor(() => {
        expect(screen.getByLabelText('hero selector')).toBeInTheDocument()
      })

      // Every hero in the hand has a domino button; heroes NOT in the hand
      // (but in the pool) must be absent.
      for (const id of hand) {
        const hero = getHeroById(id)!
        expect(screen.getByRole('button', { name: hero.name })).toBeInTheDocument()
      }
      const notInHand = LARGE_POOL.filter((id) => !hand.includes(id))
      expect(notInHand.length).toBeGreaterThan(0)
      for (const id of notInHand) {
        const hero = getHeroById(id)!
        expect(screen.queryByRole('button', { name: hero.name })).not.toBeInTheDocument()
      }

      // Picking the first card in the hand succeeds.
      const user = userEvent.setup()
      const pickId = hand[0]!
      const pickHero = getHeroById(pickId)!
      await user.click(screen.getByRole('button', { name: pickHero.name }))
      await user.click(await screen.findByRole('button', { name: /pick this hero/i }))

      expect(
        await screen.findByText(new RegExp(`picked ${pickHero.name}`, 'i')),
      ).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByTestId('pick-progress')).toHaveTextContent(/pick 1 of 4/i)
      })
    })

    it('renders a friendly error (not a perpetual spinner) when the token is bogus', async () => {
      const created = await createGameWith('single-draft', LARGE_POOL)
      renderAt(`/play/${created.game.id}?t=definitely-not-a-real-token`)

      // The hand error card appears once the playerView fetch settles to null.
      const errorCard = await screen.findByTestId('hand-error')
      expect(errorCard).toBeInTheDocument()
      expect(errorCard).toHaveTextContent(/couldn't load your hand/i)
      // And the loading spinner is NOT present.
      expect(screen.queryByTestId('hand-pending')).not.toBeInTheDocument()
      // No selector either — there's no hand to render.
      expect(screen.queryByLabelText('hero selector')).not.toBeInTheDocument()
    })
  })
})
