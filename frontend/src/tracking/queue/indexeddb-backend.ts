import type {
  PendingSession,
  QueueBackend,
  QueuedSample,
} from '@/tracking/queue/types'

const DB_NAME = 'openvoyage-tracking'
const DB_VERSION = 1
const SESSIONS_STORE = 'pending_sessions'
const SAMPLES_STORE = 'pending_samples'
const META_STORE = 'meta'
const DROPPED_COUNT_KEY = 'droppedLocallyCount'

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export class IndexedDbQueueBackend implements QueueBackend {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    if (this.db) {
      return
    }

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          db.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' })
        }
        if (!db.objectStoreNames.contains(SAMPLES_STORE)) {
          const store = db.createObjectStore(SAMPLES_STORE, { keyPath: 'id' })
          store.createIndex('sessionId', 'sessionId', { unique: false })
          store.createIndex('recordedAt', 'recordedAt', { unique: false })
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private get connection(): IDBDatabase {
    if (!this.db) {
      throw new Error('IndexedDbQueueBackend used before init()')
    }
    return this.db
  }

  async putPendingSession(session: PendingSession): Promise<void> {
    const tx = this.connection.transaction(SESSIONS_STORE, 'readwrite')
    tx.objectStore(SESSIONS_STORE).put(session)
    await txDone(tx)
  }

  async getPendingSession(sessionId: string): Promise<PendingSession | null> {
    const tx = this.connection.transaction(SESSIONS_STORE, 'readonly')
    const result = await promisify(
      tx.objectStore(SESSIONS_STORE).get(sessionId) as IDBRequest<
        PendingSession | undefined
      >,
    )
    return result ?? null
  }

  async listPendingSessions(): Promise<PendingSession[]> {
    const tx = this.connection.transaction(SESSIONS_STORE, 'readonly')
    const result = await promisify(
      tx.objectStore(SESSIONS_STORE).getAll() as IDBRequest<PendingSession[]>,
    )
    return result
  }

  async markSessionCreateAcked(sessionId: string): Promise<void> {
    const session = await this.getPendingSession(sessionId)
    if (!session) {
      return
    }
    await this.putPendingSession({ ...session, createAcked: true })
  }

  async markSessionEndAcked(sessionId: string, endedAt: string): Promise<void> {
    const session = await this.getPendingSession(sessionId)
    if (!session) {
      return
    }
    await this.putPendingSession({
      ...session,
      endAcked: true,
      endedAt,
    })
  }

  async deletePendingSession(sessionId: string): Promise<void> {
    const tx = this.connection.transaction(SESSIONS_STORE, 'readwrite')
    tx.objectStore(SESSIONS_STORE).delete(sessionId)
    await txDone(tx)
  }

  async enqueueSample(sample: QueuedSample): Promise<void> {
    const tx = this.connection.transaction(SAMPLES_STORE, 'readwrite')
    tx.objectStore(SAMPLES_STORE).put(sample)
    await txDone(tx)
  }

  async getLastSample(sessionId: string): Promise<QueuedSample | null> {
    const samples = await this.samplesForSession(sessionId)
    if (samples.length === 0) {
      return null
    }
    return samples.reduce((latest, sample) =>
      sample.recordedAt > latest.recordedAt ? sample : latest,
    )
  }

  async listSamplesForUpload(
    sessionId: string,
    limit: number,
  ): Promise<QueuedSample[]> {
    const samples = await this.samplesForSession(sessionId)
    return samples
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .slice(0, limit)
  }

  async deleteSamples(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    const tx = this.connection.transaction(SAMPLES_STORE, 'readwrite')
    const store = tx.objectStore(SAMPLES_STORE)
    for (const id of ids) {
      store.delete(id)
    }
    await txDone(tx)
  }

  async deleteSamplesForSession(sessionId: string): Promise<void> {
    const samples = await this.samplesForSession(sessionId)
    await this.deleteSamples(samples.map((sample) => sample.id))
  }

  async countSamplesForSession(sessionId: string): Promise<number> {
    const samples = await this.samplesForSession(sessionId)
    return samples.length
  }

  async oldestSampleTimestamp(sessionId: string): Promise<string | null> {
    const samples = await this.samplesForSession(sessionId)
    if (samples.length === 0) {
      return null
    }
    return samples.reduce((oldest, sample) =>
      sample.enqueuedAt < oldest.enqueuedAt ? sample : oldest,
    ).enqueuedAt
  }

  async evictOverflow(options: {
    capacitySamples: number
    maxAgeMs: number
    now: string
  }): Promise<number> {
    const tx = this.connection.transaction(SAMPLES_STORE, 'readwrite')
    const store = tx.objectStore(SAMPLES_STORE)
    const all = await promisify(store.getAll() as IDBRequest<QueuedSample[]>)

    const nowMs = Date.parse(options.now)
    const cutoffMs = nowMs - options.maxAgeMs
    const toDrop = new Set<string>()

    for (const sample of all) {
      if (Date.parse(sample.enqueuedAt) < cutoffMs) {
        toDrop.add(sample.id)
      }
    }

    const remaining = all
      .filter((sample) => !toDrop.has(sample.id))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    const overCapacity = Math.max(0, remaining.length - options.capacitySamples)
    for (let index = 0; index < overCapacity; index += 1) {
      const sample = remaining[index]
      if (sample) {
        toDrop.add(sample.id)
      }
    }

    for (const id of toDrop) {
      store.delete(id)
    }
    await txDone(tx)
    return toDrop.size
  }

  async getDroppedLocallyCount(): Promise<number> {
    const tx = this.connection.transaction(META_STORE, 'readonly')
    const result = await promisify(
      tx.objectStore(META_STORE).get(DROPPED_COUNT_KEY) as IDBRequest<
        { key: string; value: number } | undefined
      >,
    )
    return result?.value ?? 0
  }

  async addDroppedLocallyCount(delta: number): Promise<void> {
    if (delta === 0) {
      return
    }
    const current = await this.getDroppedLocallyCount()
    const tx = this.connection.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put({ key: DROPPED_COUNT_KEY, value: current + delta })
    await txDone(tx)
  }

  async deleteOrphanedSamples(): Promise<number> {
    const sessions = await this.listPendingSessions()
    const known = new Set(sessions.map((session) => session.sessionId))

    const tx = this.connection.transaction(SAMPLES_STORE, 'readwrite')
    const store = tx.objectStore(SAMPLES_STORE)
    const all = await promisify(store.getAll() as IDBRequest<QueuedSample[]>)
    const orphans = all.filter((sample) => !known.has(sample.sessionId))
    for (const sample of orphans) {
      store.delete(sample.id)
    }
    await txDone(tx)
    return orphans.length
  }

  async resetDroppedLocallyCount(): Promise<void> {
    const tx = this.connection.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).delete(DROPPED_COUNT_KEY)
    await txDone(tx)
  }

  private async samplesForSession(sessionId: string): Promise<QueuedSample[]> {
    const tx = this.connection.transaction(SAMPLES_STORE, 'readonly')
    const index = tx.objectStore(SAMPLES_STORE).index('sessionId')
    const result = await promisify(
      index.getAll(IDBKeyRange.only(sessionId)) as IDBRequest<QueuedSample[]>,
    )
    return result
  }
}
