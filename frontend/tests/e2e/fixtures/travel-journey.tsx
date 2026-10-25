import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { TrackingJourney } from '../../../src/api/client'
import { PublicSettingsContext } from '../../../src/settings/public-settings-context'
import { ThemeProvider } from '../../../src/theme/theme-provider'
import { TripLeafletMap } from '../../../src/pages/trip-detail/trip-map'
import type { MapConnection, MapStop, TravelMode } from '../../../src/pages/trip-detail/models'
import '../../../src/index.css'

const eindhoven = { name: 'Eindhoven', latitude: 51.44, longitude: 5.48 }
const sevilla = { name: 'Sevilla', latitude: 37.39, longitude: -5.98 }
const ams = { name: 'Amsterdam Airport', latitude: 52.31, longitude: 4.76 }
const fra = { name: 'Frankfurt Airport', latitude: 50.04, longitude: 8.56 }
const lis = { name: 'Lisbon Airport', latitude: 38.77, longitude: -9.13 }
const lisbon = { name: 'Lisbon', latitude: 38.72, longitude: -9.14 }
const porto = { name: 'Porto', latitude: 41.16, longitude: -8.63 }
const stops = [sevilla, lisbon, porto].map((location) => ({
  id: location.name, title: location.name, location,
})) as MapStop[]
const line = (...points: typeof ams[]) => ({
  type: 'LineString' as const, coordinates: points.map((p) => [p.longitude, p.latitude]),
})
function leg(id: string, mode: TravelMode, from: typeof ams, to: typeof ams) {
  return { id, intent: { travel_mode: mode }, from_endpoint: from, to_endpoint: to,
    route_state: mode === 'FLIGHT' ? 'UNSUPPORTED' : 'READY', geometry: line(from, to),
  } as MapConnection['segments'][number]
}
const connection = {
  id: 'to-lisbon', from: { type: 'LOCATION', location: eindhoven },
  to: { type: 'STOP', stop_id: 'Lisbon' },
  route: { type: 'SIMPLE', geometry: line(eindhoven, ams, fra, lis, lisbon) },
  segments: [leg('to-ams', 'CAR', eindhoven, ams), leg('ams-fra', 'FLIGHT', ams, fra),
    // Airports alone must suffice when no stored flight geometry is available.
    { ...leg('fra-lis', 'FLIGHT', fra, lis), geometry: null },
    { ...leg('to-hotel', 'CAR', lis, lisbon), geometry: line(lis, { ...lis, latitude: 38.74 }, lisbon) }],
} as MapConnection
const later = {
  id: 'to-porto', from: { type: 'STOP', stop_id: 'Lisbon' },
  to: { type: 'STOP', stop_id: 'Porto' }, segments: [leg('to-porto', 'CAR', lisbon, porto)],
  route: { type: 'PROVIDER_BACKED', geometry: line(lisbon, porto) },
} as MapConnection
const base: TrackingJourney = {
  server_time: '2026-10-25T08:00:00Z', current_connection_id: connection.id,
  current_flight_segment_index: 1, active_flight_id: null, remaining_flight_route: null,
  visible_to_members_only: false, position: { ...eindhoven, at: '2026-10-25T07:59:00Z', source: 'MOBILE_GPS' },
  target: { type: 'AIRPORT', ...ams }, connector: line(eindhoven, ams),
}
const firstPosition = { name: 'First flight', latitude: 51, longitude: 7 }
const secondPosition = { name: 'Second flight', latitude: 45, longitude: 0 }
const stages: Record<string, TrackingJourney> = {
  'Before departure': base,
  'AMS-FRA': { ...base, active_flight_id: 'first', target: { type: 'AIRPORT', ...fra }, connector: null,
    position: { ...base.position!, ...firstPosition, source: 'FLIGHT_TRACK' }, remaining_flight_route: line(firstPosition, fra) },
  'Frankfurt layover': { ...base, current_flight_segment_index: 2,
    position: { ...base.position!, ...fra }, target: { type: 'AIRPORT', ...fra }, connector: null },
  'FRA-LIS': { ...base, current_flight_segment_index: 2, active_flight_id: 'second',
    position: { ...base.position!, ...secondPosition, source: 'FLIGHT_TRACK' },
    target: { type: 'AIRPORT', ...lis }, connector: null, remaining_flight_route: line(secondPosition, lis) },
  'Lisbon ground': { ...base, current_flight_segment_index: null,
    position: { ...base.position!, ...lis }, target: { type: 'DESTINATION', ...lisbon }, connector: line(lis, lisbon) },
  'No flight tracking': { ...base, current_flight_segment_index: null,
    target: { type: 'DESTINATION', ...lisbon }, connector: line(eindhoven, lisbon) },
  'Staying in Sevilla': { ...base, current_connection_id: null, current_flight_segment_index: null,
    target: { type: 'CURRENT_STOP', ...sevilla }, connector: line({ ...sevilla, longitude: -6 }, sevilla) },
  'Before trip starts': { ...base, current_connection_id: null, current_flight_segment_index: null,
    target: null, connector: null },
  'Unknown position': { ...base, position: null, connector: null },
  'Missing future road': base,
  'Missing flight endpoint': base,
  'Unknown departure': base,
}
for (const mode of ['CAR', 'BIKE', 'WALK', 'BUS', 'TRAIN', 'FERRY', 'MOTORCYCLE', 'OTHER', 'UNKNOWN'] as TravelMode[]) {
  stages[`Ground ${mode}`] = { ...stages['No flight tracking'] }
}

