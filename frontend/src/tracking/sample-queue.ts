import type { TravelMode } from '@/api/client'
import { isNativePlatform } from '@/native/platform'
import { haversineMeters } from '@/tracking/geo'
import { IndexedDbQueueBackend } from '@/tracking/queue/indexeddb-backend'
import { SqliteQueueBackend } from '@/tracking/queue/sqlite-backend'
import type {
  PendingSession,
  QueueBackend,
  QueuedSample,
  QueueStats,
} from '@/tracking/queue/types'

export type { PendingSession, QueuedSample, QueueStats } from '@/tracking/queue/types'

export const QUEUE_CAPACITY_SAMPLES = 10_000
export const QUEUE_MAX_AGE_DAYS = 7
const QUEUE_MAX_AGE_MS = QUEUE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

// GPS jump guard (§5.2): a fix implying a faster-than-this speed from the
// previous queued fix is almost certainly bad data, not a fast traveler.
const MAX_IMPLIED_SPEED_MPS = 350

let backend: QueueBackend | null = null
let initPromise: Promise<QueueBackend> | null = null

function createBackend(): QueueBackend {
  return isNativePlatform() ? new SqliteQueueBackend() : new IndexedDbQueueBackend()
}

async function getBackend(): Promise<QueueBackend> {
  if (backend) {
    return backend
  }
  if (!initPromise) {
    const instance = createBackend()
    initPromise = instance.init().then(() => {
      backend = instance
      return instance
    })
  }
  return initPromise
}

export type SanityFilterCandidate = {
  recordedAt: string
  latitude: number
  longitude: number
  accuracyMeters: number | null
  simulated: boolean
}

export type SanityFilterResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'accuracy'
        | 'coordinates'
        | 'out-of-order'
        | 'gps-jump'
        | 'before-session'
        | 'simulated'
    }

// §5.2: reject a fix before it ever reaches the queue.
// Only the fields the jump/ordering guards actually read, so the caller can
// pass an in-memory record of the last accepted fix rather than a row that may
// already have been uploaded and deleted.
export type SanityFilterPrevious = {
  recordedAt: string
  latitude: number
  longitude: number
}

export function checkSanityFilter(
  candidate: SanityFilterCandidate,
  previous: SanityFilterPrevious | null,
  accuracyThresholdMeters: number,
  sessionStartedAt?: string,
): SanityFilterResult {
  // The fused provider's first callback often carries a fix it had already
  // cached, timestamped before the recording began. The server discards
  // anything outside [started_at, now) without saying which sample it was,
  // so catching it here saves a pointless upload and keeps the discard
  // counter meaningful.
  if (
    sessionStartedAt !== undefined &&
    Date.parse(candidate.recordedAt) < Date.parse(sessionStartedAt)
  ) {
    return { ok: false, reason: 'before-session' }
  }

  // A mock-location fix is wrong, not merely imprecise — the same category as
  // impossible coordinates or a GPS jump. It must never reach the queue
  // indistinguishably from a real fix, and must never be rescued by
  // shouldRescueRejectedFix (B3).
  if (candidate.simulated) {
    return { ok: false, reason: 'simulated' }
  }

  // Accuracy unknown (null) is deliberately accepted rather than rejected:
  // the cutoff exists to judge a number, and there is nothing here for it to
  // judge (B6).
  if (
    candidate.accuracyMeters !== null &&
    candidate.accuracyMeters > accuracyThresholdMeters
  ) {
    return { ok: false, reason: 'accuracy' }
  }

  if (
    candidate.latitude < -90 ||
    candidate.latitude > 90 ||
    candidate.longitude < -180 ||
    candidate.longitude > 180 ||
    (candidate.latitude === 0 && candidate.longitude === 0)
  ) {
    return { ok: false, reason: 'coordinates' }
  }

  if (!previous) {
    return { ok: true }
  }

  const previousMs = Date.parse(previous.recordedAt)
  const candidateMs = Date.parse(candidate.recordedAt)
  if (candidateMs < previousMs) {
    return { ok: false, reason: 'out-of-order' }
  }

  const elapsedSeconds = (candidateMs - previousMs) / 1000
  if (elapsedSeconds > 0) {
    const distanceMeters = haversineMeters(
      previous.latitude,
      previous.longitude,
      candidate.latitude,
      candidate.longitude,
    )
    const impliedSpeedMps = distanceMeters / elapsedSeconds
    if (impliedSpeedMps > MAX_IMPLIED_SPEED_MPS) {
      return { ok: false, reason: 'gps-jump' }
    }
  }

  return { ok: true }
}

export async function putPendingSession(session: PendingSession): Promise<void> {
  const store = await getBackend()
  await store.putPendingSession(session)
}

export async function getPendingSession(
  sessionId: string,
): Promise<PendingSession | null> {
  const store = await getBackend()
  return store.getPendingSession(sessionId)
}

