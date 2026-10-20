import { connectionEndpointInput, resolveConnectionEndpoint } from './connection-endpoints'
import { TripLeafletMap } from './trip-map'
import { EMPTY_TRACKING_GEOMETRY } from './models'
import { useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Loader2, MapPin, Plus, Trash2 } from 'lucide-react'
import { getErrorMessage, lookupFlight, previewTravel, type FlightLookupResult, type PlanningPreview, type PlanningSegment } from '@/api/client'
import { PlaceSearchDropdown } from '@/components/places/place-search-dropdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RouteChooserShell } from './route-chooser-shell'
import { useMediaQuery } from './use-media-query'
import { Textarea } from '@/components/ui/textarea'
import { usePlaceSearch } from '@/hooks/use-place-search'
import type { Stop, TravelLeg, TravelMode } from './models'
import type { TravelLegEditDraft } from './page-types'
import { connectionWritePayload, createTravelLegEditDraft, formatDuration, getStayLeaveDateValue, getTravelModeIcon, travelModeOptions } from './planning-utils'
import { connectionWithOptions, routeDistance, routeTime } from './route-choice-utils'
import { PlanningPreviewCache, planningPreviewKey } from './planning-preview-cache'
import { PlanningSessionContext } from './planning-session'
import { airportTransferLabel, getAirportTransfers, type AirportTransfer, type AirportTransferSide } from './airport-transfers'
import type { ConnectionLocation } from './outer-connection'
import { ConnectionLocationPicker } from './connection-location-picker'
import type { ConnectionAnchor } from './connection-endpoints'

type PlaceInput = NonNullable<PlanningSegment['via']>
const roadModes = ['CAR', 'BIKE', 'WALK']
const transitLabels: Record<string, [string, string]> = {
  TRAIN: ['Rail company', 'Train number'], BUS: ['Bus company', 'Service number'],
  FERRY: ['Ferry company', 'Service'], OTHER: ['Service company', 'Service number'],
}

export function EndpointPicker({ label, value, airport = false, placeholder, onChange, disabled }: {
  label: string; value?: PlaceInput | null; airport?: boolean; placeholder?: string
  onChange: (value: PlaceInput | null, resolved?: ConnectionAnchor['location']) => void; disabled: boolean
}) {
  const [airportOnly, setAirportOnly] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<{ id: string; label: string } | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const search = usePlaceSearch(query, searching, airport || airportOnly ? 'AIRPORT' : undefined)
  const coordinates = query.split(',').map((part) => Number(part.trim()))
  const validCoordinates = !airport && query.includes(',') && coordinates.length === 2 &&
    coordinates.every(Number.isFinite) && Math.abs(coordinates[0]) <= 90 && Math.abs(coordinates[1]) <= 180
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2">
      <label className="grid min-w-0 grid-cols-1 gap-1 text-sm font-medium">{label}
        <Input className="min-w-0 max-w-full" disabled={disabled} placeholder={placeholder || (value ? 'Selected place' : airport ? 'Airport name or code' : 'Search a place, or latitude, longitude')}
          value={query} onChange={(event) => { setQuery(event.target.value); setSearching(true) }} />
      </label>
      {!airport ? <Button disabled={disabled} type="button" variant="ghost" onClick={() => { setAirportOnly((previous) => !previous); setSearching(true) }}>{airportOnly ? 'Search places' : 'Search airports'}</Button> : null}
      {value ? <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
        <span className="min-w-0 break-words">{selectedPlace && 'place_id' in value && selectedPlace.id === value.place_id ? selectedPlace.label : placeholder || ('latitude' in value ? value.latitude + ', ' + value.longitude : 'Place selected')}</span>
        <Button className="h-auto min-w-0 max-w-full whitespace-normal py-2" disabled={disabled} variant="ghost" type="button" onClick={() => { onChange(null); setSelectedPlace(null); setQuery(''); setSearching(false) }}>Clear {label.toLowerCase()}</Button>
      </div> : null}
      <PlaceSearchDropdown placeType={airport || airportOnly ? 'AIRPORT' : undefined} disabled={disabled} open={searching} places={search.places}
        status={search.status} error={search.error} query={query}
        onSelect={(place) => { onChange({ place_id: place.id }, place); setSelectedPlace({ id: place.id, label: place.iata_code ? place.name + ' (' + place.iata_code + ')' : place.name }); setQuery(place.iata_code ? place.name + ' (' + place.iata_code + ')' : place.name); setSearching(false) }} />
      {validCoordinates ? <Button disabled={disabled} type="button" variant="outline" onClick={() => {
        onChange({ latitude: coordinates[0], longitude: coordinates[1] }, { latitude: coordinates[0], longitude: coordinates[1], name: coordinates.join(', ') }); setSearching(false)
      }}>Use coordinates</Button> : null}
    </div>
  )
}

