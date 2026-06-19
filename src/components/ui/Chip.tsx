import { cn } from './cn'

export interface ChipProps {
  label: string
  selected?: boolean
  onClick?: () => void
  tone?: 'default' | 'red' | 'blue' | 'gold'
}

const TONE_UNSELECTED: Record<NonNullable<ChipProps['tone']>, string> = {
  default: 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700 hover:border-slate-500',
  red: 'bg-slate-800 text-red-300 border-red-900/60 hover:bg-red-950/40 hover:border-red-700',
  blue: 'bg-slate-800 text-blue-300 border-blue-900/60 hover:bg-blue-950/40 hover:border-blue-700',
  gold: 'bg-slate-800 text-amber-300 border-amber-900/60 hover:bg-amber-950/40 hover:border-amber-700',
}

const TONE_SELECTED: Record<NonNullable<ChipProps['tone']>, string> = {
  default: 'bg-teal-500 text-slate-950 border-teal-400 shadow-sm shadow-teal-900/40',
  red: 'bg-red-600 text-white border-red-400 shadow-sm shadow-red-900/40',
  blue: 'bg-blue-600 text-white border-blue-400 shadow-sm shadow-blue-900/40',
  gold: 'bg-amber-500 text-slate-950 border-amber-300 shadow-sm shadow-amber-900/40',
}

const BASE_CLASSES =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'

export function Chip({ label, selected = false, onClick, tone = 'default' }: ChipProps) {
  const toneClasses = selected ? TONE_SELECTED[tone] : TONE_UNSELECTED[tone]
  return (
    <button
      type="button"
      role="switch"
      aria-checked={selected}
      onClick={onClick}
      className={cn(BASE_CLASSES, toneClasses, selected && 'is-selected')}
    >
      {label}
    </button>
  )
}
