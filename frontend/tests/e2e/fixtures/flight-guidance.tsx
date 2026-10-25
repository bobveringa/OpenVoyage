import * as L from 'leaflet'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { TrackedFlight, TrackingJourney } from '../../../src/api/client'
import { PublicSettingsContext } from '../../../src/settings/public-settings-context'
import { ThemeProvider } from '../../../src/theme/theme-provider'
import { TripLeafletMap } from '../../../src/pages/trip-detail/trip-map'
import { flightFocusCoordinates } from '../../../src/pages/trip-detail/flight-map-focus'
import type { MapConnection, MapStop } from '../../../src/pages/trip-detail/models'
import '../../../src/index.css'

const stops = [
  { id: 'auckland', title: 'Auckland', location: { latitude: -36.85, longitude: 174.76 } },
  { id: 'wellington', title: 'Wellington', location: { latitude: -41.29, longitude: 174.78 } },
  { id: 'christchurch', title: 'Christchurch', location: { latitude: -43.53, longitude: 172.64 } },
] as MapStop[]
const departure = { name: 'Auckland Airport', latitude: -37.01, longitude: 174.79 }
const arrival = { name: 'Wellington Airport', latitude: -41.33, longitude: 174.81 }
const current = {
  route: { type: 'SIMPLE', geometry: { type: 'LineString', coordinates: [[174.79, -37.01], [174.81, -41.33]] } },
  id: 'current', from: { type: 'STOP', stop_id: 'auckland' }, to: { type: 'STOP', stop_id: 'wellington' },
  segments: [{ id: 'flight', intent: { travel_mode: 'FLIGHT' }, route_state: 'UNSUPPORTED',
    from_endpoint: departure, to_endpoint: arrival,
    geometry: { type: 'LineString', coordinates: [[174.79, -37.01], [174.81, -41.33]] } }],
} as MapConnection
const future = { ...current, id: 'future', from: current.to, to: { type: 'STOP', stop_id: 'christchurch' },
  segments: [{ intent: { travel_mode: 'CAR' }, route_state: 'READY', from_endpoint: stops[1].location,
    to_endpoint: stops[2].location, geometry: { type: 'LineString', coordinates: [[174.78, -41.29], [172.64, -43.53]] } }],
} as MapConnection
const base: TrackingJourney = {
  server_time: '2026-10-23T19:20:00Z', current_connection_id: 'current', position: null,
  current_flight_segment_index: 0,
  target: { type: 'AIRPORT', ...departure }, connector: null, active_flight_id: null,
  remaining_flight_route: null, visible_to_members_only: false,
}
const position = { latitude: -36.85, longitude: 174.76, at: base.server_time, source: 'MOBILE_GPS' as const }
const connector = { type: 'LineString' as const, coordinates: [[174.76, -36.85], [174.79, -37.01]] }
const stages: Record<string, TrackingJourney | undefined> = {
  'Unknown position': base,
  'Ground guidance': { ...base, position, connector },
  'In flight': { ...base, position: { ...position, latitude: -39.2, longitude: 174.8, source: 'FLIGHT_ESTIMATE' }, active_flight_id: 'flight', remaining_flight_route: { type: 'LineString', coordinates: [[174.8, -39.2], [174.81, -41.33]] } },
  'Observed flight': { ...base, position: { ...position, latitude: -39.2, longitude: 174.8, source: 'FLIGHT_TRACK' }, active_flight_id: 'flight', remaining_flight_route: { type: 'LineString', coordinates: [[174.8, -39.2], [174.81, -41.33]] } },
  'Between flights': { ...base, position, connector, target: { type: 'AIRPORT', ...arrival } },
  'Arrived': { ...base, current_flight_segment_index: null, position: { ...position, ...arrival }, connector: { type: 'LineString', coordinates: [[174.81, -41.33], [174.78, -41.29]] }, target: { type: 'DESTINATION', ...stops[1].location, name: 'Wellington' } },
  'Ground only': { ...base, current_flight_segment_index: null, position, connector: { type: 'LineString', coordinates: [[174.76, -36.85], [174.78, -41.29]] }, target: { type: 'DESTINATION', ...stops[1].location, name: 'Wellington' } },
  'Hidden journey': { ...base, current_connection_id: null, target: null },
  'Unavailable journey': undefined,
}

