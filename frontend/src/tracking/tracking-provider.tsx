import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  deleteTrackingSession,
  getErrorMessage,
  listTrackingSessionsWithServerDate,
  type TrackingSession,
  type TravelMode,
} from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import {
  requestBackgroundLocation,
  requestIgnoreBatteryOptimizations,
  requestNotificationPermission,
} from '@/native/tracking-onboarding'
import {
  accuracyCutoffFor,
  createMovementDetector,
  shouldRescueRejectedFix,
  decideTracking,
  describeAdaptiveReason,
  isMeaningfulChange,
  type AdaptiveDecision,
} from '@/tracking/adaptive'
import { estimateClockOffsetMs } from '@/tracking/clock-offset'
import { checkClockSkew } from '@/tracking/clock-skew'
import {
  createPositionSource,
  type PositionFix,
  type PositionSource,
  type PositionSourceOptions,
  type PowerState,
} from '@/tracking/position-source'
import {
  addDroppedLocallyCount,
  addSimulatedRejectedCount,
  checkSanityFilter,
  enqueueSample,
  getLastQueuedSample,
  getPendingSession,
  type SanityFilterPrevious,
  getQueueStats,
  listPendingSessions,
  purgeSession,
  putPendingSession,
  resetDroppedLocallyCount,
  resetSimulatedRejectedCount,
  setSessionTravelMode,
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
import { describeTravelMode } from '@/tracking/travel-mode-options'
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
  // U1: a live re-check (triggered by the uploader on a non-zero discarded
  // count) still finds the clock off. Self-heals to null once discards stop.
  const [clockSkewWarningSeconds, setClockSkewWarningSeconds] = useState<number | null>(
    null,
  )
  // C5: one-time advisory measured when the recording started — never
  // blocks starting, unlike the old confirmation gate this replaces.
  const [clockSkewNoticeSeconds, setClockSkewNoticeSeconds] = useState<number | null>(
    null,
  )
  // U2: the travel mode new samples are being stamped with right now.
  const [currentTravelMode, setCurrentTravelModeState] = useState<TravelMode>('UNKNOWN')

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
  // Bumped every time settingsRef is written (B8). The ref itself is the read
  // path for synchronous code like handleFix, but a bare ref is invisible to
  // a useEffect's dependency array — this gives effects (the notification
  // text, most notably) something to depend on so they actually re-run when
  // settings change mid-recording.
  const [settingsVersion, setSettingsVersion] = useState(0)
  // Whether the current engine can still deliver fixes at a degraded power
  // tier (B7) — see adaptive.ts's battery branch. False until a probe says
  // otherwise, which is the safe default.
  const coarseLocationAvailableRef = useRef(false)

  // One source for the whole app lifetime. The native side owns "am I
  // recording", so this object is a handle to it, not the recording itself.
  const sourceRef = useRef<PositionSource | null>(null)
  const capturingRef = useRef(false)
  const movementRef = useRef(createMovementDetector())
  const powerRef = useRef<PowerState>(UNKNOWN_POWER_STATE)
  const decisionRef = useRef<AdaptiveDecision | null>(null)
  const lastAcceptedAtRef = useRef<number | null>(null)
  // The last fix that was actually recorded, held in memory. Reading it back
  // from the queue instead meant the out-of-order and 350 m/s jump guards were
  // inert whenever the uploader was keeping up: it drains rows faster than
  // fixes arrive, so the lookup returned null and every fix was compared
  // against nothing. A 16 km jump in 4 s was accepted in testing.
  const lastAcceptedFixRef = useRef<SanityFilterPrevious | null>(null)
  // Sync read path for handleFix (U2), mirroring settingsRef's pattern —
  // the state above is for display, this ref is what actually gets stamped
  // onto each sample without needing handleFix to depend on React state.
  const currentTravelModeRef = useRef<TravelMode>('UNKNOWN')

  const getSource = useCallback((): PositionSource => {
    if (!sourceRef.current) {
      sourceRef.current = createPositionSource()
    }
    return sourceRef.current
  }, [])

  // The one place settingsRef is ever written (B8) — pairs the ref update
  // with a version bump so effects depending on settings can see it.
  const updateSettingsRef = useCallback((next: TrackingSettings) => {
    settingsRef.current = next
    setSettingsVersion((version) => version + 1)
  }, [])

  // Pairs the ref (handleFix's synchronous read path) with the state
  // (display) update, mirroring updateSettingsRef above (U2).
  const updateCurrentTravelMode = useCallback((mode: TravelMode) => {
    currentTravelModeRef.current = mode
    setCurrentTravelModeState(mode)
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
    setClockSkewWarningSeconds(null)
    setClockSkewNoticeSeconds(null)
    updateCurrentTravelMode('UNKNOWN')
  }, [updateCurrentTravelMode])

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
        coarseLocationAvailable: coarseLocationAvailableRef.current,
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
      // Prefer the in-memory record; fall back to the queue only on the first
      // fix after a start or a re-attach, when there is nothing in memory yet.
      const previous =
        lastAcceptedFixRef.current ?? (await getLastQueuedSample(sessionId))
      const decision = decisionRef.current
      const cutoff = accuracyCutoffFor(decision?.powerLevel ?? 'high')
      const filterResult = checkSanityFilter(fix, previous, cutoff, startedAt)

      if (
        !filterResult.ok &&
        !shouldRescueRejectedFix({
          intervalSeconds: decision?.intervalSeconds ?? 60,
          msSinceAccepted:
            Date.now() - (lastAcceptedAtRef.current ?? Date.parse(startedAt)),
          reason: filterResult.reason,
        })
      ) {
        if (filterResult.reason === 'simulated') {
          // A user who left a mock-location app enabled needs to be told —
          // otherwise the recording just appears to produce nothing (B3).
          void addSimulatedRejectedCount(1).then(() => refreshQueueStats(sessionId))
        }
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
        travelMode: currentTravelModeRef.current,
      })

      lastAcceptedAtRef.current = Date.now()
      lastAcceptedFixRef.current = {
        latitude: fix.latitude,
        longitude: fix.longitude,
        recordedAt: fix.recordedAt,
      }
      movementRef.current.observe({
        // No Number.isFinite guard needed: accuracyMeters is null end-to-end
        // for "unknown" rather than Number.POSITIVE_INFINITY (B6).
        accuracyMeters: fix.accuracyMeters,
        atMs: Date.parse(fix.recordedAt),
        latitude: fix.latitude,
        longitude: fix.longitude,
        speedMps: fix.speedMps,
      })
      // The detector's displacement-derived speed, not the fix's own field —
      // see createMovementDetector for why the latter cannot be trusted.
      void applyAdaptivePolicy(movementRef.current.getSpeedMps())
      void getSource().noteSampleAccepted()

      uploaderRef.current?.requestSync()
      void refreshQueueStats(sessionId)
    },
    [applyAdaptivePolicy, getSource, refreshQueueStats],
  )

  const stopCapture = useCallback(async () => {
    capturingRef.current = false
    decisionRef.current = null
    lastAcceptedAtRef.current = null
    lastAcceptedFixRef.current = null
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
          coarseLocationAvailable: coarseLocationAvailableRef.current,
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
        onFixesDropped: (count) => {
          // The native fix buffer overflowed before JS ever saw these fixes
          // (B4) — the same failure mode the queue's own overflow eviction
          // already surfaces, so it feeds the same counter and UI copy.
          void addDroppedLocallyCount(count).then(() => refreshQueueStats(sessionId))
        },
        onStopRequested: () => {
          // Stopping from the notification has to run the same lifecycle as
          // the in-app button — end the session, flush the queue, send the
          // PATCH — not just silence the GPS.
          void stopTrackingRef.current()
        },
      }
    },
    [handleFix, refreshQueueStats],
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
      updateSettingsRef(settings)

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
          getWifiOnlyUpload: () => settingsRef.current.wifiOnlyUpload,
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
        getWifiOnlyUpload: () => settingsRef.current.wifiOnlyUpload,
        onClockSkewChecked: setClockSkewWarningSeconds,
        onFullySynced: handleFullySynced,
        onSnapshotChange: (snapshot) => handleUploaderSnapshot(toShow.sessionId, snapshot),
        onTerminated: handleTerminated,
        sessionId: toShow.sessionId,
        tripId: toShow.tripId,
      })
      replaceUploader(uploader)
      uploader.start()

      updateCurrentTravelMode(toShow.currentTravelMode ?? 'UNKNOWN')

      if (stillOpen) {
        movementRef.current = createMovementDetector()
        decisionRef.current = null
        try {
          const probe = await getSource().probe(settings.locationSource)
          coarseLocationAvailableRef.current = probe.ok
            ? probe.coarseLocationAvailable
            : false
        } catch {
          coarseLocationAvailableRef.current = false
        }
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
      // U2: visible without unlocking into the app, since the mode switcher
      // is the one piece of state the user is now responsible for.
      if (status === 'recording') {
        parts.push(describeTravelMode(currentTravelMode))
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
    currentTravelMode,
    getSource,
    notificationTitleFor,
    queueStats,
    settingsVersion,
    status,
    uploaderSnapshot,
  ])

  // Settings just saved from the settings page (B8). Previously the page
  // wrote to storage and nothing else happened until the *next* recording —
  // silently, with no indication in the UI that the change had no effect on
  // the one currently running.
  const notifySettingsChanged = useCallback(
    (next: TrackingSettings) => {
      updateSettingsRef(next)
      void applyAdaptivePolicy(movementRef.current.getSpeedMps())
    },
    [applyAdaptivePolicy, updateSettingsRef],
  )

  // U2: only affects samples enqueued from this point on — handleFix reads
  // currentTravelModeRef fresh on every fix, and nothing here touches
  // samples already sitting in the queue. Persisted on the session's own
  // row so it survives a reload or a process kill, unlike a plain ref.
  const setTravelMode = useCallback(
    async (mode: TravelMode) => {
      const session = activeSession
      if (!session || session.endedAt !== null) {
        return
      }
      updateCurrentTravelMode(mode)
      try {
        await setSessionTravelMode(session.sessionId, mode)
      } catch (travelModeError) {
        setError(getErrorMessage(travelModeError))
      }
    },
    [activeSession, updateCurrentTravelMode],
  )

  const startTracking = useCallback(
    async ({
      tripId,
      tripTitle,
      accessToken: startAccessToken,
      currentUserId,
    }: StartTrackingInput): Promise<void> => {
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

        // C2: this call already exists for the open-session check below, so
        // its Date header plus this measured round trip is the offset
        // estimate — no new endpoint, no extra request. A network failure
        // here means starting fully offline (C2): nothing has been
        // transmitted yet, so there is nothing to converge on and no open
        // session to check for; the uploader measures and pins the offset
        // itself on its first real network contact instead.
        let sessions: TrackingSession[] = []
        let serverDate: Date | null = null
        let t0 = Date.now()
        let t1 = t0
        try {
          t0 = Date.now()
          const response = await listTrackingSessionsWithServerDate({
            accessToken: startAccessToken,
            tripId,
          })
          t1 = Date.now()
          sessions = response.sessions
          serverDate = response.serverDate
        } catch {
          // Offline at start — see comment above.
        }

        let clockOffsetMs: number | null = null
        let clockNoticeSeconds: number | null = null
        if (serverDate) {
          clockOffsetMs = estimateClockOffsetMs({
            dateHeaderMs: serverDate.getTime(),
            t0,
            t1,
          })
          // C5: advisory only now that every outgoing timestamp is
          // corrected — a device clock this far off is still worth fixing,
          // but it no longer costs data, so this never blocks the start.
          const skew = checkClockSkew(serverDate)
          if (!skew.withinTolerance) {
            clockNoticeSeconds = Math.round(Math.abs(skew.skewMs) / 1000)
          }
        }

        const openSession = sessions.find((session) => session.ended_at === null)
        if (openSession) {
          setError('A recording is already in progress for this trip.')
          setStatus('idle')
          return
        }

        const settings = await readTrackingSettings()
        updateSettingsRef(settings)

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
        coarseLocationAvailableRef.current = probe.coarseLocationAvailable

        try {
          powerRef.current = await getSource().getPowerState()
        } catch {
          powerRef.current = UNKNOWN_POWER_STATE
        }
        movementRef.current = createMovementDetector()
        decisionRef.current = null

        await resetDroppedLocallyCount()
        await resetSimulatedRejectedCount()
        setClockSkewWarningSeconds(null)
        setClockSkewNoticeSeconds(clockNoticeSeconds)
        // U2: always UNKNOWN at the start of a new recording, never carried
        // over from the device's old defaultTravelMode setting — the mode
        // is a property of this leg of the trip.
        updateCurrentTravelMode('UNKNOWN')

        const sessionId = crypto.randomUUID()
        const startedAt = new Date().toISOString()

        // Persisted before any network call, per §3.1's durability rule.
        await putPendingSession({
          clockOffsetMs,
          createAcked: false,
          currentTravelMode: 'UNKNOWN',
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
          getWifiOnlyUpload: () => settingsRef.current.wifiOnlyUpload,
          onClockSkewChecked: setClockSkewWarningSeconds,
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
      updateCurrentTravelMode,
      updateSettingsRef,
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
        setClockSkewWarningSeconds(null)
        setClockSkewNoticeSeconds(null)
        updateCurrentTravelMode('UNKNOWN')
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
    [replaceUploader, updateCurrentTravelMode],
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
      clockSkewNoticeSeconds,
      clockSkewWarningSeconds,
      currentTravelMode,
      error,
      locationWarning,
      notifySettingsChanged,
      queueStats,
      setTravelMode,
      startTracking,
      status,
      stopTracking,
      uploaderSnapshot,
    }),
    [
      activeSession,
      adaptiveDecision,
      clockSkewNoticeSeconds,
      clockSkewWarningSeconds,
      currentTravelMode,
      error,
      locationWarning,
      notifySettingsChanged,
      queueStats,
      setTravelMode,
      startTracking,
      status,
      stopTracking,
      uploaderSnapshot,
    ],
  )

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
}
