import { describe, expect, it } from 'vitest'

import type { Connection } from '@/pages/trip-detail/models'
import { clockChangeHint, placementForGap, travelLineSummary, utcOffsetMinutes } from './stop-timeline-utils'

function connection(overrides: Partial<Connection>, modes: string[] = ['CAR'], state = 'NOT_CALCULATED') {
  return {
    route: { type: 'SIMPLE', distance_meters: null, geometry: { type: 'LineString', coordinates: [[4.9, 52.37], [2.16, 41.39]] } },
    duration_seconds: null,
    segments: modes.map((travel_mode) => ({ intent: { travel_mode }, route_state: state })),
    ...overrides,
  } as unknown as Connection
}

describe('clockChangeHint', () => {
  it('shows the clock change on the travel date', () => {
    expect(clockChangeHint('Europe/London', 'Europe/Amsterdam', '2026-10-03')).toBe('Time difference +1 h')
    expect(clockChangeHint('Europe/Amsterdam', 'Europe/London', '2026-10-03')).toBe('Time difference −1 h')
    expect(clockChangeHint('Europe/Amsterdam', 'Asia/Kolkata', '2026-10-03')).toBe('Time difference +3 h 30 min')
  })

  it('stays quiet without a change', () => {
    expect(clockChangeHint('Europe/Amsterdam', 'Europe/Madrid', '2026-10-03')).toBeNull()
    expect(clockChangeHint('Europe/Amsterdam', 'Europe/Amsterdam', '2026-10-03')).toBeNull()
    expect(clockChangeHint('Europe/Amsterdam', 'Not/AZone', '2026-10-03')).toBeNull()
  })

  it('follows daylight saving on the date', () => {
    expect(utcOffsetMinutes('UTC', '2026-01-10')).toBe(0)
    expect(utcOffsetMinutes('Europe/Amsterdam', '2026-01-10')).toBe(60)
    expect(utcOffsetMinutes('Europe/Amsterdam', '2026-07-10')).toBe(120)
    expect(utcOffsetMinutes('America/New_York', '2026-07-10')).toBe(-240)
  })
})

describe('travelLineSummary', () => {
  it('shows distance and duration of a ready route', () => {
    expect(travelLineSummary(connection({
      route: { type: 'PROVIDER_BACKED', distance_meters: 95_400, duration_seconds: 4_000, geometry: { type: 'LineString', coordinates: [] } },
      duration_seconds: 4_000,
    } as Partial<Connection>, ['CAR'], 'READY'))).toBe('95 km · 1 hr 5 min +')
  })

  it('measures a flight along its line', () => {
    expect(travelLineSummary(connection({ duration_seconds: 7_000 }, ['FLIGHT'], 'UNSUPPORTED')))
      .toBe('1,238 km · 1 hr 55 min +')
  })

  it('adds up the legs of a car, flight and car trip', () => {
    const leg = (travel_mode: string, distance_meters: number | null, duration_seconds: number, coordinates: number[][]) => ({
      intent: { travel_mode }, route_state: travel_mode === 'CAR' ? 'READY' : 'UNSUPPORTED', distance_meters, duration_seconds,
      geometry: { type: 'LineString', coordinates },
    })
    expect(travelLineSummary(connection({
      segments: [
        leg('CAR', 17_000, 1_400, [[4.89, 52.37], [4.76, 52.31]]),
        leg('FLIGHT', null, 4_500, [[4.76, 52.31], [2.55, 49.01]]),
        leg('CAR', 38_000, 3_100, [[2.55, 49.01], [2.35, 48.86]]),
      ],
    } as unknown as Partial<Connection>))).toBe('454 km · 2 hr 30 min +')
  })

  it('says how far the route is from ready', () => {
    expect(travelLineSummary(connection({}))).toBe('Approximate connection')
    expect(travelLineSummary(connection({}, ['CAR'], 'FAILED'))).toBe('Route unavailable')
  })
})

describe('placementForGap', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('places the stop after the stop before the gap', () => {
    expect(placementForGap(ids, 0, 2)).toEqual({ after_stop_id: 'b' })
    expect(placementForGap(ids, 3, 0)).toEqual({ after_stop_id: null })
    expect(placementForGap(ids, 1, 4)).toEqual({ after_stop_id: 'd' })
  })

  it('ignores the gaps on either side of the stop', () => {
    expect(placementForGap(ids, 1, 1)).toBeNull()
    expect(placementForGap(ids, 1, 2)).toBeNull()
  })
})
