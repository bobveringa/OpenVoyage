import { describe, expect, it } from 'vitest'

import { createFixGate } from '@/tracking/position-source'

const STATIONARY = { latitude: 51.5, longitude: 5.5 }

describe('createFixGate', () => {
  it('always accepts the first fix', () => {
    const gate = createFixGate(30, 10)
    expect(gate({ atMs: 0, ...STATIONARY })).toBe(true)
  })

  // Regression test: a stationary recording must still produce a point
  // every intervalSeconds. This previously broke because distanceFilter
  // was passed to the native watcher's own distanceFilter option, which
  // hard-blocks delivery until the device moves — so nothing arrived here
  // to even be gated.
  it('accepts a later fix at the exact same location once the interval elapses, not before', () => {
    const gate = createFixGate(30, 10)
    gate({ atMs: 0, ...STATIONARY })

    expect(gate({ atMs: 29_999, ...STATIONARY })).toBe(false)
    expect(gate({ atMs: 30_000, ...STATIONARY })).toBe(true)
  })

  it('accepts a fix that moved past the distance filter before the interval elapses', () => {
    const gate = createFixGate(30, 10)
    gate({ atMs: 0, ...STATIONARY })

    // ~0.0001 degrees of latitude is roughly 11 meters.
    const moved = { latitude: STATIONARY.latitude + 0.0001, longitude: STATIONARY.longitude }
    expect(gate({ atMs: 5_000, ...moved })).toBe(true)
  })

  it('ignores movement as a trigger when the distance filter is 0 (disabled)', () => {
    const gate = createFixGate(30, 0)
    gate({ atMs: 0, ...STATIONARY })

    const movedFar = { latitude: STATIONARY.latitude + 1, longitude: STATIONARY.longitude }
    expect(gate({ atMs: 5_000, ...movedFar })).toBe(false)
    expect(gate({ atMs: 30_000, ...movedFar })).toBe(true)
  })
})
