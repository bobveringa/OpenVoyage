import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/network', () => ({
  Network: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    getStatus: vi.fn().mockResolvedValue({ connected: true, connectionType: 'wifi' }),
  },
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    createTrackingSession: vi.fn(),
    endTrackingSession: vi.fn(),
    listTrackingSessionsWithServerDate: vi.fn(),
    uploadTrackSamples: vi.fn(),
  }
})

vi.mock('@/tracking/sample-queue', () => ({
  deletePendingSession: vi.fn().mockResolvedValue(undefined),
  deleteUploadedSamples: vi.fn().mockResolvedValue(undefined),
  getPendingSession: vi.fn(),
  getQueueStats: vi.fn().mockResolvedValue({
    droppedLocallyCount: 0,
    oldestSampleAt: null,
    sampleCount: 0,
    simulatedRejectedCount: 0,
  }),
  listSamplesForUpload: vi.fn().mockResolvedValue([]),
  markSessionCreateAcked: vi.fn().mockResolvedValue(undefined),
  markSessionEndAcked: vi.fn().mockResolvedValue(undefined),
  purgeSession: vi.fn().mockResolvedValue(undefined),
  setSessionClockOffset: vi.fn().mockResolvedValue(undefined),
}))

import { Network } from '@capacitor/network'

import {
  ApiError,
  createTrackingSession,
  endTrackingSession,
  listTrackingSessionsWithServerDate,
  uploadTrackSamples,
} from '@/api/client'
import {
  deletePendingSession,
  deleteUploadedSamples,
  getPendingSession,
  listSamplesForUpload,
  markSessionCreateAcked,
  markSessionEndAcked,
  purgeSession,
  setSessionClockOffset,
  type PendingSession,
  type QueuedSample,
} from '@/tracking/sample-queue'
import { SessionUploader, type UploaderDeps, type UploaderSnapshot } from '@/tracking/uploader'

const mockCreateTrackingSession = vi.mocked(createTrackingSession)
const mockEndTrackingSession = vi.mocked(endTrackingSession)
const mockUploadTrackSamples = vi.mocked(uploadTrackSamples)
const mockListTrackingSessionsWithServerDate = vi.mocked(listTrackingSessionsWithServerDate)
const mockGetPendingSession = vi.mocked(getPendingSession)
const mockListSamplesForUpload = vi.mocked(listSamplesForUpload)
const mockMarkSessionCreateAcked = vi.mocked(markSessionCreateAcked)
const mockPurgeSession = vi.mocked(purgeSession)
const mockDeleteUploadedSamples = vi.mocked(deleteUploadedSamples)

function session(overrides: Partial<PendingSession> = {}): PendingSession {
  return {
    clockOffsetMs: 0,
    createAcked: true,
    endAcked: false,
    endedAt: null,
    recordedByUserId: 'user-1',
    sessionId: 'session-1',
    startedAt: '2026-08-16T09:00:00.000Z',
    tripId: 'trip-1',
    ...overrides,
  }
}

function sampleBatch(count: number): QueuedSample[] {
  return Array.from({ length: count }, (_, index) => ({
    accuracyMeters: 8,
    altitudeMeters: null,
    enqueuedAt: '2026-08-16T09:00:00.000Z',
    headingDegrees: null,
    id: `sample-${index}`,
    latitude: 51.5,
    longitude: 5.5,
    recordedAt: '2026-08-16T09:00:00.000Z',
    sessionId: 'session-1',
    speedMps: null,
    travelMode: 'UNKNOWN' as const,
  }))
}

function makeUploader(overrides: Partial<UploaderDeps> = {}) {
  const snapshots: UploaderSnapshot[] = []
  const terminations: string[] = []
  const uploader = new SessionUploader({
    getAccessToken: () => 'token',
    getCurrentUserId: () => 'user-1',
    getWifiOnlyUpload: () => false,
    onSnapshotChange: (snapshot) => snapshots.push(snapshot),
    onTerminated: (message) => terminations.push(message),
    sessionId: 'session-1',
    tripId: 'trip-1',
    ...overrides,
  })
  return { snapshots, terminations, uploader }
}

