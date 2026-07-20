import { ShieldAlert, ShieldCheck } from 'lucide-react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { LoadingState } from '@/components/ui/empty-state'
import { PlaceholderPage } from '@/pages/placeholder-page'

type AdminPageProps = {
  authStatus: AuthStatus
  currentUser: CurrentUser | null
}

export function AdminPage({ authStatus, currentUser }: AdminPageProps) {
  if (authStatus === 'loading') {
    return <LoadingState label="Checking access" />
  }

  if (currentUser?.role !== 'ADMIN') {
    return (
      <PlaceholderPage
        description="This area is only available to admin users."
        icon={ShieldAlert}
        title="Admin access required"
      />
    )
  }

  return (
    <PlaceholderPage
      description="Admin workflows will be added in a later pass."
      icon={ShieldCheck}
      title="Admin"
    />
  )
}
