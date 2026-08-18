import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  deleteTrackingSession,
  getErrorMessage,
  listTrackingSessionsWithServerDate,
} from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import {
  requestBackgroundLocation,
  requestIgnoreBatteryOptimizations,
  requestNotificationPermission,
} from '@/native/tracking-onboarding'
import {
  createMovementDetector,
  decideTracking,
  describeAdaptiveReason,
  isMeaningfulChange,
  type AdaptiveDecision,
} from '@/tracking/adaptive'
import { checkClockSkew } from '@/tracking/clock-skew'
import {
  createPositionSource,
  type PositionFix,
  type PositionSource,
  type PositionSourceOptions,
  type PowerState,
} from '@/tracking/position-source'
import {
  checkSanityFilter,
  enqueueSample,
  getLastQueuedSample,
  getPendingSession,
  getQueueStats,
  listPendingSessions,
  purgeSession,
  putPendingSession,
  resetDroppedLocallyCount,
  sweepOrphanedSamples,
  type QueueStats,
} from '@/tracking/sample-queue'
import {
  DEFAULT_TRACKING_SETTINGS,
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
import { describeUploaderStatus } from '@/tracking/uploader-status'

type TrackingProviderProps = {
  children: ReactNode
}

const UNKNOWN_POWER_STATE: PowerState = {
  batteryLevel: null,
  charging: false,
  powerSaveMode: false,
}

// Battery level and power-save mode change slowly; polling them more often
// than this would cost more than the adaptation saves.
const POWER_POLL_MS = 60_000

export function TrackingProvider({ children }: TrackingProviderProps) {
  const { accessToken, currentUser } = useAuth()
  const [activeSession, setActiveSession] = useState<ActiveTrackingSession | null>(null)
  const [status, setStatus] = useState<TrackingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null)
  const [uploaderSnapshot, setUploaderSnapshot] = useState<UploaderSnapshot | null>(null)
  const [adaptiveDecision, setAdaptiveDecision] = useState<AdaptiveDecision | null>(null)
  // Advisory only: the engine has gone quiet but the recording continues.
  const [locationWarning, setLocationWarning] = useState<string | null>(null)

  const accessTokenRef = useRef<string | null>(accessToken)
  const currentUserIdRef = useRef<string | null>(currentUser?.id ?? null)
  const uploaderRef = useRef<SessionUploader | null>(null)
  // Recovery can start uploaders for sessions other than the visible one;
  // they have to be stoppable too, or they outlive the sign-in that created
  // them and keep polling forever.
  const backgroundUploadersRef = useRef<SessionUploader[]>([])
  // Claimed synchronously, before the first await: the "already recovering?"
  // checks below all sit behind awaits, so without this two runs of the
  // effect can both pass them and set up two uploaders for one session.
  const recoveryClaimedRef = useRef(false)
  const settingsRef = useRef<TrackingSettings>(DEFAULT_TRACKING_SETTINGS)

  // One source for the whole app lifetime. The native side owns "am I
  // recording", so this object is a handle to it, not the recording itself.
  const sourceRef = useRef<PositionSource | null>(null)
  const capturingRef = useRef(false)
  const movementRef = useRef(createMovementDetector())
  const powerRef = useRef<PowerState>(UNKNOWN_POWER_STATE)
  const decisionRef = useRef<AdaptiveDecision | null>(null)

  const getSource = useCallback((): PositionSource => {
    if (!sourceRef.current) {
      sourceRef.current = createPositionSource()
    }
    return sourceRef.current
  }, [])

  useEffect(() => {
    accessTokenRef.current = accessToken
  }, [accessToken])

  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null
  }, [currentUser?.id])

  // Two uploaders on one session both list the same queue rows before
  // either deletes them, so every sample gets uploaded twice — harmless on
  // the server (the duplicate bucket absorbs it) but it doubles traffic and
  // makes the queue look like it is not draining.
  const replaceUploader = useCallback((next: SessionUploader | null) => {
    uploaderRef.current?.stop()
    uploaderRef.current = next
  }, [])

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

  // Re-evaluates the Phase 3 policy and, when the cadence has genuinely
  // moved, pushes it down to the OS location request. Doing this natively
  // (rather than discarding unwanted fixes in JS, as the old implementation
  // did) is what makes a long interval actually cost less battery.
  const applyAdaptivePolicy = useCallback(
    async (speedMps: number | null) => {
      if (!capturingRef.current) {
        return
      }
      const decision = decideTracking({
        movement: movementRef.current.getState(),
        power: powerRef.current,
        settings: settingsRef.current,
        speedMps,
      })

      const previous = decisionRef.current
      if (previous && !isMeaningfulChange(previous, decision)) {
        return
      }
      decisionRef.current = decision
      setAdaptiveDecision(decision)

      try {
        await getSource().configure(decision)
      } catch (configureError) {
        setError(getErrorMessage(configureError))
      }
    },
    [getSource],
  )

  const handleFix = useCallback(
    async (sessionId: string, startedAt: string, fix: PositionFix) => {
      const previous = await getLastQueuedSample(sessionId)
      const filterResult = checkSanityFilter(
        fix,
        previous,
        settingsRef.current.accuracyThresholdMeters,
        startedAt,
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

      movementRef.current.observe(fix.speedMps, Date.parse(fix.recordedAt))
      void applyAdaptivePolicy(fix.speedMps)

      uploaderRef.current?.requestSync()
      void refreshQueueStats(sessionId)
    },
    [applyAdaptivePolicy, refreshQueueStats],
  )

  const stopCapture = useCallback(async () => {
    capturingRef.current = false
    decisionRef.current = null
    setAdaptiveDecision(null)
    setLocationWarning(null)
    try {
      await getSource().stop()
    } catch (stopError) {
      setError(getErrorMessage(stopError))
    }
  }, [getSource])

  const handleTerminated = useCallback(
    (message: string) => {
      setError(message)
      setActiveSession(null)
      setStatus('idle')
      void stopCapture()
    },
    [stopCapture],
  )

  const stopTrackingRef = useRef<() => Promise<void>>(async () => {})
  const engineFailedRef = useRef<(message: string) => Promise<void>>(async () => {})

  const buildSourceOptions = useCallback(
    (
      sessionId: string,
      startedAt: string,
      notification: { title: string; message: string },
    ): PositionSourceOptions => {
      const decision =
        decisionRef.current ??
        decideTracking({
          movement: 'unknown',
          power: powerRef.current,
          settings: settingsRef.current,
          speedMps: null,
        })
      decisionRef.current = decision

      return {
        distanceFilterMeters: decision.distanceFilterMeters,
        powerLevel: decision.powerLevel,
        intervalSeconds: decision.intervalSeconds,
        locationSource: decision.locationSource,
        notificationMessage: notification.message,
        notificationTitle: notification.title,
        onEngineFailed: (message) => void engineFailedRef.current(message),
        onEngineWarning: (message) => setLocationWarning(message),
        onError: (positionError) => setError(positionError.message),
        onFix: (fix) => handleFix(sessionId, startedAt, fix),
        onStopRequested: () => {
          // Stopping from the notification has to run the same lifecycle as
          // the in-app button — end the session, flush the queue, send the
          // PATCH — not just silence the GPS.
          void stopTrackingRef.current()
        },
      }
    },
    [handleFix],
  )

  const notificationTitleFor = useCallback(
    (session: { tripTitle: string | null }) =>
      session.tripTitle ? `Recording ${session.tripTitle}` : 'Recording trip',
    [],
  )

  // Boot recovery and reconciliation. The webview (and its React state) can
  // die at any time — process kill, force-stop, low-memory eviction,
  // pull-to-refresh — while pending_sessions still has a session on disk and
  // the native service is still recording. Two invariants are restored here:
  //
  //   1. a session that should still be recording is re-adopted (never
  //      re-started alongside the running one, which used to orphan the
  //      original watcher and leave location on with no way to stop it);
  //   2. if this app does not believe it should be recording, the native
  //      service is told to stop — so an orphan can't outlive the belief
  //      that created it.
  useEffect(() => {
    const userId = currentUser?.id
    if (!userId) {
      return
    }

    let cancelled = false
    if (recoveryClaimedRef.current) {
      return
    }
    recoveryClaimedRef.current = true

    void (async () => {
      const settings = await readTrackingSettings()
      if (cancelled) {
        return
      }
      settingsRef.current = settings

      try {
        powerRef.current = await getSource().getPowerState()
      } catch {
        powerRef.current = UNKNOWN_POWER_STATE
      }

      await sweepOrphanedSamples().catch(() => 0)

      const pending = await listPendingSessions()
      if (cancelled || capturingRef.current || uploaderRef.current) {
        return
      }

      const mine = pending.filter((session) => session.recordedByUserId === userId)
      const stillOpen = mine.find((session) => session.endedAt === null) ?? null

      if (!stillOpen) {
        // Invariant 2. Cheap no-op when nothing is running natively, and the
        // one thing that guarantees a leaked recording can never survive a
        // relaunch.
        await getSource().stop()
      }

      if (mine.length === 0) {
        return
      }

      // Prefer a still-open session (resume full capture for it); otherwise
      // show whichever stopped-but-unsynced session comes first — either
      // way there's normally at most one, per the one-session-per-device
      // rule enforced by startTracking()'s status gate.
      const toShow = stillOpen ?? mine[0] ?? null

      for (const session of mine) {
        if (session === toShow) {
          continue
        }
        const backgroundUploader = new SessionUploader({
          getAccessToken: () => accessTokenRef.current,
          getCurrentUserId: () => currentUserIdRef.current,
          onSnapshotChange: () => {},
          onTerminated: () => {},
          sessionId: session.sessionId,
          tripId: session.tripId,
        })
        backgroundUploadersRef.current.push(backgroundUploader)
        backgroundUploader.start()
      }

      if (!toShow) {
        return
      }

      const uploader = new SessionUploader({
        getAccessToken: () => accessTokenRef.current,
        getCurrentUserId: () => currentUserIdRef.current,
        onFullySynced: handleFullySynced,
        onSnapshotChange: (snapshot) => handleUploaderSnapshot(toShow.sessionId, snapshot),
        onTerminated: handleTerminated,
        sessionId: toShow.sessionId,
        tripId: toShow.tripId,
      })
      replaceUploader(uploader)
      uploader.start()

      if (stillOpen) {
        movementRef.current = createMovementDetector()
        decisionRef.current = null
        const options = buildSourceOptions(toShow.sessionId, toShow.startedAt, {
          message: 'Reattaching…',
          title: notificationTitleFor({ tripTitle: toShow.tripTitle ?? null }),
        })
        try {
          // Adopts the still-running native recording when there is one and
          // only starts a fresh one when there genuinely isn't.
          const resumed = await getSource().resume(options)
          if (!resumed) {
            await getSource().start(options)
          }
          capturingRef.current = true
          setAdaptiveDecision(decisionRef.current)
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

  // Battery state moves slowly but it does move; without this poll a
  // recording that started at 80% would still be asking for high-accuracy
  // fixes at 4%.
  useEffect(() => {
    if (status !== 'recording') {
      return undefined
    }
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          powerRef.current = await getSource().getPowerState()
        } catch {
          return
        }
        await applyAdaptivePolicy(null)
      })()
    }, POWER_POLL_MS)
    return () => window.clearInterval(timer)
  }, [applyAdaptivePolicy, getSource, status])

  // Keeps the ongoing notification honest. It used to be built once when the
  // recording started and never touched again, so it kept claiming
  // "Recording your route" while the queue backed up, the uploader paused
  // for re-authentication, or the recording had already been stopped.
  useEffect(() => {
    if (!activeSession || (status !== 'recording' && status !== 'syncing')) {
      return
    }

    const title =
      status === 'syncing'
        ? 'Finishing sync'
        : notificationTitleFor({ tripTitle: activeSession.tripTitle })

    let text: string
    if (settingsRef.current.notificationDetail === 'minimal') {
      text = status === 'syncing' ? 'Uploading the last points.' : 'Recording your route.'
    } else {
      const queued = queueStats?.sampleCount ?? uploaderSnapshot?.queueDepth ?? 0
      const parts = [
        `${queued} queued`,
        describeUploaderStatus(uploaderSnapshot?.status ?? 'idle'),
      ]
      if (status === 'recording' && adaptiveDecision) {
        parts.push(describeAdaptiveReason(adaptiveDecision))
      }
      text = parts.join(' · ')
    }

    void getSource()
      .updateStatus({ text, title })
      .catch(() => {
        // A failed notification refresh is cosmetic; the recording itself is
        // unaffected and the next state change will try again.
      })
  }, [
    activeSession,
    adaptiveDecision,
    getSource,
    notificationTitleFor,
    queueStats,
    status,
    uploaderSnapshot,
  ])

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

        // Probe before committing anything. A device that cannot track — no
        // Play Services with the fused engine pinned, location switched off,
        // permission missing — must not end up with a persisted session, a
        // zero-point recording on the server, or a foreground service that
        // will never produce a fix.
        const probe = await getSource().probe(settings.locationSource)
        if (!probe.ok) {
          setError(probe.message ?? 'Location tracking is unavailable on this device.')
          setStatus('idle')
          return
        }

        try {
          powerRef.current = await getSource().getPowerState()
        } catch {
          powerRef.current = UNKNOWN_POWER_STATE
        }
        movementRef.current = createMovementDetector()
        decisionRef.current = null

        await resetDroppedLocallyCount()

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
        replaceUploader(uploader)
        uploader.start()

        await getSource().start(
          buildSourceOptions(sessionId, startedAt, {
            message: 'Starting…',
            title: notificationTitleFor({ tripTitle }),
          }),
        )
        capturingRef.current = true
        setAdaptiveDecision(decisionRef.current)

        // The recording is live the moment start() resolves, so publish it
        // now. Awaiting the background-location prompt first left the UI
        // stuck on "Starting…" — with no Stop button — for as long as that
        // prompt went unanswered, while the service was already recording.
        // On Android 11+ that prompt is a full settings screen the user can
        // simply walk away from, so "as long as" can be forever.
        setActiveSession({ endedAt: null, sessionId, startedAt, tripId, tripTitle })
        setStatus('recording')
        void refreshQueueStats(sessionId)

        // Best-effort, and only meaningful once foreground location is
        // granted (which the successful start() above confirms); the
        // foreground service is what actually keeps location flowing in the
        // background, so a "no" here doesn't affect the recording.
        void requestBackgroundLocation()
      } catch (startError) {
        // Starting failed partway through, which may still have left the
        // native service running. Tearing it down here is what keeps a
        // failed start from becoming an untouchable background recording.
        await stopCapture()
        setError(getErrorMessage(startError))
        setStatus('idle')
      }
    },
    [
      buildSourceOptions,
      getSource,
      handleFullySynced,
      handleTerminated,
      handleUploaderSnapshot,
      notificationTitleFor,
      refreshQueueStats,
      replaceUploader,
      status,
      stopCapture,
    ],
  )

  // A recording that captured nothing has no value and leaving it behind
  // just litters the trip's recordings list with 0-point rows. Anything with
  // points in it is wound up normally instead — never discard real data.
  const finishSession = useCallback(
    async (session: ActiveTrackingSession) => {
      const stats = await getQueueStats(session.sessionId).catch(() => null)
      const pending = await getPendingSession(session.sessionId)
      if ((stats?.sampleCount ?? 0) === 0) {
        const token = accessTokenRef.current
        // Only worth a DELETE if the server has actually heard of it; an
        // un-ACKed create has nothing on the other end to remove.
        if (pending?.createAcked && token) {
          try {
            await deleteTrackingSession({
              accessToken: token,
              sessionId: session.sessionId,
              tripId: session.tripId,
            })
          } catch {
            // Best effort. A failed delete leaves an empty session on the
            // server, which is untidy but harmless.
          }
        }
        await purgeSession(session.sessionId)
        replaceUploader(null)
        setActiveSession(null)
        setStatus('idle')
        return
      }

      const endedAt = new Date().toISOString()
      if (pending) {
        await putPendingSession({ ...pending, endAcked: false, endedAt })
      }
      uploaderRef.current?.requestSync()
      setActiveSession({ ...session, endedAt })
      setStatus('syncing')
    },
    [replaceUploader],
  )

  // Hard failure: the engine cannot deliver fixes and will not recover. The
  // recording is wound up rather than left running against nothing, which is
  // the silent-nothing outcome the whole engine split exists to prevent.
  const handleEngineFailed = useCallback(
    async (message: string) => {
      capturingRef.current = false
      decisionRef.current = null
      setAdaptiveDecision(null)
      setLocationWarning(null)
      setError(message)

      const session = activeSession
      if (!session || session.endedAt !== null) {
        return
      }
      await finishSession(session)
    },
    [activeSession, finishSession],
  )

  useEffect(() => {
    engineFailedRef.current = handleEngineFailed
  }, [handleEngineFailed])

  const stopTracking = useCallback(async () => {
    const session = activeSession
    if (!session || (status !== 'recording' && status !== 'starting')) {
      return
    }
    setStatus('stopping')

    // Stop capturing immediately (§3.2); syncing what was already captured
    // happens asynchronously via the still-running uploader.
    await stopCapture()

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
  }, [activeSession, status, stopCapture])

  // Lets the notification's Stop action reach the current stopTracking
  // without rebuilding (and re-registering) the native listeners every time
  // the callback identity changes.
  useEffect(() => {
    stopTrackingRef.current = stopTracking
  }, [stopTracking])

  const value = useMemo(
    () => ({
      activeSession,
      adaptiveDecision,
      error,
      locationWarning,
      queueStats,
      startTracking,
      status,
      stopTracking,
      uploaderSnapshot,
    }),
    [
      activeSession,
      adaptiveDecision,
      error,
      locationWarning,
      queueStats,
      startTracking,
      status,
      stopTracking,
      uploaderSnapshot,
    ],
  )

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
}