beforeEach(() => {
  vi.useFakeTimers()
  mockGetPendingSession.mockReset().mockResolvedValue(session())
  mockListSamplesForUpload.mockReset().mockResolvedValue([])
  mockCreateTrackingSession.mockReset()
  mockEndTrackingSession.mockReset()
  mockUploadTrackSamples.mockReset()
  mockListTrackingSessionsWithServerDate.mockReset()
  mockMarkSessionCreateAcked.mockReset().mockResolvedValue(undefined)
  mockPurgeSession.mockReset().mockResolvedValue(undefined)
  mockDeleteUploadedSamples.mockReset().mockResolvedValue(undefined)
  vi.mocked(deletePendingSession).mockReset().mockResolvedValue(undefined)
  vi.mocked(markSessionEndAcked).mockReset().mockResolvedValue(undefined)
  vi.mocked(setSessionClockOffset).mockReset().mockResolvedValue(undefined)
  vi.mocked(Network.getStatus)
    .mockReset()
    .mockResolvedValue({ connected: true, connectionType: 'wifi' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionUploader batching', () => {
  it('drains a queue larger than 1000 samples in successive capped batches', async () => {
    mockListSamplesForUpload
      .mockResolvedValueOnce(sampleBatch(1000))
      .mockResolvedValueOnce(sampleBatch(500))
      .mockResolvedValueOnce([])
    mockUploadTrackSamples.mockResolvedValue({
      result: {
        accepted_samples: 1000,
        discarded_samples: 0,
        duplicate_samples: 0,
        filtered_samples: 0,
      },
      serverDate: null,
    })

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockUploadTrackSamples).toHaveBeenCalledTimes(2)
    expect(mockUploadTrackSamples.mock.calls[0][0].samples).toHaveLength(1000)
    expect(mockUploadTrackSamples.mock.calls[1][0].samples).toHaveLength(500)
  })

  it('deletes the whole uploaded slice on 2xx regardless of the bucket breakdown', async () => {
    const batch = sampleBatch(3)
    mockListSamplesForUpload.mockResolvedValueOnce(batch).mockResolvedValueOnce([])
    mockUploadTrackSamples.mockResolvedValue({
      result: {
        accepted_samples: 1,
        discarded_samples: 1,
        duplicate_samples: 1,
        filtered_samples: 0,
      },
      serverDate: null,
    })

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockDeleteUploadedSamples).toHaveBeenCalledWith(
      batch.map((item) => item.id),
    )
  })

  // B5: the four-bucket response used to be discarded entirely. discarded and
  // filtered are user-visible (clock skew / privacy zone respectively) and
  // must accumulate across every batch and cycle of the session, not just
  // reflect the last response.
  it('accumulates discarded and filtered counts from the server response across cycles', async () => {
    mockListSamplesForUpload
      .mockResolvedValueOnce(sampleBatch(2))
      .mockResolvedValueOnce(sampleBatch(2))
    mockUploadTrackSamples
      .mockResolvedValueOnce({
        result: {
          accepted_samples: 1,
          discarded_samples: 1,
          duplicate_samples: 0,
          filtered_samples: 0,
        },
        serverDate: null,
      })
      .mockResolvedValueOnce({
        result: {
          accepted_samples: 1,
          discarded_samples: 0,
          duplicate_samples: 0,
          filtered_samples: 1,
        },
        serverDate: null,
      })

    const { snapshots, uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    uploader.requestSync()
    await vi.advanceTimersByTimeAsync(0)

    const last = snapshots[snapshots.length - 1]
    expect(last?.discardedCount).toBe(1)
    expect(last?.filteredCount).toBe(1)
  })
})

// C1-C4: outgoing timestamps are corrected by the session's pinned clock
// offset; the local queue itself (mocked here via sample-queue) always keeps
// raw device time.
describe('SessionUploader clock offset correction (C4)', () => {
  it('applies the pinned offset to started_at, recorded_at and ended_at on the wire', async () => {
    mockGetPendingSession.mockResolvedValue(
      session({
        clockOffsetMs: 5_000,
        createAcked: false,
        endAcked: false,
        endedAt: '2026-08-16T10:00:00.000Z',
      }),
    )
    mockCreateTrackingSession.mockResolvedValue({
      ended_at: null,
      id: 'session-1',
      recorded_by_user_id: 'user-1',
      sample_count: 0,
      started_at: '2026-08-16T09:00:00.000Z',
    })
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(1)).mockResolvedValueOnce([])
    mockUploadTrackSamples.mockResolvedValue({
      result: {
        accepted_samples: 1,
        discarded_samples: 0,
        duplicate_samples: 0,
        filtered_samples: 0,
      },
      serverDate: null,
    })
    mockEndTrackingSession.mockResolvedValue({
      ended_at: '2026-08-16T10:00:05.000Z',
      id: 'session-1',
      recorded_by_user_id: 'user-1',
      sample_count: 1,
      started_at: '2026-08-16T09:00:00.000Z',
    })

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    // The raw session's startedAt is 09:00:00.000Z; +5s offset on the wire.
    expect(mockCreateTrackingSession).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: '2026-08-16T09:00:05.000Z' }),
    )
    // The raw sample's recordedAt (from sampleBatch) is 09:00:00.000Z.
    expect(mockUploadTrackSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        samples: [expect.objectContaining({ recorded_at: '2026-08-16T09:00:05.000Z' })],
      }),
    )
    expect(mockEndTrackingSession).toHaveBeenCalledWith(
      expect.objectContaining({ endedAt: '2026-08-16T10:00:05.000Z' }),
    )
    // The local record stays raw device time — never the corrected value.
    expect(markSessionEndAcked).toHaveBeenCalledWith(
      'session-1',
      '2026-08-16T10:00:00.000Z',
    )
  })

  it('sends the raw timestamp unchanged when the offset is 0', async () => {
    mockGetPendingSession.mockResolvedValue(session({ createAcked: false }))
    mockCreateTrackingSession.mockResolvedValue({
      ended_at: null,
      id: 'session-1',
      recorded_by_user_id: 'user-1',
      sample_count: 0,
      started_at: '2026-08-16T09:00:00.000Z',
    })

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockCreateTrackingSession).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: '2026-08-16T09:00:00.000Z' }),
    )
  })

  it('treats a null/unknown offset the same as 0 once measurement fails', async () => {
    mockGetPendingSession.mockResolvedValue(
      session({ clockOffsetMs: null, createAcked: false }),
    )
    mockListTrackingSessionsWithServerDate.mockRejectedValue(new TypeError('offline'))
    mockCreateTrackingSession.mockResolvedValue({
      ended_at: null,
      id: 'session-1',
      recorded_by_user_id: 'user-1',
      sample_count: 0,
      started_at: '2026-08-16T09:00:00.000Z',
    })

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockCreateTrackingSession).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: '2026-08-16T09:00:00.000Z' }),
    )
    // Measurement failed, so nothing is pinned — left to retry next cycle.
    expect(setSessionClockOffset).not.toHaveBeenCalled()
  })

  it('measures and pins the offset on first network contact for a session started offline, before the create is sent', async () => {
    mockGetPendingSession.mockResolvedValue(
      session({ clockOffsetMs: null, createAcked: false }),
    )
    mockListTrackingSessionsWithServerDate.mockResolvedValue({
      serverDate: new Date('2026-08-16T09:00:10.000Z'),
      sessions: [],
    })
    mockCreateTrackingSession.mockResolvedValue({
      ended_at: null,
      id: 'session-1',
      recorded_by_user_id: 'user-1',
      sample_count: 0,
      started_at: '2026-08-16T09:00:00.000Z',
    })

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockListTrackingSessionsWithServerDate).toHaveBeenCalledTimes(1)
    expect(setSessionClockOffset).toHaveBeenCalledWith('session-1', expect.any(Number))
    // The offset measured from the preflight is what corrects the create's
    // own payload — the whole point of measuring before it is transmitted.
    const [, pinnedOffsetMs] = vi.mocked(setSessionClockOffset).mock.calls[0] ?? []
    expect(mockCreateTrackingSession).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: new Date(
          Date.parse('2026-08-16T09:00:00.000Z') + (pinnedOffsetMs as number),
        ).toISOString(),
      }),
    )
  })

  it('does not re-measure once an offset is already pinned', async () => {
    mockGetPendingSession.mockResolvedValue(session({ clockOffsetMs: -2_000 }))

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mockListTrackingSessionsWithServerDate).not.toHaveBeenCalled()
  })
})