export function TravelLegEditDialog({ fromStop, leg, onClose, onSave, open, saving, toStop, creating = false, outsideLocation, onOutsideLocationChange, onDelete }: {
  fromStop: Stop | null; leg: TravelLeg | null; onClose: () => void
  onRefreshRoute: (legId: string) => void; onSave: (id: string, draft: TravelLegEditDraft) => void
  open: boolean; pendingAction: string | null; saving: boolean; toStop: Stop | null
  creating?: boolean
  outsideLocation?: ConnectionLocation | null
  onOutsideLocationChange?: (value: ConnectionLocation | null) => void
  onDelete?: () => void
}) {
  const session = useContext(PlanningSessionContext)
  const desktop = useMediaQuery('(min-width: 1024px)')
  const [details, setDetails] = useState<number | null>(null)
  const [transferSide, setTransferSide] = useState<AirportTransferSide | null>(null)
  const handledTransferRequest = useRef(0)
  const [draft, setDraft] = useState<TravelLegEditDraft>(() => createTravelLegEditDraft(leg))
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState<PlanningPreview | null>(null)
  const [lookups, setLookups] = useState<Record<number, FlightLookupResult>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previews = useRef(new PlanningPreviewCache())
  const modeDrafts = useRef(new Map<string, PlanningSegment>())
  const submittedLeg = useRef<TravelLeg | null>(null)
  const closeAfterSave = useEffectEvent(onClose)
  const version = useRef(0)
  const request = useRef<AbortController | null>(null)
  const inferNewConnectionMode = useRef(creating)
  const appliedOutsideLocation = useRef(outsideLocation)
  const initializeOutsideLocation = useEffectEvent((next: TravelLegEditDraft) => {
    appliedOutsideLocation.current = outsideLocation
    if (leg && onOutsideLocationChange) next[leg.connection_type === 'DEPARTURE' ? 'from' : 'to'] = outsideLocation
      ? { type: 'LOCATION', location: outsideLocation.input } : undefined
  })
  const showPreview = session.onPreview
  const calculateOnOpen = useEffectEvent((payload: TravelLegEditDraft) => { void calculate(false, payload) })
  useEffect(() => {
    version.current += 1
    request.current?.abort()
    previews.current.clear(); modeDrafts.current.clear()
    inferNewConnectionMode.current = creating
    const next = createTravelLegEditDraft(creating ? null : leg)
    if (leg && creating) { next.from = connectionEndpointInput(leg.from); next.to = connectionEndpointInput(leg.to) }
    initializeOutsideLocation(next)
    if (fromStop) next.segments = next.segments.map((segment) => segment.travel_mode === 'FLIGHT' && !segment.flight?.departure_date ? {
      ...segment, flight: { ...segment.flight, departure_date: getStayLeaveDateValue(fromStop.planned_start_date, fromStop.planned_nights) },
    } : segment)
    next.segments.forEach((segment, index) => modeDrafts.current.set((segment.id || index) + ':' + segment.travel_mode, segment))
    setDraft(next)
    setDetails(null)
    setTransferSide(null)
    setDirty(false); setPreview(null); setLookups({}); setError(null); setBusy(null)
    showPreview(null)
    if (submittedLeg.current && open && leg !== submittedLeg.current) {
      submittedLeg.current = null; closeAfterSave(); return
    }
    if (!open) submittedLeg.current = null
    if (open && leg && !creating && next.segments.some((segment) => roadModes.includes(segment.travel_mode))) calculateOnOpen(next)
    return () => { version.current += 1; request.current?.abort(); showPreview(null) }
  }, [leg, open, showPreview, fromStop, creating])
  const endpointReady = !onOutsideLocationChange || Boolean(outsideLocation)
  const applyOutsideLocation = useEffectEvent(() => {
    if (!leg || !onOutsideLocationChange) return
    if (appliedOutsideLocation.current === outsideLocation) return
    appliedOutsideLocation.current = outsideLocation
    const side = leg.connection_type === 'DEPARTURE' ? 'from' : 'to'
    const endpoint = outsideLocation ? { type: 'LOCATION' as const, location: outsideLocation.input } : undefined
    if (JSON.stringify(draft[side]) !== JSON.stringify(endpoint)) {
      const next = update({ ...draft, [side]: endpoint }, true)
      if (open && next.from && next.to) void calculate(false, next)
    }
  })
  useEffect(() => { applyOutsideLocation() }, [outsideLocation, leg])
  useEffect(() => {
    const transfer = session.airportTransferRequest
    if (open && transfer && transfer.legId === leg?.id && transfer.sequence !== handledTransferRequest.current) {
      handledTransferRequest.current = transfer.sequence
      setTransferSide(transfer.side)
    }
  }, [open, leg?.id, session.airportTransferRequest])
  const currentConnection = useMemo<TravelLeg | null>(() => {
    if (preview) return connectionWithOptions(preview.connection, draft)
    if (!leg || !dirty) return leg
    const outside = outsideLocation ? { type: 'LOCATION' as const, location: { ...outsideLocation.anchor.location, id: 'draft-location', full_name: outsideLocation.anchor.title, country_code: '', region: '' } } : null
    const endpointsUnchanged = JSON.stringify([draft.from, draft.to]) === JSON.stringify([connectionEndpointInput(leg.from), connectionEndpointInput(leg.to)])
    const from = outside && leg.connection_type === 'DEPARTURE' ? outside : leg.from
    const to = outside && leg.connection_type === 'RETURN' ? outside : leg.to
    const anchors = [from, to].map((endpoint) => resolveConnectionEndpoint(endpoint, [fromStop, toStop].filter((stop): stop is Stop => stop !== null)))
    return { ...leg, from, to, segments: draft.segments.map((intent, index) => {
      const saved = leg.segments.find((segment) => segment.id === intent.id)
      const unchanged = endpointsUnchanged && saved && planningPreviewKey({ notes: '', segments: [saved.intent] }) === planningPreviewKey({ notes: '', segments: [intent] })
      return { ...(saved || leg.segments[0]), input_version: saved?.input_version ?? 1, mode_source: saved?.mode_source ?? 'USER', id: intent.id || 'draft-' + index, intent,
        geometry: unchanged ? saved.geometry : null,
        from_endpoint: unchanged ? saved.from_endpoint : null, to_endpoint: unchanged ? saved.to_endpoint : null,
        lookup: unchanged ? saved.lookup : null,
        route_state: unchanged ? saved.route_state : 'NOT_CALCULATED' as const, route_options: [],
        duration_seconds: unchanged ? saved.duration_seconds : null, distance_meters: unchanged ? saved.distance_meters : null }
    }), duration_seconds: null, warnings: [], route: { ...leg.route, type: 'SIMPLE' as const,
      geometry: { type: 'LineString' as const, coordinates: anchors.flatMap((anchor) => anchor ? [[anchor.location.longitude, anchor.location.latitude] as [number, number]] : []) } } }
  }, [preview, draft, leg, dirty, outsideLocation, fromStop, toStop])
  useEffect(() => { if (open) showPreview(endpointReady ? currentConnection : null) }, [currentConnection, open, showPreview, endpointReady])
  const endpointStops = [fromStop, toStop].filter((stop): stop is Stop => stop !== null)
  const fromAnchor = leg ? outsideLocation && leg.connection_type === 'DEPARTURE' ? outsideLocation.anchor : resolveConnectionEndpoint((preview?.connection || leg).from, endpointStops) : null
  const toAnchor = leg ? outsideLocation && leg.connection_type === 'RETURN' ? outsideLocation.anchor : resolveConnectionEndpoint((preview?.connection || leg).to, endpointStops) : null
  if (!leg || !fromAnchor || !toAnchor) return null
  const currentLeg = leg
  const disabled = saving || busy !== null || !endpointReady
  const transfers = currentConnection ? getAirportTransfers(currentConnection, fromAnchor, toAnchor) : []
  const activeTransfer = transfers.find((transfer) => transfer.side === transferSide)
  function transferCard(transfer: AirportTransfer) {
    return <button type="button" key={transfer.side} aria-label={airportTransferLabel(transfer)}
      disabled={disabled || draft.segments.length >= 20} onClick={() => setTransferSide(transfer.side)}
      className="grid min-w-0 gap-1 rounded-xl border border-dashed border-border p-3 text-left hover:bg-muted disabled:opacity-60">
      <span className="font-semibold">Airport transfer</span>
      <span className="break-words text-sm">{transfer.from.name} → {transfer.to.name}</span>
      <span className="text-xs text-muted-foreground">Transport not chosen · Approximate connection</span>
      <span className="text-sm font-medium text-primary">{draft.segments.length >= 20 ? 'Journey has reached the 20 segment limit' : 'Choose transport'}</span>
    </button>
  }
  function chooseAirportTransfer(mode: TravelMode) {
    if (!activeTransfer || draft.segments.length >= 20) return
    const segment: PlanningSegment = { travel_mode: mode, mode_selected: true, notes: '', route_option: 0 }
    const before = activeTransfer.side === 'departure'
    const next = { ...draft, segments: before ? [segment, ...draft.segments] : [...draft.segments, segment] }
    update(next)
    if (before) setLookups((previous) => Object.fromEntries(Object.entries(previous).map(([index, value]) => [Number(index) + 1, value])))
    setTransferSide(null)
    setDetails(before ? 0 : draft.segments.length)
    // Ground endpoints inherit the stop and adjacent flight's airport on the server.
    // Selecting a mode is the explicit request to calculate its route.
    void calculate(false, next)
  }
  function update(next: TravelLegEditDraft, preserveDefaultMode = false) {
    if (!preserveDefaultMode) inferNewConnectionMode.current = false
    if (next.segments.length !== draft.segments.length || next.segments.some((segment, index) => segment.id !== draft.segments[index]?.id)) {
      previews.current.clear(); modeDrafts.current.clear()
    }
    version.current += 1
    request.current?.abort()
    const withoutNotes = (value: TravelLegEditDraft) => JSON.stringify({ ...value, notes: '', preview_id: undefined,
      segments: value.segments.map((segment) => ({ ...segment, notes: '' })) })
    const notesOnly = withoutNotes(next) === withoutNotes(draft)
    setDirty(true); setBusy(null); setError(null)
    const updated = notesOnly ? next : { ...next, preview_id: undefined,
      segments: next.segments.map((segment) => ({ ...segment, route_option: 0 })) }
    setDraft(updated)
    if (!notesOnly) setPreview(null)
    return updated
  }
  function updateSegment(index: number, change: Partial<PlanningSegment>) {
    update({ ...draft, segments: draft.segments.map((segment, i) => i === index ? { ...segment, ...change } : segment) })
  }
  function flightChange(index: number, change: NonNullable<PlanningSegment['flight']>) {
    const flight = draft.segments[index].flight || {}
    updateSegment(index, { flight: { ...flight, candidate_id: null, ...change } })
    setLookups((previous) => { const next = { ...previous }; delete next[index]; return next })
  }
  async function calculate(retryFailed = false, payload = draft) {
    if (!session.accessToken || !payload.from || !payload.to || !endpointReady) return
    const activeVersion = version.current
    const controller = new AbortController()
    request.current = controller
    // Omitting segments uses the same server default as a new between-stop connection.
    const inferMode = creating && inferNewConnectionMode.current
    setBusy('Calculating route'); setError(null)
    try {
      const result = await previewTravel({ tripId: leg!.trip_id, legId: creating ? undefined : leg!.id,
        accessToken: session.accessToken, itineraryRevision: session.itineraryRevision,
        payload: { ...connectionWritePayload(payload), ...(inferMode ? { preview_id: undefined, segments: undefined } : {}) },
        retryFailed, signal: controller.signal })
      if (version.current !== activeVersion) return
      const inferredSegments = inferMode ? result.connection.segments.map((segment) => ({ ...segment.intent, id: undefined,
        mode_selected: false, notes: payload.segments[0]?.notes ?? '' })) : null
      const resolved = inferredSegments ? { ...payload, segments: inferredSegments } : payload
      previews.current.put(resolved, session.itineraryRevision, result)
      setPreview(result); setDraft((previous) => ({ ...previous, preview_id: result.preview_id,
        segments: (inferredSegments ?? previous.segments).map((segment, index) => ({ ...segment, route_option: Math.min(segment.route_option || 0, Math.max(0, (result.connection.segments[index]?.route_options?.length || 0) - 1)) })) }))
      if (inferredSegments && inferredSegments[0]?.travel_mode !== payload.segments[0]?.travel_mode) {
        setDetails(inferredSegments[0]?.travel_mode === 'FLIGHT' ? 0 : null)
      }
      showPreview(result.connection)
    } catch (failure) {
      if (version.current === activeVersion) setError(getErrorMessage(failure))
    } finally { if (version.current === activeVersion) setBusy(null) }
  }
  async function findFlight(index: number) {
    const flight = draft.segments[index].flight
    if (!session.accessToken || !flight?.flight_number || !flight.departure_date) return
    const activeVersion = version.current
    const controller = new AbortController()
    request.current = controller
    setBusy('Looking up flight'); setError(null)
    try {
      const result = await lookupFlight({ tripId: currentLeg.trip_id, legId: creating ? undefined : currentLeg.id,
        accessToken: session.accessToken, itineraryRevision: session.itineraryRevision,
        payload: { flight_number: flight.flight_number, departure_date: flight.departure_date },
        signal: controller.signal })
      if (version.current === activeVersion) setLookups((previous) => ({ ...previous, [index]: result }))
    } catch (failure) {
      if (version.current === activeVersion) setError(getErrorMessage(failure))
    } finally { if (version.current === activeVersion) setBusy(null) }
  }
  function draftForMode(index: number, mode: TravelMode, optionIndex = 0): TravelLegEditDraft {
    const segment = draft.segments[index]
    const remembered = modeDrafts.current.get((segment.id || index) + ':' + mode)
    const target = mode === segment.travel_mode ? segment : remembered || {
      ...segment, via: null, from: null, to: null,
      service_company: null, service_number: null,
      flight: mode === 'FLIGHT' ? { ...(fromStop ? { departure_date: getStayLeaveDateValue(fromStop.planned_start_date, fromStop.planned_nights) } : {}) } : null,
    }
    return { ...draft, preview_id: undefined, segments: draft.segments.map((item, i) => i === index ? {
      ...target, notes: segment.notes, travel_mode: mode, mode_selected: true, route_option: optionIndex,
    } : item) }
  }
  function chooseMode(index: number, mode: TravelMode, optionIndex = 0) {
    inferNewConnectionMode.current = false
    const segment = draft.segments[index]
    modeDrafts.current.set((segment.id || index) + ':' + segment.travel_mode, segment)
    const next = draftForMode(index, mode, optionIndex)
    const cached = previews.current.get(next, session.itineraryRevision)
    version.current += 1; request.current?.abort()
    setDirty(true); setBusy(null); setError(null)
    setDraft({ ...next, preview_id: cached?.preview_id })
    setPreview(cached)
    if (mode !== segment.travel_mode) setDetails(mode === 'FLIGHT' ? index : null)
    if (!cached && (creating || roadModes.includes(mode))) void calculate(false, next)
  }
  function move(index: number, step: number) {
    previews.current.clear(); modeDrafts.current.clear()
    const segments = [...draft.segments]
    ;[segments[index], segments[index + step]] = [segments[index + step], segments[index]]
    setLookups({}); update({ ...draft, segments })
  }
  return (
    <RouteChooserShell desktop={desktop} open={open} onClose={onClose}
      description={'From ' + fromAnchor.title + ' to ' + toAnchor.title}
      footer={<div className="flex flex-wrap items-center justify-between gap-3">
        {error || session.saveError ? <p role="alert" className="w-full text-sm text-destructive">{error || session.saveError}</p> : null}
        <p className="text-sm text-muted-foreground">{!endpointReady ? 'Choose a location to continue.' : busy ? <span role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{busy}…</span> : currentConnection?.duration_seconds != null ? routeTime(currentConnection.duration_seconds) + (currentConnection.duration_scope === 'FLIGHT_JOURNEY' ? ' flight journey · airport transfers not included' : ' estimated travel time') : 'Select a route to preview it on the map'}</p>
        <div className="flex min-w-0 flex-wrap gap-2"><Button disabled={saving} type="button" variant="outline" onClick={onClose}>Cancel</Button>
        {onDelete ? <Button disabled={saving || busy !== null} type="button" variant="ghost" onClick={onDelete}>Remove {leg.connection_type === 'DEPARTURE' ? 'departure' : 'return'} connection</Button> : null}
        <Button disabled={disabled || Boolean(activeTransfer)} type="button" onClick={() => { submittedLeg.current = leg; onSave(leg.id, draft) }}>{saving ? 'Saving…' : creating ? leg.connection_type === 'DEPARTURE' ? 'Add departure' : 'Add return' : 'Select this route'}</Button></div>
      </div>}>
      <div className="grid min-h-full min-w-0 grid-cols-1">
      <div className="order-2 grid min-w-0 grid-cols-1 content-start gap-4 p-4 lg:order-1 lg:p-5">
          {onOutsideLocationChange ? !desktop ? <ConnectionLocationPicker label={leg.connection_type === 'DEPARTURE' ? 'Departure location' : 'Return location'}
            value={outsideLocation ?? null} onChange={onOutsideLocationChange} disabled={saving || busy !== null} /> : null : (['from', 'to'] as const).map((side) => {
            const endpoint = draft[side]
            return endpoint?.type === 'LOCATION' ? <EndpointPicker key={side} label={side === 'from' ? 'Departure location' : 'Return location'}
              value={endpoint.location} disabled={disabled} onChange={(location) => {
                if (location && !('location_id' in location)) update({ ...draft, [side]: { type: 'LOCATION', location } })
              }} /> : null
          })}

        {!endpointReady ? <p role="status" className="text-sm text-muted-foreground">Choose a {leg.connection_type === 'DEPARTURE' ? 'departure' : 'return'} location to enable travel options.</p> : null}

        {activeTransfer ? <section aria-label="Choose airport transfer" className="grid min-w-0 gap-3">
          <h3 className="font-semibold">Airport transfer</h3>
          <p className="break-words text-sm">{activeTransfer.from.name} → {activeTransfer.to.name}</p>
          <p className="text-sm text-muted-foreground">Choose how you’ll get there. Transfer time is not included until a duration is available.</p>
          {draft.segments.length >= 20 ? <p role="status" className="text-sm">Journey has reached the 20 segment limit. Remove a segment before adding a transfer.</p> : null}
          {travelModeOptions.filter((option) => !['FLIGHT', 'UNKNOWN'].includes(option.value)).map((option) => {
            const Icon = getTravelModeIcon(option.value)
            return <Button className="h-auto min-w-0 justify-start whitespace-normal py-3" key={option.value} disabled={disabled || draft.segments.length >= 20}
              variant="outline" type="button" onClick={() => chooseAirportTransfer(option.value)}><Icon className="size-4 shrink-0" />{option.label}</Button>
          })}
          <Button type="button" variant="ghost" onClick={() => setTransferSide(null)}>Back to journey</Button>
        </section> : <>
        {transfers.filter((transfer) => transfer.side === 'departure').map(transferCard)}
        {draft.segments.map((segment, index) => {
          const labels = transitLabels[segment.travel_mode]
          const flight = segment.flight || {}
          const saved = leg.segments.find((s) => s.id === segment.id)
          const estimate = currentConnection?.segments[index]
          const currentLookup = lookups[index]?.candidates?.find((candidate) => candidate.candidate_id === flight.candidate_id)?.lookup ||
            (saved && saved.lookup?.flight_number === flight.flight_number && saved?.lookup?.departure_date === flight.departure_date && (saved.intent.flight?.departure_airport_place_id ?? null) === (flight.departure_airport_place_id ?? null) && (saved.intent.flight?.arrival_airport_place_id ?? null) === (flight.arrival_airport_place_id ?? null) ? saved?.lookup : null)
          const segmentDetails = <div className="grid min-w-0 grid-cols-1 gap-3 rounded-xl bg-muted/40 p-3">
              {segment.travel_mode === 'FLIGHT' ? <>
                <label className="grid min-w-0 grid-cols-1 gap-1 text-sm">Flight number<Input className="min-w-0 max-w-full" disabled={disabled} placeholder="KL597" value={flight.flight_number || ''} onChange={(event) => flightChange(index, { flight_number: event.target.value.trim().toUpperCase() || null })} /></label>
                <label className="grid min-w-0 grid-cols-1 gap-1 text-sm">Departure date<Input className="min-w-0 max-w-full" disabled={disabled} type="date" value={flight.departure_date || ''} onChange={(event) => flightChange(index, { departure_date: event.target.value || null })} /></label>
                <label className="grid min-w-0 grid-cols-1 gap-1 text-sm">Airline<Input className="min-w-0 max-w-full" disabled={disabled} value={flight.airline_name || ''} onChange={(event) => updateSegment(index, { flight: { ...flight, airline_name: event.target.value || null } })} /></label>
                <EndpointPicker label="Departure airport" airport disabled={disabled}
                  value={flight.departure_airport_place_id ? { place_id: flight.departure_airport_place_id } : null}
                  placeholder={currentLookup?.departure_airport.name || (saved?.intent.travel_mode === 'FLIGHT' ? saved.from_endpoint?.name : undefined)}
                  onChange={(value) => flightChange(index, { departure_airport_place_id: value && 'place_id' in value ? value.place_id : null })} />
                <EndpointPicker label="Arrival airport" airport disabled={disabled}
                  value={flight.arrival_airport_place_id ? { place_id: flight.arrival_airport_place_id } : null}
                  placeholder={currentLookup?.arrival_airport.name || (saved?.intent.travel_mode === 'FLIGHT' ? saved.to_endpoint?.name : undefined)}
                  onChange={(value) => flightChange(index, { arrival_airport_place_id: value && 'place_id' in value ? value.place_id : null })} />
                <Button disabled={disabled || !flight.flight_number || !flight.departure_date} variant="outline" type="button" onClick={() => void findFlight(index)}>Look up flight</Button>
                {lookups[index]?.status === 'UNAVAILABLE' ? <p role="status" className="text-sm">{lookups[index].reason}. You can still save this flight without an estimate.</p> : null}
                {lookups[index]?.status === 'NOT_FOUND' ? <p role="status" className="text-sm">No matching flight found. You can still save the flight details.</p> : null}
                {lookups[index]?.candidates?.map((candidate) => <Button className="h-auto min-w-0 max-w-full flex-col items-start whitespace-normal break-words py-3 text-left" key={candidate.candidate_id} type="button" variant={flight.candidate_id === candidate.candidate_id ? 'default' : 'outline'}
                  disabled={disabled} onClick={() => updateSegment(index, { flight: { ...flight, candidate_id: candidate.candidate_id } })}>
                  <span className="block w-full min-w-0 break-words">{candidate.lookup.departure_airport.iata_code || candidate.lookup.departure_airport.name} → {candidate.lookup.arrival_airport.iata_code || candidate.lookup.arrival_airport.name}</span>
                  {candidate.lookup.scheduled_departure ? <span className="block w-full min-w-0 break-all text-xs font-normal text-muted-foreground">{candidate.lookup.scheduled_departure.replace('T', ' ')}</span> : null}
                </Button>)}
                {currentLookup ? <p className="min-w-0 break-words text-xs text-muted-foreground">{currentLookup.departure_airport.name} → {currentLookup.arrival_airport.name}
                  {currentLookup.scheduled_departure ? ' · ' + currentLookup.scheduled_departure : ''}</p> : null}
              </> : <>
                {index === 0 ? <p className="text-sm">From: {fromAnchor.location.name}</p> :
                  <EndpointPicker label="From" disabled={disabled} value={segment.from} placeholder={estimate?.from_endpoint?.name || saved?.from_endpoint?.name || 'Inherit the preceding endpoint'} onChange={(value) => updateSegment(index, { from: value })} />}
                {index === draft.segments.length - 1 ? <p className="text-sm">To: {toAnchor.location.name}</p> :
                  <EndpointPicker label="To" disabled={disabled} value={segment.to} placeholder={estimate?.to_endpoint?.name || saved?.to_endpoint?.name || 'Inherit the next endpoint'} onChange={(value) => updateSegment(index, { to: value })} />}
                {roadModes.includes(segment.travel_mode) ? <EndpointPicker label="Via (optional)" disabled={disabled} value={segment.via} placeholder={saved?.via_endpoint ? saved.via_endpoint.name || saved.via_endpoint.latitude + ', ' + saved.via_endpoint.longitude : undefined} onChange={(value) => updateSegment(index, { via: value })} /> : <p className="text-xs text-muted-foreground">Approximate connection; no timetable estimate.</p>}
              </>}
              {labels ? <div className="grid min-w-0 grid-cols-1 gap-2">
                <label className="grid min-w-0 grid-cols-1 gap-1 text-sm">{labels[0]}<Input className="min-w-0 max-w-full" disabled={disabled} value={segment.service_company || ''} onChange={(event) => updateSegment(index, { service_company: event.target.value || null })} /></label>
                <label className="grid min-w-0 grid-cols-1 gap-1 text-sm">{labels[1]}<Input className="min-w-0 max-w-full" disabled={disabled} value={segment.service_number || ''} onChange={(event) => updateSegment(index, { service_number: event.target.value || null })} /></label>
              </div> : null}
              <label className="grid min-w-0 grid-cols-1 gap-1 text-sm">Segment notes<Textarea disabled={disabled} value={segment.notes || ''} onChange={(event) => updateSegment(index, { notes: event.target.value })} /></label>
              </div>
          return (
            <section key={segment.id || index} className="grid min-w-0 grid-cols-1 gap-3" aria-label={'Travel segment ' + (index + 1)}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{draft.segments.length > 1 ? 'Segment ' + (index + 1) : 'How will you get there?'}</h3>
                <div className="flex">
                  <Button disabled={disabled || index === 0} size="icon" variant="ghost" type="button" aria-label={'Move segment ' + (index + 1) + ' up'} onClick={() => move(index, -1)}><ArrowUp className="size-4" /></Button>
                  <Button disabled={disabled || index === draft.segments.length - 1} size="icon" variant="ghost" type="button" aria-label={'Move segment ' + (index + 1) + ' down'} onClick={() => move(index, 1)}><ArrowDown className="size-4" /></Button>
                  <Button disabled={disabled || draft.segments.length === 1} size="icon" variant="ghost" type="button" aria-label={'Remove segment ' + (index + 1)} onClick={() => {
                    setLookups({}); update({ ...draft, segments: draft.segments.filter((_, i) => i !== index) })
                  }}><Trash2 className="size-4" /></Button>
                </div>
              </div>
              <div role="radiogroup" aria-label={'Route options for segment ' + (index + 1)} className="grid min-w-0 grid-cols-1 gap-3" onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return
                event.preventDefault()
                const choices = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'))
                const position = choices.indexOf(document.activeElement as HTMLButtonElement)
                const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1
                const choice = choices[(position + step + choices.length) % choices.length]
                choice?.focus(); choice?.click()
              }}>
                {(['CAR', 'TRAIN', 'FLIGHT', 'BUS', 'FERRY', 'BIKE', 'WALK', 'MOTORCYCLE', 'OTHER'] as TravelMode[]).flatMap((mode) => {
                  const selectedMode = mode === segment.travel_mode
                  const modePreview = previews.current.get(draftForMode(index, mode), session.itineraryRevision)
                  const modeEstimate = selectedMode ? estimate : modePreview?.connection.segments[index]
                  const options = modeEstimate?.route_options?.length ? modeEstimate.route_options : [null]
                  const Icon = getTravelModeIcon(mode)
                  const label = travelModeOptions.find((item) => item.value === mode)?.label || mode
                  return options.map((option, optionIndex) => {
                    const selected = endpointReady && selectedMode && (segment.route_option || 0) === optionIndex
                    const time = routeTime(option?.duration_seconds ?? modeEstimate?.duration_seconds)
                    const distance = routeDistance(option?.distance_meters ?? modeEstimate?.distance_meters)
                    return <div key={mode + optionIndex} className={'overflow-hidden rounded-2xl border-2 transition ' + (selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border/60 bg-muted/40 hover:border-primary/50')}><button type="button" role="radio" aria-checked={selected}
                      aria-label={label + (options.length > 1 ? ' route ' + (optionIndex + 1) : '')}
                      aria-description={[time, distance].filter(Boolean).join(' · ')} tabIndex={selected ? 0 : -1}
                      disabled={disabled} onClick={() => chooseMode(index, mode, optionIndex)}
                      className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60">
                      <span className={'flex size-10 shrink-0 items-center justify-center rounded-xl ' + (mode === 'FLIGHT' ? 'bg-teal-500/15 text-teal-600' : mode === 'TRAIN' ? 'bg-violet-500/15 text-violet-500' : mode === 'CAR' ? 'bg-rose-500/15 text-rose-500' : 'bg-primary/10 text-primary')}><Icon className="size-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold">{label}{options.length > 1 ? ' · Route ' + (optionIndex + 1) : ''}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{distance || (roadModes.includes(mode) ? selectedMode && estimate?.route_state === 'FAILED' ? 'Road route unavailable' : 'Calculate road routes' : 'Approximate connection')}</span>
                      </span>
                      {time ? <span className="max-w-24 text-right text-sm font-bold tabular-nums">{time}</span> : null}
                      <span className={'flex size-5 shrink-0 items-center justify-center rounded-full border-2 ' + (selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>{selected ? <Check className="size-3" /> : null}</span>
                    </button>
                    {selected ? <div className="grid min-w-0 grid-cols-1 gap-3 px-4 pb-4">{selectedMode && preview && (estimate?.route_state === 'FAILED' || estimate?.route_state === 'NOT_CALCULATED') ? <Button disabled={disabled} type="button" variant="outline" onClick={() => void calculate(true)}>Retry routes</Button> : null}              {estimate?.error_code === 'NOT_CONFIGURED' && roadModes.includes(segment.travel_mode) ? <p role="status" className="rounded-xl bg-muted p-3 text-sm">Road routing needs a GraphHopper key in Admin → Routing. No calculated road route is available.</p> : estimate?.route_state === 'FAILED' ? <p role="status" className="text-sm text-muted-foreground">{estimate.error_code === 'ROUTING_LIMIT_REACHED' ? 'Routing limit reached. Try again later.' : 'Could not calculate a road route. You can retry or choose another transport.'}</p> : null}
              <Button className="h-auto min-w-0 max-w-full whitespace-normal py-2" variant="outline" type="button" disabled={disabled} aria-expanded={details === index}
                onClick={() => setDetails(details === index ? null : index)}><ChevronDown className="size-4" />{segment.travel_mode === 'FLIGHT' ? 'Flight & booking details' : 'Route details & notes'}</Button>
{details === index ? segmentDetails : null}</div> : null}
                    </div>
                  })
                })}
              </div>
              {estimate ? <p className="text-sm">
                {estimate.duration_seconds != null ? formatDuration(estimate.duration_seconds) : 'No duration estimate'}
                {' · '}{estimate.route_state === 'READY' ? 'Route ready' : estimate.route_state === 'FAILED' ? 'Route unavailable' : 'Approximate connection'}
              </p> : null}
            </section>
          )
        })}
        {transfers.filter((transfer) => transfer.side === 'arrival').map(transferCard)}
        {endpointReady ? <><Button disabled={disabled || draft.segments.length >= 20} variant="outline" type="button"
          onClick={() => update({ ...draft, segments: [...draft.segments, { travel_mode: 'CAR', mode_selected: true, route_option: 0, notes: '' }] })}><Plus className="size-4" />Add segment</Button>
        <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Journey notes</summary><Textarea className="mt-3" aria-label="Connection notes" disabled={disabled} value={draft.notes || ''} onChange={(event) => update({ ...draft, notes: event.target.value })} /></details>
        {currentConnection ? <div className="grid gap-2 rounded-xl bg-muted p-3" aria-live="polite">
          <p>{currentConnection.duration_seconds != null ? formatDuration(currentConnection.duration_seconds) + ' · ' + (currentConnection.duration_scope === 'FLIGHT_JOURNEY' ? 'Flight journey; airport transfers excluded' : 'Estimated travel time; waits excluded') : 'No combined duration estimate. Available segment times are shown above.'}</p>
          {currentConnection.warnings.map((warning) => <p key={warning} className="text-sm">{warning}</p>)}
        </div> : null}
        <p className="text-xs text-muted-foreground">Flight information from <a href="https://aerodatabox.com/" target="_blank" rel="noopener" className="underline">AeroDataBox</a>. Flight lines are approximate.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={disabled} type="button" variant="outline" onClick={() => void calculate()}>Preview changes</Button>

        </div>
        </> : null}
        </>}
      </div>
      {!desktop ? <section aria-label="Connection map preview" className="order-1 sticky top-0 z-10 h-64 overflow-hidden border-b border-border bg-muted lg:order-2 lg:sticky lg:top-0 lg:h-[calc(100dvh-15rem)] lg:min-h-[30rem] lg:max-h-[41rem] lg:border-b-0 lg:border-l">
        {currentConnection && endpointReady ? <TripLeafletMap fitMode="route-preview" draftMapLocation={null} mapPointEnabled={false} onDraftMapPointSelect={() => {}}
          resetNonce={0} stops={endpointStops} travelLegs={[currentConnection]}
          travelPosts={[]} trackingGeometry={EMPTY_TRACKING_GEOMETRY} /> : null}
        <div className="pointer-events-none absolute bottom-3 left-3 right-12 z-[400] rounded-xl border border-border bg-card/95 p-3 text-xs shadow-sm">
          <div className="flex items-center gap-2 font-medium"><MapPin className="size-4 text-primary" />{fromAnchor.title} → {toAnchor.title}</div>
          <p className="mt-1 text-muted-foreground">Solid: calculated route · Gray: alternatives · Dashed: approximate</p>
        </div>
      </section> : null}
      </div>
    </RouteChooserShell>
  )
}
