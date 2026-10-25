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
  const [recovered, setRecovered] = useState(false)
  const [observed, setObserved] = useState(false)
  return <main className="mx-auto max-w-md space-y-4 p-4">
    <button onClick={() => setRecovered((value) => !value)}>Toggle on-time arrival</button>
    <button onClick={() => setObserved((value) => !value)}>Toggle observed position</button>
    <FlightCard flight={{ ...flight, estimated_arrival: recovered ? flight.scheduled_arrival : flight.estimated_arrival,
      position_source: observed ? 'FLIGHT_TRACK' : 'FLIGHT_ESTIMATE', estimate_basis: observed ? null : flight.estimate_basis }} tripId="trip" />
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
