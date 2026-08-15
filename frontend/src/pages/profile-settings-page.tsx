import { UserCog } from 'lucide-react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { GpsPrivacyZonesForm } from '@/components/users/gps-privacy-zones-form'
import { ProfileDetailsForm } from '@/components/users/profile-details-form'
import { Button } from '@/components/ui/button'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { getUserUsername } from '@/lib/users'

type ProfileSettingsPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  onNavigate: (to: string) => void
  onProfileUpdated: (user: CurrentUser) => void
}

export function ProfileSettingsPage({
  accessToken,
  authStatus,
  currentUser,
  onNavigate,
  onProfileUpdated,
}: ProfileSettingsPageProps) {
  if (authStatus === 'loading') {
    return <LoadingState label="Loading profile" />
  }

  if (!accessToken || !currentUser) {
    return (
      <div className="py-8 sm:py-10">
        <EmptyState
          action={
            <Button onClick={() => onNavigate('/login')} type="button">
              Sign in
            </Button>
          }
          description="You need to be signed in before you can update profile details."
          icon={UserCog}
          title="Sign in required"
        />
      </div>
    )
  }

  const username = getUserUsername(currentUser)

  return (
    <div className="space-y-6 py-6 sm:py-8 lg:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Account
          </p>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-normal text-foreground">
              Profile settings
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Update the details people see when they open your trip overview.
            </p>
          </div>
        </div>
        {username ? (
          <Button
            onClick={() => onNavigate(`/users/${encodeURIComponent(username)}`)}
            type="button"
            variant="outline"
          >
            View profile
          </Button>
        ) : null}
      </div>

      <ProfileDetailsForm
        accessToken={accessToken}
        currentUser={currentUser}
        onSaved={onProfileUpdated}
      />

      <GpsPrivacyZonesForm accessToken={accessToken} />
    </div>
  )
}
