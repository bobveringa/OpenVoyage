import type { TravelMode } from '@/api/client'

export type QueuedSample = {
  id: string
  sessionId: string
  recordedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number | null
  travelMode: TravelMode
  speedMps: number | null
  headingDegrees: number | null
  altitudeMeters: number | null
  enqueuedAt: string
}

export type PendingSession = {
  sessionId: string
  tripId: string
  // Optional: lets a resumed/offline session show a human-readable name
  // (trips list badge, global tracking indicator) without a network fetch.
  // Absent for sessions written before this field existed.
  tripTitle?: string | null
  recordedByUserId: string
  startedAt: string
  endedAt: string | null
  createAcked: boolean
  endAcked: boolean
  // U2: the travel mode for samples enqueued *from now on* in this
  // recording — a property of this leg of the trip, not a device setting.
  // null until the user picks one; enqueueSample treats null as 'UNKNOWN'.
  // Absent for sessions written before this field existed, same as
  // tripTitle above.
  currentTravelMode?: TravelMode | null
  // Device→server clock offset in ms, measured once near session start and
  // applied to every timestamp on the way out (see clock-offset.ts). null
  // when not yet measured (e.g. the session was started fully offline) —
  // SessionUploader measures and pins it at the moment of first network
  // contact instead. Pinned for the rest of the session once set; never
  // re-measured. Absent for sessions written before this field existed,
  // same as tripTitle/currentTravelMode above.
  clockOffsetMs?: number | null
}

export type QueueStats = {
  sampleCount: number
  oldestSampleAt: string | null
  droppedLocallyCount: number
  // Fixes rejected by the sanity filter because they came from a mock
  // location provider (B3) — tracked separately from droppedLocallyCount so
  // the two very different causes ("ran out of local storage" vs. "a
  // mock-location app is enabled") get distinct, actionable messages.
  simulatedRejectedCount: number
}

// A durable local FIFO for one device's in-flight tracking session(s).
// Implemented by a SQLite backend on native and an IndexedDB backend on web
// (see sample-queue.ts for the platform switch).
export interface QueueBackend {
  init(): Promise<void>

  putPendingSession(session: PendingSession): Promise<void>
  getPendingSession(sessionId: string): Promise<PendingSession | null>
  listPendingSessions(): Promise<PendingSession[]>
  markSessionCreateAcked(sessionId: string): Promise<void>
  markSessionEndAcked(sessionId: string, endedAt: string): Promise<void>
  deletePendingSession(sessionId: string): Promise<void>

  enqueueSample(sample: QueuedSample): Promise<void>
  getLastSample(sessionId: string): Promise<QueuedSample | null>
  listSamplesForUpload(sessionId: string, limit: number): Promise<QueuedSample[]>
  deleteSamples(ids: readonly string[]): Promise<void>
  deleteSamplesForSession(sessionId: string): Promise<void>
  countSamplesForSession(sessionId: string): Promise<number>
  // Across every session, not just the active one — used to warn when the
  // offline queue is nearing capacity while paused for Wi-Fi-only uploads
  // (U3), which is the one eviction cause that is the user's own setting's
  // fault.
  countAllSamples(): Promise<number>
  oldestSampleTimestamp(sessionId: string): Promise<string | null>

  // Overflow eviction (§5.1): drop the oldest rows across every session once
  // the queue exceeds capacity or a row exceeds the max age. Returns how many
  // rows were dropped so the caller can grow the persisted "dropped" counter.
  evictOverflow(options: {
    capacitySamples: number
    maxAgeMs: number
    now: string
  }): Promise<number>

  // Samples whose session no longer exists. They can never be uploaded (the
  // uploader works per session) and nothing else removes them, so without a
  // sweep they accumulate forever against the capacity cap. Created by a fix
  // landing just after its session was purged on full sync.
  deleteOrphanedSamples(): Promise<number>

  getDroppedLocallyCount(): Promise<number>
  addDroppedLocallyCount(delta: number): Promise<void>
  resetDroppedLocallyCount(): Promise<void>

  getSimulatedRejectedCount(): Promise<number>
  addSimulatedRejectedCount(delta: number): Promise<void>
  resetSimulatedRejectedCount(): Promise<void>
}
