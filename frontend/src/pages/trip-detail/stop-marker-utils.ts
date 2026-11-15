import { haversineMeters } from '@/tracking/geo'
import type { Stop } from './models'
import { formatDistance } from './planning-utils'

/** The same limit as the server: further away is another place. */
export const MARKER_MAX_DISTANCE_METERS = 25_000

export type MarkerPoint = { latitude: number; longitude: number }

export function markerDistance(stop: Stop, point: MarkerPoint) {
  const origin = stop.original_location
  return haversineMeters(origin.latitude, origin.longitude, point.latitude, point.longitude)
}

export function sameMarkerPoint(left: MarkerPoint, right: MarkerPoint) {
  return left.latitude === right.latitude && left.longitude === right.longitude
}

export function markerRangeError(stop: Stop, point: MarkerPoint) {
  return markerDistance(stop, point) > MARKER_MAX_DISTANCE_METERS
    ? `Choose a point within ${formatDistance(MARKER_MAX_DISTANCE_METERS)} of ${stop.original_location.name}.`
    : null
}

/** The stop's only stay, when the marker could move there. */
export function markerStaySuggestion(stop: Stop) {
  const location = stop.stays.length === 1 ? stop.stays[0]?.location : null
  if (!location || sameMarkerPoint(location, stop.location) || markerRangeError(stop, location)) return null
  return { latitude: location.latitude, longitude: location.longitude }
}
