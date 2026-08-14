import { ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import {
  AdminNavigation,
  type AdminSectionId,
} from '@/components/admin/admin-navigation'
import { AdminSections } from '@/components/admin/admin-sections'
import { LoadingState } from '@/components/ui/empty-state'
import { PlaceholderPage } from '@/pages/placeholder-page'

type AdminPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
}

export function AdminPage({
  accessToken,
  authStatus,
  currentUser,
}: AdminPageProps) {
  const { activeSection, selectSection } = useAdminSectionHash()

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
    <div className="space-y-7 py-6 sm:py-8 lg:space-y-8 lg:py-10">
      <div className="space-y-2 lg:pl-[calc(14.5rem+2rem)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Administration
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Application control centre
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Manage shared appearance, travel infrastructure, and application tools.
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:items-start lg:gap-8 min-[1680px]:-ml-[16.5rem] min-[1680px]:w-[calc(100%+16.5rem)]">
        <AdminNavigation
          activeSection={activeSection}
          onSectionChange={selectSection}
        />
        <div className="min-w-0">
          <AdminSections
            accessToken={accessToken}
            activeSection={activeSection}
          />
        </div>
      </div>
    </div>
  )
}

const adminSectionIds: readonly AdminSectionId[] = [
  'appearance',
  'routing',
  'media',
  'data',
  'jobs',
  'users',
]

function useAdminSectionHash() {
  const [activeSection, setActiveSection] = useState<AdminSectionId>(() =>
    readAdminSectionHash(),
  )

  useEffect(() => {
    normalizeAdminSectionHash()

    function handleHashChange() {
      setActiveSection(readAdminSectionHash())
      normalizeAdminSectionHash()
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const selectSection = useCallback((section: AdminSectionId) => {
    if (readAdminSectionHash() === section && isKnownAdminSectionHash()) {
      return
    }

    setActiveSection(section)
    window.location.hash = section
  }, [])

  return { activeSection, selectSection }
}

function readAdminSectionHash(): AdminSectionId {
  if (typeof window === 'undefined') {
    return 'appearance'
  }

  const section = window.location.hash.slice(1)
  return adminSectionIds.includes(section as AdminSectionId)
    ? (section as AdminSectionId)
    : 'appearance'
}

function isKnownAdminSectionHash() {
  return adminSectionIds.includes(
    window.location.hash.slice(1) as AdminSectionId,
  )
}

function normalizeAdminSectionHash() {
  if (isKnownAdminSectionHash()) {
    return
  }

  const nextUrl = `${window.location.pathname}${window.location.search}#appearance`
  window.history.replaceState(window.history.state, '', nextUrl)
}
