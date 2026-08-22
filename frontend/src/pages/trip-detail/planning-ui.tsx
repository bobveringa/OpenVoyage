import {
  ArrowLeft,
  Check,
  Clock,
  Minus,
  MousePointer2,
  Navigation,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  Fragment,
  useEffect,
  useState,
  type SyntheticEvent,
} from 'react'

import type { Place } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { Stop, TravelLeg, TravelMode } from '@/pages/trip-detail/models'
import type {
  CreateStopDraft,
  DraftPostLocation,
  MapPointTarget,
  StopEditDraft,
  StopInsertionPoint,
  TravelLegEditDraft,
} from '@/pages/trip-detail/page-types'
import {
  createFirstStopInsertionPoint,
  createStopEditDraft,
  createStopInsertionPointAfterStop,
  createTravelLegEditDraft,
  formatCoordinates,
  formatDistance,
  formatDuration,
  formatNights,
  formatPlaceDetail,
  formatStopDateLabel,
  getNightsBetweenDates,
  getPlaceCoordinates,
  getPlaceNameLabel,
  getPlaceSearchInput,
  getStayLeaveDateValue,
  getStopPlaceName,
  getStopTitleSuggestion,
  getTravelModeIcon,
  nullableTextValue,
  travelModeOptions,
} from '@/pages/trip-detail/planning-utils'
import { getTravelModeLabel } from '@/pages/trip-detail/shared-utils'
import { usePlaceSearch } from '@/pages/trip-detail/use-place-search'

type PlaceSearchStatus = 'error' | 'idle' | 'loading' | 'success'

