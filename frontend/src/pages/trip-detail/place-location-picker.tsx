import { Check, MousePointer2, Search, type LucideIcon } from 'lucide-react'
import type { Place } from '@/api/client'
import { PlaceSearchDropdown } from '@/components/places/place-search-dropdown'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { usePlaceSearch } from '@/hooks/use-place-search'
import type { DraftPostLocation } from './page-types'
import { formatCoordinates, formatPlaceDetail, getPlaceNameLabel } from './planning-utils'
import type { ReactNode } from 'react'

export function LocationOptionCard({
  active,
  disabled = false,
  detail,
  icon: Icon,
  label,
  onClick,
  source,
}: {
  active: boolean
  disabled?: boolean
  detail: string
  icon: LucideIcon
  label: string
  onClick: () => void
  source: string
}) {
  return (
    <button
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3 rounded-[1.25rem] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-primary bg-card shadow-sm ring-2 ring-primary/12'
          : 'border-border bg-card/75 hover:bg-card',
      )}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-2xl',
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-primary',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase text-muted-foreground">
          {source}
        </span>
        <span className="mt-0.5 block truncate font-semibold text-foreground">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
          {detail}
        </span>
      </span>
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full border transition-colors',
          active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-transparent',
        )}
      >
        <Check className="size-4" aria-hidden="true" />
      </span>
    </button>
  )
}

export function PlaceLocationPicker({
  disabled, searchValue, selectedPlace, resultsOpen, source, mapActive, mapLocation,
  onSearchChange, onSearchFocus, onSelectPlace, onSelectSearch, onSelectMap,
  selectedSearchLabel, mapInstruction, children,
}: {
  disabled: boolean
  searchValue: string
  selectedPlace: Place | null
  resultsOpen: boolean
  source: 'search' | 'map'
  mapActive: boolean
  mapLocation: DraftPostLocation | null
  onSearchChange: (value: string) => void
  onSearchFocus: () => void
  onSelectPlace: (place: Place) => void
  onSelectSearch: () => void
  onSelectMap: () => void
  selectedSearchLabel?: string
  mapInstruction: string
  children?: ReactNode
}) {
  const search = usePlaceSearch(searchValue, source === 'search' && !disabled)
  return <section className="space-y-3 rounded-[1.5rem] border border-border bg-muted/70 p-4">
    <label className="grid gap-2 text-sm font-medium text-foreground">
      Search places
      <span className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-9" disabled={disabled} onChange={(event) => onSearchChange(event.target.value)}
          onFocus={onSearchFocus} placeholder="Search places" value={searchValue} />
      </span>
    </label>
    <PlaceSearchDropdown disabled={disabled} error={search.error} onSelect={onSelectPlace}
      open={source === 'search' && resultsOpen && !selectedPlace}
      places={search.places} query={searchValue} status={search.status} />
    {children}
    <LocationOptionCard active={source === 'search' && !mapActive}
      detail={selectedPlace ? formatPlaceDetail(selectedPlace) : 'Select a place from the geocode results.'}
      icon={Search} label={selectedSearchLabel || (selectedPlace ? getPlaceNameLabel(selectedPlace) : searchValue.trim()) || 'Search for a place'}
      onClick={onSelectSearch} source="Searched place" disabled={disabled} />
    <LocationOptionCard active={source === 'map' && mapActive}
      detail={source === 'map' && mapActive && mapLocation ? `Map point · ${formatCoordinates(mapLocation.coordinates)}`
        : source === 'map' && mapActive ? mapInstruction : 'Map placement disabled'}
      icon={MousePointer2} label={mapLocation?.label ?? 'Map point'} onClick={onSelectMap}
      source={source === 'map' && mapActive ? 'Active map source' : 'Exact point'} disabled={disabled} />
  </section>
}
