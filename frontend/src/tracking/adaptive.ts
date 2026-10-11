import { haversineMeters } from '@/tracking/geo'
import type { PositionSourceConfig, PowerState } from '@/tracking/position-source'
import {
  baselineFor,
  type PowerLevel,
  type TrackingSettings,
} from '@/tracking/tracking-settings'

/** Browser fallback policy. Android implements the sparse profiles natively. */

// A fix's own speed field is Doppler-derived and unreliable at rest: a real
// trace showed a parked phone reporting 0.57-0.88 m/s while its coordinates
// moved 10 m in two minutes (0.08 m/s actual). Anything at or below this is
// treated as "the speed field is telling me nothing".
export const CLEARLY_MOVING_MPS = 2.0

// Displacement that counts as having  moved, before accuracy is taken into
// account. A fix pair can disagree by a few metres while perfectly still.
export const MIN_MOVEMENT_METERS = 25

// A ±100 m fix can appear to jump 100 m without the device moving at all, so
// the movement threshold has to scale with how good the fixes are.
const ACCURACY_MOVEMENT_FACTOR = 1.5

// How long the device has to look stationary before the interval is stretched.
// Reacting to a single slow fix would stretch the interval at every traffic
// light and then miss the pull-away.
export const STATIONARY_DWELL_MS = 90_000

/**
 * How inaccurate a fix may be before it is discarded, per power tier.
 *
 * This used to be a single user-facing number defaulting to 100 m, which was
 * wrong in both directions. A `low` tier request is answered by network
 * location, which is coarse by construction — a 100 m cutoff silently rejects
 * essentially everything it produces, so the recording looks like it simply
 * stopped. Conversely 100 m is loose for a high-accuracy GNSS fix. Tying the
 * cutoff to what the current tier can actually deliver removes the setting and
 * makes it correct at both ends.
 */
const ACCURACY_CUTOFF_METERS: Record<PowerLevel, number> = {
  balanced: 300,
  high: 100,
  low: 1000,
}

export function accuracyCutoffFor(powerLevel: PowerLevel): number {
  return ACCURACY_CUTOFF_METERS[powerLevel]
}

// How long the cutoff may reject everything before it is overridden.
const ACCURACY_OVERRIDE_AFTER_INTERVALS = 3

/**
 * Whether a fix rejected by the sanity filter should be recorded anyway.
 *
 * Only accuracy misses are ever rescued, and only once nothing has been
 * recorded for several intervals. A real trace lost a 17-minute, 16 km stretch
 * of driving because every fix in it sat above the cutoff and was dropped in
 * silence; a ±300 m point would have preserved the shape of that journey. The
 * filter is meant to thin noise, not to delete the route.
 */
export function shouldRescueRejectedFix(options: {
  reason: string
  msSinceAccepted: number
  intervalSeconds: number
}): boolean {
  if (options.reason !== 'accuracy') {
    // A fix from before the session, at impossible coordinates, out of order
    // or implying 350 m/s is wrong rather than merely imprecise. Recording it
    // would corrupt the track, not complete it.
    return false
  }
  return (
    options.msSinceAccepted >
    options.intervalSeconds * 1000 * ACCURACY_OVERRIDE_AFTER_INTERVALS
  )
}

export type MovementState = 'unknown' | 'stationary' | 'moving'

export type AdaptiveInput = {
  settings: TrackingSettings
  // Effective speed in m/s — displacement between the last two fixes over the
  // time between them, from the movement detector. Deliberately *not* the
  // fix's own speed field, which is Doppler noise at rest. Null until two
  // fixes have been seen.
  speedMps: number | null
  movement: MovementState
  power: PowerState
  // Whether dropping the power tier can still produce fixes on this device
  // (B7): true for the fused engine, or for the platform engine when a
  // network location provider exists. False (the safe default when unknown)
  // means the battery branch may still stretch the interval but must not
  // touch the tier — see the stationary branch's comment for why a tier drop
  // that yields no fixes is a trap, not a saving.
  coarseLocationAvailable: boolean
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

export type MovementSample = {
  latitude: number
  longitude: number
  accuracyMeters: number | null
  speedMps: number | null
  atMs: number
}

/**
 * Decides whether the device is parked, using **where it is** rather than what
 * the fix claims its speed is.
 *
 * The previous version keyed off the speed field alone and got both directions
 * wrong in the field. A stationary phone reporting no speed never advanced out
 * of `unknown`, so a six-minute stop sampled at the full baseline rate instead
 * of the stretched one; and when the same phone did report speed, Doppler noise
 * of 0.5-0.9 m/s kept it just above the old threshold, so the *moving* formula
 * stretched the interval in proportion to nonsense. Displacement between fixes
 * answers "did we move" directly, and is bounded by accuracy rather than by
 * receiver noise.
 */
export function createMovementDetector() {
  // The position movement is measured against. It deliberately survives across
  // stationary fixes so slow drift is compared to where we started, not to the
  // previous fix.
  let anchor: MovementSample | null = null
  let previous: MovementSample | null = null
  let stationarySinceMs: number | null = null
  let state: MovementState = 'unknown'
  let effectiveSpeedMps: number | null = null

  function movementThreshold(a: MovementSample, b: MovementSample): number {
    const worstAccuracy = Math.max(a.accuracyMeters ?? 0, b.accuracyMeters ?? 0)
    return Math.max(MIN_MOVEMENT_METERS, worstAccuracy * ACCURACY_MOVEMENT_FACTOR)
  }

  return {
    getState: (): MovementState => state,
    /**
     * Speed derived from how far the device actually travelled between the last
     * two fixes, which is what the cadence formula should use. Null until there
     * are two fixes to compare.
     */
    getSpeedMps: (): number | null => effectiveSpeedMps,
    // Returns the movement state after folding in this fix.
    observe: (sample: MovementSample): MovementState => {
      if (previous) {
        const elapsedSeconds = (sample.atMs - previous.atMs) / 1000
        if (elapsedSeconds > 0) {
          effectiveSpeedMps =
            haversineMeters(
              previous.latitude,
              previous.longitude,
              sample.latitude,
              sample.longitude,
            ) / elapsedSeconds
        }
      }
      previous = sample

      if (!anchor) {
        anchor = sample
        stationarySinceMs = sample.atMs
        return state
      }

      const displacement = haversineMeters(
        anchor.latitude,
        anchor.longitude,
        sample.latitude,
        sample.longitude,
      )
      // The speed field is only trusted well clear of its noise floor, where it
      // buys responsiveness: pulling away from a stop is caught on the first
      // fix rather than after enough distance has accumulated.
      const clearlyMoving =
        sample.speedMps !== null && sample.speedMps > CLEARLY_MOVING_MPS

      if (clearlyMoving || displacement > movementThreshold(anchor, sample)) {
        anchor = sample
        stationarySinceMs = null
        state = 'moving'
        return state
      }

      if (stationarySinceMs === null) {
        stationarySinceMs = sample.atMs
      }
      if (sample.atMs - stationarySinceMs >= STATIONARY_DWELL_MS) {
        state = 'stationary'
      }
      return state
    },
  }
}

export function decideTracking({
  settings,
}: AdaptiveInput): AdaptiveDecision {
  const baseline = baselineFor(settings)
  return {
    distanceFilterMeters: settings.mode === 'smart' ? 0 : settings.distanceFilterMeters,
    intervalSeconds: baseline.intervalSeconds,
    locationSource: settings.locationSource,
    powerLevel: baseline.powerLevel,
    reason: 'fixed',
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
