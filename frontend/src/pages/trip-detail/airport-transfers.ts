import type { ConnectionAnchor } from './connection-endpoints'
import type { MapConnection } from './models'
import { getCentralAngle } from './route-geometry'

export type AirportTransferSide = 'departure' | 'arrival'
export type AirportTransferRequest = { connectionId: string; side: AirportTransferSide; sequence: number }
type Point = { latitude: number; longitude: number; name: string }
export type AirportTransfer = {
  connectionId: string
  side: AirportTransferSide
  from: Point
  to: Point
}

/** Visual gaps only: these are never saved as transport or included in estimates. */
export function getAirportTransfers(connection: MapConnection, fromStop: ConnectionAnchor, toStop: ConnectionAnchor): AirportTransfer[] {
  const transfers: AirportTransfer[] = []
  const first = connection.segments[0]
  const last = connection.segments[connection.segments.length - 1]
  function add(side: AirportTransferSide, from: Point, to: Point) {
    // An airport stop (or the same point with slightly different coordinates)
    // does not need a transfer back to itself.
    const meters = getCentralAngle([from.latitude, from.longitude], [to.latitude, to.longitude]) * 6_371_000
    if (Number.isFinite(meters) && meters > 100) transfers.push({ connectionId: connection.id, side, from, to })
  }
  if (first?.intent.travel_mode === 'FLIGHT' && first.from_endpoint) {
    add('departure', { ...fromStop.location, name: fromStop.title }, first.from_endpoint)
  }
  if (last?.intent.travel_mode === 'FLIGHT' && last.to_endpoint) {
    add('arrival', last.to_endpoint, { ...toStop.location, name: toStop.title })
  }
  return transfers
}

export function airportTransferLabel(transfer: AirportTransfer) {
  return `Airport transfer: ${transfer.from.name || 'Departure'} → ${transfer.to.name || 'Arrival'}`
}
