import { describe, expect, it } from 'vitest'

import {
  createMovementDetector,
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

  it('stretches the interval and drops a power tier while stationary', () => {
    const decision = decide({ movement: 'stationary', speedMps: 0.1 })

    expect(decision.intervalSeconds).toBeGreaterThan(60)
    expect(decision.powerLevel).toBe('balanced')
    expect(decision.reason).toBe('stationary')
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

describe('createMovementDetector', () => {
  it('only calls the device stationary after it has dwelled, not on one slow fix', () => {
    const detector = createMovementDetector()

    expect(detector.observe(0.1, 0)).not.toBe('stationary')
    expect(detector.observe(0.1, STATIONARY_DWELL_MS - 1)).not.toBe('stationary')
    expect(detector.observe(0.1, STATIONARY_DWELL_MS)).toBe('stationary')
  })

  it('restarts the dwell timer as soon as the device moves again', () => {
    const detector = createMovementDetector()

    detector.observe(0.1, 0)
    // Pulling away from a traffic light must not leave it marked stationary.
    expect(detector.observe(5, STATIONARY_DWELL_MS / 2)).toBe('moving')
    expect(detector.observe(0.1, STATIONARY_DWELL_MS)).toBe('moving')
    expect(detector.observe(0.1, STATIONARY_DWELL_MS * 2)).toBe('stationary')
  })

  it('holds its previous verdict when a fix carries no speed', () => {
    const detector = createMovementDetector()

    detector.observe(5, 0)
    expect(detector.observe(null, 1_000)).toBe('moving')
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
