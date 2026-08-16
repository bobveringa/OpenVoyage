import { beforeEach, describe, expect, it } from 'vitest'

import { IndexedDbQueueBackend } from '@/tracking/queue/indexeddb-backend'
import type { QueuedSample } from '@/tracking/queue/types'

function sample(id: string, overrides: Partial<QueuedSample> = {}): QueuedSample {
  return {
    accuracyMeters: 8,
    altitudeMeters: null,
    enqueuedAt: '2026-08-16T09:00:00.000Z',
    headingDegrees: null,
    id,
    latitude: 51.5,
    longitude: 5.5,
    recordedAt: '2026-08-16T09:00:00.000Z',
    sessionId: 'session-1',
    speedMps: null,
    travelMode: 'UNKNOWN',
    ...overrides,
  }
}

// The backend always opens the same fixed database name/version, so each
// test clears every store first to avoid leaking rows from the previous
// test. A second connection at the same version can clear alongside an
// already-open one without triggering a blocking version-change.
async function clearDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.open('openvoyage-tracking', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of ['pending_sessions', 'pending_samples', 'meta']) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(
            name,
            name === 'pending_sessions'
              ? { keyPath: 'sessionId' }
              : name === 'pending_samples'
                ? { keyPath: 'id' }
                : { keyPath: 'key' },
          )
          if (name === 'pending_samples') {
            store.createIndex('sessionId', 'sessionId', { unique: false })
            store.createIndex('recordedAt', 'recordedAt', { unique: false })
          }
        }
      }
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(
        ['pending_sessions', 'pending_samples', 'meta'],
        'readwrite',
      )
      tx.objectStore('pending_sessions').clear()
      tx.objectStore('pending_samples').clear()
      tx.objectStore('meta').clear()
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

async function freshBackend(): Promise<IndexedDbQueueBackend> {
  await clearDatabase()
  const backend = new IndexedDbQueueBackend()
  await backend.init()
  return backend
}

describe('IndexedDbQueueBackend samples', () => {
  let backend: IndexedDbQueueBackend

  beforeEach(async () => {
    backend = await freshBackend()
  })

  it('lists samples for upload in recorded_at order', async () => {
    await backend.enqueueSample(sample('c', { recordedAt: '2026-08-16T09:00:02.000Z' }))
    await backend.enqueueSample(sample('a', { recordedAt: '2026-08-16T09:00:00.000Z' }))
    await backend.enqueueSample(sample('b', { recordedAt: '2026-08-16T09:00:01.000Z' }))

    const batch = await backend.listSamplesForUpload('session-1', 10)
    expect(batch.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('caps a batch at the requested limit', async () => {
    for (let index = 0; index < 5; index += 1) {
      await backend.enqueueSample(
        sample(`s${index}`, { recordedAt: `2026-08-16T09:00:0${index}.000Z` }),
      )
    }
    const batch = await backend.listSamplesForUpload('session-1', 3)
    expect(batch).toHaveLength(3)
  })

  it('deletes an uploaded slice so it is not re-listed', async () => {
    await backend.enqueueSample(sample('a'))
    await backend.enqueueSample(sample('b'))
    await backend.deleteSamples(['a'])

    const remaining = await backend.listSamplesForUpload('session-1', 10)
    expect(remaining.map((item) => item.id)).toEqual(['b'])
  })

  it('evicts samples older than the max age and counts them as dropped', async () => {
    await backend.enqueueSample(sample('old', { enqueuedAt: '2026-08-01T00:00:00.000Z' }))
    await backend.enqueueSample(sample('new', { enqueuedAt: '2026-08-16T08:59:00.000Z' }))

    const evicted = await backend.evictOverflow({
      capacitySamples: 10_000,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      now: '2026-08-16T09:00:00.000Z',
    })

    expect(evicted).toBe(1)
    const remaining = await backend.listSamplesForUpload('session-1', 10)
    expect(remaining.map((item) => item.id)).toEqual(['new'])
  })

  it('evicts the oldest-by-recorded_at rows once over capacity', async () => {
    for (let index = 0; index < 5; index += 1) {
      await backend.enqueueSample(
        sample(`s${index}`, {
          enqueuedAt: '2026-08-16T09:00:00.000Z',
          recordedAt: `2026-08-16T09:00:0${index}.000Z`,
        }),
      )
    }

    const evicted = await backend.evictOverflow({
      capacitySamples: 3,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      now: '2026-08-16T09:00:00.000Z',
    })

    expect(evicted).toBe(2)
    const remaining = await backend.listSamplesForUpload('session-1', 10)
    // The two oldest (s0, s1) are dropped; s2..s4 survive.
    expect(remaining.map((item) => item.id)).toEqual(['s2', 's3', 's4'])
  })

  it('accumulates the dropped-locally counter across eviction calls', async () => {
    await backend.enqueueSample(sample('old1', { enqueuedAt: '2026-08-01T00:00:00.000Z' }))
    await backend.evictOverflow({
      capacitySamples: 10_000,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      now: '2026-08-16T09:00:00.000Z',
    })
    await backend.addDroppedLocallyCount(1)

    await backend.enqueueSample(sample('old2', { enqueuedAt: '2026-08-01T00:00:00.000Z' }))
    await backend.evictOverflow({
      capacitySamples: 10_000,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      now: '2026-08-16T09:00:00.000Z',
    })
    await backend.addDroppedLocallyCount(1)

    expect(await backend.getDroppedLocallyCount()).toBe(2)
  })
})

describe('IndexedDbQueueBackend sessions', () => {
  let backend: IndexedDbQueueBackend

  beforeEach(async () => {
    backend = await freshBackend()
  })

  it('round-trips a pending session and acks', async () => {
    await backend.putPendingSession({
      createAcked: false,
      endAcked: false,
      endedAt: null,
      recordedByUserId: 'user-1',
      sessionId: 'session-1',
      startedAt: '2026-08-16T09:00:00.000Z',
      tripId: 'trip-1',
    })

    await backend.markSessionCreateAcked('session-1')
    let stored = await backend.getPendingSession('session-1')
    expect(stored?.createAcked).toBe(true)
    expect(stored?.endAcked).toBe(false)

    await backend.markSessionEndAcked('session-1', '2026-08-16T10:00:00.000Z')
    stored = await backend.getPendingSession('session-1')
    expect(stored?.endAcked).toBe(true)
    expect(stored?.endedAt).toBe('2026-08-16T10:00:00.000Z')
  })

  it('purges a session and its samples together', async () => {
    await backend.putPendingSession({
      createAcked: true,
      endAcked: false,
      endedAt: null,
      recordedByUserId: 'user-1',
      sessionId: 'session-1',
      startedAt: '2026-08-16T09:00:00.000Z',
      tripId: 'trip-1',
    })
    await backend.enqueueSample(sample('a'))

    await backend.deleteSamplesForSession('session-1')
    await backend.deletePendingSession('session-1')

    expect(await backend.getPendingSession('session-1')).toBeNull()
    expect(await backend.countSamplesForSession('session-1')).toBe(0)
  })
})
