import { createContext } from 'react'

import type { TravelMode } from '@/api/client'
import type { AdaptiveDecision } from '@/tracking/adaptive'
import type { QueueStats } from '@/tracking/sample-queue'
import type { TrackingSettings } from '@/tracking/tracking-settings'
import type { UploaderSnapshot } from '@/tracking/uploader'

export type TrackingStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  // Recording has ended locally but the local queue hasn't been confirmed
  // fully synced yet (offline, or the upload just hasn't caught up). The
  // session stays visible in this state rather than disappearing the
  // instant Stop is tapped, so "stopped while offline" doesn't read as
  // "the recording was lost".
  | 'syncing'

export type ActiveTrackingSession = {
  sessionId: string
  tripId: string
  tripTitle: string | null
  startedAt: string
  // Set once Stop has been tapped; null while still actively recording.
  endedAt: string | null
}

export type StartTrackingInput = {
  tripId: string
  tripTitle: string
  accessToken: string
  currentUserId: string
  // Set on the re-entrant call after the user has confirmed they want to
  // proceed despite a detected clock skew (U1).
  acknowledgeClockSkew?: boolean
}

export type StartTrackingOutcome =
  | { kind: 'ok' }
  // The device clock disagrees with the server by more than the tolerance.
  // startTracking does *not* show its own confirmation UI (it can't render
  // anything) — the caller shows one and re-calls with
  // acknowledgeClockSkew: true if the user wants to proceed anyway (U1).
  | { kind: 'clock-skew-confirmation-required'; skewSeconds: number }

export type TrackingContextValue = {
  activeSession: ActiveTrackingSession | null
  status: TrackingStatus
  error: string | null
  queueStats: QueueStats | null
  uploaderSnapshot: UploaderSnapshot | null
  // The cadence the Phase 3 policy currently has the OS running at, or null
  // when nothing is recording.
  adaptiveDecision: AdaptiveDecision | null
  // The engine has gone quiet (cold fix, tunnel, basement). Advisory: the
  // recording is still running. Hard failures land in `error` instead.
  locationWarning: string | null
  // A live re-check (triggered whenever an upload batch reports a non-zero
  // discarded count) still finds the device clock off by roughly this many
  // seconds (U1). Distinct from locationWarning: this is a data-quality
  // problem, not an engine problem, and survives until the clock is fixed or
  // the recording ends.
  clockSkewWarningSeconds: number | null
  // The travel mode new samples are being stamped with right now (U2) — a
  // property of this recording, not a device setting. 'UNKNOWN' whenever
  // nothing is recording or the user hasn't picked one.
  currentTravelMode: TravelMode
  startTracking: (input: StartTrackingInput) => Promise<StartTrackingOutcome>
  stopTracking: () => Promise<void>
  // Settings just saved from the settings page (B8). Applies immediately to
  // a live recording — re-evaluates the adaptive policy and, if the cadence
  // genuinely changed, pushes it to the native service — rather than only
  // taking effect on the next recording.
  notifySettingsChanged: (settings: TrackingSettings) => void
  // U2: changes the travel mode for samples enqueued from this point on in
  // the active recording. Never rewrites samples already queued — use the
  // trip's bulk sample-mode editor for corrections. A no-op when nothing is
  // recording.
  setTravelMode: (mode: TravelMode) => Promise<void>
}

export const TrackingContext = createContext<TrackingContextValue | null>(null)
