import {
  ChevronRight,
  Clock3,
  CloudUpload,
  Loader2,
  MapPinned,
  Radio,
  Route,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react'
import { useCallback, useContext, useEffect, useState } from 'react'

import {
  deleteTrackingSession,
  stopTrackingSession,
  getErrorMessage,
  getTripLiveLocationSettings,
  listTrackingSessions,
  replaceTripLiveLocationSettings,
  type TrackSample,
  type TrackingSession,
} from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TrackingConfirmation } from '@/components/ui/tracking-confirmation'
import { TrackingSessionDetail } from './tracking-session-detail'
import { TrackingReady, TrackingRecorder } from './tracking-recorder'
import { TrackingHealth } from './tracking-health'
import { TrackingSettingsLink } from './tracking-settings-link'
import { loadSessionPoints } from '@/tracking/session-points'
import { formatDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { isNativePlatform } from '@/native/platform'
import { useTracking } from '@/tracking/use-tracking'
import { TrackingContext } from '@/tracking/tracking-context'

type TrackingManagementPanelProps = {
  accessToken: string
  canManageLiveSharing: boolean
  onTrackingChanged: () => void
  tripId: string
  tripTitle: string
}

function RecordingBadge({
  saved,
  syncing,
}: {
  saved: boolean
  syncing: boolean
}) {
  const Icon = saved ? Clock3 : syncing ? CloudUpload : Radio
  return (
    <span
      className={cn(
        'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        saved
          ? 'bg-muted text-muted-foreground'
          : syncing
            ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
            : 'bg-primary/10 text-primary',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {saved ? 'Saved' : syncing ? 'Syncing' : 'Recording'}
    </span>
  )
}

function RecordingControl({
  accessToken,
  currentUserId,
  onSessionsChanged,
  onTrackingChanged,
  tripId,
  tripTitle,
}: {
  accessToken: string
  currentUserId: string | null
  onSessionsChanged: () => void
  onTrackingChanged: () => void
  tripId: string
  tripTitle: string
}) {
  const tracking = useTracking()
  const activeSession = tracking.activeSession
  const isThisTripActive = activeSession?.tripId === tripId
  const isOtherTripActive =
    activeSession !== null && activeSession?.tripId !== tripId

  // The session list (below `onSessionsChanged`) and the trip's public map
  // (`onTrackingChanged`) both only reflect server state, so both need a
  // refetch once a recording starts/stops locally and again once the
  // uploader actually finishes syncing it (the end PATCH is asynchronous).
  useEffect(() => {
    onSessionsChanged()
    onTrackingChanged()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isThisTripActive,
    activeSession?.endedAt,
    tracking.uploaderSnapshot?.lastSyncAt,
  ])

  const handleStart = async () => {
    if (!currentUserId) {
      return
    }
    await tracking.startTracking({
      accessToken,
      currentUserId,
      tripId,
      tripTitle,
    })
  }

  return (
    <div className="space-y-3">
      {isOtherTripActive ? (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CloudUpload className="size-4" aria-hidden="true" />
            {activeSession?.endedAt
              ? 'Another trip is finishing sync'
              : 'Another trip is recording'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {activeSession?.tripTitle ?? 'Another trip'} is using tracking on
            this device.{' '}
            {activeSession?.endedAt
              ? 'Wait for its points to sync before starting here.'
              : 'Open the active recording to stop it before starting here.'}
          </p>
          <a
            className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4"
            href="/tracking/active"
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.altKey
              )
                return
              event.preventDefault()
              // Use the app's popstate listener to keep this reachable offline,
              // without reloading auth or fetching the trip first.
              window.history.pushState(null, '', '/tracking/active')
              window.dispatchEvent(new PopStateEvent('popstate'))
            }}
          >
            View active recording
            <ChevronRight className="size-4" aria-hidden="true" />
          </a>
        </div>
      ) : isThisTripActive ? (
        <TrackingRecorder compact />
      ) : (
        <TrackingReady
          disabled={tracking.status !== 'idle' || !currentUserId}
          starting={tracking.status === 'starting'}
          onStart={() => void handleStart()}
        />
      )}
      {!isOtherTripActive && <TrackingHealth />}
      <TrackingSettingsLink tripId={tripId} />
    </div>
  )
}

export function TrackingManagementPanel({
  accessToken,
  canManageLiveSharing,
  onTrackingChanged,
  tripId,
  tripTitle,
}: TrackingManagementPanelProps) {
  const { currentUser } = useAuth()
  const tracking = useContext(TrackingContext)
  const localSession = tracking?.activeSession
  const native = isNativePlatform()
  const [view, setView] = useState<'tracking' | 'recordings'>('tracking')
  const [sessions, setSessions] = useState<readonly TrackingSession[]>([])
  const [shareLiveLocation, setShareLiveLocation] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [points, setPoints] = useState<Record<string, readonly TrackSample[]>>(
    {},
  )
  const [confirm, setConfirm] = useState<{
    id: string
    action: 'stop' | 'delete'
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [isUpdatingLiveSharing, setIsUpdatingLiveSharing] = useState(false)

  const loadOverview = useCallback(async () => {
    try {
      const [loadedSessions, settings] = await Promise.all([
        listTrackingSessions({ accessToken, tripId }),
        getTripLiveLocationSettings({ accessToken, tripId }),
      ])
      setSessions(loadedSessions)
      setShareLiveLocation(settings.share_live_location)
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [accessToken, tripId])

  useEffect(() => {
    setSelectedSessionId(null)
    void loadOverview()
  }, [loadOverview])

  const handleToggleLiveSharing = async () => {
    if (isBusy || isLoading || isUpdatingLiveSharing) {
      return
    }

    const previousValue = shareLiveLocation
    const nextValue = !previousValue
    setShareLiveLocation(nextValue)
    setIsUpdatingLiveSharing(true)
    setIsBusy(true)
    try {
      const settings = await replaceTripLiveLocationSettings({
        accessToken,
        shareLiveLocation: nextValue,
        tripId,
      })
      setShareLiveLocation(settings.share_live_location)
      setError(null)
      onTrackingChanged()
    } catch (toggleError) {
      setShareLiveLocation(previousValue)
      setError(getErrorMessage(toggleError))
    } finally {
      setIsBusy(false)
      setIsUpdatingLiveSharing(false)
    }
  }

  const handleConfirmedAction = async () => {
    if (!confirm) return
    setIsBusy(true)
    try {
      if (confirm.action === 'stop') {
        if (localSession?.sessionId === confirm.id && tracking) {
          await tracking.stopTracking()
        } else {
          await stopTrackingSession({
            accessToken,
            sessionId: confirm.id,
            tripId,
          })
        }
      } else {
        await deleteTrackingSession({
          accessToken,
          sessionId: confirm.id,
          tripId,
        })
      }
      setConfirm(null)
      await loadOverview()
      onTrackingChanged()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setIsBusy(false)
    }
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!selectedSessionId && !isBusy) void loadOverview()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [loadOverview, selectedSessionId, isBusy])
  const openSession = async (id: string) => {
    setIsBusy(true)
    try {
      const loaded = await loadSessionPoints({
        accessToken,
        tripId,
        sessionId: id,
      })
      setPoints({ [id]: loaded })
      setSelectedSessionId(id)
      setError(null)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setIsBusy(false)
    }
  }
  const selectedSession = sessions.find((s) => s.id === selectedSessionId)

  const isLiveLocationPending = isLoading || isUpdatingLiveSharing

  if (selectedSession && points[selectedSession.id]) {
    return (
      <TrackingSessionDetail
        key={selectedSession.id}
        accessToken={accessToken}
        tripId={tripId}
        session={selectedSession}
        initial={points[selectedSession.id]}
        sessions={sessions}
        onBack={() => setSelectedSessionId(null)}
        onSaved={async () => {
          await loadOverview()
          onTrackingChanged()
        }}
      />
    )
  }

  return (
    <div className="space-y-5">
      {native && (
        <div
          className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
          role="group"
          aria-label="GPS views"
        >
          {(['tracking', 'recordings'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {value === 'tracking' ? 'Tracking' : 'Recordings'}
              {value === 'recordings' && (
                <span className="rounded-full bg-muted px-1.5 text-xs">
                  {sessions.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {native ? (
        <div hidden={view !== 'tracking'}>
          <RecordingControl
            accessToken={accessToken}
            currentUserId={currentUser?.id ?? null}
            onSessionsChanged={() => void loadOverview()}
            onTrackingChanged={onTrackingChanged}
            tripId={tripId}
            tripTitle={tripTitle}
          />
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4">
          <MapPinned
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-sm font-semibold">Your recorded routes</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Record a route with the OpenVoyage Android app. You can review and
              edit your recordings here.
            </p>
          </div>
        </div>
      )}
      {error ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {canManageLiveSharing && (!native || view === 'tracking') ? (
        <div
          aria-busy={isLiveLocationPending}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t border-border py-4"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Share live location
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {shareLiveLocation
                ? 'On · Anyone who can read this trip can see the latest route and endpoint.'
                : 'Off · The route after your latest post is visible to trip members only. Earlier finished routes remain visible to everyone.'}
            </p>
          </div>
          {isLiveLocationPending ? (
            <span
              aria-label={
                isLoading
                  ? 'Loading live location setting'
                  : 'Updating live location setting'
              }
              className="mt-0.5 grid h-7 w-12 place-items-center rounded-full border border-input bg-muted text-muted-foreground"
              role="status"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            </span>
          ) : (
            <>
              <input
                aria-label="Share live location"
                checked={shareLiveLocation}
                className="peer sr-only"
                disabled={isBusy}
                id="share-live-location"
                onChange={() => void handleToggleLiveSharing()}
                role="switch"
                type="checkbox"
              />
              <label
                className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border p-0.5 transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:cursor-not-allowed peer-disabled:opacity-50 ${
                  shareLiveLocation
                    ? 'border-primary bg-primary'
                    : 'border-input bg-muted'
                }`}
                htmlFor="share-live-location"
              >
                <span
                  className={`size-5 rounded-full bg-card shadow-sm transition-transform ${
                    shareLiveLocation ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
                <span className="sr-only">
                  {shareLiveLocation
                    ? 'Live location sharing is on'
                    : 'Live location sharing is off'}
                </span>
              </label>
            </>
          )}
        </div>
      ) : null}

      <section
        hidden={native && view !== 'recordings'}
        className="space-y-3"
        aria-label="Saved recordings"
      >
        {!native && (
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-foreground">
              Recordings
            </h3>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {sessions.length}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Open a recording to review its route or edit points.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading recordings…</p>
        ) : sessions.length === 0 ? (
          <EmptyState
            description="Start tracking in the Android app. Your saved routes will appear here."
            icon={Route}
            title="No recordings yet"
          />
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((session) => (
              <li
                className="flex flex-wrap items-center gap-2 rounded-xl px-1 py-3 transition-colors hover:bg-muted/40"
                key={session.id}
              >
                <button
                  className="group flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 text-left"
                  onClick={() => void openSession(session.id)}
                  disabled={isBusy}
                  type="button"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/5 text-primary">
                    <Route className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {formatDateTime(new Date(session.started_at), {
                        dateStyle: 'medium',
                      })}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {formatDateTime(new Date(session.started_at), {
                          timeStyle: 'short',
                        })}
                        {session.ended_at
                          ? ` – ${formatDateTime(new Date(session.ended_at), { timeStyle: 'short' })}`
                          : ''}
                      </span>
                      <span>
                        · {session.sample_count} point
                        {session.sample_count === 1 ? '' : 's'}
                      </span>
                      {session.recorded_by_user_id ? null : (
                        <span>· removed account</span>
                      )}
                    </p>
                    <RecordingBadge
                      saved={Boolean(session.ended_at)}
                      syncing={
                        localSession?.sessionId === session.id &&
                        Boolean(localSession.endedAt)
                      }
                    />
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground group-hover:text-primary"
                    aria-hidden="true"
                  />
                </button>
                {!session.ended_at &&
                  !(
                    localSession?.sessionId === session.id &&
                    localSession.endedAt
                  ) &&
                  (session.recorded_by_user_id === currentUser?.id ||
                    currentUser?.role === 'ADMIN') && (
                    <Button
                      className="min-h-11"
                      disabled={isBusy}
                      variant="outline"
                      onClick={() =>
                        setConfirm({ id: session.id, action: 'stop' })
                      }
                    >
                      <Square className="size-4" />
                      Stop
                    </Button>
                  )}
                <Button
                  aria-label="Delete recording"
                  disabled={isBusy}
                  onClick={() =>
                    setConfirm({ id: session.id, action: 'delete' })
                  }
                  size="icon"
                  className="size-11 text-muted-foreground hover:text-destructive"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirm && (
        <TrackingConfirmation
          title={
            confirm.action === 'stop' ? 'Stop recording?' : 'Delete recording?'
          }
          description={
            confirm.action === 'stop'
              ? localSession?.sessionId === confirm.id
                ? 'This stops recording on this device. Your points are kept and will sync when connected.'
                : 'This ends the tracking session. Its recorded points are kept. The recording device will stop when it next connects.'
              : 'Every point will be permanently removed. This cannot be undone.'
          }
          confirmLabel={
            confirm.action === 'stop' ? 'Stop recording' : 'Delete recording'
          }
          destructive={confirm.action === 'delete'}
          busy={isBusy}
          error={error}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void handleConfirmedAction()}
        />
      )}
    </div>
  )
}
