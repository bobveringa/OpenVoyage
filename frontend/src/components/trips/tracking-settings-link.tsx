import { InternalLink } from '@/components/ui/internal-link'
import {
  trackingSettingsHref,
  tripTrackingReturnPath,
} from '@/tracking/settings-navigation'

export function TrackingSettingsLink({ tripId }: { tripId?: string }) {
  const returnTo = tripId ? tripTrackingReturnPath(tripId) : '/tracking/active'
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      Change recording preferences in{' '}
      <InternalLink
        href={trackingSettingsHref(returnTo)}
        navigationState={() => ({
          trackingSettingsReturnPath: returnTo,
          trackingSettingsPreviousPath:
            window.location.pathname +
            window.location.search +
            window.location.hash,
        })}
        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
      >
        GPS settings
      </InternalLink>
      .
    </p>
  )
}
