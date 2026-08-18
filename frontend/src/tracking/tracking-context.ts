import { createContext } from 'react'

import type { AdaptiveDecision } from '@/tracking/adaptive'
import type { QueueStats } from '@/tracking/sample-queue'
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
  startTracking: (input: StartTrackingInput) => Promise<void>
  stopTracking: () => Promise<void>
}

export const TrackingContext = createContext<TrackingContextValue | null>(null)
