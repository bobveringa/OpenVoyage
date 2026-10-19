import type { TravelLeg } from './models'
import type { TravelLegEditDraft } from './page-types'

export function routeTime(seconds: number | null | undefined) {
  if (seconds == null) return null
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + ' hr' + (minutes % 60 ? ' ' + minutes % 60 + ' min' : '')
}

export function routeDistance(meters: number | null | undefined) {
  return meters == null ? null : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(meters / 1000) + ' km'
}

export function connectionWithOptions(connection: TravelLeg, draft: TravelLegEditDraft): TravelLeg {
  const segments = connection.segments.map((segment, index) => {
    const option = segment.route_options?.[draft.segments[index]?.route_option || 0]
    return option ? { ...segment, ...option } : segment
  })
  const allRoad = segments.every((segment) => segment.route_state === 'READY')
  const duration = allRoad && segments.every((segment) => segment.duration_seconds != null)
    ? segments.reduce((total, segment) => total + segment.duration_seconds!, 0) : connection.duration_seconds
  return { ...connection, segments, duration_seconds: duration, route: { ...connection.route,
    geometry: { type: 'LineString', coordinates: segments.flatMap((segment) => segment.geometry?.coordinates || []) },
    duration_seconds: duration,
    distance_meters: allRoad && segments.every((segment) => segment.distance_meters != null)
      ? segments.reduce((total, segment) => total + segment.distance_meters!, 0) : null,
  } }
}
