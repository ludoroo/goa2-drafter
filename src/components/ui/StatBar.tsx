import { cn } from './cn'

export interface StatBarProps {
  label: string
  value: number
  upgraded?: number
  max?: number
}

export function StatBar({ label, value, upgraded, max = 8 }: StatBarProps) {
  const safeMax = max > 0 ? max : 1
  const clampedValue = Math.max(0, Math.min(value, safeMax))
  const valuePct = (clampedValue / safeMax) * 100

  const hasUpgrade = typeof upgraded === 'number' && upgraded > value
  const clampedUpgraded = hasUpgrade ? Math.max(0, Math.min(upgraded, safeMax)) : clampedValue
  const upgradePct = hasUpgrade ? ((clampedUpgraded - clampedValue) / safeMax) * 100 : 0

  const readout = hasUpgrade ? `${value} (${upgraded})` : `${value}`
  const ariaLabel = `${label}: ${value}${upgraded != null ? ` (upgraded ${upgraded})` : ''}`

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-slate-400">{label}</span>
        <span className={cn('font-mono text-slate-200', hasUpgrade && 'text-amber-300')}>
          {readout}
        </span>
      </div>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/60"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeMax}
      >
        <div
          data-testid="statbar-fill"
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-teal-500 to-cyan-400"
          style={{ width: `${valuePct}%` }}
        />
        {hasUpgrade && (
          <div
            data-testid="statbar-upgrade"
            className="absolute inset-y-0 rounded-r-full bg-gradient-to-r from-amber-400 to-amber-300 opacity-80"
            style={{ left: `${valuePct}%`, width: `${upgradePct}%` }}
          />
        )}
      </div>
    </div>
  )
}
