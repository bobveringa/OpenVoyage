import { useCallback, useEffect, useState } from 'react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import {
  AccountSettingsLayout,
  AccountSettingsSectionHeading,
  type AccountSettingsSection,
} from '@/components/users/account-settings-layout'
import { isNativePlatform } from '@/native/platform'
import { AccountPreferencesPage } from '@/pages/account-preferences-page'
import { AccountSecurityPage } from '@/pages/account-security-page'
import { PrivacySettingsPage } from '@/pages/privacy-settings-page'
import { ProfileSettingsPage } from '@/pages/profile-settings-page'
import { TrackingSettingsPage } from '@/pages/tracking-settings-page'

type AccountSettingsPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  initialSection?: AccountSettingsSection
  onNavigate: (to: string) => void
  onProfileUpdated: (user: CurrentUser) => void
}

const accountSettingsSectionIds: readonly AccountSettingsSection[] = [
  'profile',
  'preferences',
  'privacy',
  'security',
  ...(isNativePlatform() ? (['tracking'] as const) : []),
]

const accountSettingsSectionHeadings: Record<
  AccountSettingsSection,
  { description: string; title: string }
> = {
  preferences: {
    description: 'Choose how OpenVoyage is displayed on this device.',
    title: 'Preferences',
  },
  privacy: {
    description: 'Control which locations are kept out of your GPS recordings.',
    title: 'Privacy',
  },
  profile: {
    description: 'Update the details people see when they open your trip overview.',
    title: 'Profile',
  },
  security: {
    description: 'Manage your password and active account sessions.',
    title: 'Security',
  },
  tracking: {
    description: 'Configure how this device records and uploads GPS locations.',
    title: 'GPS tracking',
  },
}

export function AccountSettingsPage({
  accessToken,
  authStatus,
  currentUser,
  initialSection = 'profile',
  onNavigate,
  onProfileUpdated,
}: AccountSettingsPageProps) {
  const { activeSection, selectSection } = useAccountSettingsSectionHash(initialSection)

  return (
    <AccountSettingsLayout
      activeSection={activeSection}
      onSectionChange={selectSection}
    >
      <AccountSettingsSections
        accessToken={accessToken}
        activeSection={activeSection}
        authStatus={authStatus}
        currentUser={currentUser}
        onNavigate={onNavigate}
        onProfileUpdated={onProfileUpdated}
      />
    </AccountSettingsLayout>
  )
}

function AccountSettingsSections({
  activeSection,
  ...props
}: Omit<AccountSettingsPageProps, 'initialSection'> & {
  activeSection: AccountSettingsSection
}) {
  const heading = accountSettingsSectionHeadings[activeSection]

  return (
    <section className="space-y-6">
      <AccountSettingsSectionHeading {...heading} />
      <AccountSettingsPanel activeSection={activeSection} {...props} />
    </section>
  )
}

function AccountSettingsPanel({
  accessToken,
  activeSection,
  authStatus,
  currentUser,
  onNavigate,
  onProfileUpdated,
}: Omit<AccountSettingsPageProps, 'initialSection'> & {
  activeSection: AccountSettingsSection
}) {
  switch (activeSection) {
    case 'preferences':
      return (
        <AccountPreferencesPage
          authStatus={authStatus}
          currentUser={currentUser}
          embedded
          onNavigate={onNavigate}
        />
      )
    case 'privacy':
      return (
        <PrivacySettingsPage
          accessToken={accessToken}
          authStatus={authStatus}
          currentUser={currentUser}
          embedded
          onNavigate={onNavigate}
        />
      )
    case 'security':
      return (
        <AccountSecurityPage
          authStatus={authStatus}
          currentUser={currentUser}
          embedded
          onNavigate={onNavigate}
        />
      )
    case 'tracking':
      return isNativePlatform() ? (
        <TrackingSettingsPage embedded />
      ) : null
    case 'profile':
      return (
        <ProfileSettingsPage
          accessToken={accessToken}
          authStatus={authStatus}
          currentUser={currentUser}
          embedded
          onNavigate={onNavigate}
          onProfileUpdated={onProfileUpdated}
        />
      )
  }
}

function useAccountSettingsSectionHash(initialSection: AccountSettingsSection) {
  const [activeSection, setActiveSection] = useState<AccountSettingsSection>(() =>
    readAccountSettingsSectionHash(initialSection),
  )

  useEffect(() => {
    normalizeAccountSettingsSectionHash(initialSection)

    function handleHashChange() {
      setActiveSection(readAccountSettingsSectionHash(initialSection))
      normalizeAccountSettingsSectionHash(initialSection)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [initialSection])

  const selectSection = useCallback((section: AccountSettingsSection) => {
    if (readAccountSettingsSectionHash(section) === section && isKnownAccountSettingsSectionHash()) {
      return
    }

    setActiveSection(section)
    window.location.hash = section
  }, [])

  return { activeSection, selectSection }
}

function readAccountSettingsSectionHash(fallback: AccountSettingsSection) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const section = window.location.hash.slice(1)
  return accountSettingsSectionIds.includes(section as AccountSettingsSection)
    ? (section as AccountSettingsSection)
    : fallback
}

function isKnownAccountSettingsSectionHash() {
  return accountSettingsSectionIds.includes(
    window.location.hash.slice(1) as AccountSettingsSection,
  )
}

function normalizeAccountSettingsSectionHash(fallback: AccountSettingsSection) {
  if (isKnownAccountSettingsSectionHash()) {
    return
  }

  const nextUrl = `${window.location.pathname}${window.location.search}#${fallback}`
  window.history.replaceState(window.history.state, '', nextUrl)
}
