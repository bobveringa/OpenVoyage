import { describe, expect, it } from 'vitest'
import {
  clampMove,
  destination,
  distance,
  insertionArea,
  moveAreaRadius,
} from './edit-geometry'

describe('session point editing distances', () => {
  it('clamps moves to the supplied connection-aware radius', () => {
    for (const meters of [499, 500, 501, 2_000]) {
      const target = destination([52, 5], 1, meters)
      expect(distance([52, 5], clampMove([52, 5], target))).toBeCloseTo(
        Math.min(meters, 500),
        5,
      )
    }
  })
  it('creates a broad circular insertion area around the midpoint', () => {
    const shortSegment = insertionArea([0, 0], [0, 0.004])
    expect(shortSegment.radius).toBe(500)
    expect(distance(shortSegment.center, [0, 0.002])).toBeCloseTo(0, 2)

    expect(insertionArea([0, 0], [0, 0]).radius).toBe(500)
    expect(insertionArea([0, 0], [0, 1]).radius).toBeCloseTo(111_194.93, 2)
  })
  it('makes move areas large enough for adjacent connections', () => {
    expect(moveAreaRadius([0, 0], [[0, 0.01]])).toBeCloseTo(1_667.92, 2)
    expect(moveAreaRadius([0, 0], [])).toBe(500)
  })
})
