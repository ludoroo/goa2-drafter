import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  children?: ReactNode
}

const BASE_CLASSES =
  'rounded-xl border border-slate-700/60 bg-slate-800/80 p-4 shadow-md shadow-black/20 backdrop-blur-sm transition-all duration-200'

const INTERACTIVE_CLASSES =
  'cursor-pointer hover:-translate-y-0.5 hover:border-teal-500/60 hover:shadow-lg hover:shadow-teal-900/30 active:translate-y-0'

export function Card({ interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div className={cn(BASE_CLASSES, interactive && INTERACTIVE_CLASSES, className)} {...rest}>
      {children}
    </div>
  )
}
