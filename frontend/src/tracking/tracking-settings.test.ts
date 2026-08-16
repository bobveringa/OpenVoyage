import { beforeEach, describe, expect, it } from 'vitest'

import {
  BATTERY_SAVER_INTERVAL_FLOOR_SECONDS,
  DEFAULT_TRACKING_SETTINGS,
  effectiveIntervalSeconds,
  readTrackingSettings,
  writeTrackingSettings,
} from '@/tracking/tracking-settings'

beforeEach(() => {
  window.localStorage.clear()
})

describe('effectiveIntervalSeconds', () => {
  it('returns the configured interval when battery saver is off', () => {
    expect(
      effectiveIntervalSeconds({ ...DEFAULT_TRACKING_SETTINGS, batterySaver: false, intervalSeconds: 10 }),
    ).toBe(10)
  })

  it('raises the interval to the battery-saver floor when it is lower', () => {
    expect(
      effectiveIntervalSeconds({ ...DEFAULT_TRACKING_SETTINGS, batterySaver: true, intervalSeconds: 10 }),
    ).toBe(BATTERY_SAVER_INTERVAL_FLOOR_SECONDS)
  })

  it('leaves an interval already at or above the floor unchanged', () => {
    expect(
      effectiveIntervalSeconds({ ...DEFAULT_TRACKING_SETTINGS, batterySaver: true, intervalSeconds: 300 }),
    ).toBe(300)
  })
})

describe('read/writeTrackingSettings', () => {
  it('returns defaults when nothing has been saved', async () => {
    expect(await readTrackingSettings()).toEqual(DEFAULT_TRACKING_SETTINGS)
  })

  it('round-trips a saved value', async () => {
    const settings = { ...DEFAULT_TRACKING_SETTINGS, defaultTravelMode: 'BIKE' as const, intervalSeconds: 60 }
    await writeTrackingSettings(settings)
    expect(await readTrackingSettings()).toEqual(settings)
  })

  it('falls back to defaults for corrupt stored JSON', async () => {
    window.localStorage.setItem('openvoyage.tracking.settings', '{not json')
    expect(await readTrackingSettings()).toEqual(DEFAULT_TRACKING_SETTINGS)
  })

  it('clamps a negative distance filter and zero interval on save', async () => {
    await writeTrackingSettings({
      ...DEFAULT_TRACKING_SETTINGS,
      distanceFilterMeters: -5,
      intervalSeconds: 0,
    })
    const saved = await readTrackingSettings()
    expect(saved.distanceFilterMeters).toBe(0)
    expect(saved.intervalSeconds).toBe(1)
  })
})
