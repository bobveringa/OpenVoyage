import { UserCog } from 'lucide-react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { AccountSettingsLayout } from '@/components/users/account-settings-layout'
import { ProfileDetailsForm } from '@/components/users/profile-details-form'
import { Button } from '@/components/ui/button'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'

type ProfileSettingsPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  embedded?: boolean
  onNavigate: (to: string) => void
  onProfileUpdated: (user: CurrentUser) => void
}

export function ProfileSettingsPage({
  accessToken,
  authStatus,
  currentUser,
  embedded = false,
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

  const content = (
    <div className="space-y-6">
      <ProfileDetailsForm
        accessToken={accessToken}
        currentUser={currentUser}
        onSaved={onProfileUpdated}
      />
    </div>
  )

  return embedded ? (
    content
  ) : (
    <AccountSettingsLayout
      activeSection="profile"
      onSectionChange={() => undefined}
    >
      {content}
    </AccountSettingsLayout>
  )
}
