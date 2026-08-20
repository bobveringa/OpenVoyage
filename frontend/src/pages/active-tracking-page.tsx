import { CloudUpload, MapPinned, Radio, Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { TravelMode } from '@/api/client'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { describeAdaptiveReason } from '@/tracking/adaptive'
import { getTotalQueuedSampleCount, QUEUE_CAPACITY_SAMPLES } from '@/tracking/sample-queue'
import { TRAVEL_MODE_OPTIONS } from '@/tracking/travel-mode-options'
import { describeUploaderStatus } from '@/tracking/uploader-status'
import { useTracking } from '@/tracking/use-tracking'

// U3: warn once the offline queue is most of the way to the hard capacity
// cap while paused for Wi-Fi — the one eviction cause that is the user's own
// setting's fault, so it deserves a heads-up before points start dropping.
const QUEUE_WARNING_FRACTION = 0.8

type ActiveTrackingPageProps = {
  onNavigate: (to: string) => void
}

// A global, trip-independent screen: everything it shows comes from
// TrackingContext + the local queue, never a trip fetch, so it (and its
// Stop button) is reachable from anywhere in the app while fully offline —
// unlike the trip's own GPS panel, which can't render without the trip
// having loaded first.
export function ActiveTrackingPage({ onNavigate }: ActiveTrackingPageProps) {
  const tracking = useTracking()
  const { activeSession } = tracking
  const isSyncing = Boolean(activeSession?.endedAt)
  const [now, setNow] = useState(() => Date.now())
  const [totalQueuedCount, setTotalQueuedCount] = useState<number | null>(null)

  useEffect(() => {
    // Once recording has stopped, the duration is fixed — no need to keep
    // ticking, and ticking would suggest it's still recording.
    if (!activeSession || isSyncing) {
      return undefined
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeSession, isSyncing])

  const uploaderStatus = tracking.uploaderSnapshot?.status ?? null
  useEffect(() => {
    // Only worth checking while this is actually the reason nothing is
    // uploading (U3) — the cross-session total is a separate query from the
    // per-session queueStats already being refreshed elsewhere.
    if (uploaderStatus !== 'paused-wifi-required') {
      setTotalQueuedCount(null)
      return undefined
    }
    let cancelled = false
    void getTotalQueuedSampleCount().then((count) => {
      if (!cancelled) {
        setTotalQueuedCount(count)
      }
    })
    return () => {
      cancelled = true
    }
  }, [uploaderStatus, tracking.queueStats?.sampleCount])

  if (!activeSession) {
    return (
      <div className="py-8 sm:py-10">
        <EmptyState
          action={
            <Button onClick={() => onNavigate('/')} type="button" variant="outline">
              Back home
            </Button>
          }
          description="Start a recording from a trip's GPS panel to see it here."
          icon={MapPinned}
          title="Nothing is recording right now"
        />
      </div>
    )
  }

  const elapsedEndMs = activeSession.endedAt
    ? Date.parse(activeSession.endedAt)
    : now
  const elapsedMs = Math.max(0, elapsedEndMs - Date.parse(activeSession.startedAt))

  return (
    <div className="mx-auto max-w-xl space-y-6 py-8 sm:py-10">
      <div className="space-y-2 text-center">
        <span
          className={
            isSyncing
              ? 'mx-auto grid size-12 place-items-center rounded-xl bg-amber-500/10 text-amber-600'
              : 'mx-auto grid size-12 place-items-center rounded-xl bg-destructive/10 text-destructive'
          }
        >
          {isSyncing ? (
            <CloudUpload className="size-6" aria-hidden="true" />
          ) : (
            <Radio className="size-6 animate-pulse" aria-hidden="true" />
          )}
        </span>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          {isSyncing ? 'Finishing sync — ' : 'Recording '}
          {activeSession.tripTitle ?? 'a trip'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSyncing
            ? "Stopped — the points already recorded are still uploading. It's safe to leave this screen."
            : `Started ${new Date(activeSession.startedAt).toLocaleString()}`}
        </p>
      </div>

      <div className="grid gap-1 rounded-2xl border border-border bg-card px-6 py-8 text-center shadow-sm">
        <span className="text-4xl font-semibold tabular-nums tracking-tight text-foreground">
          {formatElapsed(elapsedMs)}
        </span>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {isSyncing ? 'Duration' : 'Elapsed'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label={isSyncing ? 'Points still syncing' : 'Points queued'}
          value={String(tracking.queueStats?.sampleCount ?? 0)}
        />
        <StatCard
          label="Sync status"
          value={
            tracking.uploaderSnapshot
              ? describeUploaderStatus(tracking.uploaderSnapshot.status)
              : 'starting…'
          }
        />
      </div>

      {isSyncing ? null : (
        <label className="block space-y-1.5 text-center text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Travel mode
          </span>
          <Select
            ariaLabel="Travel mode"
            onValueChange={(value) => void tracking.setTravelMode(value as TravelMode)}
            options={TRAVEL_MODE_OPTIONS}
            value={tracking.currentTravelMode}
          />
          <span className="block text-xs text-muted-foreground">
            Applies to points recorded from now on — not to points already
            queued.
          </span>
        </label>
      )}

      {!isSyncing && tracking.locationWarning ? (
        <p className="text-center text-sm font-medium text-amber-700" role="status">
          {tracking.locationWarning}
        </p>
      ) : null}

      {!isSyncing && tracking.adaptiveDecision ? (
        <p className="text-center text-xs text-muted-foreground">
          Recording {describeAdaptiveReason(tracking.adaptiveDecision)}
        </p>
      ) : null}

      {tracking.queueStats && tracking.queueStats.droppedLocallyCount > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          {tracking.queueStats.droppedLocallyCount} point
          {tracking.queueStats.droppedLocallyCount === 1 ? '' : 's'} dropped locally
          to stay inside the offline storage limit
        </p>
      ) : null}

      {tracking.queueStats && tracking.queueStats.simulatedRejectedCount > 0 ? (
        <p className="text-center text-xs font-medium text-amber-700" role="status">
          {tracking.queueStats.simulatedRejectedCount} point
          {tracking.queueStats.simulatedRejectedCount === 1 ? '' : 's'} rejected because
          {tracking.queueStats.simulatedRejectedCount === 1 ? ' it came' : ' they came'} from a
          mock-location app. Turn off mock locations to record a real track.
        </p>
      ) : null}

      {tracking.clockSkewWarningSeconds !== null ? (
        <p className="text-center text-xs font-medium text-amber-700" role="status">
          Your device clock looks about {tracking.clockSkewWarningSeconds}s off from
          the server — new points may be silently rejected. Fix your device's date
          &amp; time.
        </p>
      ) : tracking.uploaderSnapshot && tracking.uploaderSnapshot.discardedCount > 0 ? (
        <p className="text-center text-xs font-medium text-amber-700" role="status">
          {tracking.uploaderSnapshot.discardedCount} point
          {tracking.uploaderSnapshot.discardedCount === 1 ? ' was' : 's were'} rejected by the
          server, usually because this device's clock is off. Check date &amp; time.
        </p>
      ) : null}

      {tracking.uploaderSnapshot?.status === 'paused-wifi-required' &&
      totalQueuedCount !== null &&
      totalQueuedCount > QUEUE_CAPACITY_SAMPLES * QUEUE_WARNING_FRACTION ? (
        <p className="text-center text-xs font-medium text-amber-700" role="status">
          The offline queue is {Math.round((totalQueuedCount / QUEUE_CAPACITY_SAMPLES) * 100)}%
          full while waiting for Wi-Fi — connect to Wi-Fi soon or older points will
          start being dropped.
        </p>
      ) : null}

      {tracking.uploaderSnapshot && tracking.uploaderSnapshot.filteredCount > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          {tracking.uploaderSnapshot.filteredCount} point
          {tracking.uploaderSnapshot.filteredCount === 1 ? '' : 's'} fell inside one of your
          privacy zones and {tracking.uploaderSnapshot.filteredCount === 1 ? 'was' : 'were'} not
          stored.
        </p>
      ) : null}

      {tracking.error ? (
        <p className="text-center text-sm font-medium text-destructive" role="alert">
          {tracking.error}
        </p>
      ) : null}

      <div className="grid gap-3">
        {isSyncing ? null : (
          <Button
            disabled={tracking.status === 'stopping'}
            onClick={() => void tracking.stopTracking()}
            size="lg"
            type="button"
            variant="destructive"
          >
            <Square className="size-4" aria-hidden="true" />
            {tracking.status === 'stopping' ? 'Stopping…' : 'Stop tracking'}
          </Button>
        )}
        <Button
          onClick={() => onNavigate(`/trips/${encodeURIComponent(activeSession.tripId)}`)}
          type="button"
          variant="outline"
        >
          View trip
        </Button>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-border bg-card px-4 py-3 text-center shadow-sm">
      <span className="truncate text-lg font-semibold text-foreground">{value}</span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
