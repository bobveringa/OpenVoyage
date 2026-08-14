import { cva } from 'class-variance-authority'

import type { Trip } from '@/api/client'
import { getTripTiming, pluralize, type TripTimingStatus } from '@/lib/dates'
import { cn } from '@/lib/utils'

const tripStatusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm before:size-1.5 before:rounded-full before:content-['']",
  {
    variants: {
      surface: {
        default: '',
        overlay: 'border-white/60 bg-card/90 text-card-foreground backdrop-blur-md',
      },
      status: {
        active:
          'border-emerald-300/60 bg-emerald-100/75 text-emerald-900 before:bg-emerald-500',
        completed:
          'border-slate-300/60 bg-card/65 text-slate-700 before:bg-slate-400',
        upcoming:
          'border-amber-300/70 bg-amber-100/85 text-amber-950 before:bg-amber-500',
      },
    },
    compoundVariants: [
      {
        className: 'border-white/60 bg-emerald-100/90 text-emerald-950',
        status: 'active',
        surface: 'overlay',
      },
      {
        className: 'border-white/35 bg-slate-950/55 text-white before:bg-white/75',
        status: 'completed',
        surface: 'overlay',
      },
      {
        className: 'border-white/60 bg-amber-100/95 text-amber-950',
        status: 'upcoming',
        surface: 'overlay',
      },
    ],
    defaultVariants: {
      surface: 'default',
    },
  },
)

type TripStatusBadgeProps = {
  className?: string
  surface?: 'default' | 'overlay'
  trip: Pick<Trip, 'start_date' | 'end_date'>
}

export function TripStatusBadge({
  className,
  surface,
  trip,
}: TripStatusBadgeProps) {
  const timing = getTripTiming(trip)

  return (
    <span
      className={cn(
        tripStatusBadgeVariants({ status: timing.status, surface }),
        className,
      )}
    >
      {getTimingLabel(timing.status, timing.daysUntilStart)}
    </span>
  )
}

function getTimingLabel(status: TripTimingStatus, daysUntilStart: number | null) {
  if (status === 'upcoming' && daysUntilStart !== null) {
    return `Upcoming: ${pluralize(daysUntilStart, 'day')}`
  }

  if (status === 'active') {
    return 'Active'
  }

  return 'Completed'
}
