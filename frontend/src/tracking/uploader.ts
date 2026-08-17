import { Network } from '@capacitor/network'

import {
  ApiError,
  createTrackingSession,
  endTrackingSession,
  uploadTrackSamples,
  type TrackSampleInput,
} from '@/api/client'
import {
  deletePendingSession,
  deleteUploadedSamples,
  getPendingSession,
  getQueueStats,
  listSamplesForUpload,
  markSessionCreateAcked,
  markSessionEndAcked,
  purgeSession,
  type PendingSession,
} from '@/tracking/sample-queue'

const BATCH_SIZE = 1000
// §5.3: 5s -> 10s -> 30s -> 60s -> 5min cap.
const BACKOFF_SCHEDULE_MS = [5_000, 10_000, 30_000, 60_000, 300_000]
// Steady-state poll once a session is fully drained, in case a fix was
// enqueued without a requestSync() call reaching us (belt and suspenders —
// tracking-provider also calls requestSync() after every enqueue).
const HEARTBEAT_MS = 30_000

export type UploaderStatus =
  | 'idle'
  | 'syncing'
  | 'waiting-retry'
  | 'paused-sign-in-required'
  | 'paused-account-mismatch'
  | 'terminated'

export type UploaderSnapshot = {
  status: UploaderStatus
  queueDepth: number
  lastSyncAt: string | null
  lastErrorMessage: string | null
}

export type UploaderDeps = {
  tripId: string
  sessionId: string
  getAccessToken: () => string | null
  getCurrentUserId: () => string | null
  // 409 anywhere is terminal (§5.3): the caller is responsible for stopping
  // the position watcher and surfacing `message` to the user.
  onTerminated: (message: string) => void
  onSnapshotChange: (snapshot: UploaderSnapshot) => void
  // Fires exactly once, only for a session that had been ended (has
  // endedAt set): every sample uploaded, the end PATCH ACKed, and the local
  // record purged. Lets the caller distinguish "stopped, still syncing"
  // from "fully done" instead of treating Stop itself as completion.
  onFullySynced?: () => void
}

type RequestOutcome<T, Converge extends boolean> =
  | { kind: 'ok'; value: T }
  | (Converge extends true ? { kind: 'converged' } : never)
  | { kind: 'terminal' }
  | { kind: 'unauthorized' }
  | { kind: 'retry'; message: string }

export class SessionUploader {
  private readonly deps: UploaderDeps
  private backoffIndex = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private cycleInFlight = false
  private networkListenerHandle: { remove: () => void } | null = null
  private snapshot: UploaderSnapshot = {
    lastErrorMessage: null,
    lastSyncAt: null,
    queueDepth: 0,
    status: 'idle',
  }

  constructor(deps: UploaderDeps) {
    this.deps = deps
  }