describe('SessionUploader Wi-Fi-only uploads (U3)', () => {
  it('pauses without attempting the batch request when off Wi-Fi', async () => {
    vi.mocked(Network.getStatus).mockResolvedValue({
      connected: true,
      connectionType: 'cellular',
    })
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(2))

    const { snapshots, uploader } = makeUploader({ getWifiOnlyUpload: () => true })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockUploadTrackSamples).not.toHaveBeenCalled()
    expect(snapshots[snapshots.length - 1]?.status).toBe('paused-wifi-required')
  })

  it('proceeds normally once on Wi-Fi', async () => {
    vi.mocked(Network.getStatus).mockResolvedValue({
      connected: true,
      connectionType: 'wifi',
    })
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(2)).mockResolvedValueOnce([])
    mockUploadTrackSamples.mockResolvedValue({
      result: {
        accepted_samples: 2,
        discarded_samples: 0,
        duplicate_samples: 0,
        filtered_samples: 0,
      },
      serverDate: null,
    })

    const { snapshots, uploader } = makeUploader({ getWifiOnlyUpload: () => true })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockUploadTrackSamples).toHaveBeenCalledTimes(1)
    expect(snapshots.some((snapshot) => snapshot.status === 'paused-wifi-required')).toBe(
      false,
    )
  })

  it('uploads on any connection when the setting is off (default)', async () => {
    vi.mocked(Network.getStatus).mockResolvedValue({
      connected: true,
      connectionType: 'cellular',
    })
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(2)).mockResolvedValueOnce([])
    mockUploadTrackSamples.mockResolvedValue({
      result: {
        accepted_samples: 2,
        discarded_samples: 0,
        duplicate_samples: 0,
        filtered_samples: 0,
      },
      serverDate: null,
    })

    const { uploader } = makeUploader({ getWifiOnlyUpload: () => false })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockUploadTrackSamples).toHaveBeenCalledTimes(1)
  })
})

