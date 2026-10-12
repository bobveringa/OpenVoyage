import { describe, expect, it } from 'vitest'

import {
  accuracyCutoffFor,
  createMovementDetector,
  shouldRescueRejectedFix,
  decideTracking,
  isMeaningfulChange,
  STATIONARY_DWELL_MS,
  type AdaptiveInput,
} from '@/tracking/adaptive'
import type { PowerState } from '@/tracking/position-source'
import { DEFAULT_TRACKING_SETTINGS } from '@/tracking/tracking-settings'

const HEALTHY_POWER: PowerState = {
  batteryLevel: 0.8,
  charging: false,
  powerSaveMode: false,
}

const BALANCED = { ...DEFAULT_TRACKING_SETTINGS, smartPrecision: 3 as const }

function decide(overrides: Partial<AdaptiveInput> = {}) {
  return decideTracking({
    coarseLocationAvailable: true,
    movement: 'moving',
    power: HEALTHY_POWER,
    settings: BALANCED,
    speedMps: null,
    ...overrides,
  })
}

describe('sparse tracking profiles', () => {
  it('keeps the selected request interval and power across movement and battery changes', () => {
    const profiles = [
      { level: 1, seconds: 3600, power: 'low' },
      { level: 2, seconds: 900, power: 'low' },
      { level: 3, seconds: 600, power: 'balanced' },
      { level: 4, seconds: 360, power: 'high' },
      { level: 5, seconds: 10, power: 'high' },
    ] as const
    for (const profile of profiles) {
      const settings = { ...BALANCED, smartPrecision: profile.level }
      const moving = decide({ settings, speedMps: 30 })
      const parked = decide({
        movement: 'stationary',
        power: { batteryLevel: 0.02, charging: false, powerSaveMode: true },
        settings,
        speedMps: 0,
      })
      for (const decision of [moving, parked]) {
        expect(decision.intervalSeconds).toBe(profile.seconds)
        expect(decision.powerLevel).toBe(profile.power)
        expect(decision.reason).toBe('fixed')
        expect(decision.distanceFilterMeters).toBe(0)
      }
    }
  })

  it('honors manual cadence and distance without a battery override', () => {
    const settings = {
      ...BALANCED,
      mode: 'manual' as const,
      manualIntervalSeconds: 120,
      manualPowerLevel: 'high' as const,
      distanceFilterMeters: 25,
    }
    const decision = decide({
      settings,
      power: { batteryLevel: 0.02, charging: false, powerSaveMode: true },
    })
    expect(decision.intervalSeconds).toBe(120)
    expect(decision.powerLevel).toBe('high')
    expect(decision.distanceFilterMeters).toBe(25)
  })
})
describe('decideTracking — location source', () => {
  // Which engine records is a user choice; the cadence policy has no business
  // overriding it, so it must survive every branch untouched.
  it('carries the location source through unchanged', () => {
    for (const source of ['auto', 'gms', 'platform'] as const) {
      const settings = { ...BALANCED, locationSource: source }
      expect(decide({ settings, speedMps: 20 }).locationSource).toBe(source)
      expect(decide({ movement: 'stationary', settings }).locationSource).toBe(source)
      expect(
        decide({ power: { ...HEALTHY_POWER, batteryLevel: 0.02 }, settings }).locationSource,
      ).toBe(source)
    }
  })
})

