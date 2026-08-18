import { CloudUpload, MapPinned, Radio, Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { describeAdaptiveReason } from '@/tracking/adaptive'
import { EmptyState } from '@/components/ui/empty-state'
import { describeUploaderStatus } from '@/tracking/uploader-status'
import { useTracking } from '@/tracking/use-tracking'

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

  useEffect(() => {
    // Once recording has stopped, the duration is fixed — no need to keep
    // ticking, and ticking would suggest it's still recording.
    if (!activeSession || isSyncing) {
      return undefined
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeSession, isSyncing])

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