export function LocationOptionCard({
  active,
  detail,
  icon: Icon,
  label,
  onClick,
  source,
}: {
  active: boolean
  detail: string
  icon: LucideIcon
  label: string
  onClick: () => void
  source: string
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-3 rounded-[1.25rem] border p-3 text-left transition-colors',
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

export function PlaceSearchDropdown({
  disabled,
  error,
  onSelect,
  open,
  places,
  query,
  status,
}: {
  disabled: boolean
  error: string | null
  onSelect: (place: Place) => void
  open: boolean
  places: readonly Place[]
  query: string
  status: PlaceSearchStatus
}) {
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

export function PlanningPanel({
  canMutate,
  isMutating,
  onAddStop,
  onRefreshTravelLegRoute,
  onStopChange,
  onStopDelete,
  onStopSave,
  onTravelLegSave,
  pendingAction,
  stops,
  tripStartDate,
  travelLegs,
}: {
  canMutate: boolean
  isMutating: boolean
  onAddStop: (insertionPoint: StopInsertionPoint) => void
  onRefreshTravelLegRoute: (legId: string) => void
  onStopChange: (stopId: string, updates: Partial<Stop>) => void
  onStopDelete: (stopId: string) => void
  onStopSave: (stopId: string, draft: StopEditDraft) => void
  onTravelLegSave: (legId: string, draft: TravelLegEditDraft) => void
  pendingAction: string | null
  stops: readonly Stop[]
  tripStartDate: string
  travelLegs: readonly TravelLeg[]
}) {
  const [editingStopId, setEditingStopId] = useState<string | null>(null)
  const [editingLegId, setEditingLegId] = useState<string | null>(null)
  const addStopDisabled = !canMutate || isMutating
  const editingStop = stops.find((stop) => stop.id === editingStopId) ?? null
  const editingLeg = travelLegs.find((leg) => leg.id === editingLegId) ?? null
  const editingLegFromStop =
    editingLeg
      ? stops.find((stop) => stop.id === editingLeg.from_stop_id) ?? null
      : null
  const editingLegToStop =
    editingLeg
      ? stops.find((stop) => stop.id === editingLeg.to_stop_id) ?? null
      : null

  return (
    <div className="min-w-0 space-y-5 p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Planning</h2>
        <p className="text-sm text-muted-foreground">
          Build the route one stop at a time.
        </p>
      </div>

      <div className="space-y-3">
        {stops.length === 0 ? (
          <StopInsertButton
            disabled={addStopDisabled}
            label="Create your first stop"
            onClick={() =>
              onAddStop(createFirstStopInsertionPoint(tripStartDate))
            }
          />
        ) : null}

        {stops.map((stop, index) => {
          const nextStop = stops[index + 1]
          const leg = nextStop
            ? travelLegs.find(
                (travelLeg) =>
                  travelLeg.from_stop_id === stop.id &&
                  travelLeg.to_stop_id === nextStop.id,
              )
            : undefined

          return (
            <Fragment key={stop.id}>
              <StopCard
                index={index}
                disabled={!canMutate || isMutating}
                onChange={onStopChange}
                onDelete={onStopDelete}
                onDetails={setEditingStopId}
                stop={stop}
              />
              {nextStop && leg ? (
                <TravelLegCard
                  fromStop={stop}
                  leg={leg}
                  disabled={!canMutate || isMutating}
                  onEdit={setEditingLegId}
                  toStop={nextStop}
                />
              ) : null}
              <StopInsertButton
                disabled={addStopDisabled}
                label={nextStop ? 'Add stop here' : 'Add stop after this stop'}
                onClick={() => onAddStop(createStopInsertionPointAfterStop(stop))}
              />
            </Fragment>
          )
        })}
      </div>

      <StopEditDialog
        onClose={() => setEditingStopId(null)}
        onSave={onStopSave}
        open={Boolean(editingStop)}
        saving={isMutating}
        stop={editingStop}
      />
      <TravelLegEditDialog
        fromStop={editingLegFromStop}
        leg={editingLeg}
        onClose={() => setEditingLegId(null)}
        onRefreshRoute={onRefreshTravelLegRoute}
        onSave={onTravelLegSave}
        open={Boolean(editingLeg && editingLegFromStop && editingLegToStop)}
        pendingAction={pendingAction}
        saving={isMutating}
        toStop={editingLegToStop}
      />
    </div>
  )
}

function StopInsertButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <div className="grid grid-cols-[3.25rem_1fr] gap-3 px-1 py-0.5">
      <div className="flex justify-center">
        <div className="flex w-0 flex-col items-center">
          <span className="h-2 w-px bg-border" />
          <span className="grid size-8 shrink-0 place-items-center rounded-2xl border border-dashed border-input bg-muted text-primary">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <span className="h-2 w-px bg-border" />
        </div>
      </div>

      <button
        className="flex min-h-10 w-full items-center justify-center gap-2 rounded-[1.1rem] border border-dashed border-input bg-muted/55 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:border-primary/50 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        <Plus className="size-4" aria-hidden="true" />
        {label}
      </button>
    </div>
  )
}

export function CreateStopPanel({
  draftLocation,
  insertionPoint,
  isSubmitting,
  mapPointActive,
  onCancel,
  onCreateStop,
  onMapPointTargetChange,
}: {
  draftLocation: DraftPostLocation | null
  insertionPoint: StopInsertionPoint
  isSubmitting: boolean
  mapPointActive: boolean
  onCancel: () => void
  onCreateStop: (draft: CreateStopDraft) => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
}) {
  const [locationSource, setLocationSource] = useState<'map' | 'search'>(
    mapPointActive ? 'map' : 'search',
  )
  const [newStopDate, setNewStopDate] = useState(
    insertionPoint.plannedStartDate,
  )
  const [newStopNights, setNewStopNights] = useState(2)
  const [searchValue, setSearchValue] = useState('')
  const [selectedSearchPlace, setSelectedSearchPlace] = useState<Place | null>(
    null,
  )
  const [placeResultsOpen, setPlaceResultsOpen] = useState(false)
  const [stopTitle, setStopTitle] = useState('')
  const [stopTitleEdited, setStopTitleEdited] = useState(false)
  const placeSearch = usePlaceSearch(
    searchValue,
    locationSource === 'search' && !isSubmitting,
  )
  const selectedSearchCoordinates = selectedSearchPlace
    ? getPlaceCoordinates(selectedSearchPlace)
    : null
  const selectedSearchLabel =
    selectedSearchPlace ? getPlaceNameLabel(selectedSearchPlace) : searchValue.trim()
  const suggestedStopTitle =
    locationSource === 'map' && mapPointActive && draftLocation
      ? getStopTitleSuggestion(draftLocation.label)
      : (selectedSearchPlace?.name ?? searchValue.trim())
  const selectedCoordinates =
    locationSource === 'map' && mapPointActive && draftLocation
      ? draftLocation.coordinates
      : selectedSearchCoordinates
  const hasSelectedLocation =
    locationSource === 'map'
      ? Boolean(mapPointActive && draftLocation)
      : Boolean(selectedSearchPlace)

  useEffect(() => {
    if (mapPointActive) {
      setLocationSource('map')
      return
    }

    if (!draftLocation) {
      setLocationSource('search')
    }
  }, [draftLocation, mapPointActive])

  useEffect(() => {
    setNewStopDate(insertionPoint.plannedStartDate)
  }, [insertionPoint.plannedStartDate])

  useEffect(() => {
    if (!stopTitleEdited) {
      setStopTitle(suggestedStopTitle)
    }
  }, [stopTitleEdited, suggestedStopTitle])

  function handleSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault()
    if (
      stopTitle.trim().length === 0 ||
      !hasSelectedLocation ||
      !selectedCoordinates ||
      isSubmitting
    ) {
      return
    }

    onCreateStop({
      afterStopId: insertionPoint.afterStopId,
      coordinates: selectedCoordinates,
      notes: '',
      placeId:
        locationSource === 'search' && selectedSearchPlace
          ? selectedSearchPlace.id
          : null,
      plannedNights: newStopNights,
      plannedStartDate: newStopDate,
      title: stopTitle.trim(),
    })
  }

  function selectSearchLocation() {
    setLocationSource('search')
    onMapPointTargetChange(null)
    setPlaceResultsOpen(true)
  }

  function selectMapLocation() {
    setLocationSource('map')
    onMapPointTargetChange('stop')
  }

  function handleSearchValueChange(value: string) {
    if (isSubmitting) {
      return
    }

    selectSearchLocation()
    setSearchValue(value)
    setSelectedSearchPlace(null)
    setPlaceResultsOpen(true)
  }

  function handlePlaceSelect(place: Place) {
    if (isSubmitting) {
      return
    }

    selectSearchLocation()
    setSelectedSearchPlace(place)
    setSearchValue(getPlaceSearchInput(place))
    setStopTitle(place.name)
    setStopTitleEdited(false)
    setPlaceResultsOpen(false)
  }

  return (
    <form className="min-w-0 space-y-5 p-4" onSubmit={handleSubmit}>
      <div className="flex items-start gap-3">
        <Button
          aria-label="Back to stops"
          onClick={onCancel}
          size="icon"
          title="Back to stops"
          type="button"
          variant="outline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div>
          <h2 className="text-base font-semibold text-foreground">New stop</h2>
          <p className="text-sm text-muted-foreground">
            Add a place to the itinerary.
          </p>
        </div>
      </div>

      <section className="space-y-3 rounded-[1.5rem] border border-border bg-muted/70 p-4">
        <label className="grid gap-2 text-sm font-medium text-foreground">
          Search places
          <span className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-9"
              disabled={isSubmitting}
              onChange={(event) => {
                handleSearchValueChange(event.target.value)
              }}
              onFocus={() => setPlaceResultsOpen(true)}
              placeholder="Search places"
              value={searchValue}
            />
          </span>
        </label>
        <PlaceSearchDropdown
          disabled={isSubmitting}
          error={placeSearch.error}
          onSelect={handlePlaceSelect}
          open={
            locationSource === 'search' &&
            placeResultsOpen &&
            !selectedSearchPlace
          }
          places={placeSearch.places}
          query={searchValue}
          status={placeSearch.status}
        />

        <LocationOptionCard
          active={locationSource === 'search' && !mapPointActive}
          detail={
            selectedSearchPlace
              ? formatPlaceDetail(selectedSearchPlace)
              : 'Select a place from the geocode results.'
          }
          icon={Search}
          label={selectedSearchLabel || 'Search for a place'}
          onClick={selectSearchLocation}
          source="Searched place"
        />

        <LocationOptionCard
          active={locationSource === 'map' && mapPointActive}
          detail={
            locationSource === 'map' && mapPointActive && draftLocation
              ? `Map point · ${formatCoordinates(draftLocation.coordinates)}`
              : locationSource === 'map' && mapPointActive
                ? 'Click on the map to place this stop.'
                : 'Map placement disabled'
          }
          icon={MousePointer2}
          label={draftLocation?.label ?? 'Map point'}
          onClick={selectMapLocation}
          source={
            locationSource === 'map' && mapPointActive
              ? 'Active map source'
              : 'Exact point'
          }
        />
      </section>

      <section className="space-y-3 rounded-[1.5rem] border border-border bg-card p-4">
        <div>
          <h3 className="font-semibold text-foreground">Stop title</h3>
          <p className="text-sm text-muted-foreground">
            Prefilled from the selected place, editable for the itinerary.
          </p>
        </div>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Title
          <Input
            disabled={isSubmitting}
            maxLength={255}
            onChange={(event) => {
              setStopTitle(event.target.value)
              setStopTitleEdited(true)
            }}
            placeholder="Place name"
            value={stopTitle}
          />
        </label>

        {suggestedStopTitle &&
        stopTitleEdited &&
        stopTitle !== suggestedStopTitle ? (
          <Button
            className="w-fit"
            onClick={() => {
              setStopTitle(suggestedStopTitle)
              setStopTitleEdited(false)
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Use place name
          </Button>
        ) : null}
      </section>

      <section className="min-w-0 space-y-4 rounded-[1.5rem] border border-border bg-card p-4">
        <div>
          <h3 className="font-semibold text-foreground">Schedule</h3>
          <p className="text-sm text-muted-foreground">
            {newStopDate} · {newStopNights} nights
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Date
            <DatePicker
              disabled={isSubmitting}
              onValueChange={setNewStopDate}
              value={newStopDate}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Nights
            <Input
              disabled={isSubmitting}
              min={0}
              onChange={(event) =>
                setNewStopNights(Math.max(0, Number(event.target.value)))
              }
              type="number"
              value={newStopNights}
            />
          </label>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button disabled={isSubmitting} onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={
            stopTitle.trim().length === 0 || !hasSelectedLocation || isSubmitting
          }
          type="submit"
        >
          <Plus className="size-4" aria-hidden="true" />
          {isSubmitting ? 'Creating' : 'Create stop'}
        </Button>
      </div>
    </form>
  )
}


function StopCard({
  disabled,
  index,
  onChange,
  onDelete,
  onDetails,
  stop,
}: {
  disabled: boolean
  index: number
  onChange: (stopId: string, updates: Partial<Stop>) => void
  onDelete: (stopId: string) => void
  onDetails: (stopId: string) => void
  stop: Stop
}) {
  function updateNights(nextValue: number) {
    onChange(stop.id, {
      planned_nights: Math.max(0, nextValue),
    })
  }

  function updateLeaveDate(leaveDate: string) {
    onChange(stop.id, {
      planned_nights: getNightsBetweenDates(stop.planned_start_date, leaveDate),
    })
  }

  const leaveDate = getStayLeaveDateValue(
    stop.planned_start_date,
    stop.planned_nights,
  )

  return (
    <article
      className={cn(
        'grid w-full grid-cols-[3rem_1fr] gap-3 rounded-[1.5rem] border p-3 text-left',
        'border-border bg-muted/45 shadow-sm shadow-foreground/5',
      )}
    >
      <span className="grid size-10 place-items-center rounded-2xl bg-secondary text-sm font-semibold text-primary">
        {index + 1}
      </span>
      <span className="min-w-0 space-y-3">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-foreground">
              {stop.title}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button
              aria-label={`Show details for ${stop.title}`}
              className="size-8 rounded-xl"
              disabled={disabled}
              onClick={() => onDetails(stop.id)}
              size="icon"
              title={`Show details for ${stop.title}`}
              type="button"
              variant="outline"
            >
              <PenLine className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              aria-label={`Delete ${stop.title}`}
              className="size-8 rounded-xl text-destructive hover:bg-destructive/10"
              disabled={disabled}
              onClick={() => onDelete(stop.id)}
              size="icon"
              title={`Delete ${stop.title}`}
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </span>
        </span>

        <div className="grid grid-cols-2 rounded-2xl border border-border bg-card shadow-sm sm:min-h-14 sm:grid-cols-[minmax(0,1fr)_7.75rem_minmax(0,1fr)]">
          <div className="min-w-0 px-3 py-2">
            <span className="block text-[0.65rem] font-semibold uppercase text-muted-foreground">
              Arrive
            </span>
            <DatePicker
              ariaLabel={`Edit arrival date for ${stop.title}`}
              className="mt-1"
              disabled={disabled}
              displayValue={formatStopDateLabel(stop.planned_start_date)}
              onValueChange={(planned_start_date) =>
                onChange(stop.id, {
                  planned_start_date,
                })
              }
              triggerClassName="h-auto min-h-0 justify-start gap-1.5 rounded-lg border-0 bg-transparent p-0 text-sm font-semibold shadow-none hover:border-transparent hover:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [&>svg]:size-3.5"
              value={stop.planned_start_date}
            />
          </div>

          <div className="min-w-0 border-l border-border bg-card/70 px-3 py-2 text-right sm:order-3">
            <span className="block text-[0.65rem] font-semibold uppercase text-muted-foreground">
              Leave
            </span>
            <DatePicker
              ariaLabel={`Edit leave date for ${stop.title}`}
              className="mt-1"
              disabled={disabled}
              displayValue={formatStopDateLabel(leaveDate)}
              min={stop.planned_start_date}
              onValueChange={updateLeaveDate}
              popoverAlign="end"
              triggerClassName="h-auto min-h-0 justify-end gap-1.5 rounded-lg border-0 bg-transparent p-0 text-sm font-semibold shadow-none hover:border-transparent hover:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [&>svg]:size-3.5"
              value={leaveDate}
            />
          </div>

          <div className="col-span-2 grid grid-cols-[2rem_minmax(0,1fr)_2rem] border-t border-border bg-muted/50 sm:order-2 sm:col-span-1 sm:border-x sm:border-t-0">
            <button
              aria-label={`Remove one night from ${stop.title}`}
              className="grid place-items-center border-r border-border text-primary transition-colors hover:bg-secondary/70"
              disabled={disabled}
              onClick={() => updateNights(stop.planned_nights - 1)}
              type="button"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <span className="grid min-h-14 place-items-center px-1 text-center leading-none">
              <span className="text-[0.65rem] font-semibold uppercase text-muted-foreground">
                Stay
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatNights(stop.planned_nights)}
              </span>
            </span>
            <button
              aria-label={`Add one night to ${stop.title}`}
              className="grid place-items-center border-l border-border text-primary transition-colors hover:bg-secondary/70"
              disabled={disabled}
              onClick={() => updateNights(stop.planned_nights + 1)}
              type="button"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </span>
    </article>
  )
}

function TravelLegCard({
  disabled,
  fromStop,
  leg,
  onEdit,
  toStop,
}: {
  disabled: boolean
  fromStop: Stop
  leg: TravelLeg
  onEdit: (legId: string) => void
  toStop: Stop
}) {
  const ModeIcon = getTravelModeIcon(leg.travel_mode)
  const legDetail = [leg.operator, leg.reference].filter(Boolean).join(' · ')
  const routeDistanceLabel =
    leg.route.type === 'PROVIDER_BACKED' &&
    typeof leg.route.distance_meters === 'number'
      ? formatDistance(leg.route.distance_meters)
      : null
  const routeDurationLabel =
    leg.route.type === 'PROVIDER_BACKED' &&
    typeof leg.route.duration_seconds === 'number'
      ? formatDuration(leg.route.duration_seconds)
      : null
  const hasRouteMetrics = Boolean(routeDistanceLabel || routeDurationLabel)

  return (
    <div className="grid grid-cols-[3.25rem_1fr] gap-3 px-1 py-0.5">
      <div className="flex justify-center">
        <div className="flex w-0 flex-col items-center">
          <span className="h-2 w-px bg-border" />
          <span className="grid size-8 shrink-0 place-items-center rounded-2xl border border-border bg-card text-primary shadow-sm">
            <ModeIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="h-2 w-px bg-border" />
        </div>
      </div>

      <section className="min-w-0">
        <button
          className="flex min-h-10 w-full items-center gap-2 rounded-[1.1rem] border border-border bg-card/85 px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-muted"
          disabled={disabled}
          onClick={() => onEdit(leg.id)}
          type="button"
        >
          <span className="shrink-0 font-semibold text-primary">
            {getTravelModeLabel(leg.travel_mode)}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-foreground',
              hasRouteMetrics && 'hidden sm:block',
            )}
          >
            {fromStop.title} to {toStop.title}
          </span>
          {hasRouteMetrics ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
              {routeDurationLabel ? (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-muted px-1.5 py-0.5">
                  <Clock className="size-3" aria-hidden="true" />
                  {routeDurationLabel}
                </span>
              ) : null}
              {routeDistanceLabel ? (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-muted px-1.5 py-0.5">
                  <Navigation className="size-3" aria-hidden="true" />
                  {routeDistanceLabel}
                </span>
              ) : null}
            </span>
          ) : null}
          {legDetail ? (
            <span className="hidden max-w-36 shrink-0 truncate text-xs text-muted-foreground md:block">
              {legDetail}
            </span>
          ) : null}
          <Badge
            className="hidden shrink-0 lg:inline-flex"
            variant={leg.route.type === 'PROVIDER_BACKED' ? 'default' : 'outline'}
          >
            {leg.route.type === 'PROVIDER_BACKED' ? 'Provider route' : 'Simple route'}
          </Badge>
          <PenLine
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </section>
    </div>
  )
}

