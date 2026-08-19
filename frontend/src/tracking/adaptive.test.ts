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

// Precision 3 ("Balanced"): 60 s baseline, high power.
const BALANCED = { ...DEFAULT_TRACKING_SETTINGS, smartPrecision: 3 as const }

function decide(overrides: Partial<AdaptiveInput> = {}) {
  return decideTracking({
    movement: 'moving',
    power: HEALTHY_POWER,
    settings: BALANCED,
    speedMps: null,
    ...overrides,
  })
}

describe('decideTracking — smart mode', () => {
  it('starts from the chosen precision preset', () => {
    expect(decide({ speedMps: 1.4 }).intervalSeconds).toBe(60)
    expect(decide({ speedMps: 1.4 }).powerLevel).toBe('high')

    const frugal = decide({
      settings: { ...BALANCED, smartPrecision: 1 },
      speedMps: 1.4,
    })
    expect(frugal.intervalSeconds).toBe(300)
    expect(frugal.powerLevel).toBe('low')
  })

  it('stretches the interval while stationary', () => {
    const decision = decide({ movement: 'stationary', speedMps: 0.1 })

    expect(decision.intervalSeconds).toBeGreaterThan(60)
    expect(decision.reason).toBe('stationary')
  })

  // Reproduced on device: parking dropped the tier to `balanced`, the engine
  // then produced no fixes at all, and because movement can only be noticed
  // *from* a fix the recording could never recover — it sat parked through a
  // 1.5 km move. Battery is the third priority, behind offline reliability and
  // accuracy; a saving that can strand the recording is not worth taking.
  it('keeps the power tier while stationary so movement can still be noticed', () => {
    for (const level of [1, 3, 5] as const) {
      const settings = { ...BALANCED, smartPrecision: level }
      const moving = decide({ settings, speedMps: 1.4 })
      const parked = decide({ movement: 'stationary', settings, speedMps: 0 })
      expect(parked.powerLevel).toBe(moving.powerLevel)
    }
  })

  it('samples more densely as speed rises, so a road keeps its shape', () => {
    const walking = decide({ speedMps: 1.4 })
    const brisk = decide({ speedMps: 3 })
    const cycling = decide({ speedMps: 6 })
    const driving = decide({ speedMps: 25 })

    expect(walking.intervalSeconds).toBe(60)
    expect(brisk.intervalSeconds).toBeLessThan(walking.intervalSeconds)
    expect(cycling.intervalSeconds).toBeLessThan(brisk.intervalSeconds)
    // Past roughly four times walking pace the densification cap takes over,
    // so a car and a train sample at the same maximum rate.
    expect(driving.intervalSeconds).toBe(cycling.intervalSeconds)
    expect(driving.intervalSeconds).toBe(15)
  })

  it('never samples faster than the absolute floor, however fast the device moves', () => {
    expect(decide({ speedMps: 250 }).intervalSeconds).toBeGreaterThanOrEqual(5)
  })

  it('never stretches past five minutes, however long the device sits still', () => {
    const decision = decide({
      movement: 'stationary',
      settings: { ...BALANCED, smartPrecision: 1 },
      speedMps: 0,
    })
    expect(decision.intervalSeconds).toBeLessThanOrEqual(300)
  })

  // The distance filter and the speed-derived interval both exist to keep
  // points evenly spaced; running both at once multiplies them together.
  it('leaves the distance filter off while smart mode owns the spacing', () => {
    const settings = { ...BALANCED, distanceFilterMeters: 10 }
    expect(decide({ settings, speedMps: 10 }).distanceFilterMeters).toBe(0)
  })
})

describe('decideTracking — manual mode', () => {
  const manual = {
    ...DEFAULT_TRACKING_SETTINGS,
    distanceFilterMeters: 10,
    manualIntervalSeconds: 120,
    manualPowerLevel: 'balanced' as const,
    mode: 'manual' as const,
  }

  it('honors the interval and power exactly, at any speed', () => {
    for (const speedMps of [0, 1.4, 25, 250]) {
      const decision = decideTracking({
        movement: 'moving',
        power: HEALTHY_POWER,
        settings: manual,
        speedMps,
      })
      expect(decision.intervalSeconds).toBe(120)
      expect(decision.powerLevel).toBe('balanced')
      expect(decision.reason).toBe('fixed')
    }
  })

  it('does not stretch the interval while stationary', () => {
    const decision = decideTracking({
      movement: 'stationary',
      power: HEALTHY_POWER,
      settings: manual,
      speedMps: 0,
    })
    expect(decision.intervalSeconds).toBe(120)
  })

  it('keeps the distance filter the user configured', () => {
    const decision = decideTracking({
      movement: 'moving',
      power: HEALTHY_POWER,
      settings: manual,
      speedMps: 5,
    })
    expect(decision.distanceFilterMeters).toBe(10)
  })
})

describe('decideTracking — battery safety net', () => {
  it('degrades on low battery even in manual mode', () => {
    const manual = { ...DEFAULT_TRACKING_SETTINGS, mode: 'manual' as const }
    const healthy = decide({ settings: manual })
    const low = decide({
      power: { ...HEALTHY_POWER, batteryLevel: 0.1 },
      settings: manual,
    })

    expect(low.intervalSeconds).toBe(healthy.intervalSeconds * 2)
    expect(low.powerLevel).toBe('balanced')
    expect(low.reason).toBe('battery-low')
  })

  it('degrades harder when the battery is critical', () => {
    const decision = decide({ power: { ...HEALTHY_POWER, batteryLevel: 0.03 } })
    expect(decision.reason).toBe('battery-critical')
    expect(decision.powerLevel).toBe('low')
    expect(decision.intervalSeconds).toBeGreaterThan(
      decide({ power: { ...HEALTHY_POWER, batteryLevel: 0.1 } }).intervalSeconds,
    )
  })

  it('does not degrade while charging, however low the battery reads', () => {
    const decision = decide({
      power: { batteryLevel: 0.02, charging: true, powerSaveMode: true },
      speedMps: 1.4,
    })
    expect(decision.reason).not.toBe('battery-critical')
    expect(decision.powerLevel).toBe('high')
  })

  it('respects system power-save mode', () => {
    const decision = decide({ power: { ...HEALTHY_POWER, powerSaveMode: true } })
    expect(decision.reason).toBe('power-save-mode')
    expect(decision.powerLevel).toBe('balanced')
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
  // A 100 m cutoff against a low-power request rejects essentially everything
  // network location produces, which reads to the user as the recording having
  // stopped. The cutoff has to match what the tier can actually deliver.
  it('loosens as the power tier drops', () => {
    expect(accuracyCutoffFor('high')).toBeLessThan(accuracyCutoffFor('balanced'))
    expect(accuracyCutoffFor('balanced')).toBeLessThan(accuracyCutoffFor('low'))
  })

  it('keeps a high-accuracy recording tight', () => {
    expect(accuracyCutoffFor('high')).toBe(100)
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
