import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  children?: ReactNode
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-teal-500 text-slate-950 hover:bg-teal-400 active:bg-teal-600 focus-visible:ring-teal-400 shadow-md shadow-teal-900/30',
  secondary:
    'bg-slate-700 text-slate-100 hover:bg-slate-600 active:bg-slate-800 focus-visible:ring-slate-400 border border-slate-600',
  ghost:
    'bg-transparent text-slate-200 hover:bg-slate-800 active:bg-slate-900 focus-visible:ring-slate-500',
  danger:
    'bg-red-600 text-white hover:bg-red-500 active:bg-red-700 focus-visible:ring-red-400 shadow-md shadow-red-900/30',
}

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
}

const BASE_CLASSES =
  'inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none'

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
      {...rest}
    >
      {children}
    </button>
  )
}
