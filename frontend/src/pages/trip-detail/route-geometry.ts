import type * as L from 'leaflet'

import type { GeoJsonLineString } from '@/api/client'
import type { Stop } from '@/pages/trip-detail/models'
import { getStopCoordinates } from '@/pages/trip-detail/shared-utils'

const earthRadiusKilometers = 6371
const geodesicSegmentKilometers = 125

export function getGeoJsonLineStringCoordinates(
  geometry: GeoJsonLineString,
): L.LatLngTuple[] | null {
  if (geometry.type !== 'LineString' || geometry.coordinates.length < 2) {
    return null
  }

  const coordinates: L.LatLngTuple[] = []
  for (const position of geometry.coordinates) {
    const coordinate = getLeafletCoordinate(position)
    if (!coordinate) {
      return null
    }
    coordinates.push(coordinate)
  }

  return unwrapRouteLongitudes(coordinates)
}

export function getSimpleRouteCoordinates(fromStop: Stop, toStop: Stop) {
  return createGeodesicRoute([
    getStopCoordinates(fromStop),
    getStopCoordinates(toStop),
  ])
}

function getLeafletCoordinate(
  position: GeoJsonLineString['coordinates'][number],
): L.LatLngTuple | null {
  const [longitude, latitude] = position
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90
  ) {
    return null
  }

  return [latitude, longitude]
}

export function createGeodesicRoute(coordinates: readonly L.LatLngTuple[]) {
  if (coordinates.length < 2) {
    return [...coordinates]
  }

  const route: L.LatLngTuple[] = []
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]
    const end = coordinates[index + 1]
    if (!start || !end) {
      continue
    }

    const segment = interpolateGeodesicSegment(start, end)
    route.push(...(route.length > 0 ? segment.slice(1) : segment))
  }

  return unwrapRouteLongitudes(route)
}

function interpolateGeodesicSegment(
  start: L.LatLngTuple,
  end: L.LatLngTuple,
) {
  const angularDistance = getCentralAngle(start, end)
  if (angularDistance < 1e-9) {
    return [start, end]
  }

  const segmentCount = Math.max(
    1,
    Math.min(
      128,
      Math.ceil(
        (angularDistance * earthRadiusKilometers) / geodesicSegmentKilometers,
      ),
    ),
  )
  const points: L.LatLngTuple[] = []

  for (let index = 0; index <= segmentCount; index += 1) {
    points.push(interpolateGreatCirclePoint(start, end, index / segmentCount))
  }

  return points
}

function interpolateGreatCirclePoint(
  start: L.LatLngTuple,
  end: L.LatLngTuple,
  fraction: number,
): L.LatLngTuple {
  const startLat = toRadians(start[0])
  const startLng = toRadians(start[1])
  const endLat = toRadians(end[0])
  const endLng = toRadians(end[1])
  const angularDistance = getCentralAngle(start, end)
  const sinDistance = Math.sin(angularDistance)

  if (Math.abs(sinDistance) < 1e-9) {
    return [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]
  }

  const startWeight = Math.sin((1 - fraction) * angularDistance) / sinDistance
  const endWeight = Math.sin(fraction * angularDistance) / sinDistance
  const x =
    startWeight * Math.cos(startLat) * Math.cos(startLng) +
    endWeight * Math.cos(endLat) * Math.cos(endLng)
  const y =
    startWeight * Math.cos(startLat) * Math.sin(startLng) +
    endWeight * Math.cos(endLat) * Math.sin(endLng)
  const z = startWeight * Math.sin(startLat) + endWeight * Math.sin(endLat)

  return [
    toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y))),
    normalizeLongitude(toDegrees(Math.atan2(y, x))),
  ]
}

export function getCentralAngle(start: L.LatLngTuple, end: L.LatLngTuple) {
  const startLat = toRadians(start[0])
  const endLat = toRadians(end[0])
  const deltaLat = endLat - startLat
  const deltaLng = toRadians(end[1] - start[1])
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2

  return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
}

function unwrapRouteLongitudes(coordinates: readonly L.LatLngTuple[]) {
  if (coordinates.length <= 1) {
    return [...coordinates]
  }

  const firstCoordinate = coordinates[0]
  if (!firstCoordinate) {
    return []
  }

  const unwrapped: L.LatLngTuple[] = [firstCoordinate]
  let previousLongitude = firstCoordinate[1]
  for (const coordinate of coordinates.slice(1)) {
    const longitude = unwrapLongitude(coordinate[1], previousLongitude)
    unwrapped.push([coordinate[0], longitude])
    previousLongitude = longitude
  }

  return unwrapped
}

function unwrapLongitude(longitude: number, previousLongitude: number) {
  let unwrapped = longitude
  while (unwrapped - previousLongitude > 180) {
    unwrapped -= 360
  }
  while (unwrapped - previousLongitude < -180) {
    unwrapped += 360
  }
  return unwrapped
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI
}

export function createRouteGeometryKey(geometry: GeoJsonLineString) {
  return geometry.coordinates
    .map((position) => `${position[0]},${position[1]}`)
    .join(';')
}

export function createStopPairKey(fromStopId: string, toStopId: string) {
  return `${fromStopId}:${toStopId}`
}

