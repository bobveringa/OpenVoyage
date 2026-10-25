import { Check, Clock3, Plane, PlaneLanding, PlaneTakeoff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { completeFlight, getErrorMessage, stopTrackingSession, type Place, type TrackedFlight, type FlightJourney } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePlaceSearch } from '@/hooks/use-place-search'
import { PlaceSearchDropdown } from '@/components/places/place-search-dropdown'
import { formatDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'

export function FlightJourneyCard({ journey, className, compact = false, accessToken, tripId }: {
  journey: FlightJourney; className?: string; compact?: boolean; accessToken?: string | null; tripId: string
}) {
  return <section aria-label="Flight journey" className={cn('space-y-3', className)}>
    {journey.flights.map((flight, index) => <div key={flight.id}>
      {index > 0 ? <p className="mb-2 text-center text-xs text-muted-foreground">Connecting flight{layover(journey.flights[index - 1], flight)}</p> : null}
      <FlightCard flight={flight} compact={compact} accessToken={accessToken} tripId={tripId} />
    </div>)}
  </section>
}

export function FlightCard({ flight, compact = false, accessToken, tripId }: {
  flight: TrackedFlight; compact?: boolean; accessToken?: string | null; tripId: string
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (flight.position_source !== 'FLIGHT_TRACK') return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [flight.position_source])
  const departure = flight.departure_airport
  const arrival = flight.arrival_airport
  const departing = flight.progress != null && flight.progress < 1
  const completed = Boolean(flight.completion_source)
  const departureAt = new Date(flight.actual_departure ?? flight.estimated_departure ?? flight.scheduled_departure)
  const arrivalValue = flight.actual_arrival ?? flight.estimated_arrival ?? flight.scheduled_arrival
  const arrivalAt = arrivalValue ? new Date(arrivalValue) : null
  const scheduledDepartureAt = new Date(flight.scheduled_departure)
  const scheduledArrivalAt = flight.scheduled_arrival ? new Date(flight.scheduled_arrival) : null
  const departureDelta = Math.round((departureAt.getTime() - scheduledDepartureAt.getTime()) / 60_000)
  const arrivalDelta = (flight.actual_arrival || flight.estimated_arrival) && arrivalAt && scheduledArrivalAt
    ? Math.round((arrivalAt.getTime() - scheduledArrivalAt.getTime()) / 60_000) : null
  const hasDeparted = Boolean(flight.actual_departure || flight.actual_arrival || completed || ['IN_FLIGHT', 'ARRIVED'].includes(flight.status))
  const showTiming = !flight.stop_reason && !['CANCELLED', 'DIVERTED'].includes(flight.status)
  const delayed = showTiming && (hasDeparted ? arrivalDelta != null && arrivalDelta > 0
    : flight.status === 'DELAYED' || departureDelta > 0 || (arrivalDelta != null && arrivalDelta > 0))
  const timingLabel = showTiming && hasDeparted && arrivalDelta != null
    ? arrivalDelta > 0 ? 'Delayed' : arrivalDelta < 0 ? 'Early' : 'On time'
    : delayed ? 'Delayed' : null
  const departureTiming = departureDelta !== 0
    ? flight.actual_departure ? `Departed ${Math.abs(departureDelta)} min ${departureDelta > 0 ? 'late' : 'early'}`
      : departureDelta > 0 ? `Departure delayed ${departureDelta} min behind schedule`
        : `Departure estimated ${Math.abs(departureDelta)} min early`
    : null
  const arrivalTiming = showTiming && arrivalDelta != null
    ? `${flight.actual_arrival ? 'Arrived' : 'Arrival estimated'} ${arrivalDelta === 0 ? 'on time' : `${Math.abs(arrivalDelta)} min ${arrivalDelta > 0 ? 'late' : 'early'}`}` : null
  const arrivalDay = arrivalAt && arrival ? airportDate(arrivalAt, arrival) : null
  const departureDay = airportDate(departureAt, departure)
  const Icon = delayed ? Clock3 : completed ? PlaneLanding : PlaneTakeoff
  const percent = Math.round((flight.progress ?? 0) * 100)
  const statusLabel = flight.stop_reason ? 'Tracking stopped'
    : hasDeparted && flight.status === 'DELAYED' ? completed || flight.actual_arrival ? 'Arrived' : 'In flight'
      : flight.status.replace(/_/g, ' ').toLowerCase().replace(/^./, (v) => v.toUpperCase())
  return (
    <article
      aria-label={`${flight.flight_number} · ${statusLabel}`}
      className={cn('overflow-hidden rounded-[1.75rem] border bg-card', compact ? 'p-3.5' : 'p-4', delayed ? 'border-amber-500/30 shadow-sm' : departing ? 'border-primary/30 shadow-sm' : 'border-border')}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn('grid shrink-0 place-items-center rounded-xl', compact ? 'size-7' : 'size-9', delayed ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : departing ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary')}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{flight.flight_number}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{departureDay}{flight.airline_name ? ` · ${flight.airline_name}` : ''}</p>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium', delayed ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : departing ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
          {delayed ? <Clock3 className="size-3" aria-hidden="true" /> : departing ? <span className="size-1.5 rounded-full bg-primary" /> : <Check className="size-3" aria-hidden="true" />}
          {statusLabel}
          {timingLabel && timingLabel !== statusLabel ? ` · ${timingLabel}` : ''}
        </span>
      </div>

      <div className={cn('grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] items-center gap-2', compact ? 'mt-3' : 'mt-4')}>
        <div>
          <p className={cn('font-semibold leading-none tracking-tight', compact ? 'text-2xl' : 'text-[28px]')}>{departure.iata_code}</p>
          {!compact ? <p className="mt-1 text-[11px] text-muted-foreground">{departure.name}</p> : null}
        </div>
        <div className="relative flex items-center justify-center text-primary/60" aria-hidden="true">
          <span className="absolute inset-x-0 border-t border-border" />
          <Plane className="relative size-5 rotate-45 bg-card" />
        </div>
        <div className="text-right">
          <p className={cn('font-semibold leading-none tracking-tight', compact ? 'text-2xl' : 'text-[28px]')}>{arrival?.iata_code ?? '—'}</p>
          {!compact ? <p className="mt-1 text-[11px] text-muted-foreground">{arrival?.name ?? 'Landing airport unresolved'}</p> : null}
        </div>
      </div>
      <div className={cn('flex items-start justify-between gap-2', compact ? 'mt-2' : 'mt-3')}>
        <div>
          <p className="text-[10px] text-muted-foreground">{flight.actual_departure ? 'Departed' : flight.estimated_departure ? 'Estimated departure' : 'Scheduled departure'}</p>
          {departureDelta !== 0 ? <p className="mt-0.5 text-[11px] text-muted-foreground"><del aria-label={`Scheduled departure ${airportTime(scheduledDepartureAt, departure)}`}>{airportTime(scheduledDepartureAt, departure)}</del></p> : null}
          <p className="mt-0.5 text-lg font-semibold leading-tight tabular-nums">{airportTime(departureAt, departure)}{compact ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">{airportTimezone(departureAt, departure)}</span> : null}</p>
          {!compact ? <p className="mt-0.5 text-[10px] text-muted-foreground">{airportTimezone(departureAt, departure)}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground">{flight.actual_arrival ? 'Arrived' : flight.estimated_arrival ? 'Estimated arrival' : 'Scheduled arrival'}</p>
          {arrivalDelta != null && arrivalDelta !== 0 && scheduledArrivalAt && arrival ? <p className="mt-0.5 text-[11px] text-muted-foreground"><del aria-label={`Scheduled arrival ${airportTime(scheduledArrivalAt, arrival)}`}>{airportTime(scheduledArrivalAt, arrival)}</del></p> : null}
          <p className="mt-0.5 text-lg font-semibold leading-tight tabular-nums">{arrivalAt && arrival ? airportTime(arrivalAt, arrival) : '—'}{compact ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">{arrivalAt && arrival ? airportTimezone(arrivalAt, arrival) : ''}</span> : null}</p>
          {!compact || arrivalDay !== departureDay ? <p className="mt-0.5 text-[10px] text-muted-foreground">{!compact && arrivalAt && arrival ? airportTimezone(arrivalAt, arrival) : ''}{arrivalDay && arrivalDay !== departureDay ? `${compact ? '' : ' · '}${arrivalDay}` : ''}</p> : null}
        </div>
      </div>

      {showTiming && (departureTiming || arrivalTiming || delayed) ? (
        <div className={cn('mt-3 rounded-xl px-3', delayed ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-muted text-muted-foreground', compact ? 'py-2' : 'py-2.5')}>
          <p className="flex items-center gap-1.5 text-xs font-medium"><Clock3 className="size-3.5 shrink-0" aria-hidden="true" />{departureTiming ?? arrivalTiming ?? 'Flight delayed'}</p>
          {departureTiming && arrivalTiming ? <p className={cn('mt-1 text-[11px]', arrivalDelta != null && arrivalDelta <= 0 && 'text-primary')}>{arrivalTiming}</p> : null}
          {delayed && !hasDeparted && !departing ? <p className="mt-1 text-[11px]">Awaiting departure</p> : null}
        </div>
      ) : null}
      {departing ? (
        <div className={cn('mt-3 rounded-xl bg-primary/5 px-3', compact ? 'py-2' : 'py-2.5')}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-primary">{`${percent}% · Estimated`}</span>
            <span className="text-muted-foreground">{percent >= 99 ? 'Waiting for arrival update' : 'In flight'}</span>
          </div>
          <div aria-label="Estimated flight progress" aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} role="progressbar" className={cn('relative flex items-center', compact ? 'mb-1 mt-2 h-3' : 'my-3 h-4')}>
            <div className="w-full border-t border-dashed border-primary/30" />
            <div className="absolute left-0 border-t-2 border-primary" style={{ width: `${percent}%` }} />
            <span className={cn('absolute grid -translate-x-1/2 place-items-center rounded-full bg-card text-primary ring-1 ring-primary/15', compact ? 'size-5' : 'size-6')} style={{ left: `${percent}%` }}>
              <Plane className="size-3.5 rotate-45" aria-hidden="true" />
            </span>
            <span className="absolute right-0 size-1.5 rounded-full bg-card ring-1 ring-primary/35" />
          </div>
          {!compact ? <p className="text-[11px] text-muted-foreground">{percent}% · Estimated progress</p> : null}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <Clock3 className="size-3.5" aria-hidden="true" />
          <span>{completed ? 'Flight completed' : flight.stop_reason === 'NEXT_FLIGHT_DEPARTED' ? 'Tracking stopped because the next flight began' : flight.stop_reason ? 'Recording stopped without an arrival estimate' : flight.status === 'DIVERTED' ? 'Diverted · awaiting landing airport' : statusLabel}</span>
          {!compact && completed ? <span className="ml-auto inline-flex items-center gap-1 text-primary"><Check className="size-3.5" aria-hidden="true" />Completed</span> : null}
        </div>
      )}
      {flight.visible_to_members_only ? <p className="mt-2 text-[10px] text-muted-foreground">Members only · Live sharing is off</p> : null}
      {flight.position_at ? <p className="mt-2 text-[10px] text-muted-foreground">{flight.position_source === 'FLIGHT_TRACK' ? `Observed ${Math.max(0, Math.floor((now - Date.parse(flight.position_at)) / 60_000))} min ago · Position at` : 'Estimated position at'} {formatDateTime(new Date(flight.position_at), { timeStyle: 'short' })}{flight.estimate_basis === 'SCHEDULED_DURATION' ? ' · Scheduled duration' : ''}</p> : null}
      <p className="mt-2 text-[10px] text-muted-foreground">{flight.status_updated_at ? `Provider updated ${formatDateTime(new Date(flight.status_updated_at), { dateStyle: 'short', timeStyle: 'short' })}` : 'Awaiting provider update'}{flight.update_state !== 'CURRENT' ? ` · ${flight.update_state.toLowerCase()}` : ''}</p>
      {flight.completion_source === 'OWNER' ? <p className="mt-2 text-[11px] text-muted-foreground">Completion confirmed by owner · Estimated arrival</p> : null}
      {flight.can_complete && accessToken ? <FinishFlight flight={flight} accessToken={accessToken} tripId={tripId} /> : null}
    </article>
  )
}

function airportTime(value: Date, airport: Pick<Place, 'timezone'>) {
  return formatDateTime(value, { hour: '2-digit', minute: '2-digit', timeZone: airport.timezone || 'UTC' })
}

function airportDate(value: Date, airport: Pick<Place, 'timezone'>) {
  return formatDateTime(value, { day: 'numeric', month: 'short', year: 'numeric', timeZone: airport.timezone || 'UTC' })
}

function airportTimezone(value: Date, airport: Pick<Place, 'timezone'>) {
  return new Intl.DateTimeFormat(undefined, { timeZone: airport.timezone || 'UTC', timeZoneName: 'short' })
    .formatToParts(value).find((part) => part.type === 'timeZoneName')?.value
}


function localInputNow() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function FinishFlight({ flight, accessToken, tripId }: { flight: TrackedFlight; accessToken: string; tripId: string }) {
  const [open, setOpen] = useState(false)
  const [arrival, setArrival] = useState(localInputNow)
  const [airport, setAirport] = useState<Place | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const search = usePlaceSearch(query, open && !flight.arrival_airport && !airport, 'AIRPORT')
  async function finish(stop = false) {
    setBusy(true); setError('')
    try {
      if (stop && flight.gps_tracking_session_id) {
        await stopTrackingSession({ accessToken, tripId, sessionId: flight.gps_tracking_session_id })
      } else {
        await completeFlight({ accessToken, tripId, flightId: flight.id, estimatedArrival: new Date(arrival).toISOString(), arrivalAirportPlaceId: airport?.id })
      }
      setOpen(false)
      // Refresh saved history and the live guidance together after a mutation.
      window.dispatchEvent(new Event('focus'))
    } catch (e) { setError(getErrorMessage(e)) } finally { setBusy(false) }
  }
  if (!open) return <Button className="mt-3" size="sm" variant="outline" onClick={() => { setArrival(localInputNow()); setOpen(true) }}>Finish flight</Button>
  return <form className="mt-3 space-y-2 border-t pt-3" onSubmit={(event) => { event.preventDefault(); void finish() }}>
    <label className="block text-xs">Estimated arrival · Your local time<Input aria-label="Estimated arrival" type="datetime-local" required value={arrival} max={localInputNow()} onChange={(event) => setArrival(event.target.value)} /></label>
    {!flight.arrival_airport ? <div><label className="block text-xs">Landing airport<Input aria-label="Landing airport" value={airport ? airport.name : query} onChange={(event) => { setAirport(null); setQuery(event.target.value) }} /></label>
      <PlaceSearchDropdown disabled={busy} error={search.error} status={search.status} places={search.places} query={query} open={!airport} onSelect={setAirport} placeType="AIRPORT" />
    </div> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || (!flight.arrival_airport && !airport)} size="sm">Save arrival</Button><Button type="button" disabled={busy} size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="button" disabled={busy} size="sm" variant="ghost" onClick={() => void finish(true)}>Stop recording</Button></div>
  </form>
}

function layover(previous: TrackedFlight, next: TrackedFlight) {
  const end = previous.actual_arrival ?? previous.estimated_arrival ?? previous.scheduled_arrival
  const begin = next.actual_departure ?? next.estimated_departure ?? next.scheduled_departure
  if (!end) return ''
  const minutes = Math.max(0, Math.round((Date.parse(begin) - Date.parse(end)) / 60_000))
  return ` · ${Math.floor(minutes / 60)}h ${minutes % 60}m layover`
}
