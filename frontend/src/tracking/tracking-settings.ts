import type { TravelMode } from '@/api/client'
import { getItem, setItem } from '@/native/kv-storage'

export type NotificationDetail = 'minimal' | 'detailed'

export type TrackingSettings = {
  intervalSeconds: number
  // §8 Phase 3: when on, intervalSeconds is the baseline that speed and
  // battery state adapt around; when off it is honored exactly (the
  // "pin a fixed interval" toggle the phase requires).
  adaptiveTracking: boolean
  distanceFilterMeters: number
  accuracyThresholdMeters: number
  defaultTravelMode: TravelMode
  batterySaver: boolean
  notificationDetail: NotificationDetail
}

export const TRACKING_INTERVAL_OPTIONS_SECONDS = [10, 30, 60, 120, 300] as const

// batterySaver forces a floor on the interval regardless of what the user
// last picked, so a saved settings object can't silently drift out of that
// constraint (e.g. after toggling battery saver on with a 10s interval set).
export const BATTERY_SAVER_INTERVAL_FLOOR_SECONDS = 60

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = {
  accuracyThresholdMeters: 100,
  adaptiveTracking: true,
  batterySaver: false,
  defaultTravelMode: 'UNKNOWN',
  distanceFilterMeters: 10,
  intervalSeconds: 30,
  notificationDetail: 'detailed',
}

const STORAGE_KEY = 'openvoyage.tracking.settings'

export function effectiveIntervalSeconds(settings: TrackingSettings): number {
  return settings.batterySaver
    ? Math.max(settings.intervalSeconds, BATTERY_SAVER_INTERVAL_FLOOR_SECONDS)
    : settings.intervalSeconds
}

export async function readTrackingSettings(): Promise<TrackingSettings> {
  const rawValue = await getItem(STORAGE_KEY)
  if (!rawValue) {
    return DEFAULT_TRACKING_SETTINGS
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<TrackingSettings>
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
  return {
    ...settings,
    accuracyThresholdMeters: Math.max(1, settings.accuracyThresholdMeters),
    distanceFilterMeters: Math.max(0, settings.distanceFilterMeters),
    intervalSeconds: Math.max(1, settings.intervalSeconds),
  }
}
