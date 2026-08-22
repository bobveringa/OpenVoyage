import { Clock3 } from 'lucide-react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { AccountSettingsLayout } from '@/components/users/account-settings-layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { useClockFormat, type ClockFormatPreference } from '@/lib/date-time'

type AccountPreferencesPageProps = {
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  embedded?: boolean
  onNavigate: (to: string) => void
}

export function AccountPreferencesPage({
  authStatus,
  currentUser,
  embedded = false,
  onNavigate,
}: AccountPreferencesPageProps) {
  const { preference: clockFormat, setPreference: setClockFormat } = useClockFormat()

  if (authStatus === 'loading') {
    return <LoadingState label="Loading preferences" />
  }

  if (!currentUser) {
    return (
      <div className="py-8 sm:py-10">
        <EmptyState
          action={
            <Button onClick={() => onNavigate('/login')} type="button">
              Sign in
            </Button>
          }
          description="You need to be signed in before you can update your preferences."
          icon={Clock3}
          title="Sign in required"
        />
      </div>
    )
  }

  const content = (
    <Card>
      <CardHeader>
        <CardTitle>Time format</CardTitle>
        <CardDescription>
          Controls every time shown in OpenVoyage on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-xs">
        <Select<ClockFormatPreference>
          ariaLabel="Time format"
          onValueChange={setClockFormat}
          options={[
            { label: '12-hour clock', value: '12-hour' },
            { label: '24-hour clock', value: '24-hour' },
          ]}
          value={clockFormat}
        />
      </CardContent>
    </Card>
  )

  return embedded ? (
    content
  ) : (
    <AccountSettingsLayout
      activeSection="preferences"
      onSectionChange={() => undefined}
    >
      {content}
    </AccountSettingsLayout>
  )
}
