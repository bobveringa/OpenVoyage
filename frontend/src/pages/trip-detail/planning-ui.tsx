import { resolveConnectionEndpoint, type ConnectionAnchor } from './connection-endpoints'
import { FlightAttribution } from './flight-attribution'
import { ConnectionEditDialog } from './connection-editor'
import { ConnectionLocationPicker } from './connection-location-picker'
import {
  ArrowLeft,
  BedDouble,
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
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'

import type { Place, StopNotes } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Stop, Connection } from '@/pages/trip-detail/models'
import type {
  CreateStopDraft,
  DraftPostLocation,
  MapPointTarget,
  StopInsertionPoint,
  ConnectionEditDraft,
} from '@/pages/trip-detail/page-types'
import { Modal } from '@/components/ui/modal'
import { StopDetailCard, type StopCardControls, type StopUpdate } from './stop-card'
import { getStopStayStatus, type StopStayStatus } from './stay-warnings'
import { StaysSection, WarningLine } from './stop-stays'
import {
  createFirstStopInsertionPoint,
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
import {
  DragHandle,
  DropIndicator,
  SLIM_TRAVEL_LINE,
  SMALL_ADD_BUTTONS,
  TimelineGap,
  TravelLine,
} from './stop-timeline'
import { useStopDrag } from './use-stop-drag'
export { LocationOptionCard } from './place-location-picker'

export function PlanningPanel({
  canMutate,
  isMutating,
  onAddStop,
  onRefreshConnectionRoute,
  onStopDelete,
  onStopUpdate,
  onStopNotesSaved,
  openStopId,
  onOpenStop,
  onCloseStop,
  tripEndDate,
  onMoveTripEnd,
  onStayCreate,
  onStayUpdate,
  onStayDelete,
  onStayHover,
  highlightedStopId,
  onStopHover,
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
  onStopDelete: (stopId: string) => void
  onStopUpdate: (stopId: string, update: StopUpdate) => void
  onStopNotesSaved: (stopId: string, notes: StopNotes) => void
  openStopId: string | null
  onOpenStop: (stopId: string) => void
  onCloseStop: () => void
  tripEndDate: StopCardControls['tripEndDate']
  onMoveTripEnd: StopCardControls['onMoveTripEnd']
  onStayCreate: StopCardControls['onStayCreate']
  onStayUpdate: StopCardControls['onStayUpdate']
  onStayDelete: StopCardControls['onStayDelete']
  onStayHover: StopCardControls['onStayHover']
  highlightedStopId: StopCardControls['highlightedStopId']
  onStopHover: StopCardControls['onStopHover']
  onConnectionSave: (connectionId: string, draft: ConnectionEditDraft) => void
  onConnectionCreate: (payload: import('@/api/client').ItineraryConnectionReplacePayload) => void
  onConnectionDelete: (connectionId: string) => void
  pendingAction: string | null
  stops: readonly Stop[]
  tripStartDate: string
  connections: readonly Connection[]
}) {
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)
  const { airportTransferRequest, connectionMap, saveError, stopCardHost } = useContext(PlanningSessionContext)
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
  function openStop(stopId: string) {
    closeConnectionEditor()
    onOpenStop(stopId)
  }
  function closeStop() {
    const stopId = openStopId
    onCloseStop()
    // Put focus back on the row the card came from.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-stop-row="${stopId}"] [data-stop-open]`)?.focus()
    })
  }
  function openOuterEditor(side: OuterConnectionSide) {
    if (openStopId) onCloseStop()
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
    else { if (openStopId) onCloseStop(); connectionMap?.stop(); setOuterEditor(null); setEditingConnectionId(id) }
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
  const listRef = useRef<HTMLDivElement | null>(null)
  const stopDrag = useStopDrag({
    disabled: !canMutate || isMutating,
    listRef,
    onMove: (stopId, placement) => onStopUpdate(stopId, { placement }),
    stops,
  })
  const compactTimeline = SMALL_ADD_BUTTONS && SLIM_TRAVEL_LINE
  const openedStop = stops.find((stop) => stop.id === openStopId) ?? null
  const stayStatuses = useMemo(
    () => stops.map((_, index) => getStopStayStatus(stops, index, tripEndDate)),
    [stops, tripEndDate],
  )
  const openedStatus = openedStop ? stayStatuses[stops.indexOf(openedStop)] ?? null : null
  // A stop with booked stays asks before it's deleted, with its stays.
  const [deletingStopId, setDeletingStopId] = useState<string | null>(null)
  const deletingStop = stops.find((stop) => stop.id === deletingStopId) ?? null
  const deletingBooked = deletingStop?.stays.filter((stay) => stay.status === 'BOOKED').length ?? 0
  function requestStopDelete(stopId: string) {
    const stop = stops.find((item) => item.id === stopId)
    if (stop?.stays.some((stay) => stay.status === 'BOOKED')) setDeletingStopId(stopId)
    else onStopDelete(stopId)
  }
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

      <div className={compactTimeline ? 'space-y-1' : 'space-y-3'} ref={listRef}>
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

          const addLabel = nextStop ? 'Add stop here' : 'Add stop after this stop'
          const addStop = () => onAddStop(createStopInsertionPointAfterStop(stop))
          return (
            <Fragment key={stop.id}>
              {stopDrag.dropGap === index ? <DropIndicator /> : null}
              <StopRow
                active={stop.id === openStopId}
                dragging={stopDrag.draggingStopId === stop.id}
                dragHandle={canMutate && stops.length > 1 ? <DragHandle {...stopDrag.handleProps(stop, index)} /> : null}
                highlighted={stop.id === highlightedStopId}
                index={index}
                disabled={!canMutate || isMutating}
                onChange={onStopUpdate}
                onDelete={requestStopDelete}
                onHover={onStopHover}
                onMoveTripEnd={onMoveTripEnd}
                onOpen={openStop}
                status={stayStatuses[index]!}
                stop={stop}
              />
              {!SLIM_TRAVEL_LINE && nextStop && connection ? (
                <ConnectionCard
                  fromStop={stop}
                  connection={connection}
                  disabled={!canMutate || isMutating}
                  onEdit={editConnection}
                  toStop={nextStop}
                />
              ) : null}
              {SMALL_ADD_BUTTONS || (SLIM_TRAVEL_LINE && nextStop && connection) ? (
                <TimelineGap addLabel={addLabel} disabled={addStopDisabled} onAdd={SMALL_ADD_BUTTONS ? addStop : undefined}>
                  {SLIM_TRAVEL_LINE && nextStop && connection ? (
                    <TravelLine connection={connection} disabled={!canMutate || isMutating}
                      fromStop={stop} onEdit={editConnection} toStop={nextStop} />
                  ) : !nextStop && SMALL_ADD_BUTTONS ? (
                    <span className="text-xs text-muted-foreground">Add a stop</span>
                  ) : null}
                </TimelineGap>
              ) : null}
              {!SMALL_ADD_BUTTONS ? (
                <StopInsertButton disabled={addStopDisabled} label={addLabel} onClick={addStop} />
              ) : null}
            </Fragment>
          )
        })}
        {stopDrag.dropGap === stops.length ? <DropIndicator /> : null}
        <p aria-live="polite" className="sr-only">{stopDrag.announcement}</p>
        {stops.length > 0 ? <OuterConnectionControl side="RETURN" stops={stops} connections={connections}
          disabled={addStopDisabled} canMutate={canMutate} onEdit={() => openOuterEditor('RETURN')} onRemove={requestRemoval} /> : null}
      </div>

      <FlightAttribution providers={connections.flatMap((connection) => connection.segments.map((segment) => segment.lookup?.provider))} />
      </>}
      {openedStop ? (
        <StopDetailCard
          desktop={desktop}
          disabled={!canMutate || isMutating}
          host={stopCardHost ?? null}
          key={openedStop.id}
          onClose={closeStop}
          onNotesSaved={onStopNotesSaved}
          onUpdate={onStopUpdate}
          stop={openedStop}
        >
          {openedStatus?.showStays ? (
            <StaysSection
              actions={{ onCreate: onStayCreate, onUpdate: onStayUpdate, onDelete: onStayDelete, onHover: onStayHover }}
              disabled={!canMutate || isMutating}
              status={openedStatus}
              stop={openedStop}
            />
          ) : null}
        </StopDetailCard>
      ) : null}
      <Modal
        description={deletingStop ? `${deletingStop.title} has ${deletingBooked} booked ${deletingBooked === 1 ? 'stay' : 'stays'}. Delete the stop and its stays?` : undefined}
        footer={<div className="flex justify-end gap-2">
          <Button onClick={() => setDeletingStopId(null)} type="button" variant="outline">Cancel</Button>
          <Button onClick={() => { if (deletingStop) onStopDelete(deletingStop.id); setDeletingStopId(null) }} type="button" variant="destructive">
            Delete stop
          </Button>
        </div>}
        onClose={() => setDeletingStopId(null)}
        open={Boolean(deletingStop)}
        title={deletingStop ? `Delete ${deletingStop.title}?` : 'Delete stop?'}
      >
        <p className="text-sm text-muted-foreground">The booking itself isn't cancelled. Only the plan changes.</p>
      </Modal>
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


