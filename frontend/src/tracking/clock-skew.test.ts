import { describe, expect, it } from 'vitest'

import { checkClockSkew, CLOCK_SKEW_THRESHOLD_MS } from '@/tracking/clock-skew'

describe('checkClockSkew', () => {
  it('is within tolerance when the clocks match', () => {
    const server = new Date('2026-08-16T09:00:00.000Z')
    const device = new Date('2026-08-16T09:00:00.000Z')
    expect(checkClockSkew(server, device)).toEqual({ skewMs: 0, withinTolerance: true })
  })

  it('is within tolerance exactly at the threshold', () => {
    const server = new Date('2026-08-16T09:00:00.000Z')
    const device = new Date(server.getTime() + CLOCK_SKEW_THRESHOLD_MS)
    expect(checkClockSkew(server, device).withinTolerance).toBe(true)
  })

  it('is out of tolerance just past the threshold, device ahead', () => {
    const server = new Date('2026-08-16T09:00:00.000Z')
    const device = new Date(server.getTime() + CLOCK_SKEW_THRESHOLD_MS + 1)
    const result = checkClockSkew(server, device)
    expect(result.withinTolerance).toBe(false)
    expect(result.skewMs).toBe(CLOCK_SKEW_THRESHOLD_MS + 1)
  })

  it('is out of tolerance when the device clock is behind', () => {
    const server = new Date('2026-08-16T09:00:00.000Z')
    const device = new Date(server.getTime() - CLOCK_SKEW_THRESHOLD_MS - 5000)
    const result = checkClockSkew(server, device)
    expect(result.withinTolerance).toBe(false)
    expect(result.skewMs).toBe(-(CLOCK_SKEW_THRESHOLD_MS + 5000))
  })
})