  getSnapshot(): UploaderSnapshot {
    return this.snapshot
  }

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    void Network.addListener('networkStatusChange', (status) => {
      if (status.connected) {
        this.requestSync()
      }
    }).then((handle) => {
      this.networkListenerHandle = handle
    })
    this.scheduleNow()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.networkListenerHandle?.remove()
    this.networkListenerHandle = null
  }

  // Connectivity restored, a fix was just enqueued, or the caller wants an
  // immediate flush attempt (e.g. before sending a session-end PATCH).
  requestSync(): void {
    if (!this.running) {
      return
    }
    this.backoffIndex = 0
    this.scheduleNow()
  }

  private scheduleNow(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => void this.runCycle(), 0)
  }

  private scheduleRetry(): void {
    if (!this.running) {
      return
    }
    const delay =
      BACKOFF_SCHEDULE_MS[Math.min(this.backoffIndex, BACKOFF_SCHEDULE_MS.length - 1)]
    this.backoffIndex += 1
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => void this.runCycle(), delay)
  }

  private scheduleHeartbeat(): void {
    if (!this.running) {
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => void this.runCycle(), HEARTBEAT_MS)
  }

  private updateSnapshot(patch: Partial<UploaderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.deps.onSnapshotChange(this.snapshot)
  }

  private async runCycle(): Promise<void> {
    if (this.cycleInFlight) {
      return
    }
    this.cycleInFlight = true
    try {
      await this.attemptSync()
    } finally {
      this.cycleInFlight = false
    }
  }

  private async attemptSync(): Promise<void> {
    const session = await getPendingSession(this.deps.sessionId)
    if (!session) {
      this.updateSnapshot({ queueDepth: 0, status: 'idle' })
      return
    }

    const currentUserId = this.deps.getCurrentUserId()
    if (currentUserId !== session.recordedByUserId) {
      // §5.4: a different account is signed in. The queue is retained, not
      // flushed, until the recording user signs back in.
      this.updateSnapshot({ status: 'paused-account-mismatch' })
      this.scheduleHeartbeat()
      return
    }

    const accessToken = this.deps.getAccessToken()
    if (!accessToken) {
      this.updateSnapshot({ status: 'paused-sign-in-required' })
      this.scheduleHeartbeat()
      return
    }

    this.updateSnapshot({ status: 'syncing' })

    if (!session.createAcked) {
      const outcome = await this.ensureCreateAcked(session, accessToken)
      if (outcome === 'terminated') {
        return
      }
      if (outcome === 'retry') {
        this.updateSnapshot({ status: 'waiting-retry' })
        this.scheduleRetry()
        return
      }
      if (outcome === 'paused') {
        this.scheduleHeartbeat()
        return
      }
      // A session lifecycle change (as opposed to a routine heartbeat with
      // nothing to do) is the only thing that should prompt listeners to
      // refetch — otherwise an idle 30s heartbeat causes a visible refresh
      // of anything watching lastSyncAt.
      this.updateSnapshot({ lastSyncAt: new Date().toISOString() })
    }

    const drainOutcome = await this.drainSamples(accessToken)
    if (drainOutcome === 'terminated') {
      return
    }
    if (drainOutcome === 'retry') {
      this.updateSnapshot({ status: 'waiting-retry' })
      this.scheduleRetry()
      return
    }
    if (drainOutcome === 'paused') {
      this.scheduleHeartbeat()
      return
    }

    const latestSession = await getPendingSession(this.deps.sessionId)
    if (latestSession?.endedAt && !latestSession.endAcked) {
      const outcome = await this.ensureEndAcked(latestSession, accessToken)
      if (outcome === 'terminated') {
        return
      }
      if (outcome === 'retry') {
        this.updateSnapshot({ status: 'waiting-retry' })
        this.scheduleRetry()
        return
      }
      if (outcome === 'paused') {
        this.scheduleHeartbeat()
        return
      }
      // Fully synced: nothing left to retry for a closed session.
      await deletePendingSession(this.deps.sessionId)
      this.updateSnapshot({
        lastErrorMessage: null,
        lastSyncAt: new Date().toISOString(),
        queueDepth: 0,
        status: 'idle',
      })
      this.deps.onFullySynced?.()
      return
    }

    // Steady state: nothing pending this cycle. Deliberately leaves
    // lastSyncAt untouched — bumping it here would fire on every idle
    // heartbeat (every HEARTBEAT_MS while recording) for listeners that use
    // it to know when to refetch, causing a visible periodic refresh for no
    // reason.
    this.backoffIndex = 0
    this.updateSnapshot({
      lastErrorMessage: null,
      queueDepth: 0,
      status: 'idle',
    })
    this.scheduleHeartbeat()
  }

  private async ensureCreateAcked(
    session: PendingSession,
    accessToken: string,
  ): Promise<'ok' | 'retry' | 'terminated' | 'paused'> {
    const result = await classify(
      () =>
        createTrackingSession({
          accessToken,
          endedAt: session.endedAt,
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          tripId: session.tripId,
        }),
      // §3.3: replaying our own create is idempotent convergence, not a
      // real conflict, as long as we hadn't already recorded it as acked.
      { convergeOn409: true },
    )

    if (result.kind === 'ok' || result.kind === 'converged') {
      await markSessionCreateAcked(session.sessionId)
      return 'ok'
    }
    if (result.kind === 'terminal') {
      await this.terminate('This recording was deleted or conflicted on the server.')
      return 'terminated'
    }
    if (result.kind === 'unauthorized') {
      this.updateSnapshot({ status: 'paused-sign-in-required' })
      return 'paused'
    }
    this.updateSnapshot({ lastErrorMessage: result.message })
    return 'retry'
  }

  private async drainSamples(
    accessToken: string,
  ): Promise<'ok' | 'retry' | 'terminated' | 'paused'> {
    for (;;) {
      const batch = await listSamplesForUpload(this.deps.sessionId, BATCH_SIZE)
      if (batch.length === 0) {
        return 'ok'
      }

      const payload: TrackSampleInput[] = batch.map((sample) => ({
        accuracy_meters: sample.accuracyMeters,
        altitude_meters: sample.altitudeMeters,
        heading_degrees: sample.headingDegrees,
        id: sample.id,
        latitude: sample.latitude,
        longitude: sample.longitude,
        recorded_at: sample.recordedAt,
        speed_mps: sample.speedMps,
        travel_mode: sample.travelMode,
      }))

      const result = await classify(
        () =>
          uploadTrackSamples({
            accessToken,
            samples: payload,
            sessionId: this.deps.sessionId,
            tripId: this.deps.tripId,
          }),
        { convergeOn409: false },
      )

      if (result.kind === 'ok') {
        // The four buckets sum to the request length regardless of outcome
        // per sample, so the whole slice is retired unconditionally.
        await deleteUploadedSamples(batch.map((sample) => sample.id))
        const stats = await getQueueStats(this.deps.sessionId)
        this.updateSnapshot({ queueDepth: stats.sampleCount })
        if (batch.length < BATCH_SIZE) {
          return 'ok'
        }
        continue
      }
      if (result.kind === 'terminal') {
        await this.terminate('This recording was deleted or conflicted on the server.')
        return 'terminated'
      }
      if (result.kind === 'unauthorized') {
        this.updateSnapshot({ status: 'paused-sign-in-required' })
        return 'paused'
      }
      this.updateSnapshot({ lastErrorMessage: result.message })
      return 'retry'
    }
  }

  private async ensureEndAcked(
    session: PendingSession,
    accessToken: string,
  ): Promise<'ok' | 'retry' | 'terminated' | 'paused'> {
    if (!session.endedAt) {
      return 'ok'
    }

    const result = await classify(
      () =>
        endTrackingSession({
          accessToken,
          endedAt: session.endedAt as string,
          sessionId: session.sessionId,
          tripId: session.tripId,
        }),
      { convergeOn409: false },
    )

    if (result.kind === 'ok') {
      await markSessionEndAcked(session.sessionId, session.endedAt)
      return 'ok'
    }
    if (result.kind === 'terminal') {
      await this.terminate('This recording was deleted or conflicted on the server.')
      return 'terminated'
    }
    if (result.kind === 'unauthorized') {
      this.updateSnapshot({ status: 'paused-sign-in-required' })
      return 'paused'
    }
    this.updateSnapshot({ lastErrorMessage: result.message })
    return 'retry'
  }

  private async terminate(message: string): Promise<void> {
    await purgeSession(this.deps.sessionId)
    this.stop()
    this.updateSnapshot({
      lastErrorMessage: message,
      queueDepth: 0,
      status: 'terminated',
    })
    this.deps.onTerminated(message)
  }
}

async function classify<T, Converge extends boolean>(
  fn: () => Promise<T>,
  options: { convergeOn409: Converge },
): Promise<RequestOutcome<T, Converge>> {
  try {
    const value = await fn()
    return { kind: 'ok', value }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return { kind: 'unauthorized' }
      }
      // A 404 means the trip or session no longer exists (e.g. the trip was
      // deleted) — there's nothing to converge on and no legitimate retry
      // path, unlike 409. Recreating the session would defeat the point of
      // it having been removed, so this is terminal just like 409.
      if (error.status === 404) {
        return { kind: 'terminal' }
      }
      if (error.status === 409) {
        return (
          options.convergeOn409 ? { kind: 'converged' } : { kind: 'terminal' }
        ) as RequestOutcome<T, Converge>
      }
      return { kind: 'retry', message: error.message }
    }
    return {
      kind: 'retry',
      message: error instanceof Error ? error.message : 'Network request failed',
    }
  }
}