describe('SessionUploader clock skew re-check (U1)', () => {
  it('reports skew when a batch reports non-zero discarded and the response date disagrees', async () => {
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(2)).mockResolvedValueOnce([])
    mockUploadTrackSamples.mockResolvedValue({
      result: {
        accepted_samples: 1,
        discarded_samples: 1,
        duplicate_samples: 0,
        filtered_samples: 0,
      },
      serverDate: new Date('2020-01-01T00:00:00.000Z'),
    })

    let reportedSkewSeconds: number | null = null
    const { uploader } = makeUploader({
      onClockSkewChecked: (skewSeconds) => (reportedSkewSeconds = skewSeconds),
    })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(reportedSkewSeconds).not.toBeNull()
  })

  it('clears a prior skew warning once a batch reports no discards', async () => {
    mockListSamplesForUpload
      .mockResolvedValueOnce(sampleBatch(2))
      .mockResolvedValueOnce(sampleBatch(2))
    mockUploadTrackSamples
      .mockResolvedValueOnce({
        result: {
          accepted_samples: 1,
          discarded_samples: 1,
          duplicate_samples: 0,
          filtered_samples: 0,
        },
        serverDate: new Date('2020-01-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        result: {
          accepted_samples: 2,
          discarded_samples: 0,
          duplicate_samples: 0,
          filtered_samples: 0,
        },
        serverDate: null,
      })

    const reported: Array<number | null> = []
    const { uploader } = makeUploader({
      onClockSkewChecked: (skewSeconds) => reported.push(skewSeconds),
    })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    uploader.requestSync()
    await vi.advanceTimersByTimeAsync(0)

    expect(reported[0]).not.toBeNull()
    expect(reported[reported.length - 1]).toBeNull()
  })

  it('reports null (not a warning) when nothing was ever discarded', async () => {
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(2)).mockResolvedValueOnce([])
    mockUploadTrackSamples.mockResolvedValue({
      result: {
        accepted_samples: 2,
        discarded_samples: 0,
        duplicate_samples: 0,
        filtered_samples: 0,
      },
      serverDate: new Date('2020-01-01T00:00:00.000Z'),
    })

    let called = false
    const { uploader } = makeUploader({ onClockSkewChecked: () => (called = true) })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    // Still called (with null) — a batch with zero discards is itself
    // evidence the clock is fine, which is what lets a prior warning clear.
    expect(called).toBe(true)
  })
})

