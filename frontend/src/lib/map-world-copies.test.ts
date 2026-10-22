import type { LatLngTuple } from 'leaflet'
import { describe, expect, it } from 'vitest'
import { createGeodesicRoute } from '@/pages/trip-detail/route-geometry'
import { getVisibleWorldOffsets, nearestWorldCoordinate, normalizeWorldCoordinate, shiftWorldCoordinate, shiftWorldRoute } from './map-world-copies'

describe('repeated map worlds', () => {
  it.each([0, 360, -360, 1080, -1080])('aligns Honolulu and both flight endpoints with world offset %s', (offset) => {
    const bucharest: LatLngTuple = [44.4268, 26.1025]
    const honolulu: LatLngTuple = [21.3099, -157.8581]
    const route = createGeodesicRoute([bucharest, honolulu])
    const before = structuredClone(route)
    const drawn = shiftWorldRoute(route, offset)
    const end = drawn[drawn.length - 1]
    // This flight crosses the date line eastbound and reaches the next Hawaii.
    const marker = shiftWorldCoordinate(honolulu, offset + 360)
    expect(end[0]).toBeCloseTo(marker[0], 8)
    expect(end[1]).toBeCloseTo(marker[1], 8)
    expect(drawn[0][1]).toBeCloseTo(bucharest[1] + offset, 8)
    expect(route).toEqual(before)
  })

  it('keeps a westbound crossing continuous too', () => {
    expect(shiftWorldRoute([[10, -170], [20, 170]], 0)).toEqual([[10, -170], [20, -190]])
    expect(shiftWorldRoute([[10, 170], [20, -170]], -360)).toEqual([[10, -190], [20, -170]])
  })

  it('keeps European routes unchanged in the original world', () => {
    const route: LatLngTuple[] = [[52.37, 4.9], [48.21, 16.37]]
    expect(shiftWorldRoute(route, 0)).toEqual(route)
  })

  it('finds all visible copies across wide and repeatedly panned viewports', () => {
    expect(getVisibleWorldOffsets(-180, 180, -158, -158)).toEqual([0])
    expect(getVisibleWorldOffsets(180, 540, -158, -158)).toEqual([0, 360])
    expect(getVisibleWorldOffsets(-540, -180, -158, -158)).toEqual([0, -360])
    expect(getVisibleWorldOffsets(-540, 540, -158, -158)).toEqual([0, -360, 360])
    expect(getVisibleWorldOffsets(900, 1260, -158, -158)).toEqual([0, 1080])
  })

  it('includes a crossing line when either of its worlds intersects the view', () => {
    expect(getVisibleWorldOffsets(-180, -140, 26, 202)).toContain(-360)
    expect(getVisibleWorldOffsets(190, 210, -158, -158)).toContain(360)
  })

  it('normalizes positions picked in mirrored worlds before they are saved', () => {
    expect(normalizeWorldCoordinate([21, 202])).toEqual([21, -158])
    expect(normalizeWorldCoordinate([21, -518])).toEqual([21, -158])
    expect(normalizeWorldCoordinate([21, 1282])).toEqual([21, -158])
    expect(normalizeWorldCoordinate([21.3099, -157.8581])).toEqual([21.3099, -157.8581])
  })

  it('focuses a post in the currently viewed world', () => {
    expect(nearestWorldCoordinate([21, -158], 200)).toEqual([21, 202])
    expect(nearestWorldCoordinate([21, -158], -520)).toEqual([21, -518])
    expect(nearestWorldCoordinate([21, -158], 1280)).toEqual([21, 1282])
  })
})
