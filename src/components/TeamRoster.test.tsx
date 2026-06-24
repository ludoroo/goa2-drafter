import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Pick, Player } from '@/types'
import { TeamRoster } from './TeamRoster'

const players: Player[] = [
  { id: 'p1', name: 'Alice', team: 'red', token: 't1', seat: 1 },
  { id: 'p2', name: 'Bob', team: 'red', token: 't2', seat: 2 },
  { id: 'p3', name: 'Carol', team: 'red', token: 't3', seat: 3 },
  { id: 'p4', name: 'Dave', team: 'blue', token: 't4', seat: 1 },
  { id: 'p5', name: 'Eve', team: 'blue', token: 't5', seat: 2 },
]

const picks: Pick[] = [
  {
    id: 'pk1',
    playerId: 'p1',
    heroId: 'arien-the-tidemaster',
    pickIndex: 0,
    createdAt: 1,
  },
  {
    id: 'pk2',
    playerId: 'p2',
    heroId: 'brogan-the-destroyer',
    pickIndex: 2,
    createdAt: 2,
  },
  {
    id: 'pk3',
    playerId: 'p4',
    heroId: 'wasp-the-warmaiden',
    pickIndex: 1,
    createdAt: 3,
  },
]

describe('TeamRoster', () => {
  it('renders only this team\u2019s players (excludes other team)', () => {
    render(<TeamRoster team="red" players={players} picks={picks} heroesPerTeam={3} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
    expect(screen.queryByText('Dave')).not.toBeInTheDocument()
    expect(screen.queryByText('Eve')).not.toBeInTheDocument()
  })

  it('shows the picked hero name for players who have picked', () => {
    render(<TeamRoster team="red" players={players} picks={picks} heroesPerTeam={3} />)
    expect(screen.getByText('Arien the Tidemaster')).toBeInTheDocument()
    expect(screen.getByText('Brogan the Destroyer')).toBeInTheDocument()
  })

  it('shows an empty placeholder for players without a pick', () => {
    render(<TeamRoster team="red" players={players} picks={picks} heroesPerTeam={3} />)
    // Carol has no pick — find her slot and verify placeholder text.
    const carolSlot = screen.getByTestId('roster-slot-p3')
    expect(carolSlot).toHaveTextContent(/drafting|—|waiting/i)
  })

  it('marks the current player as "on the clock"', () => {
    render(
      <TeamRoster
        team="red"
        players={players}
        picks={picks}
        heroesPerTeam={3}
        currentPlayerId="p3"
      />,
    )
    const carolSlot = screen.getByTestId('roster-slot-p3')
    expect(carolSlot).toHaveTextContent(/on the clock/i)
  })

  it('does not show "on the clock" on slots that are not current', () => {
    render(
      <TeamRoster
        team="red"
        players={players}
        picks={picks}
        heroesPerTeam={3}
        currentPlayerId="p3"
      />,
    )
    const aliceSlot = screen.getByTestId('roster-slot-p1')
    expect(aliceSlot).not.toHaveTextContent(/on the clock/i)
  })

  it('renders the picked count "X / Y picked"', () => {
    render(<TeamRoster team="red" players={players} picks={picks} heroesPerTeam={3} />)
    // 2 of 3 red players have picks.
    expect(screen.getByText(/2\s*\/\s*3 picked/i)).toBeInTheDocument()
  })

  it('uses the custom title when provided, otherwise the team default', () => {
    const { rerender } = render(
      <TeamRoster team="blue" players={players} picks={picks} heroesPerTeam={3} />,
    )
    expect(screen.getByText('Blue Team')).toBeInTheDocument()

    rerender(
      <TeamRoster
        team="red"
        players={players}
        picks={picks}
        heroesPerTeam={3}
        title="Crimson Crew"
      />,
    )
    expect(screen.getByText('Crimson Crew')).toBeInTheDocument()
  })

  it('orders players by seat', () => {
    const shuffled: Player[] = [
      { id: 'p3', name: 'Carol', team: 'red', token: 't3', seat: 3 },
      { id: 'p1', name: 'Alice', team: 'red', token: 't1', seat: 1 },
      { id: 'p2', name: 'Bob', team: 'red', token: 't2', seat: 2 },
    ]
    render(<TeamRoster team="red" players={shuffled} picks={picks} heroesPerTeam={3} />)
    const slots = screen.getAllByTestId(/^roster-slot-/)
    expect(slots[0]).toHaveTextContent('Alice')
    expect(slots[1]).toHaveTextContent('Bob')
    expect(slots[2]).toHaveTextContent('Carol')
  })

  it('does not render the handicap badge by default', () => {
    render(<TeamRoster team="red" players={players} picks={picks} heroesPerTeam={3} />)
    expect(screen.queryByTestId('handicap-badge')).not.toBeInTheDocument()
  })

  it('renders the handicap badge when handicap is true', () => {
    render(
      <TeamRoster team="red" players={players} picks={picks} heroesPerTeam={3} handicap />,
    )
    const badge = screen.getByTestId('handicap-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent(/handicap cards/i)
    expect(badge).toHaveAccessibleName(/larger team replaces a basic card with a handicap card/i)
  })
})
