import { Loader2, Play, Radio, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  deleteTrackSamples,
  deleteTrackingSession,
  getErrorMessage,
  getTripLiveLocationSettings,
  listTrackSamples,
  listTrackingSessions,
  replaceTripLiveLocationSettings,
  updateTrackSampleModes,
  type TrackSample,
  type TrackingSession,
  type TravelMode,
} from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { TRAVEL_MODE_OPTIONS } from '@/tracking/travel-mode-options'
import { describeUploaderStatus } from '@/tracking/uploader-status'
import { useTracking } from '@/tracking/use-tracking'

const SAMPLE_PAGE_SIZE = 500

type TrackingManagementPanelProps = {
  accessToken: string
  canManageLiveSharing: boolean
  onTrackingChanged: () => void
  tripId: string
  tripTitle: string
}

function formatMoment(value: string) {
  return new Date(value).toLocaleString()
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
  const isOtherTripActive = activeSession !== null && activeSession?.tripId !== tripId
  // U1: startTracking can't render its own confirmation UI, so it hands
  // back the skew and this component shows the dialog and re-enters with
  // acknowledgeClockSkew: true if the user wants to proceed anyway.
  const [clockSkewConfirm, setClockSkewConfirm] = useState<{
    skewSeconds: number
  } | null>(null)

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
    const outcome = await tracking.startTracking({
      accessToken,
      currentUserId,
      tripId,
      tripTitle,
    })
    if (outcome.kind === 'clock-skew-confirmation-required') {
      setClockSkewConfirm({ skewSeconds: outcome.skewSeconds })
    }
  }

  const handleConfirmStartAnyway = async () => {
    setClockSkewConfirm(null)
    if (!currentUserId) {
      return
    }
    await tracking.startTracking({
      accessToken,
      acknowledgeClockSkew: true,
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
                variant="destructive"
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

      <Modal
        onClose={() => setClockSkewConfirm(null)}
        open={clockSkewConfirm !== null}
        title="Device clock looks off"
      >
        <div className="space-y-4 p-2 text-sm">
          <p className="leading-6 text-foreground">
            Your device clock looks like it is off by about{' '}
            {clockSkewConfirm?.skewSeconds ?? 0} seconds from the server. Points
            recorded while your clock is this far off can be silently
            rejected.
          </p>
          <p className="leading-6 text-muted-foreground">
            Fix your device’s date &amp; time for reliable results. Start
            anyway?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setClockSkewConfirm(null)}
              size="sm"
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button onClick={() => void handleConfirmStartAnyway()} size="sm" type="button">
              Start anyway
            </Button>
          </div>
        </div>
      </Modal>
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [samples, setSamples] = useState<readonly TrackSample[]>([])
  const [selectedSampleIds, setSelectedSampleIds] = useState<readonly string[]>([])
  const [bulkMode, setBulkMode] = useState<TravelMode>('WALK')
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
    setSamples([])
    setSelectedSampleIds([])
    void loadOverview()
  }, [loadOverview])

  const loadSamples = useCallback(
    async (sessionId: string) => {
      setIsBusy(true)
      try {
        // Keyset pages, walked to the end: the editor works on the whole
        // recording rather than an arbitrary first page.
        const collected: TrackSample[] = []
        let cursor: string | null = null
        do {
          const page = await listTrackSamples({
            accessToken,
            cursor,
            limit: SAMPLE_PAGE_SIZE,
            sessionId,
            tripId,
          })
          collected.push(...page.items)
          cursor = page.next_cursor
        } while (cursor)

        setSamples(collected)
        setSelectedSampleIds([])
        setError(null)
      } catch (loadError) {
        setError(getErrorMessage(loadError))
      } finally {
        setIsBusy(false)
      }
    },
    [accessToken, tripId],
  )

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId)
    void loadSamples(sessionId)
  }

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

  const handleDeleteSession = async (sessionId: string) => {
    const confirmed = window.confirm(
      'Delete this recording? Every point in it is permanently removed and the ' +
        'map falls back to a straight line across that time. This cannot be undone.',
    )
    if (!confirmed) {
      return
    }

    setIsBusy(true)
    try {
      await deleteTrackingSession({ accessToken, sessionId, tripId })
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null)
        setSamples([])
      }
      await loadOverview()
      onTrackingChanged()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    } finally {
      setIsBusy(false)
    }
  }

  const handleApplyMode = async () => {
    if (selectedSampleIds.length === 0) {
      return
    }

    setIsBusy(true)
    try {
      await updateTrackSampleModes({
        accessToken,
        sampleIds: [...selectedSampleIds],
        travelMode: bulkMode,
        tripId,
      })
      if (selectedSessionId) {
        await loadSamples(selectedSessionId)
      }
      onTrackingChanged()
    } catch (updateError) {
      setError(getErrorMessage(updateError))
    } finally {
      setIsBusy(false)
    }
  }

  const handleDeleteSamples = async () => {
    if (selectedSampleIds.length === 0) {
      return
    }
    const confirmed = window.confirm(
      `Delete ${selectedSampleIds.length} point(s)? This is permanent and the ` +
        'map will connect the surrounding points directly.',
    )
    if (!confirmed) {
      return
    }

    setIsBusy(true)
    try {
      await deleteTrackSamples({
        accessToken,
        sampleIds: [...selectedSampleIds],
        tripId,
      })
      if (selectedSessionId) {
        await loadSamples(selectedSessionId)
      }
      await loadOverview()
      onTrackingChanged()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    } finally {
      setIsBusy(false)
    }
  }

  const toggleSample = (sampleId: string) => {
    setSelectedSampleIds((current) =>
      current.includes(sampleId)
        ? current.filter((id) => id !== sampleId)
        : [...current, sampleId],
    )
  }

  const isLiveLocationPending = isLoading || isUpdatingLiveSharing

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
                    {shareLiveLocation ? 'Live location sharing is on' : 'Live location sharing is off'}
                  </span>
                </label>
              </>
            )}
          </div>
        ) : null}

        <RecordingControl
          accessToken={accessToken}
          currentUserId={currentUser?.id ?? null}
          onSessionsChanged={() => void loadOverview()}
          onTrackingChanged={onTrackingChanged}
          tripId={tripId}
          tripTitle={tripTitle}
        />

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
                    onClick={() => handleSelectSession(session.id)}
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
                  <Button
                    aria-label="Delete recording"
                    disabled={isBusy}
                    onClick={() => void handleDeleteSession(session.id)}
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

        {selectedSessionId ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              Points ({samples.length})
            </h3>

            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">
                  Set mode for selection
                </span>
                <Select
                  ariaLabel="Travel mode"
                  onValueChange={(value) => setBulkMode(value as TravelMode)}
                  options={TRAVEL_MODE_OPTIONS}
                  value={bulkMode}
                />
              </label>
              <Button
                disabled={isBusy || selectedSampleIds.length === 0}
                onClick={() => void handleApplyMode()}
                size="sm"
                type="button"
              >
                Apply to {selectedSampleIds.length}
              </Button>
              <Button
                disabled={isBusy || selectedSampleIds.length === 0}
                onClick={() => void handleDeleteSamples()}
                size="sm"
                type="button"
                variant="destructive"
              >
                Delete {selectedSampleIds.length}
              </Button>
            </div>

            <p className="text-xs leading-5 text-muted-foreground">
              A point&apos;s mode describes the movement that arrived at it, so
              select the points you travelled <em>to</em> by the mode you are
              setting.
            </p>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <ul className="divide-y divide-border">
                {samples.map((sample) => (
                  <li key={sample.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-muted">
                      <input
                        checked={selectedSampleIds.includes(sample.id)}
                        onChange={() => toggleSample(sample.id)}
                        type="checkbox"
                      />
                      <span className="tabular-nums text-muted-foreground">
                        {formatMoment(sample.recorded_at)}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {sample.latitude.toFixed(5)},{' '}
                        {sample.longitude.toFixed(5)}
                      </span>
                      <span className="ml-auto font-medium text-foreground">
                        {sample.travel_mode}
                      </span>
                      <span className="text-muted-foreground">
                        {sample.accuracy_meters === null
                          ? 'accuracy unknown'
                          : `±${Math.round(sample.accuracy_meters)} m`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
    </div>
  )
}
