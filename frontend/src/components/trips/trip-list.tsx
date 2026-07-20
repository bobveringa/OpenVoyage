import { Route } from 'lucide-react'

import type { Trip } from '@/api/client'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

import { TripListItem } from './trip-list-item'

type TripListProps = {
  description?: string
  emptyDescription?: string
  emptyTitle?: string
  hasMore?: boolean
  isOwner: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  showStatusBadge?: boolean
  title?: string
  total: number
  trips: Trip[]
}

export function TripList({
  description,
  emptyDescription,
  emptyTitle,
  hasMore = false,
  isOwner,
  isLoadingMore = false,
  onLoadMore,
  showStatusBadge = false,
  title = 'Trips',
  total,
  trips,
}: TripListProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-white px-5 py-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {description ?? `${total} ${total === 1 ? 'trip' : 'trips'}`}
          </p>
        </div>
      </div>

      {trips.length === 0 ? (
        <EmptyState
          description={
            emptyDescription ??
            (isOwner
              ? 'Trips you create will appear here.'
              : 'There are no readable trips for this user.')
          }
          icon={Route}
          title={emptyTitle ?? (isOwner ? 'No trips yet' : 'No trips to show')}
        />
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-5">
            {trips.map((trip) => (
              <TripListItem
                key={trip.id}
                showStatusBadge={showStatusBadge}
                trip={trip}
              />
            ))}
          </div>
          {hasMore && onLoadMore ? (
            <div className="flex justify-center">
              <Button
                disabled={isLoadingMore}
                onClick={onLoadMore}
                type="button"
                variant="outline"
              >
                {isLoadingMore ? 'Loading' : 'Show more'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