let map: L.Map
L.Map.addInitHook(function (this: L.Map) {
  // Fixture-only camera observations; selection must not add production map layers.
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  map = this
})
const focusScenario = new URLSearchParams(window.location.search).get('flight-focus')
const focusFlight: TrackedFlight = {
  id: 'flight', flight_number: 'NZ6827', airline_name: 'Air New Zealand',
  departure_airport: { id: 'departure', ...departure, iata_code: 'AKL', timezone: 'Pacific/Auckland' },
  arrival_airport: { id: 'arrival', ...arrival, iata_code: 'WLG', timezone: 'Pacific/Auckland' },
  scheduled_departure: base.server_time, scheduled_arrival: null, actual_departure: null, actual_arrival: null,
  estimated_departure: null, estimated_arrival: null, status: 'SCHEDULED', progress: null, estimate_basis: null,
  completion_source: null, stop_reason: null, position_at: null, status_updated_at: null, update_state: 'CURRENT',
  visible_to_members_only: false, can_complete: false,
}
if (focusScenario === 'long-haul' || focusScenario === 'date-line') {
  focusFlight.arrival_airport = { id: 'arrival', name: 'Honolulu', iata_code: 'HNL', latitude: 21.32, longitude: -157.92, timezone: 'Pacific/Honolulu' }
}
if (focusScenario === 'date-line') {
  focusFlight.departure_airport = { id: 'departure', name: 'Tokyo', iata_code: 'HND', latitude: 35.55, longitude: 139.78, timezone: 'Asia/Tokyo' }
}
if (focusScenario === 'unresolved-arrival') focusFlight.arrival_airport = null
const flightJourneys = [{ itinerary_connection_id: 'current', flights: [focusFlight] }]

export function Preview() {
  const [stage, setStage] = useState('Unknown position')
  const [plan, setPlan] = useState(false)
  const [savedTransfer, setSavedTransfer] = useState(false)
  const [hideVisited, setHideVisited] = useState(false)
  const [focusedFlight, setFocusedFlight] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [frame, setFrame] = useState('')
  useEffect(() => {
    function observeCamera() {
      const first = flightFocusCoordinates(focusFlight)[0]
      const offset = 360 * Math.round((map.getCenter().lng - first[1]) / 360)
      setFrame(JSON.stringify({ size: map.getSize(), points: flightFocusCoordinates(focusFlight)
        .map(([lat, lon]) => map.latLngToContainerPoint([lat, lon + offset])) }))
    }
    map.on('moveend', observeCamera)
    observeCamera()
    return () => { map.off('moveend', observeCamera) }
  }, [])
  const selected = savedTransfer ? { ...current, segments: [...current.segments, {
    id: 'arrival-car', intent: { travel_mode: 'CAR' }, route_state: 'READY',
    from_endpoint: arrival, to_endpoint: { ...stops[1].location, name: 'Wellington' },
    geometry: { type: 'LineString', coordinates: [[174.81, -41.33], [174.8, -39.2], [174.78, -41.29]] },
  }] } as MapConnection : current
  return <main>
    <div style={{ height: focusScenario ? 200 : 80 }}>
      {Object.keys(stages).map((name) => <button key={name} onClick={() => setStage(name)}>{name}</button>)}
      <button onClick={() => setPlan((value) => !value)}>Toggle Plan</button>
      <button onClick={() => setSavedTransfer((value) => !value)}>Toggle saved arrival transfer</button>
      <button onClick={() => setHideVisited((value) => !value)}>Hide visited departure stop</button>
      <button onClick={() => setFocusedFlight((value) => !value)}>Toggle flight selection</button>
      <button onClick={() => setExpanded((value) => !value)}>Toggle expanded flight</button>
      <output hidden data-testid="flight-frame">{frame}</output>
    </div>
    <div style={{ position: 'relative', height: `calc(100dvh - ${focusScenario ? 200 : 80}px)` }}>
      <TripLeafletMap draftMapLocation={null} mapPointEnabled={false} onDraftMapPointSelect={() => {}}
        fitMode={focusScenario ? 'mobile-travel' : 'workspace'} focusedFlightId={focusedFlight ? 'flight' : null}
        flightFocusBottomPadding={expanded ? 320 : 160}
        resetNonce={0} routeMode={plan ? 'itinerary' : 'travel-timeline'} stops={hideVisited && !plan ? stops.slice(1) : stops}
        connections={[stage === 'Ground only' ? { ...current, segments: [{ ...current.segments[0], intent: { ...current.segments[0].intent, travel_mode: 'CAR' }, route_state: 'READY' }] } : selected, future]} travelPosts={[]} trackingGeometry={{ openingRoute: {
          durationSeconds: null, segments: stage === 'Observed flight'
            ? [{ travelMode: 'FLIGHT', source: 'FLIGHT_TRACK', coordinates: [[-37.01, 174.79], [-38.1, 174.8], [-39.2, 174.8]] }]
            : [{ travelMode: 'CAR', source: 'MOBILE_GPS', coordinates: [[-36.84, 174.75], [-36.85, 174.76]] }],
        }, journey: stages[stage], flightJourneys }} />
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<PublicSettingsContext value={{ settings: {}, refresh: async () => true }}>
  <ThemeProvider><Preview /></ThemeProvider>
</PublicSettingsContext>)
