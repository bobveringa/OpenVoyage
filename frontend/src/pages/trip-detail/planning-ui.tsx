import { resolveConnectionEndpoint, type ConnectionAnchor } from './connection-endpoints'
import { FlightAttribution } from './flight-attribution'
import { ConnectionEditDialog } from './connection-editor'
import { ConnectionLocationPicker } from './connection-location-picker'
import {
  ArrowLeft,
  Clock,
  Minus,
  Navigation,
  PenLine,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  Fragment,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type SyntheticEvent,
} from 'react'

import type { Place } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { Stop, Connection } from '@/pages/trip-detail/models'
import type {
  CreateStopDraft,
  DraftPostLocation,
  MapPointTarget,
  StopEditDraft,
  StopInsertionPoint,
  ConnectionEditDraft,
} from '@/pages/trip-detail/page-types'
import {
  createFirstStopInsertionPoint,
  createStopEditDraft,
  createStopInsertionPointAfterStop,
  formatDistance,
  formatDuration,
  formatNights,
  formatStopDateLabel,
  getNightsBetweenDates,
  getPlaceCoordinates,
  getPlaceNameLabel,
  getPlaceSearchInput,
  getStayLeaveDateValue,
  getStopPlaceName,
  getStopTitleSuggestion,
  getTravelModeIcon,
} from '@/pages/trip-detail/planning-utils'
import { getTravelModeLabel } from '@/pages/trip-detail/shared-utils'
import { PlanningSessionContext } from './planning-session'
import { createOuterConnectionDraft, type ConnectionLocation, type OuterConnectionSide } from './outer-connection'
import { connectionWritePayload } from './planning-utils'
import { useMediaQuery } from './use-media-query'
import { PlaceLocationPicker } from './place-location-picker'
import { ConnectionRemovalDialog } from './connection-removal-dialog'
export { LocationOptionCard } from './place-location-picker'

