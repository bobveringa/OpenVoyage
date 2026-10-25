import type { TrackedFlight } from '@/api/client'
import { createGeodesicRoute } from './route-geometry'

/** Fit the selected leg, including its arc, without involving adjacent stories. */
export function flightFocusCoordinates(flight: TrackedFlight) {
  const departure: [number, number] = [flight.departure_airport.latitude, flight.departure_airport.longitude]
  if (!flight.arrival_airport) return [departure]
  return createGeodesicRoute([departure, [flight.arrival_airport.latitude, flight.arrival_airport.longitude]])
}

export function flightStoryId(flightId: string) {
  return 'flight:' + flightId
}
