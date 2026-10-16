import { ArrowLeft, MapPinned } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { TrackingRecorder } from '@/components/trips/tracking-recorder'
import { TrackingHealth } from '@/components/trips/tracking-health'
import { TrackingSettingsLink } from '@/components/trips/tracking-settings-link'
import { useTracking } from '@/tracking/use-tracking'

// This screen stays trip-independent so Stop is always reachable offline.
export function ActiveTrackingPage({
  onNavigate,
}: {
  onNavigate: (to: string) => void
}) {
  const { activeSession } = useTracking()
  if (!activeSession) {
    return (
      <div className="py-8">
        <EmptyState
          icon={MapPinned}
          title="You're all set"
          description="No recording is running. Open a trip to start a new route."
          action={
            <Button onClick={() => onNavigate('/')} variant="outline">
              Back home
            </Button>
          }
        />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-xl space-y-4 py-5 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">GPS tracking</h1>
        <Button
          variant="ghost"
          onClick={() =>
            onNavigate(`/trips/${encodeURIComponent(activeSession.tripId)}`)
          }
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          View trip
        </Button>
      </div>
      <TrackingRecorder />
      <TrackingHealth />
      <TrackingSettingsLink />
    </div>
  )
}
