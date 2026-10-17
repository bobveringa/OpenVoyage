import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import {
  ApiError,
  getApiBaseUrl,
  getErrorMessage,
  provisionTrackingUploadToken,
  type TravelMode,
} from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import {
  requestBackgroundLocation,
  requestIgnoreBatteryOptimizations,
  requestNotificationPermission,
} from '@/native/tracking-onboarding'
import {
  NativeTracking,
  nativeRecording,
  type NativeRecording,
} from '@/tracking/native-recording'
import {
  TrackingContext,
  type StartTrackingInput,
  type TrackingContextValue,
} from '@/tracking/tracking-context'
import type { NativeTrackingState } from '@/tracking/position-source'
import {
  baselineFor,
  readTrackingSettings,
  type TrackingSettings,
} from '@/tracking/tracking-settings'

function config(settings: TrackingSettings) {
  const baseline = baselineFor(settings)
  return {
    ...settings,
    distanceFilterMeters:
      settings.mode === 'smart' ? 0 : settings.distanceFilterMeters,
    intervalSeconds: baseline.intervalSeconds,
    powerLevel: baseline.powerLevel,
    baselineIntervalSeconds: baseline.intervalSeconds,
    baselinePowerLevel: baseline.powerLevel,
    minIntervalSeconds: Math.max(
      5,
      baseline.intervalSeconds /
        (settings.mode === 'manual' && settings.distanceFilterMeters > 0
          ? 4
          : 1),
    ),
  }
}