describe('accuracyCutoffFor', () => {
  // Low-power network fixes need a much looser cutoff than balanced fixes.
  it('loosens from balanced to low power', () => {
    expect(accuracyCutoffFor('balanced')).toBeLessThan(accuracyCutoffFor('low'))
  })

  it('does not reject high-tier fixes solely for reported accuracy', () => {
    expect(accuracyCutoffFor('high')).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('shouldRescueRejectedFix', () => {
  const rescue = (reason: string, msSinceAccepted: number) =>
    shouldRescueRejectedFix({ intervalSeconds: 60, msSinceAccepted, reason })

  it('holds the cutoff while points are still being recorded', () => {
    expect(rescue('accuracy', 60_000)).toBe(false)
    expect(rescue('accuracy', 179_000)).toBe(false)
  })

  // Regression for a real trace: 17 minutes and 16 km of driving vanished
  // because every fix in it sat above the cutoff and was dropped silently.
  it('records a coarse fix once nothing has been recorded for three intervals', () => {
    expect(rescue('accuracy', 181_000)).toBe(true)
    expect(rescue('accuracy', 17 * 60_000)).toBe(true)
  })

  it('never rescues a fix that is wrong rather than imprecise', () => {
    for (const reason of ['before-session', 'coordinates', 'out-of-order', 'gps-jump']) {
      expect(rescue(reason, 17 * 60_000)).toBe(false)
    }
  })

  it('scales the drought with the interval', () => {
    // A 5-minute interval must not be rescued after 3 minutes of quiet.
    expect(
      shouldRescueRejectedFix({
        intervalSeconds: 300,
        msSinceAccepted: 181_000,
        reason: 'accuracy',
      }),
    ).toBe(false)
  })
})

describe('createMovementDetector', () => {
  const at = (minutes: number) => Date.parse('2026-08-18T22:00:00Z') + minutes * 60_000

  function sample(
    latitude: number,
    longitude: number,
    atMs: number,
    overrides: { accuracyMeters?: number; speedMps?: number | null } = {},
  ) {
    return {
      accuracyMeters: overrides.accuracyMeters ?? 13,
      atMs,
      latitude,
      longitude,
      speedMps: overrides.speedMps === undefined ? null : overrides.speedMps,
    }
  }

  // Regression: a real trace of a phone parked for six minutes. Every fix
  // carried no speed, so the old speed-keyed detector never left 'unknown' and
  // the recording sampled at the full baseline rate the whole time.
  it('calls a parked phone stationary even when no fix reports a speed', () => {
    const detector = createMovementDetector()
    const parked: Array<[number, number]> = [
      [51.5786, 5.3602],
      [51.5786, 5.36019],
      [51.5786, 5.36018],
      [51.5786, 5.36018],
      [51.57859, 5.36015],
      [51.5786, 5.36017],
      [51.5786, 5.36015],
    ]

    let state
    parked.forEach(([lat, lon], index) => {
      state = detector.observe(sample(lat, lon, at(index)))
    })

    expect(state).toBe('stationary')
  })

  // Regression: the same phone later reported 0.57-0.88 m/s of Doppler noise
  // while its coordinates moved 10 m in two minutes. That kept it above the
  // old 0.5 m/s threshold, so it read as "moving" and the cadence formula
  // stretched the interval in proportion to the noise.
  it('ignores a speed field that disagrees with where the device actually is', () => {
    const detector = createMovementDetector()
    detector.observe(
      sample(51.45099, 5.46369, at(0), { accuracyMeters: 31, speedMps: 0.88 }),
    )
    detector.observe(
      sample(51.45108, 5.46367, at(2), { accuracyMeters: 88, speedMps: 0.68 }),
    )
    const state = detector.observe(
      sample(51.45133, 5.46382, at(4), { accuracyMeters: 20, speedMps: 0.57 }),
    )

    expect(state).toBe('stationary')
    // ~10 m over two minutes, not the 0.68 m/s the fix claimed.
    expect(detector.getSpeedMps()).toBeLessThan(0.3)
  })

  it('reports movement once the device leaves the anchor', () => {
    const detector = createMovementDetector()
    detector.observe(sample(51.5786, 5.3602, at(0)))
    // ~1.1 km north — far beyond any accuracy-derived threshold.
    expect(detector.observe(sample(51.5886, 5.3602, at(1)))).toBe('moving')
  })

  it('does not mistake noise on a coarse fix for movement', () => {
    const detector = createMovementDetector()
    // Two ±100 m fixes 90 m apart: within what that accuracy can explain.
    detector.observe(sample(51.5786, 5.3602, at(0), { accuracyMeters: 100 }))
    const state = detector.observe(
      sample(51.57941, 5.3602, at(2), { accuracyMeters: 100 }),
    )
    expect(state).not.toBe('moving')
  })

  // Pulling away from a stop should not wait for displacement to accumulate.
  it('trusts the speed field when it is well clear of the noise floor', () => {
    const detector = createMovementDetector()
    detector.observe(sample(51.5786, 5.3602, at(0)))
    expect(
      detector.observe(sample(51.5786, 5.36021, at(1), { speedMps: 12 })),
    ).toBe('moving')
  })

  it('needs the full dwell before declaring a stop', () => {
    const detector = createMovementDetector()
    detector.observe(sample(51.5786, 5.3602, at(0), { speedMps: 12 }))
    detector.observe(sample(51.5886, 5.3602, at(1), { speedMps: 12 }))

    // The dwell can only start from the first fix that looks stopped — there
    // is no way to know it stopped earlier than that.
    const stoppedAt = at(1) + 1_000
    expect(detector.observe(sample(51.5886, 5.3602, stoppedAt))).toBe('moving')
    expect(
      detector.observe(sample(51.5886, 5.3602, stoppedAt + STATIONARY_DWELL_MS - 1)),
    ).toBe('moving')
    expect(
      detector.observe(sample(51.5886, 5.3602, stoppedAt + STATIONARY_DWELL_MS)),
    ).toBe('stationary')
  })
})

describe('isMeaningfulChange', () => {
  const base = {
    distanceFilterMeters: 10,
    intervalSeconds: 30,
    locationSource: 'auto' as const,
    powerLevel: 'high' as const,
  }

  it('ignores drift too small to be worth a GPS re-acquisition', () => {
    expect(isMeaningfulChange(base, { ...base, intervalSeconds: 32 })).toBe(false)
  })

  it('reports a real cadence change', () => {
    expect(isMeaningfulChange(base, { ...base, intervalSeconds: 10 })).toBe(true)
    expect(isMeaningfulChange(base, { ...base, intervalSeconds: 120 })).toBe(true)
  })

  it('reports a power-tier change even at the same interval', () => {
    expect(isMeaningfulChange(base, { ...base, powerLevel: 'balanced' })).toBe(true)
  })
})