describe('SessionUploader lastSyncAt semantics', () => {
  // Regression test: lastSyncAt is used by listeners (e.g. the trip GPS
  // panel) to know when to refetch. It must only change when something
  // material actually happened — an idle heartbeat bumping it caused a
  // visible refresh every 30s for the whole time a recording was active.
  it('does not bump lastSyncAt on idle heartbeat cycles with nothing to sync', async () => {
    const { snapshots, uploader } = makeUploader()
    uploader.start()

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(snapshots.length).toBeGreaterThan(1)
    expect(snapshots.every((snapshot) => snapshot.lastSyncAt === null)).toBe(true)
  })

  it('bumps lastSyncAt once when the session is newly created, then holds steady', async () => {
    mockGetPendingSession.mockResolvedValue(session({ createAcked: false }))
    mockCreateTrackingSession.mockResolvedValue({
      ended_at: null,
      id: 'session-1',
      recorded_by_user_id: 'user-1',
      sample_count: 0,
      started_at: '2026-08-16T09:00:00.000Z',
    })

    const { snapshots, uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    // lastSyncAt persists forward through later snapshot merges, so count
    // distinct values assigned rather than how many entries are non-null.
    const distinctValues = new Set(
      snapshots.map((snapshot) => snapshot.lastSyncAt).filter((value) => value !== null),
    )
    expect(distinctValues.size).toBe(1)
    const syncedAt = snapshots[snapshots.length - 1]?.lastSyncAt
    expect(syncedAt).not.toBeNull()

    // Once createAcked is true, later heartbeat cycles are idle and must
    // not bump it again.
    mockGetPendingSession.mockResolvedValue(session({ createAcked: true }))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(snapshots[snapshots.length - 1]?.lastSyncAt).toBe(syncedAt)
  })
})

describe('SessionUploader session create', () => {
  it('treats a 409 on an unacked create as idempotent convergence, not terminal', async () => {
    mockGetPendingSession.mockResolvedValue(session({ createAcked: false }))
    mockCreateTrackingSession.mockRejectedValue(
      new ApiError(409, 'Session already exists', null),
    )

    const { terminations, uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockMarkSessionCreateAcked).toHaveBeenCalledWith('session-1')
    expect(mockPurgeSession).not.toHaveBeenCalled()
    expect(terminations).toHaveLength(0)
  })
})

describe('SessionUploader terminal handling', () => {
  it('purges the queue and notifies the caller on a batch-upload 409', async () => {
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(2))
    mockUploadTrackSamples.mockRejectedValue(new ApiError(409, 'Conflict', null))

    const { snapshots, terminations, uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockPurgeSession).toHaveBeenCalledWith('session-1')
    expect(terminations).toEqual([
      'This recording was deleted or conflicted on the server.',
    ])
    expect(snapshots[snapshots.length - 1]?.status).toBe('terminated')
  })

  it('purges the queue and stops retrying on a batch-upload 404 (trip deleted)', async () => {
    mockListSamplesForUpload.mockResolvedValueOnce(sampleBatch(2))
    mockUploadTrackSamples.mockRejectedValue(new ApiError(404, 'Not Found', null))

    const { snapshots, terminations, uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockPurgeSession).toHaveBeenCalledWith('session-1')
    expect(terminations).toEqual([
      'This recording was deleted or conflicted on the server.',
    ])
    expect(snapshots[snapshots.length - 1]?.status).toBe('terminated')
    // Confirms this doesn't fall into the generic retry/backoff path, which
    // would keep hitting the same 404 forever since the trip is gone.
    expect(mockUploadTrackSamples).toHaveBeenCalledTimes(1)
  })

  it('purges the queue on a session-end 409', async () => {
    mockGetPendingSession.mockResolvedValue(
      session({ endAcked: false, endedAt: '2026-08-16T10:00:00.000Z' }),
    )
    mockEndTrackingSession.mockRejectedValue(new ApiError(409, 'Conflict', null))

    const { terminations, uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockPurgeSession).toHaveBeenCalledWith('session-1')
    expect(terminations).toHaveLength(1)
  })
})

