import {
  Check,
  ChevronDown,
  CloudUpload,
  LoaderCircle,
  Navigation,
  Radio,
  Square,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { TravelMode } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { TRAVEL_MODE_OPTIONS } from '@/tracking/travel-mode-options'
import { describeUploaderStatus } from '@/tracking/uploader-status'
import { useTracking } from '@/tracking/use-tracking'

export function TrackingTravelMode() {
  const tracking = useTracking()
  const [changing, setChanging] = useState(false)
  async function changeMode(mode: TravelMode) {
    setChanging(true)
    try {
      await tracking.setTravelMode(mode)
    } finally {
      setChanging(false)
    }
  }
  const disabled = changing || tracking.status !== 'recording'
  return (
    <section className="space-y-2" aria-label="Travel mode">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Travel mode</h3>
        <span className="text-xs text-muted-foreground">For new points</span>
      </div>
      <Select
        ariaLabel="Travel mode"
        disabled={disabled}
        value={tracking.currentTravelMode}
        options={TRAVEL_MODE_OPTIONS}
        onValueChange={(value) => void changeMode(value)}
      />
    </section>
  )
}

export function TrackingRecorder({ compact = false }: { compact?: boolean }) {
  const tracking = useTracking()
  const { activeSession } = tracking
  const [now, setNow] = useState(Date.now)
  const isSyncing = Boolean(activeSession?.endedAt) || tracking.status === 'syncing'
  const startup = tracking.startupFeedback
  const locationFoundAt = startup?.locationFoundAt ?? null
  const locationFound = locationFoundAt !== null
  // Use the first fix's timestamp so changing screens cannot restart the
  // confirmation. The recording timer already refreshes this every second.
  const showStartupFeedback = startup && !isSyncing && (
    locationFoundAt !== null
      ? now < locationFoundAt + 5_000
      : !tracking.error && !tracking.locationWarning
  )
  useEffect(() => {
    if (!activeSession || isSyncing) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeSession, isSyncing])
  if (!activeSession) return null
  const elapsed = Math.max(
    0,
    (activeSession.endedAt ? Date.parse(activeSession.endedAt) : now) -
      Date.parse(activeSession.startedAt),
  )
  const queued =
    tracking.queueStats?.sampleCount ??
    tracking.uploaderSnapshot?.queueDepth ??
    0
  const upload = tracking.uploaderSnapshot?.status
  const syncMessage = tracking.syncMessage ?? (
    upload === 'paused-wifi-required'
      ? 'Waiting for Wi-Fi. Your points are saved on this device.'
      : upload === 'waiting-retry'
        ? 'Waiting to reconnect. Your points are saved on this device.'
        : upload?.startsWith('paused-')
          ? describeUploaderStatus(upload)
          : queued > 0
            ? `${queued} point${queued === 1 ? '' : 's'} waiting to sync`
            : upload === 'idle'
              ? 'All recorded points synced'
              : 'Preparing sync…')
  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      aria-label={isSyncing ? 'Recording stopped' : 'Current recording'}
    >
      <div
        className={cn(
          'border-b border-border bg-primary/5',
          compact ? 'p-4' : 'p-5 sm:p-6',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-2 text-xs font-semibold',
              isSyncing ? 'text-amber-700 dark:text-amber-400' : 'text-primary',
            )}
          >
            {isSyncing ? (
              <CloudUpload className="size-4" aria-hidden="true" />
            ) : (
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-primary opacity-40 motion-safe:animate-ping" />
                <span className="relative size-2 rounded-full bg-primary" />
              </span>
            )}
            {isSyncing ? 'RECORDING STOPPED' : 'RECORDING LIVE'}
          </span>
          <Navigation className="size-5 text-primary/60" aria-hidden="true" />
        </div>
        {!compact && (
          <p className="mt-4 break-words text-lg font-semibold">
            {activeSession.tripTitle ?? 'Your trip'}
          </p>
        )}
        <div
          className={cn('flex items-baseline gap-3', compact ? 'mt-3' : 'mt-5')}
        >
          <span
            className={cn(
              'font-semibold tabular-nums tracking-tight',
              compact ? 'text-4xl' : 'text-5xl',
            )}
            aria-label={isSyncing ? 'Recording duration' : 'Elapsed time'}
          >
            {isSyncing && !activeSession.endedAt ? '—' : formatElapsed(elapsed)}
          </span>
          <span className="text-xs text-muted-foreground">
            {isSyncing ? 'duration' : 'elapsed'}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Started{' '}
          {formatDateTime(new Date(activeSession.startedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      </div>
      <div className={cn('space-y-5', compact ? 'p-4' : 'p-5 sm:p-6')}>
        {showStartupFeedback && (
          <div className="flex items-start gap-3" role="status">
            {locationFound ? (
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <LoaderCircle className="mt-0.5 size-4 shrink-0 text-primary motion-safe:animate-spin" aria-hidden="true" />
            )}
            <div>
              <p className="text-sm font-medium">
                {locationFound ? 'Tracking started · location found' : 'Getting your location…'}
              </p>
              {!locationFound && (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  This may take longer indoors.
                </p>
              )}
            </div>
          </div>
        )}
        <div className="flex items-start gap-3" role="status">
          {upload === 'idle' && queued === 0 ? (
            <Check
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          ) : (
            <CloudUpload
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">{syncMessage}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {isSyncing
                ? 'Your recording has ended. You can leave while the remaining points sync.'
                : 'Keeps recording with the app in the background.'}
            </p>
            {tracking.uploaderSnapshot?.lastSyncAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Last synced {formatDateTime(new Date(tracking.uploaderSnapshot.lastSyncAt), { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            ) : null}
          </div>
        </div>
        {!isSyncing && <TrackingTravelMode />}
        {!isSyncing && (
          <Button
            className="h-12 w-full text-destructive"
            variant="outline"
            disabled={tracking.status === 'stopping'}
            onClick={() => void tracking.stopTracking()}
          >
            <Square className="size-4 fill-current" aria-hidden="true" />
            {tracking.status === 'stopping' ? 'Stopping…' : 'Stop tracking'}
          </Button>
        )}
      </div>
    </section>
  )
}

export function TrackingDetails({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-1 py-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 border-t border-border px-1 py-3">
        {children}
      </div>
    </details>
  )
}

export function TrackingReady({
  onStart,
  disabled,
  starting,
}: {
  onStart: () => void
  disabled: boolean
  starting: boolean
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Navigation className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-lg font-semibold">Ready to record</h3>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            GPS records your route in the background.
          </p>
        </div>
      </div>
      <Button
        className="mt-5 h-12 w-full"
        disabled={disabled}
        onClick={onStart}
      >
        <Radio className="size-4" aria-hidden="true" />
        {starting ? 'Starting…' : 'Start tracking'}
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Records offline. Start online to enable background uploads; reopen online if upload authorization expires.
      </p>
    </section>
  )
}

function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  return `${hours > 0 ? `${hours}:` : ''}${hours > 0 ? String(minutes).padStart(2, '0') : minutes}:${String(seconds % 60).padStart(2, '0')}`
}
