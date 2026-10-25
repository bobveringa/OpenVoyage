import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { TrackedFlight } from '../../../src/api/client'
import { FlightCard } from '../../../src/pages/trip-detail/flight-card-prototype'
import '../../../src/index.css'

const airport = { id: 'airport', name: 'Eindhoven', iata_code: 'EIN', latitude: 51.45, longitude: 5.37, timezone: 'Europe/Amsterdam' }
const flight: TrackedFlight = {
  id: 'flight', flight_number: 'FR5682', airline_name: 'Ryanair',
  departure_airport: airport,
  arrival_airport: { ...airport, name: 'Stansted', iata_code: 'STN', timezone: 'Europe/London' },
  status: 'IN_FLIGHT', scheduled_departure: '2026-10-23T18:00:00Z',
  scheduled_arrival: '2026-10-23T19:00:00Z', actual_departure: '2026-10-23T18:45:00Z',
  estimated_departure: '2026-10-23T18:45:00Z', estimated_arrival: '2026-10-23T19:30:00Z',
  actual_arrival: null, completion_source: null, stop_reason: null, progress: .5,
  estimate_basis: 'PROVIDER_TIMES', position_at: '2026-10-23T19:00:00Z',
  status_updated_at: '2026-10-23T19:00:00Z', update_state: 'CURRENT',
  visible_to_members_only: false, can_complete: false, gps_tracking_session_id: 'session',
}

export function Preview() {
  const [scenario, setScenario] = useState('late')
  const [observed, setObserved] = useState(false)
  const [compact, setCompact] = useState(false)
  const scenarios: Record<string, Partial<TrackedFlight>> = {
    late: {},
    'on-time': { estimated_arrival: flight.scheduled_arrival },
    early: { estimated_arrival: '2026-10-23T18:50:00Z' },
    'arrived-early': { actual_arrival: '2026-10-23T18:50:00Z', status: 'ARRIVED', completion_source: 'PROVIDER', progress: 1 },
    'unknown-estimate': { estimated_arrival: null },
    'unknown-schedule': { scheduled_arrival: null },
    'awaiting-departure': { actual_departure: null, status: 'DELAYED', progress: null },
    'status-delay': { actual_departure: null, estimated_departure: null, estimated_arrival: null, status: 'DELAYED', progress: null },
    'stale-delay': { estimated_arrival: '2026-10-23T18:50:00Z', status: 'DELAYED' },
    'cancelled': { actual_departure: null, status: 'CANCELLED', progress: null, estimated_arrival: '2026-10-23T18:50:00Z' },
    'diverted': { status: 'DIVERTED', estimated_arrival: '2026-10-23T18:50:00Z' },
    'early-departure': { actual_departure: '2026-10-23T17:50:00Z', estimated_arrival: '2026-10-23T18:50:00Z' },
  }
  return <main className="mx-auto max-w-md space-y-4 p-4">
    <button onClick={() => setScenario((value) => value === 'on-time' ? 'late' : 'on-time')}>Toggle on-time arrival</button>
    {Object.keys(scenarios).map((name) => <button key={name} onClick={() => setScenario(name)}>{name}</button>)}
    <button onClick={() => setObserved((value) => !value)}>Toggle observed position</button>
    <button onClick={() => setCompact((value) => !value)}>Toggle compact card</button>
    <FlightCard flight={{ ...flight, ...scenarios[scenario],
      position_source: observed ? 'FLIGHT_TRACK' : 'FLIGHT_ESTIMATE', estimate_basis: observed ? null : flight.estimate_basis }} compact={compact} tripId="trip" />
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