describe('SessionUploader completion signal', () => {
  it('fires onFullySynced once the end PATCH is ACKed and the local record is purged', async () => {
    mockGetPendingSession.mockResolvedValue(
      session({ endAcked: false, endedAt: '2026-08-16T10:00:00.000Z' }),
    )
    mockEndTrackingSession.mockResolvedValue({
      ended_at: '2026-08-16T10:00:00.000Z',
      id: 'session-1',
      recorded_by_user_id: 'user-1',
      sample_count: 0,
      started_at: '2026-08-16T09:00:00.000Z',
    })

    let fullySyncedCount = 0
    const { uploader } = makeUploader({ onFullySynced: () => (fullySyncedCount += 1) })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(deletePendingSession).toHaveBeenCalledWith('session-1')
    expect(fullySyncedCount).toBe(1)
  })

  it('does not fire onFullySynced while the session is still open (no endedAt)', async () => {
    let fullySyncedCount = 0
    const { uploader } = makeUploader({ onFullySynced: () => (fullySyncedCount += 1) })
    uploader.start()

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fullySyncedCount).toBe(0)
  })
})

describe('SessionUploader auth handling', () => {
  it('pauses for sign-in on a 401 without purging the queue', async () => {
    mockGetPendingSession.mockResolvedValue(session({ createAcked: false }))
    mockCreateTrackingSession.mockRejectedValue(new ApiError(401, 'Unauthorized', null))

    const { snapshots, terminations, uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockPurgeSession).not.toHaveBeenCalled()
    expect(terminations).toHaveLength(0)
    expect(snapshots[snapshots.length - 1]?.status).toBe('paused-sign-in-required')
  })

  it('pauses when a different account is signed in than the recorder', async () => {
    mockGetPendingSession.mockResolvedValue(session({ recordedByUserId: 'other-user' }))

    const { snapshots, uploader } = makeUploader({ getCurrentUserId: () => 'user-1' })
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(mockCreateTrackingSession).not.toHaveBeenCalled()
    expect(snapshots[snapshots.length - 1]?.status).toBe('paused-account-mismatch')
  })
})

describe('SessionUploader retry backoff', () => {
  it('retries a network failure on the 5s -> 10s -> 30s schedule', async () => {
    mockGetPendingSession.mockResolvedValue(session({ createAcked: false }))
    mockCreateTrackingSession.mockRejectedValue(new TypeError('Network request failed'))

    const { uploader } = makeUploader()
    uploader.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(9_999)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(3)
  })

  it('resets the backoff schedule when requestSync is called', async () => {
    mockGetPendingSession.mockResolvedValue(session({ createAcked: false }))
    mockCreateTrackingSession.mockRejectedValue(new TypeError('Network request failed'))

    const { uploader } = makeUploader()
    uploader.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(2)

    // A connectivity-restored style trigger should retry immediately and
    // restart the backoff schedule from 5s again.
    uploader.requestSync()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(mockCreateTrackingSession).toHaveBeenCalledTimes(4)
  })
})
