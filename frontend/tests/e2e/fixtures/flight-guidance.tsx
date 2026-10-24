import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { TrackingJourney } from '../../../src/api/client'
import { PublicSettingsContext } from '../../../src/settings/public-settings-context'
import { ThemeProvider } from '../../../src/theme/theme-provider'
import { TripLeafletMap } from '../../../src/pages/trip-detail/trip-map'
import type { MapConnection, MapStop } from '../../../src/pages/trip-detail/models'
import '../../../src/index.css'

const stops = [
  { id: 'eindhoven', title: 'Eindhoven', location: { latitude: 51.44, longitude: 5.48 } },
  { id: 'london', title: 'London', location: { latitude: 51.51, longitude: -.13 } },
  { id: 'paris', title: 'Paris', location: { latitude: 48.85, longitude: 2.35 } },
] as MapStop[]
const departure = { name: 'Eindhoven Airport', latitude: 51.45, longitude: 5.37 }
const arrival = { name: 'Stansted Airport', latitude: 51.89, longitude: .26 }
const current = {
  route: { type: 'SIMPLE', geometry: { type: 'LineString', coordinates: [[5.37, 51.45], [.26, 51.89]] } },
  id: 'current', from: { type: 'STOP', stop_id: 'eindhoven' }, to: { type: 'STOP', stop_id: 'london' },
  segments: [{ id: 'flight', intent: { travel_mode: 'FLIGHT' }, route_state: 'UNSUPPORTED',
    from_endpoint: departure, to_endpoint: arrival,
    geometry: { type: 'LineString', coordinates: [[5.37, 51.45], [.26, 51.89]] } }],
} as MapConnection
const future = { ...current, id: 'future', from: current.to, to: { type: 'STOP', stop_id: 'paris' },
  segments: [{ intent: { travel_mode: 'CAR' }, route_state: 'READY', from_endpoint: stops[1].location,
    to_endpoint: stops[2].location, geometry: { type: 'LineString', coordinates: [[-.13, 51.51], [2.35, 48.85]] } }],
} as MapConnection
const base: TrackingJourney = {
  server_time: '2026-10-23T19:20:00Z', current_connection_id: 'current', position: null,
  current_flight_segment_index: 0,
  target: { type: 'AIRPORT', ...departure }, connector: null, active_flight_id: null,
  remaining_flight_route: null, visible_to_members_only: false,
}
const position = { latitude: 51.44, longitude: 5.48, at: base.server_time, source: 'MOBILE_GPS' as const }
const connector = { type: 'LineString' as const, coordinates: [[5.48, 51.44], [5.37, 51.45]] }
const stages: Record<string, TrackingJourney | undefined> = {
  'Unknown position': base,
  'Ground guidance': { ...base, position, connector },
  'In flight': { ...base, position: { ...position, latitude: 51.7, longitude: 2.5, source: 'FLIGHT_ESTIMATE' }, active_flight_id: 'flight', remaining_flight_route: { type: 'LineString', coordinates: [[2.5, 51.7], [.26, 51.89]] } },
  'Between flights': { ...base, position, connector, target: { type: 'AIRPORT', ...arrival } },
  'Arrived': { ...base, current_flight_segment_index: null, position: { ...position, ...arrival }, connector: { type: 'LineString', coordinates: [[.26, 51.89], [-.13, 51.51]] }, target: { type: 'DESTINATION', ...stops[1].location, name: 'London' } },
  'Ground only': { ...base, current_flight_segment_index: null, position, connector: { type: 'LineString', coordinates: [[5.48, 51.44], [-.13, 51.51]] }, target: { type: 'DESTINATION', ...stops[1].location, name: 'London' } },
  'Hidden journey': { ...base, current_connection_id: null, target: null },
  'Unavailable journey': undefined,
}

export function Preview() {
  const [stage, setStage] = useState('Unknown position')
  const [plan, setPlan] = useState(false)
  const [savedTransfer, setSavedTransfer] = useState(false)
  const [hideVisited, setHideVisited] = useState(false)
  const selected = savedTransfer ? { ...current, segments: [...current.segments, {
    id: 'arrival-car', intent: { travel_mode: 'CAR' }, route_state: 'READY',
    from_endpoint: arrival, to_endpoint: { ...stops[1].location, name: 'London' },
    geometry: { type: 'LineString', coordinates: [[.26, 51.89], [.1, 51.7], [-.13, 51.51]] },
  }] } as MapConnection : current
  return <main>
    <div style={{ height: 80 }}>
      {Object.keys(stages).map((name) => <button key={name} onClick={() => setStage(name)}>{name}</button>)}
      <button onClick={() => setPlan((value) => !value)}>Toggle Plan</button>
      <button onClick={() => setSavedTransfer((value) => !value)}>Toggle saved arrival transfer</button>
      <button onClick={() => setHideVisited((value) => !value)}>Hide visited departure stop</button>
    </div>
    <div style={{ position: 'relative', height: 'calc(100dvh - 80px)' }}>
      <TripLeafletMap draftMapLocation={null} mapPointEnabled={false} onDraftMapPointSelect={() => {}}
        resetNonce={0} routeMode={plan ? 'itinerary' : 'travel-timeline'} stops={hideVisited && !plan ? stops.slice(1) : stops}
        connections={[stage === 'Ground only' ? { ...current, segments: [{ ...current.segments[0], intent: { ...current.segments[0].intent, travel_mode: 'CAR' }, route_state: 'READY' }] } : selected, future]} travelPosts={[]} trackingGeometry={{ openingRoute: {
          durationSeconds: null, segments: [{ travelMode: 'CAR', source: 'MOBILE_GPS', coordinates: [[51.43, 5.5], [51.44, 5.48]] }],
        }, journey: stages[stage] }} />
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<PublicSettingsContext value={{ settings: {}, refresh: async () => true }}>
  <ThemeProvider><Preview /></ThemeProvider>
</PublicSettingsContext>)
