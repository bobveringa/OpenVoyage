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

function decide(overrides: Partial<AdaptiveInput> = {}) {
  return decideTracking({
    movement: 'moving',
    power: HEALTHY_POWER,
    settings: { ...DEFAULT_TRACKING_SETTINGS },
    speedMps: null,
    ...overrides,
  })
}

describe('decideTracking', () => {
  it('honors the configured interval exactly when adaptive tracking is off', () => {
    const decision = decide({
      settings: {
        ...DEFAULT_TRACKING_SETTINGS,
        adaptiveTracking: false,
        intervalSeconds: 120,
      },
      speedMps: 25,
    })

    expect(decision.intervalSeconds).toBe(120)
    expect(decision.reason).toBe('fixed')
  })

  it('stretches the interval and drops to balanced power while stationary', () => {
    const decision = decide({ movement: 'stationary', speedMps: 0.1 })

    expect(decision.intervalSeconds).toBeGreaterThan(
      DEFAULT_TRACKING_SETTINGS.intervalSeconds,
    )
    expect(decision.highAccuracy).toBe(false)
    expect(decision.reason).toBe('stationary')
  })

  it('samples more densely as speed rises, so a road keeps its shape', () => {
    const settings = { ...DEFAULT_TRACKING_SETTINGS, intervalSeconds: 60 }
    const walking = decide({ settings, speedMps: 1.4 })
    const brisk = decide({ settings, speedMps: 3 })
    const cycling = decide({ settings, speedMps: 6 })
    const driving = decide({ settings, speedMps: 25 })

    // The configured interval is calibrated at walking pace.
    expect(walking.intervalSeconds).toBe(60)
    expect(brisk.intervalSeconds).toBeLessThan(walking.intervalSeconds)
    expect(cycling.intervalSeconds).toBeLessThan(brisk.intervalSeconds)
    // Past roughly four times walking pace the densification cap takes over,
    // so a car and a train sample at the same maximum rate rather than
    // scaling without limit.
    expect(driving.intervalSeconds).toBe(cycling.intervalSeconds)
    expect(driving.intervalSeconds).toBe(15)
  })

  it('never samples faster than the absolute floor, however fast the device moves', () => {
    // A passenger jet: the spacing model alone would ask for sub-second fixes.
    const decision = decide({ speedMps: 250 })
    expect(decision.intervalSeconds).toBeGreaterThanOrEqual(5)
  })

  it('caps densification at four times the configured interval', () => {
    const decision = decide({
      settings: { ...DEFAULT_TRACKING_SETTINGS, intervalSeconds: 120 },
      speedMps: 250,
    })
    expect(decision.intervalSeconds).toBe(30)
  })

  // The distance filter and the speed-derived interval both exist to keep
  // points evenly spaced; running both at once multiplies them together.
  it('disables the distance filter while adaptive mode owns the spacing', () => {
    const settings = { ...DEFAULT_TRACKING_SETTINGS, distanceFilterMeters: 10 }

    expect(decide({ settings, speedMps: 10 }).distanceFilterMeters).toBe(0)
    expect(
      decide({ settings: { ...settings, adaptiveTracking: false } }).distanceFilterMeters,
    ).toBe(10)
  })

  it('never stretches past five minutes, however long the device sits still', () => {
    const decision = decide({
      movement: 'stationary',
      settings: { ...DEFAULT_TRACKING_SETTINGS, intervalSeconds: 300 },
      speedMps: 0,
    })
    expect(decision.intervalSeconds).toBeLessThanOrEqual(300)
  })

  it('degrades on low battery even when the user pinned a fixed interval', () => {
    const pinned = { ...DEFAULT_TRACKING_SETTINGS, adaptiveTracking: false }
    const healthy = decide({ settings: pinned })
    const low = decide({
      power: { ...HEALTHY_POWER, batteryLevel: 0.1 },
      settings: pinned,
    })

    expect(low.intervalSeconds).toBe(healthy.intervalSeconds * 2)
    expect(low.highAccuracy).toBe(false)
    expect(low.reason).toBe('battery-low')
  })

  it('degrades harder when the battery is critical', () => {
    const decision = decide({ power: { ...HEALTHY_POWER, batteryLevel: 0.03 } })
    expect(decision.reason).toBe('battery-critical')
    expect(decision.intervalSeconds).toBeGreaterThan(
      decide({ power: { ...HEALTHY_POWER, batteryLevel: 0.1 } }).intervalSeconds,
    )
  })

  it('does not degrade while charging, however low the battery reads', () => {
    const decision = decide({
      power: { batteryLevel: 0.02, charging: true, powerSaveMode: true },
    })
    expect(decision.reason).not.toBe('battery-critical')
    expect(decision.highAccuracy).toBe(true)
  })

  it('respects system power-save mode', () => {
    const decision = decide({ power: { ...HEALTHY_POWER, powerSaveMode: true } })
    expect(decision.reason).toBe('power-save-mode')
    expect(decision.highAccuracy).toBe(false)
  })

  // Which engine records is a user choice; the cadence policy has no
  // business overriding it, so it must survive every branch untouched.
  it('carries the location source through unchanged', () => {
    for (const source of ['auto', 'gms', 'platform'] as const) {
      const settings = { ...DEFAULT_TRACKING_SETTINGS, locationSource: source }
      expect(decide({ settings, speedMps: 20 }).locationSource).toBe(source)
      expect(decide({ movement: 'stationary', settings }).locationSource).toBe(source)
      expect(
        decide({ power: { ...HEALTHY_POWER, batteryLevel: 0.02 }, settings }).locationSource,
      ).toBe(source)
    }
  })

  it('keeps the battery-saver floor as the adaptive baseline', () => {
    const decision = decide({
      settings: {
        ...DEFAULT_TRACKING_SETTINGS,
        batterySaver: true,
        intervalSeconds: 10,
      },
      speedMps: 1.4,
    })
    expect(decision.intervalSeconds).toBeGreaterThanOrEqual(60)
    expect(decision.highAccuracy).toBe(false)
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
    highAccuracy: true,
    intervalSeconds: 30,
    locationSource: 'auto' as const,
  }

  it('ignores drift too small to be worth a GPS re-acquisition', () => {
    expect(isMeaningfulChange(base, { ...base, intervalSeconds: 32 })).toBe(false)
  })

  it('reports a real cadence change', () => {
    expect(isMeaningfulChange(base, { ...base, intervalSeconds: 10 })).toBe(true)
    expect(isMeaningfulChange(base, { ...base, intervalSeconds: 120 })).toBe(true)
  })

  it('reports an accuracy-priority change even at the same interval', () => {
    expect(isMeaningfulChange(base, { ...base, highAccuracy: false })).toBe(true)
  })
})
