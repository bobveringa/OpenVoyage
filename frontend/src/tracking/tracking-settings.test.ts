import { beforeEach, describe, expect, it } from 'vitest'

import {
  baselineFor,
  DEFAULT_TRACKING_SETTINGS,
  precisionPreset,
  PRECISION_PRESETS,
  readTrackingSettings,
  writeTrackingSettings,
} from '@/tracking/tracking-settings'

beforeEach(() => {
  window.localStorage.clear()
})

describe('precision presets', () => {
  it('runs from lowest power to highest precision', () => {
    const intervals = PRECISION_PRESETS.map((preset) => preset.baselineSeconds)
    const descending = [...intervals].sort((a, b) => b - a)
    expect(intervals).toEqual(descending)
  })

  it('falls back to the middle preset for an out-of-range level', () => {
    // @ts-expect-error deliberately out of range, as corrupt storage could be
    expect(precisionPreset(99).level).toBe(3)
  })
})

describe('baselineFor', () => {
  it('uses the precision preset in smart mode', () => {
    const baseline = baselineFor({ ...DEFAULT_TRACKING_SETTINGS, smartPrecision: 1 })
    expect(baseline).toEqual({ intervalSeconds: 300, powerLevel: 'low' })
  })

  it('uses the interval and power the user picked in manual mode', () => {
    const baseline = baselineFor({
      ...DEFAULT_TRACKING_SETTINGS,
      manualIntervalSeconds: 120,
      manualPowerLevel: 'balanced',
      mode: 'manual',
    })
    expect(baseline).toEqual({ intervalSeconds: 120, powerLevel: 'balanced' })
  })
})

describe('read/writeTrackingSettings', () => {
  it('returns defaults when nothing has been saved', async () => {
    expect(await readTrackingSettings()).toEqual(DEFAULT_TRACKING_SETTINGS)
  })

  it('round-trips a saved value', async () => {
    const settings = {
      ...DEFAULT_TRACKING_SETTINGS,
      smartPrecision: 5 as const,
    }
    await writeTrackingSettings(settings)
    expect(await readTrackingSettings()).toEqual(settings)
  })

  // U2: no longer a device preference — travel mode lives on the recording's
  // own state instead, so a stray write here must never survive a save.
  it('ignores a defaultTravelMode value on save, pinning it to UNKNOWN', async () => {
    await writeTrackingSettings({
      ...DEFAULT_TRACKING_SETTINGS,
      defaultTravelMode: 'BIKE',
    })
    expect((await readTrackingSettings()).defaultTravelMode).toBe('UNKNOWN')
  })

  it('falls back to defaults for corrupt stored JSON', async () => {
    window.localStorage.setItem('openvoyage.tracking.settings', '{not json')
    expect(await readTrackingSettings()).toEqual(DEFAULT_TRACKING_SETTINGS)
  })

  // Pre-release settings are replaced rather than mapped forward; nothing
  // stored before this model needs to survive onto a real device.
  it('discards settings saved in the previous shape', async () => {
    window.localStorage.setItem(
      'openvoyage.tracking.settings',
      JSON.stringify({
        adaptiveTracking: true,
        batterySaver: true,
        intervalSeconds: 10,
      }),
    )
    expect(await readTrackingSettings()).toEqual(DEFAULT_TRACKING_SETTINGS)
  })

  it('clamps a negative distance filter and zero interval on save', async () => {
    await writeTrackingSettings({
      ...DEFAULT_TRACKING_SETTINGS,
      distanceFilterMeters: -5,
      manualIntervalSeconds: 0,
    })
    const saved = await readTrackingSettings()
    expect(saved.distanceFilterMeters).toBe(0)
    expect(saved.manualIntervalSeconds).toBe(1)
  })

  it('replaces an out-of-range precision level on save', async () => {
    await writeTrackingSettings({
      ...DEFAULT_TRACKING_SETTINGS,
      // @ts-expect-error simulating a corrupt stored value
      smartPrecision: 42,
    })
    expect((await readTrackingSettings()).smartPrecision).toBe(
      DEFAULT_TRACKING_SETTINGS.smartPrecision,
    )
  })
})
