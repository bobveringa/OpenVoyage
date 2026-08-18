import { registerPlugin } from '@capacitor/core'

import { isNativePlatform } from '@/native/platform'
import { haversineMeters } from '@/tracking/geo'

export type PositionFix = {
  recordedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number
  speedMps: number | null
  headingDegrees: number | null
  altitudeMeters: number | null
}

export type PositionSourceConfig = {
  intervalSeconds: number
  distanceFilterMeters: number
  highAccuracy: boolean
}

export type PositionSourceOptions = PositionSourceConfig & {
  notificationTitle: string
  notificationMessage: string
  onFix: (fix: PositionFix) => void | Promise<void>
  onError: (error: Error) => void
  // The user tapped Stop in the ongoing notification. The session still has
  // to be closed and flushed by the same code path as an in-app Stop, so
  // this is surfaced rather than handled natively.
  onStopRequested?: () => void
}

export type PowerState = {
  batteryLevel: number | null
  charging: boolean
  powerSaveMode: boolean
}

export type NativeTrackingState = {
  tracking: boolean
  // True when the service is gone but the "should be recording" flag
  // survived — i.e. the process was killed mid-recording. Distinguishing
  // this from `tracking` is what lets a relaunch resume instead of
  // reporting the recording as finished.
  trackingIntent: boolean
  startedAtMs: number
  intervalSeconds: number
  highAccuracy: boolean
  bufferedFixes: number
  locationEnabled: boolean
  permissionGranted: boolean
}

export interface PositionSource {
  start(options: PositionSourceOptions): Promise<void>
  stop(): Promise<void>
  // Adopts a recording the native service is already running (after a
  // webview reload) instead of starting a second one. Resolves false when
  // there is nothing to adopt.
  resume(options: PositionSourceOptions): Promise<boolean>
  // Phase 3: change cadence mid-recording without restarting the service.
  configure(config: PositionSourceConfig): Promise<void>
  updateStatus(status: { title: string; text: string }): Promise<void>
  getPowerState(): Promise<PowerState>
}

type NativeFix = {
  latitude: number
  longitude: number
  accuracy: number | null
  altitude: number | null
  speed: number | null
  bearing: number | null
  time: number
  simulated: boolean
}

interface TrackingPlugin {
  getState(): Promise<NativeTrackingState>
  start(options: {
    intervalSeconds: number
    minIntervalSeconds: number
    distanceFilterMeters: number
    highAccuracy: boolean
    title: string
    text: string
  }): Promise<NativeTrackingState>
  configure(options: {
    intervalSeconds: number
    minIntervalSeconds: number
    distanceFilterMeters: number
    highAccuracy: boolean
  }): Promise<NativeTrackingState>
  updateStatus(options: { title: string; text: string }): Promise<void>
  stop(): Promise<void>
  drain(): Promise<{ fixes: NativeFix[]; droppedCount: number }>
  getPowerState(): Promise<PowerState>
  addListener(
    event: 'fixAvailable' | 'stopRequested',
    handler: () => void,
  ): Promise<{ remove: () => Promise<void> }>
}

const Tracking = registerPlugin<TrackingPlugin>('Tracking')

// Absolute floor on how often the OS may deliver, whatever the settings say.
const MIN_INTERVAL_FLOOR_SECONDS = 5

// How much denser than the nominal interval the distance filter is allowed to
// make the recording. The distance filter exists to add detail through corners
// while moving, but left uncapped it degenerates into the raw fix stream — the
// previous implementation turned a 30 s interval into a point every 2 s while
// driving, at full 1 Hz GPS power.
const MAX_DISTANCE_TRIGGER_SPEEDUP = 4

// The OS is asked for time-based delivery only; the distance filter is applied
// here instead. Handing setMinUpdateDistanceMeters to the fused provider makes
// displacement a precondition for *any* update, so a parked device would stop
// producing points entirely — and "I was parked here for three hours" is part
// of the track, not noise. Time stays the guaranteed cadence; distance only
// ever adds fixes on top of it.
function nativeCadence(config: PositionSourceConfig): {
  intervalSeconds: number
  minIntervalSeconds: number
  distanceFilterMeters: number
  highAccuracy: boolean
} {
  const speedup = config.distanceFilterMeters > 0 ? MAX_DISTANCE_TRIGGER_SPEEDUP : 1
  return {
    distanceFilterMeters: 0,
    highAccuracy: config.highAccuracy,
    intervalSeconds: config.intervalSeconds,
    minIntervalSeconds: Math.max(
      MIN_INTERVAL_FLOOR_SECONDS,
      config.intervalSeconds / speedup,
    ),
  }
}

export function createFixGate(intervalSeconds: number, distanceFilterMeters: number) {
  let last: { atMs: number; latitude: number; longitude: number } | null = null
  const minSpacingMs = (intervalSeconds * 1000) / MAX_DISTANCE_TRIGGER_SPEEDUP

  return (candidate: { atMs: number; latitude: number; longitude: number }): boolean => {
    if (!last) {
      last = candidate
      return true
    }

    const elapsedMs = candidate.atMs - last.atMs
    const movedEnough =
      distanceFilterMeters > 0 &&
      elapsedMs >= minSpacingMs &&
      haversineMeters(last.latitude, last.longitude, candidate.latitude, candidate.longitude) >=
        distanceFilterMeters

    if (elapsedMs >= intervalSeconds * 1000 || movedEnough) {
      last = candidate
      return true
    }
    return false
  }
}

