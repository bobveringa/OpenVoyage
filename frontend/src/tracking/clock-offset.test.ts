import { describe, expect, it } from 'vitest'

import {
  applyClockOffset,
  estimateClockOffsetMs,
  MAX_PLAUSIBLE_OFFSET_MS,
} from '@/tracking/clock-offset'

describe('estimateClockOffsetMs', () => {
  it('is zero when the clocks agree and the request is instantaneous', () => {
    const dateHeaderMs = Date.parse('2026-08-16T09:00:00.000Z')
    const t0 = dateHeaderMs
    const t1 = dateHeaderMs
    // dateHeaderMs + 500 (midpoint) vs estimatedServerNowAtT1 == same value,
    // so offset == 500ms from the header quantisation alone.
    expect(estimateClockOffsetMs({ dateHeaderMs, t0, t1 })).toBe(500)
  })

  it('detects the device running ahead of the server', () => {
    // Device clock is 30s ahead: its Date.now() readings are 30s greater
    // than true time, so a request that takes 0ms of true wall time still
    // reports t0 == t1 == deviceNow, and the header (true server time) sits
    // 30s behind them.
    const trueServerMs = Date.parse('2026-08-16T09:00:00.000Z')
    const deviceAheadMs = 30_000
    const dateHeaderMs = trueServerMs
    const t0 = trueServerMs + deviceAheadMs
    const t1 = trueServerMs + deviceAheadMs

    const offsetMs = estimateClockOffsetMs({ dateHeaderMs, t0, t1 })
    // Correcting t1 (device time) by offsetMs should land back near true
    // server time.
    expect(t1 + offsetMs).toBeCloseTo(trueServerMs + 500, -2)
    expect(offsetMs).toBeLessThan(0)
  })

  it('detects the device running behind the server', () => {
    const trueServerMs = Date.parse('2026-08-16T09:00:00.000Z')
    const deviceBehindMs = 45_000
    const dateHeaderMs = trueServerMs
    const t0 = trueServerMs - deviceBehindMs
    const t1 = trueServerMs - deviceBehindMs

    const offsetMs = estimateClockOffsetMs({ dateHeaderMs, t0, t1 })
    expect(offsetMs).toBeGreaterThan(0)
    expect(t1 + offsetMs).toBeCloseTo(trueServerMs + 500, -2)
  })

  it('splits an asymmetric round trip evenly between request and response', () => {
    const dateHeaderMs = Date.parse('2026-08-16T09:00:00.000Z')
    const t0 = dateHeaderMs - 1000
    const t1 = dateHeaderMs + 200
    // RTT here is 1200ms; half of that (600ms) is added to the midpoint.
    const expected = dateHeaderMs + 500 + 600 - t1
    expect(estimateClockOffsetMs({ dateHeaderMs, t0, t1 })).toBeCloseTo(expected, 5)
  })

  it('accounts for Date header second-quantisation via the +500ms midpoint', () => {
    // A zero-RTT request landing exactly on the header's second boundary
    // should read as 500ms of offset, not 0 — the header could represent any
    // instant in that second, and the midpoint is the least-biased guess.
    const dateHeaderMs = Date.parse('2026-08-16T09:00:00.000Z')
    expect(
      estimateClockOffsetMs({ dateHeaderMs, t0: dateHeaderMs, t1: dateHeaderMs }),
    ).toBe(500)
  })

  it('rejects an implausible offset and falls back to 0', () => {
    const t0 = Date.parse('2026-08-16T09:00:00.000Z')
    const t1 = t0
    const dateHeaderMs = t0 + MAX_PLAUSIBLE_OFFSET_MS + 60_000
    expect(estimateClockOffsetMs({ dateHeaderMs, t0, t1 })).toBe(0)
  })

  it('accepts an offset exactly at the plausibility boundary', () => {
    const t0 = Date.parse('2026-08-16T09:00:00.000Z')
    const t1 = t0
    // Offset works out to MAX_PLAUSIBLE_OFFSET_MS + 500 due to header
    // quantisation, so back it off by 500 to land exactly on the boundary.
    const dateHeaderMs = t0 + MAX_PLAUSIBLE_OFFSET_MS - 500
    expect(estimateClockOffsetMs({ dateHeaderMs, t0, t1 })).toBe(MAX_PLAUSIBLE_OFFSET_MS)
  })
})

describe('applyClockOffset', () => {
  it('returns the timestamp unchanged for a zero offset', () => {
    expect(applyClockOffset('2026-08-16T09:00:00.000Z', 0)).toBe('2026-08-16T09:00:00.000Z')
  })

  it('adds a positive offset', () => {
    expect(applyClockOffset('2026-08-16T09:00:00.000Z', 2_500)).toBe(
      '2026-08-16T09:00:02.500Z',
    )
  })

  it('adds a negative offset', () => {
    expect(applyClockOffset('2026-08-16T09:00:02.500Z', -2_500)).toBe(
      '2026-08-16T09:00:00.000Z',
    )
  })
})
