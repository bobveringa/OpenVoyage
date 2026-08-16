import { createContext } from 'react'

import type { QueueStats } from '@/tracking/sample-queue'
import type { UploaderSnapshot } from '@/tracking/uploader'

export type TrackingStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'

export type ActiveTrackingSession = {
  sessionId: string
  tripId: string
  startedAt: string
}

export type StartTrackingInput = {
  tripId: string
  accessToken: string
  currentUserId: string
}

export type TrackingContextValue = {
  activeSession: ActiveTrackingSession | null
  status: TrackingStatus
  error: string | null
  queueStats: QueueStats | null
  uploaderSnapshot: UploaderSnapshot | null
  startTracking: (input: StartTrackingInput) => Promise<void>
  stopTracking: () => Promise<void>
}

export const TrackingContext = createContext<TrackingContextValue | null>(null)
