import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button, Card, Chip, StatBar, cn } from './index'

describe('cn', () => {
  it('joins truthy class names with a single space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })

  it('skips false, null, and undefined values', () => {
    expect(cn('a', false, 'b', null, 'c', undefined)).toBe('a b c')
  })

  it('returns an empty string when all inputs are falsy', () => {
    expect(cn(false, null, undefined)).toBe('')
  })
})

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('produces a different className for primary vs danger variants', () => {
    const { rerender } = render(<Button>Action</Button>)
    const primaryClass = screen.getByRole('button').className
    rerender(<Button variant="danger">Action</Button>)
    const dangerClass = screen.getByRole('button').className
    expect(primaryClass).not.toBe(dangerClass)
    expect(primaryClass).toContain('teal')
    expect(dangerClass).toContain('red')
  })

  it('merges incoming className with built-in classes', () => {
    render(<Button className="extra-class">Hello</Button>)
    const button = screen.getByRole('button')
    expect(button.className).toContain('extra-class')
    expect(button.className.split(' ').length).toBeGreaterThan(1)
  })

  it('fires onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', () => {
    const handleClick = vi.fn()
    render(
      <Button onClick={handleClick} disabled>
        Go
      </Button>,
    )
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(handleClick).not.toHaveBeenCalled()
  })
})

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>card-content</Card>)
    expect(screen.getByText('card-content')).toBeInTheDocument()
  })

  it('applies extra hover classes when interactive', () => {
    const { rerender, container } = render(<Card>plain</Card>)
    const plainClass = container.firstElementChild?.className ?? ''
    rerender(<Card interactive>plain</Card>)
    const interactiveClass = container.firstElementChild?.className ?? ''
    expect(interactiveClass.length).toBeGreaterThan(plainClass.length)
    expect(interactiveClass).toContain('hover:')
  })
})

describe('Chip', () => {
  it('renders its label', () => {
    render(<Chip label="Tank" />)
    expect(screen.getByText('Tank')).toBeInTheDocument()
  })

  it('changes className when selected', () => {
    const { rerender } = render(<Chip label="Tank" />)
    const unselected = screen.getByRole('switch').className
    rerender(<Chip label="Tank" selected />)
    const selected = screen.getByRole('switch').className
    expect(unselected).not.toBe(selected)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('fires onClick when clicked', () => {
    const handleClick = vi.fn()
    render(<Chip label="Tank" onClick={handleClick} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})

describe('StatBar', () => {
  it('shows "5 (8)" readout when upgraded=8 and value=5', () => {
    render(<StatBar label="Attack" value={5} upgraded={8} />)
    expect(screen.getByText('5 (8)')).toBeInTheDocument()
  })

  it('shows just "5" when upgraded is not provided', () => {
    render(<StatBar label="Attack" value={5} />)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.queryByText(/\(/)).not.toBeInTheDocument()
  })

  it('renders bar fill width reflecting value/max', () => {
    render(<StatBar label="Attack" value={4} max={8} />)
    const fill = screen.getByTestId('statbar-fill')
    expect(fill.style.width).toBe('50%')
  })

  it('uses the default max of 8 when not specified', () => {
    render(<StatBar label="Attack" value={2} />)
    const fill = screen.getByTestId('statbar-fill')
    expect(fill.style.width).toBe('25%')
  })

  it('exposes an accessible progressbar with name and aria-valuenow', () => {
    render(<StatBar label="Attack" value={5} upgraded={8} />)
    const bar = screen.getByRole('progressbar', { name: /attack/i })
    expect(bar).toHaveAttribute('aria-valuenow', '5')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '8')
    expect(bar.getAttribute('aria-label')).toMatch(/upgraded 8/i)
  })
})
