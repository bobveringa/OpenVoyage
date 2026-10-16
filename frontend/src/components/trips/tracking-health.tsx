import { useEffect, useState } from 'react'

import { TrackingDetails } from '@/components/trips/tracking-recorder'
import { describeAdaptiveReason } from '@/tracking/adaptive'
import {
  getTotalQueuedSampleCount,
  QUEUE_CAPACITY_SAMPLES,
} from '@/tracking/sample-queue'
import { useTracking } from '@/tracking/use-tracking'

const QUEUE_WARNING_FRACTION = 0.8

export function TrackingHealth() {
  const tracking = useTracking()
  const isSyncing = Boolean(tracking.activeSession?.endedAt)
  const [totalQueuedCount, setTotalQueuedCount] = useState<number | null>(null)
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
  return (
    <div className="space-y-3">
      {!isSyncing && tracking.locationWarning ? (
        <p
          className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-5 text-amber-800 dark:text-amber-300"
          role="status"
        >
          {tracking.locationWarning}
        </p>
      ) : null}
      {tracking.queueStats && tracking.queueStats.simulatedRejectedCount > 0 ? (
        <p
          className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-300"
          role="status"
        >
          {tracking.queueStats.simulatedRejectedCount} point
          {tracking.queueStats.simulatedRejectedCount === 1 ? '' : 's'} rejected
          because
          {tracking.queueStats.simulatedRejectedCount === 1
            ? ' it came'
            : ' they came'}{' '}
          from a mock-location app. Turn off mock locations to record a real
          track.
        </p>
      ) : null}
      {tracking.clockSkewWarningSeconds !== null ? (
        <p
          className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-300"
          role="status"
        >
          Points are still being rejected by the server even after correcting
          for the device clock (about {tracking.clockSkewWarningSeconds}s of
          residual skew) — check your device's date &amp; time.
        </p>
      ) : tracking.uploaderSnapshot &&
        tracking.uploaderSnapshot.discardedCount > 0 ? (
        <p
          className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-300"
          role="status"
        >
          {tracking.uploaderSnapshot.discardedCount} point
          {tracking.uploaderSnapshot.discardedCount === 1
            ? ' was'
            : 's were'}{' '}
          rejected by the server despite clock correction. Check your device's
          date &amp; time.
        </p>
      ) : !isSyncing && tracking.clockSkewNoticeSeconds !== null ? (
        <p className="text-xs leading-5 text-muted-foreground" role="status">
          Your device clock is about {tracking.clockSkewNoticeSeconds}s off from
          the server — your recording is unaffected, but you may want to fix
          your device's date &amp; time.
        </p>
      ) : null}
      {tracking.uploaderSnapshot?.status === 'paused-wifi-required' &&
      totalQueuedCount !== null &&
      totalQueuedCount > QUEUE_CAPACITY_SAMPLES * QUEUE_WARNING_FRACTION ? (
        <p
          className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-300"
          role="status"
        >
          The offline queue is{' '}
          {Math.round((totalQueuedCount / QUEUE_CAPACITY_SAMPLES) * 100)}% full
          while waiting for Wi-Fi — connect to Wi-Fi soon or older points will
          start being dropped.
        </p>
      ) : null}
      {tracking.error ? (
        <p
          className="rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {tracking.error}
        </p>
      ) : null}
      {tracking.queueStats && tracking.queueStats.droppedLocallyCount > 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {tracking.queueStats.droppedLocallyCount} point
          {tracking.queueStats.droppedLocallyCount === 1 ? '' : 's'} dropped
          locally to stay inside the offline storage limit
        </p>
      ) : null}
      {tracking.activeSession &&
      ((!isSyncing && tracking.adaptiveDecision) ||
        (tracking.uploaderSnapshot?.filteredCount ?? 0) > 0) ? (
        <TrackingDetails title="Recording details">
          {!isSyncing && tracking.adaptiveDecision ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Recording {describeAdaptiveReason(tracking.adaptiveDecision)}
            </p>
          ) : null}
          {tracking.uploaderSnapshot &&
          tracking.uploaderSnapshot.filteredCount > 0 ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {tracking.uploaderSnapshot.filteredCount} point
              {tracking.uploaderSnapshot.filteredCount === 1 ? '' : 's'} fell
              inside one of your privacy zones and{' '}
              {tracking.uploaderSnapshot.filteredCount === 1 ? 'was' : 'were'}{' '}
              not stored.
            </p>
          ) : null}
        </TrackingDetails>
      ) : null}
    </div>
  )
}
