import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, cleanup, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GamePage } from './GamePage'
import { gameStore } from '@/services/store'
import type { CreateGameInput, DraftMethod, GameStore, Player } from '@/types'
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

async function createGameWith(method: DraftMethod, heroPool: string[]): Promise<CreatedGameResult> {
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

  it('shows the public pool on the board (no token) but disables picking', async () => {
    const created = await createSnakeGame()
    renderAt(`/play/${created.game.id}`)

    // Both team rosters render (Alice appears at least once — she's also the
    // first picker so may also show in the on-the-clock banner).
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0)
    expect(screen.getByText('Bob')).toBeInTheDocument()
    // Turn banner present.
    expect(screen.getByTestId('on-the-clock-banner')).toBeInTheDocument()
    // The pool IS public for snake — the selector renders for spectators too…
    expect(screen.getByLabelText('hero selector')).toBeInTheDocument()
    // …but a spectator (no token) cannot pick: open a hero and confirm the
    // Pick button is disabled.
    const user = userEvent.setup()
    const firstDomino = await screen.findByRole('button', { name: /arien the tidemaster/i })
    await user.click(firstDomino)
    const pickButton = await screen.findByRole('button', { name: /pick this hero/i })
    expect(pickButton).toBeDisabled()
  })

  it('keeps the Single Draft pool private on the board (no token shows no selector)', async () => {
    const created = await createGameWith('single-draft', LARGE_POOL)
    renderAt(`/play/${created.game.id}`)

    // Board renders rosters…
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0)
    // …but NO selector: a private hand must never be shown without a token.
    expect(screen.queryByLabelText('hero selector')).not.toBeInTheDocument()
  })

  it('shows the hero selector when a valid token is present and the game is drafting', async () => {
    const created = await createSnakeGame()
    const someToken = created.players[0]!.token
    renderAt(`/play/${created.game.id}?t=${someToken}`)

    await screen.findAllByText('Alice')
    expect(screen.getByLabelText('hero selector')).toBeInTheDocument()
  })

  it("surfaces 'other team's turn' when a wrong-team player tries to pick (collective snake)", async () => {
    const created = await createSnakeGame()
    // Snake is now collective: pick a player on the OTHER team than the
    // active one, who is unambiguously not authorised.
    const activeTeam = created.game.turns[0]!.team
    const wrongTeam = activeTeam === 'red' ? 'blue' : 'red'
    const wrongPlayer = created.players.find((p: Player) => p.team === wrongTeam)!
    renderAt(`/play/${created.game.id}?t=${wrongPlayer.token}`)

    const user = userEvent.setup()
    // Open a domino and attempt a pick.
    const firstDomino = await screen.findByRole('button', { name: /arien the tidemaster/i })
    await user.click(firstDomino)
    const pickButton = await screen.findByRole('button', { name: /pick this hero/i })
    await user.click(pickButton)

    expect(await screen.findByText(/other team's turn/i)).toBeInTheDocument()
  })

  it('lets any active-team player pick, advancing the board live (collective snake)', async () => {
    const created = await createSnakeGame()
    // Collective: any teammate on the active team may pick. Pick the
    // lowest-seat teammate of the active team for determinism.
    const activeTeam = created.game.turns[0]!.team
    const activeTeamPlayers = created.players
      .filter((p: Player) => p.team === activeTeam)
      .sort((a: Player, b: Player) => a.seat - b.seat)
    const acting = activeTeamPlayers[0]!
    renderAt(`/play/${created.game.id}?t=${acting.token}`)

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

    // The acting player owns the hero on the roster.
    const slot = screen.getByTestId(`roster-slot-${acting.id}`)
    expect(within(slot).getByText(/arien the tidemaster/i)).toBeInTheDocument()
  })

  it('shows a not-found message for an unknown game id', async () => {
    renderAt('/play/does-not-exist')
    expect(await screen.findByRole('heading', { name: /game not found/i })).toBeInTheDocument()
  })

  it('renders an odd-count game (5 players, uneven teams) without crashing and shows the handicap badge on the bigger team', async () => {
    // 3 red vs 2 blue — uneven by construction. Regression for the crash that
    // happened when GamePage called `heroesPerTeam(playerCount)` on an odd
    // player count (which throws).
    const created = await gameStore.createGame({
      playerCount: 5,
      method: 'all-pick',
      heroPool: POOL,
      players: [
        { name: 'R0', team: 'red', seat: 0 },
        { name: 'R1', team: 'red', seat: 1 },
        { name: 'R2', team: 'red', seat: 2 },
        { name: 'B0', team: 'blue', seat: 3 },
        { name: 'B1', team: 'blue', seat: 4 },
      ],
    })
    // Sanity: the store should have set handicapTeam to the bigger team (red).
    expect(created.game.handicapTeam).toBe('red')

    renderAt(`/play/${created.game.id}`)

    // The page mounts without throwing — both rosters are visible.
    const redRoster = await screen.findByLabelText('Red Team roster')
    const blueRoster = await screen.findByLabelText('Blue Team roster')
    expect(redRoster).toBeInTheDocument()
    expect(blueRoster).toBeInTheDocument()

    // Per-team slot counts reflect the actual team sizes (3 and 2), not a
    // crash from `heroesPerTeam(5)`.
    expect(within(redRoster).getByText(/0\s*\/\s*3 picked/i)).toBeInTheDocument()
    expect(within(blueRoster).getByText(/0\s*\/\s*2 picked/i)).toBeInTheDocument()

    // The handicap badge appears on the bigger team — derived from the
    // snapshot rather than hard-coded.
    const biggerRoster = created.game.handicapTeam === 'red' ? redRoster : blueRoster
    const smallerRoster = created.game.handicapTeam === 'red' ? blueRoster : redRoster
    expect(within(biggerRoster).getByTestId('handicap-badge')).toBeInTheDocument()
    expect(within(smallerRoster).queryByTestId('handicap-badge')).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // T7: generalized for all methods
  // -------------------------------------------------------------------------

  describe('all-pick', () => {
    it("banner shows 'PICK' + the active team (collective; no single player name); selector is visible", async () => {
      const created = await createGameWith('all-pick', POOL)
      const firstTurn = created.game.turns[0]!
      // All-pick turns are now COLLECTIVE — playerId is null.
      expect(firstTurn.playerId).toBeNull()
      // Any player on the active team can pick; render as one of them so the
      // selector is visible (token holder, active draft).
      const activeTeamPlayer = created.players.find((p: Player) => p.team === firstTurn.team)!
      renderAt(`/play/${created.game.id}?t=${activeTeamPlayer.token}`)

      // Banner: PICK action + team label (NOT a single player name).
      const banner = await screen.findByTestId('on-the-clock-banner')
      expect(within(banner).getByTestId('turn-action')).toHaveTextContent(/^PICK$/)
      expect(within(banner).getByTestId('current-pick-banner')).toHaveTextContent(/team/i)
      expect(within(banner).getByTestId('current-pick-banner')).not.toHaveTextContent(
        activeTeamPlayer.name,
      )
      // Selector visible (token holder, active draft).
      expect(screen.getByLabelText('hero selector')).toBeInTheDocument()
    })

    it("rejects an all-pick attempt by a wrong-team player with the 'other team's turn' message", async () => {
      const created = await createGameWith('all-pick', POOL)
      const firstTurn = created.game.turns[0]!
      const otherTeam = firstTurn.team === 'red' ? 'blue' : 'red'
      const wrongTeamPlayer = created.players.find((p: Player) => p.team === otherTeam)!
      renderAt(`/play/${created.game.id}?t=${wrongTeamPlayer.token}`)

      const user = userEvent.setup()
      const firstHeroId = created.game.heroPool[0]!
      const firstHero = getHeroById(firstHeroId)!
      await user.click(await screen.findByRole('button', { name: firstHero.name }))
      await user.click(await screen.findByRole('button', { name: /pick this hero/i }))

      expect(await screen.findByText(/other team's turn/i)).toBeInTheDocument()
    })
  })

  describe('pick-and-ban', () => {
    it("banner shows 'BAN' + Team <team> initially (no player name); detail action reads 'Ban this hero'", async () => {
      const created = await createGameWith('pick-and-ban', LARGE_POOL)
      const firstTurn = created.game.turns[0]!
      expect(firstTurn.kind).toBe('ban')
      expect(firstTurn.playerId).toBeNull()

      const activeTeamPlayer = created.players.find((p: Player) => p.team === firstTurn.team)!
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
      expect(await screen.findByRole('button', { name: /ban this hero/i })).toBeInTheDocument()
    })

    it("banning advances the banner and lists the hero under 'Bans'; that hero is then disabled", async () => {
      const created = await createGameWith('pick-and-ban', LARGE_POOL)
      const firstTurn = created.game.turns[0]!
      const activeTeamPlayer = created.players.find((p: Player) => p.team === firstTurn.team)!
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
      // Single Draft is simultaneous — `game.turns` is empty. Any player may
      // pick at any time; choose an arbitrary one (Alice).
      expect(created.game.turns).toHaveLength(0)
      const somePlayer = created.players[0]!

      // Fetch the player's private hand via the store (the page does the same
      // through useGame + getPlayerView).
      const view = await gameStore.getPlayerView(created.game.id, somePlayer.token)
      expect(view).not.toBeNull()
      expect(view!.hand).not.toBeNull()
      const hand = view!.hand!
      expect(hand).toHaveLength(3)

      renderAt(`/play/${created.game.id}?t=${somePlayer.token}`)

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

    it('banner lists every player as a pending picker initially, and excludes a player after they pick', async () => {
      const created = await createGameWith('single-draft', LARGE_POOL)

      // Board view (no token) — banner is public and lists all pending pickers.
      renderAt(`/play/${created.game.id}`)

      const banner = await screen.findByTestId('on-the-clock-banner')
      const pending = await within(banner).findByTestId('pending-pickers')
      for (const p of created.players) {
        expect(within(pending).getByText(p.name)).toBeInTheDocument()
      }

      // Drive a single pick directly through the store: pick the first card
      // from one player's hand.
      const picker = created.players[0]!
      const view = await gameStore.getPlayerView(created.game.id, picker.token)
      const heroId = view!.hand![0]!
      let result: Awaited<ReturnType<typeof gameStore.makePick>>
      await act(async () => {
        result = await gameStore.makePick(created.game.id, picker.token, heroId)
      })
      expect(result!.ok).toBe(true)

      // The board's subscription should propagate the new snapshot; the
      // picker's name disappears from the pending list, the others remain.
      await waitFor(() => {
        const pendingAfter = within(screen.getByTestId('on-the-clock-banner')).getByTestId(
          'pending-pickers',
        )
        expect(within(pendingAfter).queryByText(picker.name)).not.toBeInTheDocument()
      })
      const pendingAfter = within(screen.getByTestId('on-the-clock-banner')).getByTestId(
        'pending-pickers',
      )
      for (const p of created.players) {
        if (p.id === picker.id) continue
        expect(within(pendingAfter).getByText(p.name)).toBeInTheDocument()
      }
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
