import type { TravelMode } from '@/api/client'
import { getItem, setItem } from '@/native/kv-storage'

export type NotificationDetail = 'minimal' | 'detailed'

// Which location API the native service records with. 'auto' picks Google
// Play Services where it exists and the framework's own provider where it
// doesn't, so a de-Googled device works without the user knowing what any of
// this means; the explicit values are the escape hatch for devices where the
// automatic choice guesses wrong (microG reports Play Services as present but
// implements the fused API only partially).
export type LocationSource = 'auto' | 'gms' | 'platform'

// How hard the OS is asked to work for each fix. Replaces the old
// highAccuracy boolean: the precision slider needs a real power lever, and
// both location engines expose three tiers rather than two.
export type PowerLevel = 'low' | 'balanced' | 'high'

export type TrackingMode = 'smart' | 'manual'

// Positions on the precision slider, lowest power first. Stored as a number so
// the slider maps straight onto it.
export const PRECISION_LEVELS = [1, 2, 3, 4, 5] as const
export type PrecisionLevel = (typeof PRECISION_LEVELS)[number]

export type PrecisionPreset = {
  level: PrecisionLevel
  label: string
  // Interval at walking pace; smart mode shortens it as speed rises and
  // stretches it while stationary.
  baselineSeconds: number
  powerLevel: PowerLevel
}

// The same five intervals the old dropdown offered, presented as precision
// rather than as raw seconds.
export const PRECISION_PRESETS: readonly PrecisionPreset[] = [
  { baselineSeconds: 300, label: 'Max battery', level: 1, powerLevel: 'low' },
  { baselineSeconds: 120, label: 'Battery saver', level: 2, powerLevel: 'balanced' },
  { baselineSeconds: 60, label: 'Balanced', level: 3, powerLevel: 'high' },
  { baselineSeconds: 30, label: 'Precise', level: 4, powerLevel: 'high' },
  { baselineSeconds: 10, label: 'Max precision', level: 5, powerLevel: 'high' },
]

export const MANUAL_INTERVAL_OPTIONS_SECONDS = [10, 30, 60, 120, 300] as const

export type TrackingSettings = {
  mode: TrackingMode
  // Smart mode: one control, because a single power/precision axis is far
  // easier to reason about than the interval + smart toggle + battery-saver
  // trio it replaces (whose interaction nobody could explain).
  smartPrecision: PrecisionLevel
  // Manual mode: exactly what it says, honored as given.
  manualIntervalSeconds: number
  manualPowerLevel: PowerLevel
  defaultTravelMode: TravelMode
  // Advanced — applies to both modes. The accuracy cutoff is deliberately not
  // here: it is derived from the active power tier (see accuracyCutoffFor),
  // because the right value depends on what that tier can deliver rather than
  // on anything the user can sensibly judge.
  distanceFilterMeters: number
  locationSource: LocationSource
  notificationDetail: NotificationDetail
}

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
  defaultTravelMode: 'UNKNOWN',
  distanceFilterMeters: 0,
  locationSource: 'auto',
  manualIntervalSeconds: 30,
  manualPowerLevel: 'high',
  mode: 'smart',
  notificationDetail: 'detailed',
  smartPrecision: 3,
}

const STORAGE_KEY = 'openvoyage.tracking.settings'

export function precisionPreset(level: PrecisionLevel): PrecisionPreset {
  return (
    PRECISION_PRESETS.find((preset) => preset.level === level) ??
    PRECISION_PRESETS[2]
  )
}

/** The interval and power a recording starts from, before smart mode adapts. */
export function baselineFor(settings: TrackingSettings): {
  intervalSeconds: number
  powerLevel: PowerLevel
} {
  if (settings.mode === 'manual') {
    return {
      intervalSeconds: settings.manualIntervalSeconds,
      powerLevel: settings.manualPowerLevel,
    }
  }
  const preset = precisionPreset(settings.smartPrecision)
  return { intervalSeconds: preset.baselineSeconds, powerLevel: preset.powerLevel }
}

export async function readTrackingSettings(): Promise<TrackingSettings> {
  const rawValue = await getItem(STORAGE_KEY)
  if (!rawValue) {
    return DEFAULT_TRACKING_SETTINGS
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<TrackingSettings>
    // No migration from the pre-release shape on purpose: anything stored
    // without a recognisable `mode` predates this model and is replaced by
    // the current defaults rather than mapped forward.
    if (parsed.mode !== 'smart' && parsed.mode !== 'manual') {
      return DEFAULT_TRACKING_SETTINGS
    }
    return sanitize({ ...DEFAULT_TRACKING_SETTINGS, ...parsed })
  } catch {
    return DEFAULT_TRACKING_SETTINGS
  }
}

export async function writeTrackingSettings(
  settings: TrackingSettings,
): Promise<void> {
  await setItem(STORAGE_KEY, JSON.stringify(sanitize(settings)))
}

function sanitize(settings: TrackingSettings): TrackingSettings {
  const level = PRECISION_LEVELS.includes(settings.smartPrecision)
    ? settings.smartPrecision
    : DEFAULT_TRACKING_SETTINGS.smartPrecision

  return {
    ...settings,
    distanceFilterMeters: Math.max(0, settings.distanceFilterMeters),
    manualIntervalSeconds: Math.max(1, settings.manualIntervalSeconds),
    smartPrecision: level,
  }
}
