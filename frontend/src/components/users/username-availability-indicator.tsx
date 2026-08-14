import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { cva } from 'class-variance-authority'

import { cn } from '@/lib/utils'

export type UsernameAvailabilityState =
  | 'available'
  | 'checking'
  | 'error'
  | 'idle'
  | 'invalid'
  | 'unavailable'

type UsernameAvailabilityIndicatorProps = {
  className?: string
  message: string
  state: UsernameAvailabilityState
}

const indicatorVariants = cva(
  'inline-flex min-h-6 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      state: {
        available: 'bg-muted text-primary',
        checking: 'bg-secondary text-muted-foreground',
        error: 'bg-destructive/10 text-destructive',
        idle: 'bg-secondary text-muted-foreground',
        invalid: 'bg-secondary text-muted-foreground',
        unavailable: 'bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: {
      state: 'idle',
    },
  },
)

const iconByState = {
  available: CheckCircle2,
  checking: Loader2,
  error: AlertCircle,
  idle: AlertCircle,
  invalid: AlertCircle,
  unavailable: XCircle,
} satisfies Record<UsernameAvailabilityState, typeof AlertCircle>

export function UsernameAvailabilityIndicator({
  className,
  message,
  state,
}: UsernameAvailabilityIndicatorProps) {
  const Icon = iconByState[state]

  return (
    <span
      className={cn(
        indicatorVariants({
          state,
        }),
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-3.5', state === 'checking' && 'animate-spin')}
      />
      {message}
    </span>
  )
}
