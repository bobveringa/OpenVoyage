import { describe, expect, it } from 'vitest'
import {
  clampMove,
  destination,
  distance,
  insertDistanceLimit,
  segmentDistance,
} from './edit-geometry'

describe('session point editing distances', () => {
  it('clamps moves to 400 metres from the saved position', () => {
    for (const meters of [399, 400, 401, 2000]) {
      const target = destination([52, 5], 1, meters)
      expect(distance([52, 5], clampMove([52, 5], target))).toBeCloseTo(
        Math.min(meters, 400),
        5,
      )
    }
  })
  it('scales insertion distance with minimum and maximum caps', () => {
    expect(insertDistanceLimit([0, 0], [0, 0])).toBe(20)
    expect(insertDistanceLimit([0, 0], [0, 1])).toBe(200)
    expect(insertDistanceLimit([0, 0], [0, 0.004])).toBeCloseTo(111.195, 2)
  })
  it('measures distance from the segment including its endpoints', () => {
    expect(segmentDistance([0, 0.002], [0, 0], [0, 0.004])).toBeCloseTo(0)
    expect(segmentDistance([0.003, 0.002], [0, 0], [0, 0.004])).toBeGreaterThan(
      200,
    )
    expect(segmentDistance([0, -0.001], [0, 0], [0, 0.001])).toBeGreaterThan(
      100,
    )
  })
  it('handles dateline crossings and repeated identical points', () => {
    expect(segmentDistance([0, 180], [0, 179.9], [0, -179.9])).toBeCloseTo(0)
    expect(segmentDistance([0, 0], [0, 0], [0, 0])).toBe(0)
  })
})