export function NativeTrackingProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const identity = useRef(auth.currentUser?.id)
  identity.current = auth.currentUser?.id
  const [sessions, setSessions] = useState<NativeRecording[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const busy = useRef(false)
  const startingRef = useRef(false)
  const startupSession = useRef<string | null>(null)
  const startupConfirmedAt = useRef<number | null>(null)
  const [engine, setEngine] = useState<NativeTrackingState | null>(null)
  const denied = useRef(new Set<string>())
  const visible = useRef(true)
  const reconcile = useCallback(
    async (renew: boolean) => {
      if (
        busy.current ||
        auth.status === 'loading' ||
        auth.status === 'unavailable'
      )
        return
      busy.current = true
      const user = auth.currentUser?.id ?? ''
      try {
        let rows = await nativeRecording('snapshot')
        if (renew && auth.accessToken && user && visible.current) {
          const network = await Network.getStatus()
          if (network.connected)
            for (const s of rows) {
              if (identity.current !== user) break
              if (
                s.userId !== user ||
                s.apiBaseUrl !== getApiBaseUrl().replace(/\/$/, '') ||
                s.terminal ||
                (s.blocked && !s.renewOnForeground) ||
                denied.current.has(s.sessionId) ||
                (s.expiresAt &&
                  s.renewInMs > 60_000 &&
                  !s.authPaused &&
                  !s.blocked)
              )
                continue
              try {
                if (s.blocked) denied.current.add(s.sessionId)
                const { token, remainingMs } =
                  await provisionTrackingUploadToken({
                    accessToken: auth.accessToken,
                    tripId: s.tripId,
                    sessionId: s.sessionId,
                  })
                if (identity.current !== user) break
                await nativeRecording('credential', {
                  sessionId: s.sessionId,
                  token,
                  remainingMs,
                })
                setError(null)
              } catch (e) {
                if (identity.current !== user) break
                if (
                  e instanceof ApiError &&
                  [401, 403, 404, 409].includes(e.status)
                ) {
                  denied.current.add(s.sessionId)
                  const detail = e.detail as { code?: string } | null
                  await nativeRecording('provisionFailure', {
                    sessionId: s.sessionId,
                    reason: getErrorMessage(e),
                    deleted: detail?.code === 'session_deleted',
                    terminal: e.status === 404 || e.status === 409,
                  })
                }
                setError(getErrorMessage(e))
              }
            }
          rows = await nativeRecording('snapshot')
        }
        if (identity.current === (user || undefined)) {
          if (
            startupConfirmedAt.current === null &&
            rows.some(
              (s) => s.sessionId === startupSession.current && s.firstFixAt,
            )
          )
            startupConfirmedAt.current = Date.now()
          setSessions(rows.filter((s) => s.userId === user))
          setEngine(await NativeTracking.getState())
        }
      } catch (e) {
        setError(getErrorMessage(e))
      } finally {
        busy.current = false
      }
    },
    [auth.accessToken, auth.currentUser?.id, auth.status],
  )

  useEffect(() => {
    if (auth.status !== 'authenticated' || !auth.currentUser) return
    let alive = true
    denied.current.clear()
    void nativeRecording('identity', { userId: auth.currentUser?.id ?? '' })
      .then(() => reconcile(true))
      .then(async () => {
        if (!alive) return
        const rows = await nativeRecording('recover')
        const state = await NativeTracking.getState()
        if (
          rows.some(
            (s) => s.userId === identity.current && !s.endedAt && !s.terminal,
          ) &&
          !state.tracking
        ) {
          if (state.trackingIntent) await NativeTracking.resume()
          else await NativeTracking.start(config(await readTrackingSettings()))
        }
      })
      .catch((e) => setError(getErrorMessage(e)))
    const timer = window.setInterval(() => {
      if (visible.current) void reconcile(true)
    }, 5_000)
    const wake = () => {
      visible.current = document.visibilityState === 'visible'
      if (visible.current) {
        denied.current.clear()
        void reconcile(true)
      }
    }
    document.addEventListener('visibilitychange', wake)
    const appListener = App.addListener('appStateChange', ({ isActive }) => {
      visible.current = isActive
      if (isActive) {
        denied.current.clear()
        void reconcile(true)
      }
    })
    const networkListener = Network.addListener(
      'networkStatusChange',
      ({ connected }) => {
        if (connected) {
          denied.current.clear()
          void reconcile(true)
        }
      },
    )
    const trackingListeners = (
      [
        'fixAvailable',
        'stopRequested',
        'engineWarning',
        'engineFailed',
        'adaptiveStateChanged',
      ] as const
    ).map((event) =>
      NativeTracking.addListener(event, () => {
        if (visible.current) void reconcile(false)
      }),
    )
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
      void appListener.then((x) => x.remove())
      void networkListener.then((x) => x.remove())
      for (const listener of trackingListeners)
        void listener.then((x) => x.remove())
    }
  }, [reconcile, auth.status, auth.currentUser])

  const mine = sessions.filter((s) => s.userId === auth.currentUser?.id)
  const capturing = mine.find((s) => s.endedAt === null && !s.terminal)
  const selected = capturing ?? mine.find((s) => !s.terminal) ?? mine[0]
  const startTracking = useCallback(
    async (input: StartTrackingInput) => {
      if (startingRef.current || capturing) return
      startingRef.current = true
      setStarting(true)
      setError(null)
      let id: string | null = null
      try {
        await requestNotificationPermission()
        const settings = await readTrackingSettings()
        const probe = await NativeTracking.probe({
          locationSource: settings.locationSource,
        })
        if (!probe.ok)
          throw new Error(probe.message ?? 'Location tracking unavailable')
        if (identity.current !== input.currentUserId) return
        await nativeRecording('identity', { userId: input.currentUserId })
        id = crypto.randomUUID()
        startupSession.current = id
        startupConfirmedAt.current = null
        setSessions(
          await nativeRecording('begin', {
            ...input,
            accessToken: undefined,
            sessionId: id,
            userId: input.currentUserId,
            apiBaseUrl: getApiBaseUrl().replace(/\/$/, ''),
            wifiOnlyUpload: settings.wifiOnlyUpload,
          }),
        )
        await NativeTracking.start(config(settings))
        await requestBackgroundLocation()
        await requestIgnoreBatteryOptimizations()
        await reconcile(true)
      } catch (e) {
        if (id) {
          await nativeRecording('stop', { sessionId: id }).catch(() => {})
        }
        setError(getErrorMessage(e))
      } finally {
        startingRef.current = false
        setStarting(false)
      }
    },
    [reconcile, capturing],
  )
  const stopTracking = useCallback(async () => {
    if (!selected) return
    try {
      setSessions(
        await nativeRecording('stop', { sessionId: selected.sessionId }),
      )
      await reconcile(false)
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }, [selected, reconcile])
  const setTravelMode = useCallback(
    async (mode: TravelMode) => {
      if (selected)
        setSessions(
          await nativeRecording('travelMode', {
            sessionId: selected.sessionId,
            travelMode: mode,
          }),
        )
    },
    [selected],
  )
  const notifySettingsChanged = useCallback((settings: TrackingSettings) => {
    void nativeRecording('settings', {
      wifiOnlyUpload: settings.wifiOnlyUpload,
    })
      .then(() => NativeTracking.configure(config(settings)))
      .catch((e) => setError(getErrorMessage(e)))
  }, [])
  const value: TrackingContextValue = {
    canStartRecording: !starting && !capturing,
    syncMessage:
      selected?.reason ??
      (selected?.pending
        ? 'Points saved on this device; uploads run about every 15 minutes.'
        : null),
    totalQueuedCount: selected?.totalPending ?? 0,
    retentionWarning: selected?.ageUncertain
      ? 'Age cleanup is waiting for trusted server time. The offline storage limit still applies.'
      : null,
    activeSession: selected
      ? {
          sessionId: selected.sessionId,
          tripId: selected.tripId,
          tripTitle: selected.tripTitle,
          startedAt: selected.startedAt,
          endedAt: selected.endedAt,
        }
      : null,
    status: starting
      ? 'starting'
      : selected
        ? selected.endedAt === null && !selected.terminal
          ? 'recording'
          : 'syncing'
        : 'idle',
    error:
      error ?? (engine?.stopReason === 'engine' ? engine.stopMessage : null),
    startupFeedback:
      capturing && startupSession.current === capturing.sessionId
        ? { locationFoundAt: startupConfirmedAt.current }
        : null,
    adaptiveDecision:
      capturing && engine?.adaptiveReason
        ? {
            intervalSeconds: engine.intervalSeconds,
            powerLevel: engine.powerLevel,
            reason: engine.adaptiveReason,
            distanceFilterMeters: 0,
            locationSource: 'auto',
          }
        : null,
    clockSkewNoticeSeconds: null,
    clockSkewWarningSeconds: null,
    currentTravelMode: selected?.travelMode ?? 'UNKNOWN',
    locationWarning: capturing ? (engine?.warning ?? null) : null,
    queueStats: selected
      ? {
          sampleCount: selected.pending,
          oldestSampleAt: null,
          droppedLocallyCount: selected.dropped,
          simulatedRejectedCount: selected.simulated ?? 0,
        }
      : null,
    uploaderSnapshot: selected
      ? {
          status: selected.terminal
            ? 'terminated'
            : selected.blocked
              ? 'paused-error'
              : selected.syncing
                ? 'syncing'
                : selected.reason === 'Waiting for Wi-Fi'
                  ? 'paused-wifi-required'
                  : selected.authPaused
                    ? 'paused-sign-in-required'
                    : selected.pending > 0
                      ? selected.reason
                        ? 'waiting-retry'
                        : 'waiting-batch'
                      : 'idle',
          queueDepth: selected.pending,
          lastSyncAt: selected.lastSyncAt ?? null,
          lastErrorMessage: selected.reason,
          filteredCount: selected.filtered ?? 0,
          discardedCount: selected.discarded ?? 0,
        }
      : null,
    startTracking,
    stopTracking,
    setTravelMode,
    notifySettingsChanged,
  }
  return (
    <TrackingContext.Provider value={value}>
      {children}
    </TrackingContext.Provider>
  )
}
