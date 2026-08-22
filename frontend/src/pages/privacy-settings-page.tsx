import { MapPinned } from 'lucide-react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { AccountSettingsLayout } from '@/components/users/account-settings-layout'
import { GpsPrivacyZonesForm } from '@/components/users/gps-privacy-zones-form'
import { Button } from '@/components/ui/button'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'

type PrivacySettingsPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  embedded?: boolean
  onNavigate: (to: string) => void
}

export function PrivacySettingsPage({
  accessToken,
  authStatus,
  currentUser,
  embedded = false,
  onNavigate,
}: PrivacySettingsPageProps) {
  if (authStatus === 'loading') {
    return <LoadingState label="Loading privacy settings" />
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
          description="You need to be signed in before you can manage location privacy."
          icon={MapPinned}
          title="Sign in required"
        />
      </div>
    )
  }

  const content = <GpsPrivacyZonesForm accessToken={accessToken} />

  return embedded ? (
    content
  ) : (
    <AccountSettingsLayout
      activeSection="privacy"
      onSectionChange={() => undefined}
    >
      {content}
    </AccountSettingsLayout>
  )
}