export function Preview() {
  const [stage, setStage] = useState('Before departure')
  const [plan, setPlan] = useState(false)
  const current = stage === 'Staying in Sevilla' ? { ...connection,
    from: { type: 'STOP' as const, stop_id: 'Sevilla' },
    segments: [leg('to-ams', 'CAR', sevilla, ams), ...connection.segments.slice(1)],
  } : stage.startsWith('Ground ') ? { ...connection,
    segments: [leg('ground', stage.slice(7) as TravelMode, eindhoven, lisbon)],
  } : stage === 'Missing flight endpoint' ? { ...connection,
    segments: connection.segments.map((segment, index) => index === 2 ? { ...segment, to_endpoint: null } : segment),
  } : stage === 'Unknown departure' ? { ...connection,
    from: { type: 'STOP' as const, stop_id: 'Visited departure' },
    segments: connection.segments.map((segment, index) => index === 0 ? { ...segment, from_endpoint: null } : segment),
  } : connection
  const future = stage === 'Missing future road' ? { ...later,
    segments: [{ ...later.segments[0], route_state: 'FAILED' as const, geometry: null }],
  } : later
  const flightPosition = stage === 'AMS-FRA' ? firstPosition : stage === 'FRA-LIS' ? secondPosition : null
  return <main>
    <div style={{ height: 180, display: 'flex', flexWrap: 'wrap', alignContent: 'start', gap: 6 }}>
      {Object.keys(stages).map((name) => <button key={name} onClick={() => setStage(name)}>{name}</button>)}
      <button onClick={() => setPlan((value) => !value)}>Toggle Plan</button>
    </div>
    <div style={{ position: 'relative', height: 'calc(100dvh - 180px)' }}>
      <TripLeafletMap draftMapLocation={null} mapPointEnabled={false} onDraftMapPointSelect={() => {}}
        resetNonce={0} routeMode={plan ? 'itinerary' : 'travel-timeline'} stops={stops}
        connections={[current, future]} travelPosts={[]} trackingGeometry={{ journey: stages[stage],
          openingRoute: { durationSeconds: null, segments: [{ travelMode: flightPosition ? 'FLIGHT' : 'CAR',
            source: flightPosition ? 'FLIGHT_TRACK' : 'MOBILE_GPS',
            coordinates: flightPosition ? [[ams.latitude, ams.longitude], [flightPosition.latitude, flightPosition.longitude]]
              : [[51.43, 5.49], [51.44, 5.48]],
          }] },
        }} />
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<PublicSettingsContext value={{ settings: {}, refresh: async () => true }}>
  <ThemeProvider><Preview /></ThemeProvider>
</PublicSettingsContext>)