function StopEditDialog({
  onClose,
  onSave,
  open,
  saving,
  stop,
}: {
  onClose: () => void
  onSave: (stopId: string, draft: StopEditDraft) => void
  open: boolean
  saving: boolean
  stop: Stop | null
}) {
  const [draft, setDraft] = useState<StopEditDraft>(() =>
    createStopEditDraft(stop),
  )

  function updateNights(nextValue: number) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      plannedNights: Math.max(0, nextValue),
    }))
  }

  function updateLeaveDate(leaveDate: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      plannedNights: getNightsBetweenDates(
        currentDraft.plannedStartDate,
        leaveDate,
      ),
    }))
  }

  useEffect(() => {
    if (open) {
      setDraft(createStopEditDraft(stop))
    }
  }, [open, stop])

  if (!stop) {
    return null
  }

  const leaveDate = getStayLeaveDateValue(
    draft.plannedStartDate,
    draft.plannedNights,
  )
  const canSave = draft.title.trim().length > 0 && !saving

  return (
    <Modal
      description="Edit this itinerary stop."
      onClose={onClose}
      open={open}
      title={`Edit ${stop.title}`}
    >
      <div className="grid gap-5">
        <section className="space-y-3 rounded-[1.5rem] border border-border bg-muted/45 p-4">
          <div>
            <h3 className="font-semibold text-foreground">Stop</h3>
            <p className="text-sm text-muted-foreground">
              {getStopPlaceName(stop)}
            </p>
          </div>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Title
            <Input
              disabled={saving}
              maxLength={255}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  title: event.target.value,
                }))
              }
              value={draft.title}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Notes
            <Textarea
              className="min-h-32 resize-none"
              disabled={saving}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  notes: event.target.value,
                }))
              }
              value={draft.notes}
            />
          </label>
        </section>

        <section className="grid gap-4 rounded-[1.5rem] border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Arrival date
            <DatePicker
              disabled={saving}
              onValueChange={(planned_start_date) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  plannedStartDate: planned_start_date,
                }))
              }
              value={draft.plannedStartDate}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Leave date
            <DatePicker
              disabled={saving}
              min={draft.plannedStartDate}
              onValueChange={updateLeaveDate}
              value={leaveDate}
            />
          </label>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Nights</span>
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <button
                className="grid place-items-center border-r border-border text-primary transition-colors hover:bg-muted"
                disabled={saving}
                onClick={() => updateNights(draft.plannedNights - 1)}
                type="button"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <input
                className="h-10 w-full bg-card text-center text-sm font-semibold text-foreground focus-visible:outline-none"
                disabled={saving}
                min={0}
                onChange={(event) => updateNights(Number(event.target.value))}
                type="number"
                value={draft.plannedNights}
              />
              <button
                className="grid place-items-center border-l border-border text-primary transition-colors hover:bg-muted"
                disabled={saving}
                onClick={() => updateNights(draft.plannedNights + 1)}
                type="button"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={saving} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => onSave(stop.id, draft)}
            type="button"
          >
            {saving ? 'Saving' : 'Save stop'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TravelLegEditDialog({
  fromStop,
  leg,
  onClose,
  onRefreshRoute,
  onSave,
  open,
  pendingAction,
  saving,
  toStop,
}: {
  fromStop: Stop | null
  leg: TravelLeg | null
  onClose: () => void
  onRefreshRoute: (legId: string) => void
  onSave: (legId: string, draft: TravelLegEditDraft) => void
  open: boolean
  pendingAction: string | null
  saving: boolean
  toStop: Stop | null
}) {
  const [draft, setDraft] = useState<TravelLegEditDraft>(() =>
    createTravelLegEditDraft(leg),
  )

  useEffect(() => {
    if (open) {
      setDraft(createTravelLegEditDraft(leg))
    }
  }, [leg, open])

  if (!leg || !fromStop || !toStop) {
    return null
  }

  const ModeIcon = getTravelModeIcon(draft.travelMode)
  const isRefreshing = pendingAction === 'Refreshing route'

  return (
    <Modal
      description="Edit the travel leg and route source."
      onClose={onClose}
      open={open}
      title={`${fromStop.title} to ${toStop.title}`}
    >
      <div className="grid gap-5">
        <section className="space-y-3 rounded-[1.5rem] border border-border bg-muted/45 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-card text-primary">
              <ModeIcon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground">Travel leg</h3>
              <p className="truncate text-sm text-muted-foreground">
                {fromStop.location.name} to {toStop.location.name}
              </p>
            </div>
          </div>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Mode
            <Select<TravelMode>
              disabled={saving}
              onValueChange={(travelMode) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  travelMode,
                }))
              }
              options={travelModeOptions}
              value={draft.travelMode}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={leg.route.type === 'PROVIDER_BACKED' ? 'default' : 'outline'}
            >
              {leg.route.type === 'PROVIDER_BACKED'
                ? 'Provider route'
                : 'Simple route'}
            </Badge>
            {leg.route.distance_meters ? (
              <span className="text-xs text-muted-foreground">
                {formatDistance(leg.route.distance_meters)}
              </span>
            ) : null}
            {leg.route.duration_seconds ? (
              <span className="text-xs text-muted-foreground">
                {formatDuration(leg.route.duration_seconds)}
              </span>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 rounded-[1.5rem] border border-border bg-card p-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Operator
            <Input
              disabled={saving}
              maxLength={255}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  operator: nullableTextValue(event.target.value),
                }))
              }
              placeholder="Rail company, airline, rental firm"
              value={draft.operator ?? ''}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Reference
            <Input
              disabled={saving}
              maxLength={255}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  reference: nullableTextValue(event.target.value),
                }))
              }
              placeholder="Train number, booking code, route"
              value={draft.reference ?? ''}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground sm:col-span-2">
            Notes
            <Textarea
              className="min-h-32 resize-none"
              disabled={saving}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  notes: event.target.value,
                }))
              }
              placeholder="Tickets, buffers, transfers, pickup notes"
              value={draft.notes}
            />
          </label>
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            disabled={saving}
            onClick={() => onRefreshRoute(leg.id)}
            type="button"
            variant="outline"
          >
            <RefreshCw
              className={cn('size-4', isRefreshing && 'animate-spin')}
              aria-hidden="true"
            />
            {isRefreshing ? 'Refreshing route' : 'Refresh route'}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={() => onSave(leg.id, draft)}
              type="button"
            >
              {saving ? 'Saving' : 'Save leg'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
