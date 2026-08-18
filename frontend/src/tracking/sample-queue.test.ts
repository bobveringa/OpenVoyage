import { describe, expect, it } from 'vitest'

import { checkSanityFilter, type QueuedSample } from '@/tracking/sample-queue'

const BASE_SAMPLE: QueuedSample = {
  accuracyMeters: 8,
  altitudeMeters: null,
  enqueuedAt: '2026-08-16T09:00:00.100Z',
  headingDegrees: null,
  id: 'previous',
  latitude: 51.5,
  longitude: 5.5,
  recordedAt: '2026-08-16T09:00:00.000Z',
  sessionId: 'session-1',
  speedMps: null,
  travelMode: 'UNKNOWN',
}

describe('checkSanityFilter', () => {
  it('accepts a plausible first fix with no prior sample', () => {
    const result = checkSanityFilter(
      { accuracyMeters: 10, latitude: 51.5, longitude: 5.5, recordedAt: BASE_SAMPLE.recordedAt },
      null,
      100,
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects a fix less accurate than the configured threshold', () => {
    const result = checkSanityFilter(
      { accuracyMeters: 150, latitude: 51.5, longitude: 5.5, recordedAt: BASE_SAMPLE.recordedAt },
      null,
      100,
    )
    expect(result).toEqual({ ok: false, reason: 'accuracy' })
  })

  it('accepts a fix with a null accuracy (accuracy unknown)', () => {
    const result = checkSanityFilter(
      { accuracyMeters: null, latitude: 51.5, longitude: 5.5, recordedAt: BASE_SAMPLE.recordedAt },
      null,
      100,
    )
    expect(result).toEqual({ ok: true })
  })

  it.each([
    ['latitude too high', { latitude: 91, longitude: 5.5 }],
    ['latitude too low', { latitude: -91, longitude: 5.5 }],
    ['longitude too high', { latitude: 51.5, longitude: 181 }],
    ['longitude too low', { latitude: 51.5, longitude: -181 }],
    ['exactly (0, 0)', { latitude: 0, longitude: 0 }],
  ])('rejects out-of-range coordinates: %s', (_label, coords) => {
    const result = checkSanityFilter(
      { accuracyMeters: 10, recordedAt: BASE_SAMPLE.recordedAt, ...coords },
      null,
      100,
    )
    expect(result).toEqual({ ok: false, reason: 'coordinates' })
  })

  it('rejects a fix timestamped before the previous queued fix', () => {
    const result = checkSanityFilter(
      {
        accuracyMeters: 10,
        latitude: 51.5001,
        longitude: 5.5001,
        recordedAt: '2026-08-16T08:59:59.000Z',
      },
      BASE_SAMPLE,
      100,
    )
    expect(result).toEqual({ ok: false, reason: 'out-of-order' })
  })

  it('accepts a fix implying a plausible walking speed', () => {
    // ~1.4 m/s over 10 seconds is an easy walking pace.
    const result = checkSanityFilter(
      {
        accuracyMeters: 10,
        latitude: 51.500126,
        longitude: 5.5,
        recordedAt: '2026-08-16T09:00:10.000Z',
      },
      BASE_SAMPLE,
      100,
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects a fix implying a GPS jump faster than 350 m/s', () => {
    // ~1 degree of latitude (~111km) in 1 second is far beyond any vehicle.
    const result = checkSanityFilter(
      {
        accuracyMeters: 10,
        latitude: 52.5,
        longitude: 5.5,
        recordedAt: '2026-08-16T09:00:01.000Z',
      },
      BASE_SAMPLE,
      100,
    )
    expect(result).toEqual({ ok: false, reason: 'gps-jump' })
  })
})

describe('checkSanityFilter — session window', () => {
  const startedAt = '2026-08-18T12:00:00.000Z'

  // The fused provider's first callback commonly replays a cached fix from
  // before the recording began. The server discards those silently, so the
  // first point of every recording used to vanish with no trace.
  it('rejects a fix recorded before the session started', () => {
    const result = checkSanityFilter(
      {
        accuracyMeters: 5,
        latitude: 51.45,
        longitude: 5.46,
        recordedAt: '2026-08-18T11:59:57.000Z',
      },
      null,
      100,
      startedAt,
    )

    expect(result).toEqual({ ok: false, reason: 'before-session' })
  })

  it('accepts a fix recorded exactly at the session start', () => {
    const result = checkSanityFilter(
      { accuracyMeters: 5, latitude: 51.45, longitude: 5.46, recordedAt: startedAt },
      null,
      100,
      startedAt,
    )

    expect(result).toEqual({ ok: true })
  })

  it('skips the window check when no session start is supplied', () => {
    const result = checkSanityFilter(
      {
        accuracyMeters: 5,
        latitude: 51.45,
        longitude: 5.46,
        recordedAt: '1999-01-01T00:00:00.000Z',
      },
      null,
      100,
    )

    expect(result).toEqual({ ok: true })
  })
})
