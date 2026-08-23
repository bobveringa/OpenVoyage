import type { Place } from '@/api/client'

export type PlaceSearchStatus = 'error' | 'idle' | 'loading' | 'success'

type PlaceSearchDropdownProps = {
  disabled: boolean
  error: string | null
  onSelect: (place: Place) => void
  open: boolean
  places: readonly Place[]
  query: string
  status: PlaceSearchStatus
}

export function PlaceSearchDropdown({
  disabled,
  error,
  onSelect,
  open,
  places,
  query,
  status,
}: PlaceSearchDropdownProps) {
  if (!open) {
    return null
  }

  const trimmedQuery = query.trim()

  return (
    <div
      aria-label="Place search results"
      className="overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-sm"
      role="listbox"
    >
      {!trimmedQuery ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Start typing to search places.
        </p>
      ) : null}
      {trimmedQuery && status === 'loading' ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Searching places...
        </p>
      ) : null}
      {trimmedQuery && status === 'error' ? (
        <p className="px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {trimmedQuery && status === 'success' && places.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          No places found.
        </p>
      ) : null}
      {places.map((place) => (
        <button
          aria-selected={false}
          className="grid w-full gap-1 border-t border-border/60 px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          key={place.id}
          onClick={() => onSelect(place)}
          role="option"
          type="button"
        >
          <span className="font-semibold text-foreground">
            {getPlaceNameLabel(place)}
          </span>
          <span className="text-sm text-muted-foreground">
            {formatPlaceDetail(place)}
          </span>
        </button>
      ))}
    </div>
  )
}

function getPlaceNameLabel(place: Place) {
  return place.name || place.full_name
}

function formatPlaceDetail(place: Place) {
  const regionLabel = [place.region, place.country_code].filter(Boolean).join(', ')
  const coordinates = `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`
  return regionLabel ? `${regionLabel} · ${coordinates}` : coordinates
}