export function PlanningPanel({
  canMutate,
  isMutating,
  onAddStop,
  onRefreshConnectionRoute,
  onStopChange,
  onStopDelete,
  onStopSave,
  onConnectionSave,
  onConnectionCreate,
  onConnectionDelete,
  pendingAction,
  stops,
  tripStartDate,
  connections,
}: {
  canMutate: boolean
  isMutating: boolean
  onAddStop: (insertionPoint: StopInsertionPoint) => void
  onRefreshConnectionRoute: (connectionId: string) => void
  onStopChange: (stopId: string, updates: Partial<Stop>) => void
  onStopDelete: (stopId: string) => void
  onStopSave: (stopId: string, draft: StopEditDraft) => void
  onConnectionSave: (connectionId: string, draft: ConnectionEditDraft) => void
  onConnectionCreate: (payload: import('@/api/client').ItineraryConnectionReplacePayload) => void
  onConnectionDelete: (connectionId: string) => void
  pendingAction: string | null
  stops: readonly Stop[]
  tripStartDate: string
  connections: readonly Connection[]
}) {
  const [editingStopId, setEditingStopId] = useState<string | null>(null)
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)
  const { airportTransferRequest, connectionMap, saveError } = useContext(PlanningSessionContext)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [outerEditor, setOuterEditor] = useState<{
    side: OuterConnectionSide; connection: Connection; creating: boolean; location: ConnectionLocation | null
  } | null>(null)
  const [removingConnectionId, setRemovingConnectionId] = useState<string | null>(null)
  const [removalSubmitted, setRemovalSubmitted] = useState(false)
  const removingConnection = connections.find((connection) => connection.id === removingConnectionId) ?? null
  function requestRemoval(id: string) {
    if (!canMutate || isMutating) return
    setRemovalSubmitted(false)
    setRemovingConnectionId(id)
  }
  useEffect(() => {
    if (!removingConnection) { setRemovingConnectionId(null); setRemovalSubmitted(false) }
  }, [removingConnection])
  function closeConnectionEditor() {
    if (removingConnectionId) return
    setEditingConnectionId(null)
    setOuterEditor(null)
    connectionMap?.stop()
  }
  function openOuterEditor(side: OuterConnectionSide) {
    const connection = connections.find((item) => item.connection_type === side)
    const endpoint = connection?.[side === 'DEPARTURE' ? 'from' : 'to']
    const location = endpoint?.type === 'LOCATION' ? {
      input: { latitude: endpoint.location.latitude, longitude: endpoint.location.longitude },
      anchor: { title: endpoint.location.name, location: endpoint.location },
    } : null
    connectionMap?.stop()
    setEditingConnectionId(connection?.id ?? null)
    setOuterEditor({ side, connection: connection ?? createOuterConnectionDraft(side, side === 'DEPARTURE' ? stops[0] : stops[stops.length - 1]), creating: !connection, location })
  }
  function editConnection(id: string) {
    const connection = connections.find((item) => item.id === id)
    if (connection?.connection_type === 'DEPARTURE' || connection?.connection_type === 'RETURN') openOuterEditor(connection.connection_type)
    else { connectionMap?.stop(); setOuterEditor(null); setEditingConnectionId(id) }
  }
  useEffect(() => {
    if (outerEditor && (outerEditor.creating
      ? connections.some((connection) => connection.connection_type === outerEditor.side)
      : !connections.some((connection) => connection.id === outerEditor.connection.id))) {
      setOuterEditor(null)
      setEditingConnectionId(null)
      connectionMap?.stop()
    }
  }, [connections, outerEditor, connectionMap])
  const openRequestedConnection = useEffectEvent(editConnection)
  useEffect(() => {
    if (canMutate && airportTransferRequest) {
      openRequestedConnection(airportTransferRequest.connectionId)
    }
  }, [airportTransferRequest, canMutate])
  const addStopDisabled = !canMutate || isMutating
  const editingStop = stops.find((stop) => stop.id === editingStopId) ?? null
  const editingConnection = connections.find((connection) => connection.id === editingConnectionId) ?? outerEditor?.connection ?? null
  const editingConnectionFromStop =
    editingConnection
      ? stops.find((stop) => editingConnection.from.type === 'STOP' && stop.id === editingConnection.from.stop_id) ?? null
      : null
  const editingConnectionToStop =
    editingConnection
      ? stops.find((stop) => editingConnection.to.type === 'STOP' && stop.id === editingConnection.to.stop_id) ?? null
      : null

  return (
    <div className="min-w-0 space-y-5 p-4">
      {outerEditor && desktop ? <>
        <div className="flex items-start gap-3">
          <Button aria-label="Back to stops" title="Back to stops" disabled={isMutating} onClick={closeConnectionEditor} size="icon" type="button" variant="outline">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">{outerEditor.creating ? 'New ' : 'Edit '}{outerEditor.side === 'DEPARTURE' ? 'departure' : 'return'}</h2>
            <p className="text-sm text-muted-foreground">{outerEditor.side === 'DEPARTURE' ? 'Choose a starting place for travel to ' + stops[0].title + '.' : 'Choose a destination after ' + stops[stops.length - 1].title + '.'}</p>
          </div>
        </div>
        <ConnectionLocationPicker key={outerEditor.side + outerEditor.connection.id}
          label={outerEditor.side === 'DEPARTURE' ? 'Departure location' : 'Return location'}
          value={outerEditor.location} disabled={isMutating}
          onRemove={!outerEditor.creating ? () => requestRemoval(outerEditor.connection.id) : undefined}
          onChange={(location) => setOuterEditor((editor) => editor ? { ...editor, location } : null)} />
        <Button variant="outline" disabled={isMutating} onClick={closeConnectionEditor} type="button">Cancel</Button>
      </> : <>
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

        {stops.length > 0 ? <OuterConnectionControl side="DEPARTURE" stops={stops} connections={connections}
          disabled={addStopDisabled} canMutate={canMutate} onEdit={() => openOuterEditor('DEPARTURE')} onRemove={requestRemoval} /> : null}
        {stops.map((stop, index) => {
          const nextStop = stops[index + 1]
          const connection = nextStop
            ? connections.find(
                (connection) =>
                  connection.from.type === 'STOP' && connection.from.stop_id === stop.id &&
                  connection.to.type === 'STOP' && connection.to.stop_id === nextStop.id,
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
              {nextStop && connection ? (
                <ConnectionCard
                  fromStop={stop}
                  connection={connection}
                  disabled={!canMutate || isMutating}
                  onEdit={editConnection}
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
        {stops.length > 0 ? <OuterConnectionControl side="RETURN" stops={stops} connections={connections}
          disabled={addStopDisabled} canMutate={canMutate} onEdit={() => openOuterEditor('RETURN')} onRemove={requestRemoval} /> : null}
      </div>

      <FlightAttribution providers={connections.flatMap((connection) => connection.segments.map((segment) => segment.lookup?.provider))} />
      </>}
      <StopEditDialog
        onClose={() => setEditingStopId(null)}
        onSave={onStopSave}
        open={Boolean(editingStop)}
        saving={isMutating}
        stop={editingStop}
      />
      <ConnectionEditDialog
        fromStop={editingConnectionFromStop}
        connection={editingConnection}
        onClose={closeConnectionEditor}
        onRefreshRoute={onRefreshConnectionRoute}
        onSave={(id, draft) => outerEditor?.creating ? onConnectionCreate(connectionWritePayload(draft)) : onConnectionSave(id, draft)}
        creating={outerEditor?.creating}
        outsideLocation={outerEditor?.location}
        onOutsideLocationChange={outerEditor ? (location) => setOuterEditor((editor) => editor ? { ...editor, location } : null) : undefined}
        onDelete={outerEditor && !outerEditor.creating ? () => requestRemoval(outerEditor.connection.id) : undefined}
        open={Boolean(editingConnection)}
        pendingAction={pendingAction}
        saving={isMutating}
        toStop={editingConnectionToStop}
      />
      <ConnectionRemovalDialog connection={removingConnection} stops={stops} removing={isMutating}
        error={removalSubmitted ? saveError ?? null : null}
        onCancel={() => { if (!isMutating) setRemovingConnectionId(null) }}
        onConfirm={() => {
          if (!removingConnection || !canMutate || isMutating) return
          setRemovalSubmitted(true)
          onConnectionDelete(removingConnection.id)
        }} />
    </div>
  )
}

function OuterConnectionControl({ side, stops, connections, disabled, canMutate, onEdit, onRemove }: {
  side: OuterConnectionSide; stops: readonly Stop[]; connections: readonly Connection[]
  disabled: boolean; canMutate: boolean; onEdit: () => void
  onRemove: (id: string) => void
}) {
  const connection = connections.find((item) => item.connection_type === side)
  const label = side === 'DEPARTURE' ? 'departure' : 'return'
  if (!canMutate && !connection) return null
  const from = connection ? resolveConnectionEndpoint(connection.from, stops) : null
  const to = connection ? resolveConnectionEndpoint(connection.to, stops) : null
  return <div className="space-y-2" aria-label={connection ? label + ' connection' : undefined}>
    {connection && from && to ? <>
      <p className="pl-[4.25rem] text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <ConnectionCard disabled={disabled} fromStop={from} toStop={to} connection={connection} onEdit={onEdit}
        onRemove={canMutate ? () => onRemove(connection.id) : undefined} />
    </> : <StopInsertButton disabled={disabled} label={'Add ' + label} onClick={onEdit} />}

  </div>
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

      <PlaceLocationPicker disabled={isSubmitting} searchValue={searchValue} selectedPlace={selectedSearchPlace}
        resultsOpen={placeResultsOpen} source={locationSource} mapActive={mapPointActive} mapLocation={draftLocation}
        onSearchChange={handleSearchValueChange} onSearchFocus={() => setPlaceResultsOpen(true)}
        onSelectPlace={handlePlaceSelect} onSelectSearch={selectSearchLocation} onSelectMap={selectMapLocation}
        selectedSearchLabel={selectedSearchLabel} mapInstruction="Click on the map to place this stop." />

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

function ConnectionCard({
  disabled,
  fromStop,
  connection,
  onEdit,
  toStop,
  active = false,
  onRemove,
}: {
  active?: boolean
  disabled: boolean
  fromStop: ConnectionAnchor
  connection: Connection
  onEdit: (connectionId: string) => void
  toStop: ConnectionAnchor
  onRemove?: () => void
}) {
  const ModeIcon = getTravelModeIcon(connection.segments[0]?.intent.travel_mode ?? 'CAR')
  const connectionDetail = connection.segments.map((s) => s.intent.flight?.flight_number || s.intent.service_number).filter(Boolean).join(' · ')
  const routeDistanceLabel =
    connection.route.type === 'PROVIDER_BACKED' &&
    typeof connection.route.distance_meters === 'number'
      ? formatDistance(connection.route.distance_meters)
      : null
  const routeDurationLabel =
    typeof connection.duration_seconds === 'number'
      ? `${formatDuration(connection.duration_seconds)}${connection.duration_scope === 'FLIGHT_JOURNEY' ? ' flight journey' : ''}`
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
        <div className="flex min-w-0 items-center gap-1">
        <button
          aria-pressed={active}
          className={cn("flex min-h-10 w-full items-center gap-2 rounded-[1.1rem] border border-border bg-card/85 px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-muted", active && "border-primary bg-primary/5")}
          disabled={disabled}
          onClick={() => onEdit(connection.id)}
          type="button"
        >
          <span className="shrink-0 font-semibold text-primary">
            {connection.segments.map((s) => getTravelModeLabel(s.intent.travel_mode)).join(' → ')}
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
          {connectionDetail ? (
            <span className="hidden max-w-36 shrink-0 truncate text-xs text-muted-foreground md:block">
              {connectionDetail}
            </span>
          ) : null}
          <Badge
            className="hidden shrink-0 lg:inline-flex"
            variant={connection.route.type === 'PROVIDER_BACKED' ? 'default' : 'outline'}
          >
            {connection.segments.some((s) => s.route_state === 'FAILED') ? 'Route unavailable' : connection.route.type === 'PROVIDER_BACKED' ? 'Route ready' : 'Approximate connection'}
          </Badge>
          <PenLine
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
        {onRemove ? <Button aria-label={'Remove ' + (connection.connection_type === 'DEPARTURE' ? 'departure' : 'return') + ' connection'}
          title={'Remove ' + (connection.connection_type === 'DEPARTURE' ? 'departure' : 'return') + ' connection'}
          className="size-8 shrink-0 rounded-xl text-destructive hover:bg-destructive/10" disabled={disabled}
          size="icon" type="button" variant="ghost" onClick={onRemove}><Trash2 className="size-3.5" aria-hidden="true" /></Button> : null}
        </div>
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
