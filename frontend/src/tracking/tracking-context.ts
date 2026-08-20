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
}

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
  // seconds (U1). Timestamps are corrected before upload now (C1-C4), so a
  // non-zero value here means the correction itself failed — a real
  // data-quality signal, not routine noise — and survives until it stops
  // recurring or the recording ends.
  clockSkewWarningSeconds: number | null
  // A one-time, non-blocking notice measured when the recording started:
  // the device clock looked off by roughly this many seconds at that point.
  // Purely informational — the recording is unaffected because every
  // outgoing timestamp is corrected — but a clock this far off is worth the
  // user fixing. null once nothing was measured, or once a new recording
  // starts. Distinct from clockSkewWarningSeconds, which reports correction
  // actually failing mid-recording.
  clockSkewNoticeSeconds: number | null
  // The travel mode new samples are being stamped with right now (U2) — a
  // property of this recording, not a device setting. 'UNKNOWN' whenever
  // nothing is recording or the user hasn't picked one.
  currentTravelMode: TravelMode
  startTracking: (input: StartTrackingInput) => Promise<void>
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
