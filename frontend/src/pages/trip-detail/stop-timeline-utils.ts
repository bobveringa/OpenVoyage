import type { Connection } from '@/pages/trip-detail/models'
import { formatDistance, formatDuration } from '@/pages/trip-detail/planning-utils'

/** Minutes ahead of UTC in a time zone on a date, or null when unknown. */
export function utcOffsetMinutes(timeZone: string, date: string): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${date}T12:00:00Z`))
      .find((part) => part.type === 'timeZoneName')?.value
    if (!name) return null
    if (name === 'GMT') return 0
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name)
    if (!match) return null
    const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0)
    return match[1] === '-' ? -minutes : minutes
  } catch {
    return null
  }
}

/** "Time difference +1 h" when the clock changes between two places on a travel date. */
export function clockChangeHint(fromTimeZone: string, toTimeZone: string, date: string): string | null {
  if (!fromTimeZone || !toTimeZone || fromTimeZone === toTimeZone) return null
  const from = utcOffsetMinutes(fromTimeZone, date)
  const to = utcOffsetMinutes(toTimeZone, date)
  if (from === null || to === null || from === to) return null
  const difference = to - from
  const hours = Math.floor(Math.abs(difference) / 60)
  const minutes = Math.abs(difference) % 60
  const amount = [hours ? `${hours} h` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' ')
  return `Time difference ${difference > 0 ? '+' : '−'}${amount}`
}

function geodesicMeters(coordinates: readonly (readonly [number, number])[]) {
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const [lon1, lat1] = coordinates[index - 1]!
    const [lon2, lat2] = coordinates[index]!
    const rad = Math.PI / 180
    const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
    total += 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
  }
  return total
}

const ROAD_MODES = ['CAR', 'BIKE', 'WALK']

/** A leg's length: the road route, or along the line for a flight, train or ferry. */
function segmentMeters(segment: Connection['segments'][number]): number | null {
  if (typeof segment.distance_meters === 'number') return segment.distance_meters
  if (ROAD_MODES.includes(segment.intent.travel_mode) || !segment.geometry) return null
  return geodesicMeters(segment.geometry.coordinates)
}

function sumOrNull(values: readonly (number | null | undefined)[]) {
  return values.length > 0 && values.every((value) => typeof value === 'number')
    ? (values as number[]).reduce((total, value) => total + value, 0)
    : null
}

/** "1,146 km · 1 hr 55 min +", or how far the route is from ready.
 * A mixed trip (car, flight, car) adds up its legs. */
export function travelLineSummary(connection: Connection): string {
  const flightsOnly = connection.segments.length > 0 &&
    connection.segments.every((segment) => segment.intent.travel_mode === 'FLIGHT')
  const distance = connection.route.type === 'PROVIDER_BACKED' && typeof connection.route.distance_meters === 'number'
    ? connection.route.distance_meters
    : sumOrNull(connection.segments.map(segmentMeters))
      ?? (flightsOnly ? geodesicMeters(connection.route.geometry.coordinates) : null)
  const duration = typeof connection.duration_seconds === 'number'
    ? connection.duration_seconds
    : sumOrNull(connection.segments.map((segment) => segment.duration_seconds))
  const parts = [
    distance !== null ? formatDistance(Math.round(distance)) : null,
    duration !== null ? formatDuration(duration) : null,
  ].filter((part): part is string => part !== null)
  if (parts.length > 0) return parts.join(' · ')
  return connection.segments.some((segment) => segment.route_state === 'FAILED')
    ? 'Route unavailable'
    : 'Approximate connection'
}

/** The ``after_stop_id`` that puts the stop at ``from`` into the gap before ``gap``. */
export function placementForGap(stopIds: readonly string[], from: number, gap: number) {
  if (gap === from || gap === from + 1) return null
  return { after_stop_id: gap === 0 ? null : stopIds[gap - 1]! }
}
