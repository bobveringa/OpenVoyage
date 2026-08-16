import { registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'

import { isNativePlatform } from '@/native/platform'
import { haversineMeters } from '@/tracking/geo'

// This plugin ships no JS proxy of its own (native-only package), so it is
// registered the same way its own docs do.
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  'BackgroundGeolocation',
)

export type PositionFix = {
  recordedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
  speedMps: number | null
  headingDegrees: number | null
  altitudeMeters: number | null
}

export type PositionSourceOptions = {
  intervalSeconds: number
  distanceFilterMeters: number
  notificationTitle: string
  notificationMessage: string
  onFix: (fix: PositionFix) => void
  onError: (error: Error) => void
}

export interface PositionSource {
  start(options: PositionSourceOptions): Promise<void>
  stop(): Promise<void>
}

// The background-geolocation plugin streams every fix it gets; it has no
// fixed-interval mode of its own. V1's "fixed, user-configurable interval"
// (§6) is implemented by gating that stream on the client side: a fix is
// forwarded to onFix once intervalSeconds have passed since the last one
// that was — time is the guaranteed cadence, so a stationary recording
// still produces a point every interval instead of going silent. Passing
// distanceFilterMeters to the *native* watcher instead (its own
// distanceFilter option) would make it a hard AND-gate at the OS level:
// no time-based fix at all until the device physically moves that far,
// which silently breaks the "every N seconds" guarantee while stationary.
// distanceFilterMeters is applied here as an *additional* trigger instead —
// denser sampling while moving fast, never a block on the time-based one.
export function createFixGate(intervalSeconds: number, distanceFilterMeters: number) {
  let last: { atMs: number; latitude: number; longitude: number } | null = null
  return (candidate: { atMs: number; latitude: number; longitude: number }): boolean => {
    if (!last) {
      last = candidate
      return true
    }

    const elapsedMs = candidate.atMs - last.atMs
    const movedEnough =
      distanceFilterMeters > 0 &&
      haversineMeters(last.latitude, last.longitude, candidate.latitude, candidate.longitude) >=
        distanceFilterMeters

    if (elapsedMs >= intervalSeconds * 1000 || movedEnough) {
      last = candidate
      return true
    }
    return false
  }
}

class NativePositionSource implements PositionSource {
  private watcherId: string | null = null

  async start(options: PositionSourceOptions): Promise<void> {
    await this.stop()
    const shouldAccept = createFixGate(options.intervalSeconds, options.distanceFilterMeters)

    this.watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: options.notificationMessage,
        backgroundTitle: options.notificationTitle,
        // 0: always deliver a raw fix when the OS has one, so the interval
        // gate above (not the OS) decides cadence — see createFixGate.
        distanceFilter: 0,
        requestPermissions: true,
        stale: false,
      },
      (position, error) => {
        if (error) {
          options.onError(error)
          return
        }
        if (!position) {
          return
        }

        const recordedAtMs = position.time ?? Date.now()
        if (
          !shouldAccept({
            atMs: recordedAtMs,
            latitude: position.latitude,
            longitude: position.longitude,
          })
        ) {
          return
        }

        options.onFix({
          accuracyMeters: position.accuracy,
          altitudeMeters: position.altitude,
          headingDegrees: position.bearing,
          latitude: position.latitude,
          longitude: position.longitude,
          recordedAt: new Date(recordedAtMs).toISOString(),
          speedMps: position.speed,
        })
      },
    )
  }

  async stop(): Promise<void> {
    if (this.watcherId) {
      await BackgroundGeolocation.removeWatcher({ id: this.watcherId })
      this.watcherId = null
    }
  }
}

class WebPositionSource implements PositionSource {
  private watchId: number | null = null

  // Foreground only: the web build has no service-worker/background
  // delivery mechanism, matching the design doc's stated web fallback.
  async start(options: PositionSourceOptions): Promise<void> {
    await this.stop()
    if (!('geolocation' in navigator)) {
      options.onError(new Error('Geolocation is not available in this browser'))
      return
    }

    const shouldAccept = createFixGate(options.intervalSeconds, options.distanceFilterMeters)

    this.watchId = navigator.geolocation.watchPosition(
      (position: GeolocationPosition) => {
        const recordedAtMs = position.timestamp
        if (
          !shouldAccept({
            atMs: recordedAtMs,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
        ) {
          return
        }

        options.onFix({
          accuracyMeters: position.coords.accuracy,
          altitudeMeters: position.coords.altitude,
          headingDegrees: position.coords.heading,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          recordedAt: new Date(recordedAtMs).toISOString(),
          speedMps: position.coords.speed,
        })
      },
      (error: GeolocationPositionError) =>
        options.onError(new Error(error.message)),
      { enableHighAccuracy: true, maximumAge: 0 },
    )
  }

  async stop(): Promise<void> {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }
  }
}

export function createPositionSource(): PositionSource {
  return isNativePlatform() ? new NativePositionSource() : new WebPositionSource()
}
