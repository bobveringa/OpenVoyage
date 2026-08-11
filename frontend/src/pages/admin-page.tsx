import { Settings2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import {
  AdminNavigation,
  type AdminSectionId,
} from '@/components/admin/admin-navigation'
import { AdminSections } from '@/components/admin/admin-sections'
import { Badge } from '@/components/ui/badge'
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
      <header className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-white px-5 py-6 shadow-sm sm:px-7 sm:py-7">
        <div
          aria-hidden="true"
          className="absolute -right-16 -top-24 size-64 rounded-full bg-emerald-100/65 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-24 left-1/3 size-52 rounded-full bg-amber-100/55 blur-3xl"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Settings2 aria-hidden="true" className="size-6" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Administration
                </p>
                <Badge className="gap-1.5" variant="secondary">
                  <ShieldCheck aria-hidden="true" className="size-3" />
                  Admin only
                </Badge>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Application control centre
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Manage public preferences, infrastructure settings, media
                policy, and shared application data from one place.
              </p>
            </div>
          </div>
        </div>
      </header>

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
