import type { PositionSourceConfig, PowerState } from '@/tracking/position-source'
import {
  baselineFor,
  type PowerLevel,
  type TrackingSettings,
} from '@/tracking/tracking-settings'

/**
 * §8 Phase 3 — smart tracking.
 *
 * Kept as a pure function of (speed, movement, power, settings) so the policy
 * can be unit-tested exhaustively; the provider only decides *when* to
 * re-evaluate it and hands the result to the native service.
 */

// Below this the device is treated as parked rather than moving slowly: GPS
// noise alone produces apparent speeds of a few tenths of a m/s while
// stationary.
export const STATIONARY_SPEED_MPS = 0.5

// How long the device has to look stationary before the interval is stretched.
// Reacting to a single slow fix would stretch the interval at every traffic
// light and then miss the pull-away.
export const STATIONARY_DWELL_MS = 90_000

// The baseline is calibrated at walking pace: whatever spacing between points
// the chosen precision gives while walking is the spacing smart mode tries to
// hold at every speed.
const REFERENCE_SPEED_MPS = 1.4

// Hard bounds, independent of the baseline. The floor keeps a fast vehicle
// from pinning the GPS at its maximum rate; the ceiling keeps a long
// stationary stretch from looking like the recording died.
const MIN_INTERVAL_SECONDS = 5
const MAX_INTERVAL_SECONDS = 300

// How far the adaptive interval may stray from the chosen baseline. The
// densification bound is deliberately tighter than the stretching one:
// recording four times more points than asked for is a battery and quota
// surprise, whereas stretching a parked stretch out costs the user nothing.
const MIN_INTERVAL_FACTOR = 1 / 4
const MAX_INTERVAL_FACTOR = 6

const LOW_BATTERY_LEVEL = 0.15
const CRITICAL_BATTERY_LEVEL = 0.05

export type MovementState = 'unknown' | 'stationary' | 'moving'

export type AdaptiveInput = {
  settings: TrackingSettings
  // Latest speed in m/s; null when the fix carried none (common indoors and
  // on the first fix after a cold start).
  speedMps: number | null
  movement: MovementState
  power: PowerState
}

export type AdaptiveReason =
  | 'fixed'
  | 'stationary'
  | 'moving'
  | 'battery-low'
  | 'battery-critical'
  | 'power-save-mode'

export type AdaptiveDecision = PositionSourceConfig & {
  reason: AdaptiveReason
}

/**
 * Tracks whether the device has been below the stationary speed threshold long
 * enough to count as parked. Separate from the decision function so the dwell
 * timer is testable without faking clocks inside the policy.
 */
export function createMovementDetector() {
  let stationarySinceMs: number | null = null
  let state: MovementState = 'unknown'

  return {
    getState: (): MovementState => state,
    // Returns the movement state after folding in this fix.
    observe: (speedMps: number | null, atMs: number): MovementState => {
      if (speedMps === null) {
        return state
      }
      if (speedMps > STATIONARY_SPEED_MPS) {
        stationarySinceMs = null
        state = 'moving'
        return state
      }
      if (stationarySinceMs === null) {
        stationarySinceMs = atMs
      }
      if (atMs - stationarySinceMs >= STATIONARY_DWELL_MS) {
        state = 'stationary'
      }
      return state
    },
  }
}

function degrade(level: PowerLevel): PowerLevel {
  return level === 'high' ? 'balanced' : 'low'
}

export function decideTracking({
  settings,
  speedMps,
  movement,
  power,
}: AdaptiveInput): AdaptiveDecision {
  const baseline = baselineFor(settings)
  const baseSeconds = baseline.intervalSeconds

  let seconds = baseSeconds
  let powerLevel = baseline.powerLevel
  let reason: AdaptiveReason = 'fixed'

  // The distance filter and a speed-derived interval solve the same problem —
  // keeping points evenly spaced along the route — so running both compounds
  // them. Smart mode owns the spacing and leaves the filter off.
  const distanceFilterMeters =
    settings.mode === 'smart' ? 0 : settings.distanceFilterMeters

  if (settings.mode === 'smart') {
    if (movement === 'stationary') {
      // Parked: a point every few minutes is enough to prove the device was
      // still there, and a lower power tier lets the receiver sleep.
      seconds = baseSeconds * MAX_INTERVAL_FACTOR
      powerLevel = degrade(powerLevel)
      reason = 'stationary'
    } else if (speedMps !== null && speedMps > STATIONARY_SPEED_MPS) {
      // Hold roughly constant spacing between points as speed rises, so a
      // road or rail track keeps its shape without oversampling a walk.
      seconds = (baseSeconds * REFERENCE_SPEED_MPS) / speedMps
      reason = 'moving'
    }

    seconds = clamp(
      seconds,
      baseSeconds * MIN_INTERVAL_FACTOR,
      baseSeconds * MAX_INTERVAL_FACTOR,
    )
  }

  // Battery-aware degradation, applied last so it can override anything the
  // movement policy asked for — including a manual interval the user pinned,
  // since running the battery flat mid-trip loses far more of the track than
  // a stretched interval does.
  if (!power.charging) {
    if (power.batteryLevel !== null && power.batteryLevel <= CRITICAL_BATTERY_LEVEL) {
      seconds *= 4
      powerLevel = 'low'
      reason = 'battery-critical'
    } else if (power.batteryLevel !== null && power.batteryLevel <= LOW_BATTERY_LEVEL) {
      seconds *= 2
      powerLevel = degrade(powerLevel)
      reason = 'battery-low'
    } else if (power.powerSaveMode) {
      seconds *= 2
      powerLevel = degrade(powerLevel)
      reason = 'power-save-mode'
    }
  }

  return {
    distanceFilterMeters,
    intervalSeconds: Math.round(
      clamp(seconds, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS),
    ),
    locationSource: settings.locationSource,
    powerLevel,
    reason,
  }
}

export function describeAdaptiveReason(decision: AdaptiveDecision): string {
  switch (decision.reason) {
    case 'stationary':
      return `stationary — every ${decision.intervalSeconds}s`
    case 'moving':
      return `moving — every ${decision.intervalSeconds}s`
    case 'battery-low':
      return `battery low — every ${decision.intervalSeconds}s`
    case 'battery-critical':
      return `battery critical — every ${decision.intervalSeconds}s`
    case 'power-save-mode':
      return `power saving — every ${decision.intervalSeconds}s`
    case 'fixed':
      return `every ${decision.intervalSeconds}s`
  }
}

/**
 * Re-configuring the native request costs a GPS re-acquisition, so it is only
 * worth doing when the cadence genuinely changed rather than drifting by a
 * second.
 */
export function isMeaningfulChange(
  current: PositionSourceConfig,
  next: PositionSourceConfig,
): boolean {
  if (current.powerLevel !== next.powerLevel) {
    return true
  }
  if (current.distanceFilterMeters !== next.distanceFilterMeters) {
    return true
  }
  const ratio = next.intervalSeconds / current.intervalSeconds
  return ratio <= 0.75 || ratio >= 1.33
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
