import { CalendarDays, ImageIcon } from 'lucide-react'

import type { Trip } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { MediaImage } from '@/components/ui/media-image'
import { formatDateRange } from '@/lib/dates'

import { TripStatusBadge } from './trip-status-badge'

type TripListItemProps = {
  showStatusBadge?: boolean
  trip: Trip
}

export function TripListItem({
  showStatusBadge = false,
  trip,
}: TripListItemProps) {
  return (
    <a
      className="group overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-900/10"
      href={`/trips/${trip.id}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-emerald-50">
        <MediaImage
          alt={`${trip.name} cover`}
          className="absolute inset-0 size-full transition-transform duration-300 group-hover:scale-[1.03]"
          fallback={<ImageIcon className="size-7" aria-hidden="true" />}
          media={trip.cover_media}
        />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/45 via-slate-950/10 to-transparent" />
        {showStatusBadge ? (
          <TripStatusBadge
            className="absolute left-3 top-3"
            surface="overlay"
            trip={trip}
          />
        ) : null}
      </div>

      <div className="grid min-h-48 content-start gap-3 p-5">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold tracking-normal text-foreground group-hover:text-primary">
            {trip.name}
          </h2>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />
            {formatDateRange(trip.start_date, trip.end_date)}
          </p>
        </div>

        {trip.description ? (
          <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
            {trip.description}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{formatVisibility(trip.visibility)}</Badge>
        </div>
      </div>
    </a>
  )
}

function formatVisibility(visibility: Trip['visibility']) {
  if (visibility === 'PLATFORM_PUBLIC') {
    return 'Platform public'
  }

  return visibility.toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase())
}
