import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'

import type { TravelMode } from '@/api/client'
import type {
  PendingSession,
  QueueBackend,
  QueuedSample,
} from '@/tracking/queue/types'

const DB_NAME = 'openvoyage_tracking'
const DB_VERSION = 1

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pending_sessions (
  session_id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  trip_title TEXT,
  recorded_by_user_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  create_acked INTEGER NOT NULL DEFAULT 0,
  end_acked INTEGER NOT NULL DEFAULT 0,
  current_travel_mode TEXT
);
CREATE TABLE IF NOT EXISTS pending_samples (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_meters REAL,
  travel_mode TEXT NOT NULL DEFAULT 'UNKNOWN',
  speed_mps REAL,
  heading_degrees REAL,
  altitude_meters REAL,
  enqueued_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_samples_session_id
  ON pending_samples(session_id);
CREATE INDEX IF NOT EXISTS idx_pending_samples_recorded_at
  ON pending_samples(recorded_at);
CREATE TABLE IF NOT EXISTS queue_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const DROPPED_COUNT_KEY = 'droppedLocallyCount'
const SIMULATED_REJECTED_COUNT_KEY = 'simulatedRejectedCount'

type SessionRow = {
  session_id: string
  trip_id: string
  trip_title: string | null
  recorded_by_user_id: string
  started_at: string
  ended_at: string | null
  create_acked: number
  end_acked: number
  current_travel_mode: string | null
  clock_offset_ms: number | null
}

type SampleRow = {
  id: string
  session_id: string
  recorded_at: string
  latitude: number
  longitude: number
  accuracy_meters: number | null
  travel_mode: string
  speed_mps: number | null
  heading_degrees: number | null
  altitude_meters: number | null
  enqueued_at: string
}

function sessionFromRow(row: SessionRow): PendingSession {
  return {
    clockOffsetMs: row.clock_offset_ms,
    createAcked: row.create_acked === 1,
    currentTravelMode: (row.current_travel_mode as TravelMode | null) ?? null,
    endAcked: row.end_acked === 1,
    endedAt: row.ended_at,
    recordedByUserId: row.recorded_by_user_id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    tripId: row.trip_id,
    tripTitle: row.trip_title,
  }
}

function sampleFromRow(row: SampleRow): QueuedSample {
  return {
    accuracyMeters: row.accuracy_meters,
    altitudeMeters: row.altitude_meters,
    enqueuedAt: row.enqueued_at,
    headingDegrees: row.heading_degrees,
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    recordedAt: row.recorded_at,
    sessionId: row.session_id,
    speedMps: row.speed_mps,
    travelMode: row.travel_mode as TravelMode,
  }
}

export class SqliteQueueBackend implements QueueBackend {
  private sqlite = new SQLiteConnection(CapacitorSQLite)
  private db: SQLiteDBConnection | null = null

  async init(): Promise<void> {
    if (this.db) {
      return
    }

    const consistency = await this.sqlite.checkConnectionsConsistency()
    const alreadyOpen = (await this.sqlite.isConnection(DB_NAME, false)).result

    this.db =
      consistency.result && alreadyOpen
        ? await this.sqlite.retrieveConnection(DB_NAME, false)
        : await this.sqlite.createConnection(
            DB_NAME,
            false,
            'no-encryption',
            DB_VERSION,
            false,
          )

    await this.db.open()
    await this.db.execute(SCHEMA_SQL)
    // Upgrade path for devices whose pending_sessions table predates this
    // column: CREATE TABLE IF NOT EXISTS above is a no-op against an
    // existing table, so add it explicitly. Fails harmlessly (duplicate
    // column) once the table already has it, including on every fresh
    // install created by the CREATE TABLE above.
    try {
      await this.db.execute('ALTER TABLE pending_sessions ADD COLUMN trip_title TEXT')
    } catch {
      // Column already exists.
    }
    try {
      await this.db.execute(
        'ALTER TABLE pending_sessions ADD COLUMN current_travel_mode TEXT',
      )
    } catch {
      // Column already exists.
    }
    try {
      await this.db.execute(
        'ALTER TABLE pending_sessions ADD COLUMN clock_offset_ms REAL',
      )
    } catch {
      // Column already exists.
    }
  }

  private get connection(): SQLiteDBConnection {
    if (!this.db) {
      throw new Error('SqliteQueueBackend used before init()')
    }
    return this.db
  }

  async putPendingSession(session: PendingSession): Promise<void> {
    await this.connection.run(
      `INSERT INTO pending_sessions
        (session_id, trip_id, trip_title, recorded_by_user_id, started_at, ended_at, create_acked, end_acked, current_travel_mode, clock_offset_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
        trip_id = excluded.trip_id,
        trip_title = excluded.trip_title,
        recorded_by_user_id = excluded.recorded_by_user_id,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        create_acked = excluded.create_acked,
        end_acked = excluded.end_acked,
        current_travel_mode = excluded.current_travel_mode,
        clock_offset_ms = excluded.clock_offset_ms`,
      [
        session.sessionId,
        session.tripId,
        session.tripTitle ?? null,
        session.recordedByUserId,
        session.startedAt,
        session.endedAt,
        session.createAcked ? 1 : 0,
        session.endAcked ? 1 : 0,
        session.currentTravelMode ?? null,
        session.clockOffsetMs ?? null,
      ],
    )
  }

  async getPendingSession(sessionId: string): Promise<PendingSession | null> {
    const result = await this.connection.query(
      'SELECT * FROM pending_sessions WHERE session_id = ?',
      [sessionId],
    )
    const row = (result.values as SessionRow[] | undefined)?.[0]
    return row ? sessionFromRow(row) : null
  }

  async listPendingSessions(): Promise<PendingSession[]> {
    const result = await this.connection.query('SELECT * FROM pending_sessions')
    return ((result.values as SessionRow[]) ?? []).map(sessionFromRow)
  }

  async markSessionCreateAcked(sessionId: string): Promise<void> {
    await this.connection.run(
      'UPDATE pending_sessions SET create_acked = 1 WHERE session_id = ?',
      [sessionId],
    )
  }

  async markSessionEndAcked(sessionId: string, endedAt: string): Promise<void> {
    await this.connection.run(
      'UPDATE pending_sessions SET end_acked = 1, ended_at = ? WHERE session_id = ?',
      [endedAt, sessionId],
    )
  }

  async deletePendingSession(sessionId: string): Promise<void> {
    await this.connection.run('DELETE FROM pending_sessions WHERE session_id = ?', [
      sessionId,
    ])
  }

  async enqueueSample(sample: QueuedSample): Promise<void> {
    await this.connection.run(
      `INSERT INTO pending_samples
        (id, session_id, recorded_at, latitude, longitude, accuracy_meters,
         travel_mode, speed_mps, heading_degrees, altitude_meters, enqueued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        sample.id,
        sample.sessionId,
        sample.recordedAt,
        sample.latitude,
        sample.longitude,
        sample.accuracyMeters,
        sample.travelMode,
        sample.speedMps,
        sample.headingDegrees,
        sample.altitudeMeters,
        sample.enqueuedAt,
      ],
    )
  }

  async getLastSample(sessionId: string): Promise<QueuedSample | null> {
    const result = await this.connection.query(
      `SELECT * FROM pending_samples WHERE session_id = ?
       ORDER BY recorded_at DESC LIMIT 1`,
      [sessionId],
    )
    const row = (result.values as SampleRow[] | undefined)?.[0]
    return row ? sampleFromRow(row) : null
  }

  async listSamplesForUpload(
    sessionId: string,
    limit: number,
  ): Promise<QueuedSample[]> {
    const result = await this.connection.query(
      `SELECT * FROM pending_samples WHERE session_id = ?
       ORDER BY recorded_at ASC LIMIT ?`,
      [sessionId, limit],
    )
    return ((result.values as SampleRow[]) ?? []).map(sampleFromRow)
  }

  async deleteSamples(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    const placeholders = ids.map(() => '?').join(', ')
    await this.connection.run(
      `DELETE FROM pending_samples WHERE id IN (${placeholders})`,
      [...ids],
    )
  }

  async deleteSamplesForSession(sessionId: string): Promise<void> {
    await this.connection.run('DELETE FROM pending_samples WHERE session_id = ?', [
      sessionId,
    ])
  }

  async countSamplesForSession(sessionId: string): Promise<number> {
    const result = await this.connection.query(
      'SELECT COUNT(*) as count FROM pending_samples WHERE session_id = ?',
      [sessionId],
    )
    const row = (result.values as Array<{ count: number }> | undefined)?.[0]
    return row?.count ?? 0
  }

  async countAllSamples(): Promise<number> {
    const result = await this.connection.query(
      'SELECT COUNT(*) as count FROM pending_samples',
    )
    const row = (result.values as Array<{ count: number }> | undefined)?.[0]
    return row?.count ?? 0
  }

  async oldestSampleTimestamp(sessionId: string): Promise<string | null> {
    const result = await this.connection.query(
      `SELECT enqueued_at FROM pending_samples WHERE session_id = ?
       ORDER BY enqueued_at ASC LIMIT 1`,
      [sessionId],
    )
    const row = (result.values as Array<{ enqueued_at: string }> | undefined)?.[0]
    return row?.enqueued_at ?? null
  }

  async evictOverflow(options: {
    capacitySamples: number
    maxAgeMs: number
    now: string
  }): Promise<number> {
    const cutoff = new Date(
      Date.parse(options.now) - options.maxAgeMs,
    ).toISOString()

    // Deliberately selects the rows it is about to remove and counts those,
    // rather than diffing COUNT(*) before and after. The uploader deletes
    // uploaded rows on its own schedule — and it is woken by the very
    // enqueue that calls this — so a before/after difference attributed a
    // successful upload to "dropped locally", which is how a brand new
    // recording reported a dropped point on its first fix.
    const agedResult = await this.connection.query(
      'SELECT id FROM pending_samples WHERE enqueued_at < ?',
      [cutoff],
    )
    const agedIds = ((agedResult.values as Array<{ id: string }>) ?? []).map(
      (row) => row.id,
    )
    if (agedIds.length > 0) {
      await this.deleteSamples(agedIds)
    }

    const countResult = await this.connection.query(
      'SELECT COUNT(*) as count FROM pending_samples',
    )
    const remaining =
      (countResult.values as Array<{ count: number }> | undefined)?.[0]?.count ?? 0
    const overCapacity = Math.max(0, remaining - options.capacitySamples)

    let capacityIds: string[] = []
    if (overCapacity > 0) {
      const oldestResult = await this.connection.query(
        'SELECT id FROM pending_samples ORDER BY recorded_at ASC LIMIT ?',
        [overCapacity],
      )
      capacityIds = ((oldestResult.values as Array<{ id: string }>) ?? []).map(
        (row) => row.id,
      )
      if (capacityIds.length > 0) {
        await this.deleteSamples(capacityIds)
      }
    }

    return agedIds.length + capacityIds.length
  }

  async deleteOrphanedSamples(): Promise<number> {
    const result = await this.connection.query(
      `SELECT id FROM pending_samples
       WHERE session_id NOT IN (SELECT session_id FROM pending_sessions)`,
    )
    const ids = ((result.values as Array<{ id: string }>) ?? []).map((row) => row.id)
    if (ids.length > 0) {
      await this.deleteSamples(ids)
    }
    return ids.length
  }

  async getDroppedLocallyCount(): Promise<number> {
    const result = await this.connection.query(
      'SELECT value FROM queue_meta WHERE key = ?',
      [DROPPED_COUNT_KEY],
    )
    const row = (result.values as Array<{ value: string }> | undefined)?.[0]
    return row ? Number.parseInt(row.value, 10) : 0
  }

  async addDroppedLocallyCount(delta: number): Promise<void> {
    if (delta === 0) {
      return
    }
    const current = await this.getDroppedLocallyCount()
    await this.connection.run(
      `INSERT INTO queue_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [DROPPED_COUNT_KEY, String(current + delta)],
    )
  }

  async resetDroppedLocallyCount(): Promise<void> {
    await this.connection.run('DELETE FROM queue_meta WHERE key = ?', [
      DROPPED_COUNT_KEY,
    ])
  }

  async getSimulatedRejectedCount(): Promise<number> {
    const result = await this.connection.query(
      'SELECT value FROM queue_meta WHERE key = ?',
      [SIMULATED_REJECTED_COUNT_KEY],
    )
    const row = (result.values as Array<{ value: string }> | undefined)?.[0]
    return row ? Number.parseInt(row.value, 10) : 0
  }

  async addSimulatedRejectedCount(delta: number): Promise<void> {
    if (delta === 0) {
      return
    }
    const current = await this.getSimulatedRejectedCount()
    await this.connection.run(
      `INSERT INTO queue_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SIMULATED_REJECTED_COUNT_KEY, String(current + delta)],
    )
  }

  async resetSimulatedRejectedCount(): Promise<void> {
    await this.connection.run('DELETE FROM queue_meta WHERE key = ?', [
      SIMULATED_REJECTED_COUNT_KEY,
    ])
  }
}