export async function listPendingSessions(): Promise<PendingSession[]> {
  const store = await getBackend()
  return store.listPendingSessions()
}

export async function markSessionCreateAcked(sessionId: string): Promise<void> {
  const store = await getBackend()
  await store.markSessionCreateAcked(sessionId)
}

export async function markSessionEndAcked(
  sessionId: string,
  endedAt: string,
): Promise<void> {
  const store = await getBackend()
  await store.markSessionEndAcked(sessionId, endedAt)
}

export async function deletePendingSession(sessionId: string): Promise<void> {
  const store = await getBackend()
  await store.deletePendingSession(sessionId)
}

// U2: changes the travel mode for samples enqueued *from now on* — never
// rewrites samples already in the queue. putPendingSession is an upsert of
// the whole row, so this reads the current row and writes it back with only
// that field changed, rather than needing a dedicated column update.
export async function setSessionTravelMode(
  sessionId: string,
  travelMode: TravelMode,
): Promise<void> {
  const store = await getBackend()
  const session = await store.getPendingSession(sessionId)
  if (!session) {
    return
  }
  await store.putPendingSession({ ...session, currentTravelMode: travelMode })
}

export async function getLastQueuedSample(
  sessionId: string,
): Promise<QueuedSample | null> {
  const store = await getBackend()
  return store.getLastSample(sessionId)
}

// Writes the fix to durable storage, then applies the capacity/age eviction
// policy. A fix is written before any upload attempt (§5.1's durability
// rule), so eviction only ever discards a fix that already made it in.
export async function enqueueSample(
  sample: QueuedSample,
): Promise<{ evictedCount: number }> {
  const store = await getBackend()
  await store.enqueueSample(sample)
  const evictedCount = await store.evictOverflow({
    capacitySamples: QUEUE_CAPACITY_SAMPLES,
    maxAgeMs: QUEUE_MAX_AGE_MS,
    now: new Date().toISOString(),
  })
  if (evictedCount > 0) {
    await store.addDroppedLocallyCount(evictedCount)
  }
  return { evictedCount }
}

export async function listSamplesForUpload(
  sessionId: string,
  limit: number,
): Promise<QueuedSample[]> {
  const store = await getBackend()
  return store.listSamplesForUpload(sessionId, limit)
}

export async function deleteUploadedSamples(
  ids: readonly string[],
): Promise<void> {
  const store = await getBackend()
  await store.deleteSamples(ids)
}

// 409-terminal handling (§5.3): drop everything local for a session the
// server has tombstoned or conflicted.
export async function purgeSession(sessionId: string): Promise<void> {
  const store = await getBackend()
  await store.deleteSamplesForSession(sessionId)
  await store.deletePendingSession(sessionId)
}

// The counter is a property of the queue, not of a session, so it has to be
// cleared explicitly when a new recording starts. Left running it reported
// evictions from days-old recordings as if the current one were overflowing.
// Run once at launch: clears samples left behind by a fix that landed just
// after its session was purged. They are unuploadable and invisible, and only
// ever grow.
export async function sweepOrphanedSamples(): Promise<number> {
  const store = await getBackend()
  return store.deleteOrphanedSamples()
}

export async function resetDroppedLocallyCount(): Promise<void> {
  const store = await getBackend()
  await store.resetDroppedLocallyCount()
}

// Exported separately from enqueueSample's own internal overflow accounting
// (B4): the native fix buffer can drop fixes for the same "ran out of local
// storage" reason, and needs to add to the same counter from the drain path.
export async function addDroppedLocallyCount(count: number): Promise<void> {
  if (count <= 0) {
    return
  }
  const store = await getBackend()
  await store.addDroppedLocallyCount(count)
}

export async function addSimulatedRejectedCount(count: number): Promise<void> {
  if (count <= 0) {
    return
  }
  const store = await getBackend()
  await store.addSimulatedRejectedCount(count)
}

export async function resetSimulatedRejectedCount(): Promise<void> {
  const store = await getBackend()
  await store.resetSimulatedRejectedCount()
}

// Across every session (U3) — used to warn when the offline queue is
// nearing capacity while paused for Wi-Fi-only uploads, unlike QueueStats
// above which is scoped to a single session.
export async function getTotalQueuedSampleCount(): Promise<number> {
  const store = await getBackend()
  return store.countAllSamples()
}

export async function getQueueStats(sessionId: string): Promise<QueueStats> {
  const store = await getBackend()
  const [sampleCount, oldestSampleAt, droppedLocallyCount, simulatedRejectedCount] =
    await Promise.all([
      store.countSamplesForSession(sessionId),
      store.oldestSampleTimestamp(sessionId),
      store.getDroppedLocallyCount(),
      store.getSimulatedRejectedCount(),
    ])
  return { droppedLocallyCount, oldestSampleAt, sampleCount, simulatedRejectedCount }
}