function StopRow({
  active,
  disabled,
  dragHandle,
  dragging,
  highlighted,
  index,
  onChange,
  onDelete,
  onHover,
  onMoveTripEnd,
  onOpen,
  status,
  stop,
}: {
  active: boolean
  disabled: boolean
  dragHandle: ReactNode
  dragging: boolean
  highlighted: boolean
  index: number
  onChange: (stopId: string, update: StopUpdate) => void
  onDelete: (stopId: string) => void
  onHover: (stopId: string | null) => void
  onMoveTripEnd: (endDate: string) => void
  onOpen: (stopId: string) => void
  status: StopStayStatus
  stop: Stop
}) {
  // The whole row opens the card, except its own buttons and date pickers.
  function handleRowClick(event: MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, input, a, [role="dialog"]')) return
    onOpen(stop.id)
  }

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
        'grid w-full cursor-pointer grid-cols-[3rem_1fr] gap-3 rounded-[1.5rem] border p-3 text-left transition-colors',
        active
          ? 'border-primary bg-primary/5 shadow-sm shadow-foreground/5'
          : highlighted
            ? 'border-primary/50 bg-muted/45 shadow-sm shadow-foreground/5'
            : 'border-border bg-muted/45 shadow-sm shadow-foreground/5 hover:border-primary/40',
        dragging && 'opacity-60 ring-2 ring-primary/40',
      )}
      data-highlighted={highlighted}
      data-stop-row={stop.id}
      onClick={handleRowClick}
      onMouseEnter={() => onHover(stop.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="grid size-10 place-items-center rounded-2xl bg-secondary text-sm font-semibold text-primary">
        {index + 1}
      </span>
      <span className="min-w-0 space-y-3">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 flex-1">
            <button
              aria-expanded={active}
              className="block max-w-full truncate rounded-md text-left font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-stop-open=""
              onClick={() => onOpen(stop.id)}
              type="button"
            >
              {stop.title}
            </button>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {dragHandle}
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
        {status.stopWarnings.length > 0 ? (
          <span className="block space-y-1">
            {status.stopWarnings.map((warning) => warning.kind === 'NOT_BOOKED' ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" key={warning.kind}>
                <BedDouble className="size-3.5" aria-hidden="true" />
                {warning.message}
              </span>
            ) : (
              <span className="block" key={warning.kind + warning.message}>
                <WarningLine message={warning.message} />
                {warning.moveTripEndTo ? (
                  <Button className="mt-1 h-7 rounded-full px-2.5 text-xs" disabled={disabled}
                    onClick={() => onMoveTripEnd(warning.moveTripEndTo!)} size="sm" type="button" variant="outline">
                    Move trip end to {formatStopDateLabel(warning.moveTripEndTo)}
                  </Button>
                ) : null}
              </span>
            ))}
          </span>
        ) : null}
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
