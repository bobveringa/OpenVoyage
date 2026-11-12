import { ArrowRight, MapPin, MousePointer2, Pencil, RotateCcw, X } from 'lucide-react'
import { useContext, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { usePublicSetting } from '@/settings/public-settings'
import { addressSearchMode } from './address-search'
import type { Stop } from './models'
import { PlanningSessionContext } from './planning-session'
import { formatDistance } from './planning-utils'
import type { StopUpdate } from './stop-card'
import { StayAddressSearch } from './stay-address-search'
import { markerDistance, markerRangeError, markerStaySuggestion, sameMarkerPoint, type MarkerPoint } from './stop-marker-utils'

export function StopMarker({
  disabled,
  onUpdate,
  stop,
}: {
  disabled: boolean
  onUpdate: (update: StopUpdate) => void
  stop: Stop
}) {
  const { stopMarkerMap } = useContext(PlanningSessionContext)
  const addressMode = addressSearchMode(usePublicSetting('address_search.provider'))
  const optionsId = useId()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moved = !sameMarkerPoint(stop.location, stop.original_location)
  const atStay = stop.stays.some(({ location }) => location && sameMarkerPoint(stop.location, location))
  const suggestion = markerStaySuggestion(stop)
  const placeName = stop.original_location.name
  const status = atStay
    ? 'At the stay location'
    : moved
      ? `${formatDistance(Math.round(markerDistance(stop, stop.location)))} from the centre of ${placeName}`
      : `At the centre of ${placeName}`

  function move(point: MarkerPoint) {
    const rangeError = markerRangeError(stop, point)
    setError(rangeError)
    if (rangeError) return
    setEditing(false)
    if (!sameMarkerPoint(stop.location, point)) onUpdate({ marker: point })
  }

  return (
    <section aria-labelledby={`${optionsId}-heading`} className="space-y-2.5 border-t border-border pt-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <MapPin className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold" id={`${optionsId}-heading`}>Map marker</h3>
            <p aria-live="polite" className="text-xs text-muted-foreground">{status}</p>
          </div>
        </div>
        <Button
          aria-controls={editing ? optionsId : undefined}
          aria-expanded={editing}
          aria-label={editing ? 'Close marker options' : 'Move marker'}
          className="gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          disabled={disabled || stopMarkerMap?.active}
          onClick={() => { setError(null); setEditing(!editing) }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {editing ? <X className="size-3.5" aria-hidden="true" /> : <Pencil className="size-3.5" aria-hidden="true" />}
          {editing ? 'Close' : 'Edit'}
        </Button>
      </div>

      {suggestion && !stopMarkerMap?.active ? (
        <Button
          className="h-auto min-h-9 w-full justify-between rounded-lg border border-primary/15 bg-primary/6 px-3 py-2 text-left text-xs text-primary hover:bg-primary/12"
          disabled={disabled}
          onClick={() => move(suggestion)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Use stay location
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}

      {editing ? (
        <div className="space-y-2 rounded-xl border border-border/80 bg-muted/30 p-2" id={optionsId}>
          {addressMode !== 'off' ? (
            <StayAddressSearch
              disabled={disabled}
              label={`Search an address in ${placeName}`}
              mode={addressMode}
              near={stop.original_location}
              onPick={(result) => move({ latitude: result.latitude, longitude: result.longitude })}
              tripId={stop.trip_id}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            {stopMarkerMap ? (
              <Button
                className="gap-1.5 px-2 text-xs"
                disabled={disabled}
                onClick={() => { setEditing(false); setError(null); stopMarkerMap.start() }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <MousePointer2 className="size-4" aria-hidden="true" />
                Choose on map
              </Button>
            ) : null}
            {moved ? (
              <Button
                className="gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={disabled}
                onClick={() => { setEditing(false); setError(null); onUpdate({ marker: null }) }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset to original location
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </section>
  )
}
