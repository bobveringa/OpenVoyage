import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { getErrorMessage, listTrackingSessionsWithServerDate } from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import {
  requestBackgroundLocation,
  requestIgnoreBatteryOptimizations,
  requestNotificationPermission,
} from '@/native/tracking-onboarding'
import { checkClockSkew } from '@/tracking/clock-skew'
import {
  createPositionSource,
  type PositionFix,
  type PositionSource,
} from '@/tracking/position-source'
import {
  checkSanityFilter,
  enqueueSample,
  getLastQueuedSample,
  getPendingSession,
  getQueueStats,
  listPendingSessions,
  putPendingSession,
  type QueueStats,
} from '@/tracking/sample-queue'
import {
  DEFAULT_TRACKING_SETTINGS,
  effectiveIntervalSeconds,
  readTrackingSettings,
  type TrackingSettings,
} from '@/tracking/tracking-settings'
import {
  TrackingContext,
  type ActiveTrackingSession,
  type StartTrackingInput,
  type TrackingStatus,
} from '@/tracking/tracking-context'
import { SessionUploader, type UploaderSnapshot } from '@/tracking/uploader'

type TrackingProviderProps = {
  children: ReactNode
}

export function TrackingProvider({ children }: TrackingProviderProps) {
  const { accessToken, currentUser } = useAuth()
  const [activeSession, setActiveSession] = useState<ActiveTrackingSession | null>(
    null,
  )
  const [status, setStatus] = useState<TrackingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null)
  const [uploaderSnapshot, setUploaderSnapshot] = useState<UploaderSnapshot | null>(
    null,
  )

  const accessTokenRef = useRef<string | null>(accessToken)
  const currentUserIdRef = useRef<string | null>(currentUser?.id ?? null)
  const positionSourceRef = useRef<PositionSource | null>(null)
  const uploaderRef = useRef<SessionUploader | null>(null)
  const settingsRef = useRef<TrackingSettings>(DEFAULT_TRACKING_SETTINGS)

  useEffect(() => {
    accessTokenRef.current = accessToken
  }, [accessToken])

  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null
  }, [currentUser?.id])

  const refreshQueueStats = useCallback(async (sessionId: string) => {
    try {
      setQueueStats(await getQueueStats(sessionId))
    } catch {
      // Best-effort display data; a failed refresh just leaves the last
      // known stats on screen until the next successful one.
    }
  }, [])

  // queueStats only used to get refreshed right after a fix was enqueued,
  // so it could sit at "1 queued" long after the uploader had already
  // drained it — the uploader tracks its own separate queueDepth and never
  // told this state to recheck. Refreshing on every uploader snapshot change
  // too (not just on enqueue) keeps the displayed count in sync with what
  // the uploader itself just observed.
  const handleUploaderSnapshot = useCallback(
    (sessionId: string, snapshot: UploaderSnapshot) => {
      setUploaderSnapshot(snapshot)
      void refreshQueueStats(sessionId)
    },
    [refreshQueueStats],
  )

  // The session (and its Stop control / status) stays visible until this
  // fires — see the TrackingStatus 'syncing' comment for why stopTracking()
  // itself doesn't clear activeSession.
  const handleFullySynced = useCallback(() => {
    setActiveSession(null)
    setStatus('idle')
  }, [])

  const handleFix = useCallback(
    async (sessionId: string, fix: PositionFix) => {
      const previous = await getLastQueuedSample(sessionId)
      const filterResult = checkSanityFilter(
        fix,
        previous,
        settingsRef.current.accuracyThresholdMeters,
      )
      if (!filterResult.ok) {
        return
      }

      await enqueueSample({
        accuracyMeters: fix.accuracyMeters,
        altitudeMeters: fix.altitudeMeters,
        enqueuedAt: new Date().toISOString(),
        headingDegrees: fix.headingDegrees,
        id: crypto.randomUUID(),
        latitude: fix.latitude,
        longitude: fix.longitude,
        recordedAt: fix.recordedAt,
        sessionId,
        speedMps: fix.speedMps,
        travelMode: settingsRef.current.defaultTravelMode,
      })

      uploaderRef.current?.requestSync()
      void refreshQueueStats(sessionId)
    },
    [refreshQueueStats],
  )

  const handleTerminated = useCallback((message: string) => {
    setError(message)
    setActiveSession(null)
    setStatus('idle')
    void positionSourceRef.current?.stop()
    positionSourceRef.current = null
  }, [])

  // Boot recovery: the webview (and its React state) can die at any time —
  // process kill, force-stop, low-memory eviction — while pending_sessions
  // still has a session on disk, open or just stopped-and-not-yet-synced.
  // Without this, a killed app leaves a "ghost" recording that keeps
  // costing battery/storage (if still open) or looks silently abandoned (if
  // stopped) with no UI anywhere able to see or act on it, since
  // activeSession only ever lived in memory. This resumes capture for a
  // still-open session, or just re-attaches to a stopped-but-syncing one so
  // it stays visible until sync completes, and restarts a plain uploader
  // for every other session of this user's that hasn't fully synced yet.
  useEffect(() => {
    const userId = currentUser?.id
    if (!userId) {
      return
    }

    let cancelled = false

    void (async () => {
      const pending = await listPendingSessions()
      if (cancelled || positionSourceRef.current || uploaderRef.current) {
        return
      }

      const mine = pending.filter((session) => session.recordedByUserId === userId)
      if (mine.length === 0) {
        return
      }

      // Prefer a still-open session (resume full capture for it); otherwise
      // show whichever stopped-but-unsynced session comes first — either
      // way there's normally at most one, per the one-session-per-device
      // rule enforced by startTracking()'s status gate.
      const stillOpen = mine.find((session) => session.endedAt === null) ?? null
      const toShow = stillOpen ?? mine[0] ?? null

      for (const session of mine) {
        if (session === toShow) {
          continue
        }
        new SessionUploader({
          getAccessToken: () => accessTokenRef.current,
          getCurrentUserId: () => currentUserIdRef.current,
          onSnapshotChange: () => {},
          onTerminated: () => {},
          sessionId: session.sessionId,
          tripId: session.tripId,
        }).start()
      }

      if (!toShow) {
        return
      }

      const settings = await readTrackingSettings()
      if (cancelled || positionSourceRef.current) {
        return
      }
      settingsRef.current = settings

      const uploader = new SessionUploader({
        getAccessToken: () => accessTokenRef.current,
        getCurrentUserId: () => currentUserIdRef.current,
        onFullySynced: handleFullySynced,
        onSnapshotChange: (snapshot) => handleUploaderSnapshot(toShow.sessionId, snapshot),
        onTerminated: handleTerminated,
        sessionId: toShow.sessionId,
        tripId: toShow.tripId,
      })
      uploaderRef.current = uploader
      uploader.start()

      if (stillOpen) {
        const source = createPositionSource()
        positionSourceRef.current = source
        try {
          await source.start({
            distanceFilterMeters: settings.distanceFilterMeters,
            intervalSeconds: effectiveIntervalSeconds(settings),
            notificationMessage:
              settings.notificationDetail === 'detailed'
                ? 'Recording your route for this trip.'
                : 'OpenVoyage is tracking your location.',
            notificationTitle: 'Recording trip',
            onError: (positionError) => setError(positionError.message),
            onFix: (fix) => void handleFix(toShow.sessionId, fix),
          })
        } catch (resumeError) {
          setError(getErrorMessage(resumeError))
        }
      }

      setActiveSession({
        endedAt: toShow.endedAt,
        sessionId: toShow.sessionId,
        startedAt: toShow.startedAt,
        tripId: toShow.tripId,
        tripTitle: toShow.tripTitle ?? null,
      })
      setStatus(stillOpen ? 'recording' : 'syncing')
      void refreshQueueStats(toShow.sessionId)
    })()

    return () => {
      cancelled = true
    }
    // Deliberately a one-shot check per sign-in, not a live sync — resuming
    // a killed recording is a launch-time concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id])

  const startTracking = useCallback(
    async ({
      tripId,
      tripTitle,
      accessToken: startAccessToken,
      currentUserId,
    }: StartTrackingInput) => {
      if (status !== 'idle') {
        return
      }
      setStatus('starting')
      setError(null)

      try {
        // Onboarding prompts (§11): a no-op once already granted/exempted,
        // so this is safe to run before every recording, not just the first.
        await requestNotificationPermission()
        await requestIgnoreBatteryOptimizations()

        const { sessions, serverDate } = await listTrackingSessionsWithServerDate({
          accessToken: startAccessToken,
          tripId,
        })

        if (serverDate) {
          const skew = checkClockSkew(serverDate)
          if (!skew.withinTolerance) {
            const skewSeconds = Math.round(Math.abs(skew.skewMs) / 1000)
            const proceed = window.confirm(
              `Your device clock looks like it is off by about ${skewSeconds} seconds ` +
                'from the server. Points recorded while your clock is this far off can ' +
                'be silently rejected.\n\nFix your device’s date & time for reliable ' +
                'results. Start anyway?',
            )
            if (!proceed) {
              setStatus('idle')
              return
            }
          }
        }

        const openSession = sessions.find((session) => session.ended_at === null)
        if (openSession) {
          setError('A recording is already in progress for this trip.')
          setStatus('idle')
          return
        }

        const settings = await readTrackingSettings()
        settingsRef.current = settings

        const sessionId = crypto.randomUUID()
        const startedAt = new Date().toISOString()

        // Persisted before any network call, per §3.1's durability rule.
        await putPendingSession({
          createAcked: false,
          endAcked: false,
          endedAt: null,
          recordedByUserId: currentUserId,
          sessionId,
          startedAt,
          tripId,
          tripTitle,
        })

        const uploader = new SessionUploader({
          getAccessToken: () => accessTokenRef.current,
          getCurrentUserId: () => currentUserIdRef.current,
          onFullySynced: handleFullySynced,
          onSnapshotChange: (snapshot) => handleUploaderSnapshot(sessionId, snapshot),
          onTerminated: handleTerminated,
          sessionId,
          tripId,
        })
        uploaderRef.current = uploader
        uploader.start()

        const source = createPositionSource()
        positionSourceRef.current = source
        await source.start({
          distanceFilterMeters: settings.distanceFilterMeters,
          intervalSeconds: effectiveIntervalSeconds(settings),
          notificationMessage:
            settings.notificationDetail === 'detailed'
              ? 'Recording your route for this trip.'
              : 'OpenVoyage is tracking your location.',
          notificationTitle: 'Recording trip',
          onError: (positionError) => setError(positionError.message),
          onFix: (fix) => void handleFix(sessionId, fix),
        })

        // Best-effort, and only meaningful once foreground location is
        // granted (which the successful source.start() above confirms);
        // the foreground service above is what actually keeps location
        // flowing in the background, so a "no" here doesn't block starting.
        await requestBackgroundLocation()

        setActiveSession({ endedAt: null, sessionId, startedAt, tripId, tripTitle })
        setStatus('recording')
        void refreshQueueStats(sessionId)
      } catch (startError) {
        setError(getErrorMessage(startError))
        setStatus('idle')
      }
    },
    [
      handleFix,
      handleFullySynced,
      handleTerminated,
      handleUploaderSnapshot,
      refreshQueueStats,
      status,
    ],
  )

  const stopTracking = useCallback(async () => {
    const session = activeSession
    if (!session || status !== 'recording') {
      return
    }
    setStatus('stopping')

    // Stop capturing immediately (§3.2); syncing what was already captured
    // happens asynchronously via the still-running uploader.
    await positionSourceRef.current?.stop()
    positionSourceRef.current = null

    const endedAt = new Date().toISOString()
    const pending = await getPendingSession(session.sessionId)
    if (pending) {
      await putPendingSession({ ...pending, endAcked: false, endedAt })
    }
    uploaderRef.current?.requestSync()

    // Stays visible (as 'syncing') until the uploader's onFullySynced fires
    // — see the TrackingStatus comment. Clearing it here made an offline
    // Stop look like the recording had just been deleted, when the samples
    // were actually still safely queued and waiting to sync.
    setActiveSession({ ...session, endedAt })
    setStatus('syncing')
  }, [activeSession, status])

  const value = useMemo(
    () => ({
      activeSession,
      error,
      queueStats,
      startTracking,
      status,
      stopTracking,
      uploaderSnapshot,
    }),
    [activeSession, error, queueStats, startTracking, status, stopTracking, uploaderSnapshot],
  )

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
}