function toPositionFix(fix: NativeFix): PositionFix {
  return {
    accuracyMeters: fix.accuracy ?? Number.POSITIVE_INFINITY,
    altitudeMeters: fix.altitude,
    headingDegrees: fix.bearing,
    latitude: fix.latitude,
    longitude: fix.longitude,
    recordedAt: new Date(fix.time).toISOString(),
    speedMps: fix.speed,
  }
}

class NativePositionSource implements PositionSource {
  private listeners: Array<{ remove: () => Promise<void> }> = []
  private draining = false
  private drainAgain = false
  private shouldAccept = createFixGate(30, 0)
  private options: PositionSourceOptions | null = null

  async start(options: PositionSourceOptions): Promise<void> {
    await this.detach()
    this.shouldAccept = createFixGate(options.intervalSeconds, options.distanceFilterMeters)
    await Tracking.start({
      ...nativeCadence(options),
      text: options.notificationMessage,
      title: options.notificationTitle,
    })
    await this.attach(options)
  }

  async resume(options: PositionSourceOptions): Promise<boolean> {
    const state = await Tracking.getState()
    if (!state.trackingIntent) {
      return false
    }

    if (state.tracking) {
      // Already running natively: adopt it, and only realign the cadence,
      // rather than restarting the request (which would drop the GPS fix
      // the receiver has already locked).
      await this.attach(options)
      await this.configure(options)
      await this.updateStatus({
        text: options.notificationMessage,
        title: options.notificationTitle,
      })
      return true
    }

    // The flag outlived the service, so the process was killed mid-recording
    // and the service hasn't come back. Start it again.
    await this.start(options)
    return true
  }

  private async attach(options: PositionSourceOptions): Promise<void> {
    await this.detach()
    this.options = options

    this.listeners.push(
      await Tracking.addListener('fixAvailable', () => {
        void this.drain(options)
      }),
    )
    this.listeners.push(
      await Tracking.addListener('stopRequested', () => {
        options.onStopRequested?.()
      }),
    )

    // Whatever the service buffered while no webview was listening.
    await this.drain(options)
  }

  private async detach(): Promise<void> {
    const listeners = this.listeners
    this.listeners = []
    await Promise.all(listeners.map((listener) => listener.remove()))
  }

  // Fixes are pulled, not pushed, so one drain must not overlap another —
  // otherwise the same batch could be handed to onFix twice, or a fix that
  // arrived mid-drain could sit unnoticed until the next one.
  private async drain(options: PositionSourceOptions): Promise<void> {
    if (this.draining) {
      this.drainAgain = true
      return
    }
    this.draining = true
    try {
      do {
        this.drainAgain = false
        const { fixes } = await Tracking.drain()
        for (const fix of fixes) {
          if (
            !this.shouldAccept({
              atMs: fix.time,
              latitude: fix.latitude,
              longitude: fix.longitude,
            })
          ) {
            continue
          }
          try {
            await options.onFix(toPositionFix(fix))
          } catch (error) {
            options.onError(error instanceof Error ? error : new Error(String(error)))
          }
        }
      } while (this.drainAgain)
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.draining = false
    }
  }

  async configure(config: PositionSourceConfig): Promise<void> {
    // The gate has to be rebuilt alongside the OS request, otherwise a
    // stretched interval would keep being enforced at the old, denser
    // spacing (or vice versa) until the next start.
    this.shouldAccept = createFixGate(config.intervalSeconds, config.distanceFilterMeters)
    await Tracking.configure(nativeCadence(config))
  }

  async updateStatus(status: { title: string; text: string }): Promise<void> {
    await Tracking.updateStatus(status)
  }

  async getPowerState(): Promise<PowerState> {
    return Tracking.getPowerState()
  }

  async stop(): Promise<void> {
    // Take whatever the service captured between the last fix event and this
    // call before tearing it down — those are the final seconds of the
    // recording, and the service clears its buffer on the next start.
    const options = this.options
    if (options) {
      await this.drain(options)
    }
    await this.detach()
    this.options = null
    await Tracking.stop()
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

        void options.onFix({
          accuracyMeters: position.coords.accuracy,
          altitudeMeters: position.coords.altitude,
          headingDegrees: position.coords.heading,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          recordedAt: new Date(recordedAtMs).toISOString(),
          speedMps: position.coords.speed,
        })
      },
      (error: GeolocationPositionError) => options.onError(new Error(error.message)),
      { enableHighAccuracy: true, maximumAge: 0 },
    )
  }

  // Nothing survives a page reload on web, so there is never a recording to
  // adopt.
  async resume(): Promise<boolean> {
    return false
  }

  async configure(): Promise<void> {}

  async updateStatus(): Promise<void> {}

  async getPowerState(): Promise<PowerState> {
    return { batteryLevel: null, charging: false, powerSaveMode: false }
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
