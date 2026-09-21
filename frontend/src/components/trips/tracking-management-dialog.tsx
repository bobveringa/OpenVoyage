import { Loader2, Play, Radio, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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
import { loadSessionPoints } from '@/tracking/session-points'
import { formatDateTime } from '@/lib/date-time'
import { isNativePlatform } from '@/native/platform'
import { describeUploaderStatus } from '@/tracking/uploader-status'
import { useTracking } from '@/tracking/use-tracking'

type TrackingManagementPanelProps = {
  accessToken: string
  canManageLiveSharing: boolean
  onTrackingChanged: () => void
  tripId: string
  tripTitle: string
}

function formatMoment(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : formatDateTime(date, { dateStyle: 'medium', timeStyle: 'short' })
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
  }, [isThisTripActive, tracking.uploaderSnapshot?.lastSyncAt])

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
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Recording</h3>

      {isOtherTripActive ? (
        <p className="text-sm text-muted-foreground">
          {activeSession?.endedAt
            ? 'Still syncing a recording from another trip on this device. Wait for it to finish before starting here.'
            : 'A recording is already in progress for another trip on this device. Stop it before starting one here.'}
        </p>
      ) : isThisTripActive && activeSession ? (
        <div className="space-y-1.5 rounded-lg border border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {activeSession.endedAt ? 'Finishing sync…' : 'Recording…'}
            </p>
            {activeSession.endedAt ? null : (
              <Button
                disabled={tracking.status === 'stopping'}
                onClick={() => void tracking.stopTracking()}
                size="sm"
                type="button"
                variant="default"
              >
                <Square className="size-4" />
                {tracking.status === 'stopping' ? 'Stopping…' : 'Stop'}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {tracking.queueStats?.sampleCount ?? 0} point
            {tracking.queueStats?.sampleCount === 1 ? '' : 's'}{' '}
            {activeSession.endedAt ? 'still syncing' : 'queued'}
            {tracking.queueStats && tracking.queueStats.droppedLocallyCount > 0
              ? ` · ${tracking.queueStats.droppedLocallyCount} dropped locally`
              : ''}
            {tracking.uploaderSnapshot
              ? ` · ${describeUploaderStatus(tracking.uploaderSnapshot.status)}`
              : ''}
          </p>
        </div>
      ) : (
        <Button
          disabled={tracking.status !== 'idle' || !currentUserId}
          onClick={() => void handleStart()}
          size="sm"
          type="button"
        >
          <Play className="size-4" />
          {tracking.status === 'starting' ? 'Starting…' : 'Start tracking'}
        </Button>
      )}

      {tracking.error ? (
        <p className="text-xs text-destructive" role="alert">
          {tracking.error}
        </p>
      ) : null}

      {isThisTripActive && tracking.clockSkewNoticeSeconds !== null ? (
        <p className="text-xs text-muted-foreground" role="status">
          Your device clock is about {tracking.clockSkewNoticeSeconds}s off from
          the server — your recording is unaffected, but you may want to fix
          your device’s date &amp; time.
        </p>
      ) : null}
    </section>
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
    setIsLoading(true)
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
      if (confirm.action === 'stop')
        await stopTrackingSession({
          accessToken,
          sessionId: confirm.id,
          tripId,
        })
      else
        await deleteTrackingSession({
          accessToken,
          sessionId: confirm.id,
          tripId,
        })
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
      {error ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {canManageLiveSharing ? (
        <div
          aria-busy={isLiveLocationPending}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-border px-4 py-3"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Radio className="size-4" />
              Share live location
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {shareLiveLocation
                ? 'Anyone who can read this trip sees the final route and its endpoint.'
                : 'Only trip members see the final route after the latest post; it is shown in the map’s member-only color. Earlier finished routes remain visible to everyone.'}
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

      {isNativePlatform() ? (
        <RecordingControl
          accessToken={accessToken}
          currentUserId={currentUser?.id ?? null}
          onSessionsChanged={() => void loadOverview()}
          onTrackingChanged={onTrackingChanged}
          tripId={tripId}
          tripTitle={tripTitle}
        />
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Recordings</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading recordings…</p>
        ) : sessions.length === 0 ? (
          <EmptyState
            description="Recordings appear here once a device has uploaded a track for this trip."
            title="No recordings yet"
          />
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                key={session.id}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => void openSession(session.id)}
                  disabled={isBusy}
                  type="button"
                >
                  <p className="text-sm font-medium text-foreground">
                    {formatMoment(session.started_at)}
                    {session.ended_at
                      ? ` – ${formatMoment(session.ended_at)}`
                      : ' – recording'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.sample_count} point
                    {session.sample_count === 1 ? '' : 's'}
                    {session.recorded_by_user_id
                      ? ''
                      : ' · recorded by a removed account'}
                  </p>
                </button>
                {!session.ended_at &&
                  (session.recorded_by_user_id === currentUser?.id ||
                    currentUser?.role === 'ADMIN') && (
                    <Button
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
                  size="sm"
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
              ? 'This ends the tracking session. Its recorded points are kept. The recording device will stop when it next connects.'
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
