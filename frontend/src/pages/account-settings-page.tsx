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
import { ImmichSettingsPage } from '@/pages/immich-settings-page'
import { usePublicSetting } from '@/settings/public-settings'

type AccountSettingsPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  onNavigate: (to: string) => void
  onProfileUpdated: (user: CurrentUser) => void
}

const baseAccountSettingsSectionIds: readonly AccountSettingsSection[] = [
  'profile',
  'preferences',
  'privacy',
  'security',
  ...(isNativePlatform() ? (['tracking'] as const) : []),
]
const immichAccountSettingsSectionIds: readonly AccountSettingsSection[] = [
  ...baseAccountSettingsSectionIds,
  'immich',
]

const accountSettingsSectionHeadings: Record<
  AccountSettingsSection,
  { description: string; title: string }
> = {
  preferences: {
    description: 'Choose your time format and theme colors across signed-in devices.',
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
  immich: {
    description: 'Connect a personal Immich library for trip album imports.',
    title: 'Immich',
  },
}

export function AccountSettingsPage({
  accessToken,
  authStatus,
  currentUser,
  onNavigate,
  onProfileUpdated,
}: AccountSettingsPageProps) {
  const immichEnabled = usePublicSetting('immich.enabled') === true
  const { activeSection, selectSection } = useAccountSettingsSectionHash(immichEnabled)

  return (
    <AccountSettingsLayout
      activeSection={activeSection}
      onSectionChange={selectSection}
      showImmich={immichEnabled}
    >
      <AccountSettingsSections
        accessToken={accessToken}
        activeSection={activeSection}
        authStatus={authStatus}
        currentUser={currentUser}
        onNavigate={onNavigate}
        onProfileUpdated={onProfileUpdated}
        immichEnabled={immichEnabled}
      />
    </AccountSettingsLayout>
  )
}

function AccountSettingsSections({
  activeSection,
  ...props
}: AccountSettingsPageProps & {
  activeSection: AccountSettingsSection
  immichEnabled: boolean
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
  immichEnabled,
  onNavigate,
  onProfileUpdated,
}: AccountSettingsPageProps & {
  activeSection: AccountSettingsSection
  immichEnabled: boolean
}) {
  switch (activeSection) {
    case 'immich':
      return immichEnabled ? <ImmichSettingsPage accessToken={accessToken} /> : null
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

function useAccountSettingsSectionHash(immichEnabled: boolean) {
  const sectionIds = immichEnabled
    ? immichAccountSettingsSectionIds
    : baseAccountSettingsSectionIds
  const [activeSection, setActiveSection] = useState<AccountSettingsSection>(() =>
    readAccountSettingsSectionHash(sectionIds),
  )

  useEffect(() => {
    setActiveSection(readAccountSettingsSectionHash(sectionIds))
    normalizeAccountSettingsSectionHash(sectionIds)

    function handleHashChange() {
      setActiveSection(readAccountSettingsSectionHash(sectionIds))
      normalizeAccountSettingsSectionHash(sectionIds)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [sectionIds])

  const selectSection = useCallback((section: AccountSettingsSection) => {
    if (readAccountSettingsSectionHash(sectionIds, section) === section && isKnownAccountSettingsSectionHash(sectionIds)) {
      return
    }

    setActiveSection(section)
    window.location.hash = section
  }, [sectionIds])

  return {
    activeSection: sectionIds.includes(activeSection) ? activeSection : 'profile',
    selectSection,
  }
}

function readAccountSettingsSectionHash(
  sectionIds: readonly AccountSettingsSection[],
  fallback: AccountSettingsSection = 'profile',
) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const section = window.location.hash.slice(1)
  return sectionIds.includes(section as AccountSettingsSection)
    ? (section as AccountSettingsSection)
    : fallback
}

function isKnownAccountSettingsSectionHash(sectionIds: readonly AccountSettingsSection[]) {
  return sectionIds.includes(
    window.location.hash.slice(1) as AccountSettingsSection,
  )
}

function normalizeAccountSettingsSectionHash(sectionIds: readonly AccountSettingsSection[]) {
  if (isKnownAccountSettingsSectionHash(sectionIds)) {
    return
  }

  const nextUrl = `${window.location.pathname}${window.location.search}#profile`
  window.history.replaceState(window.history.state, '', nextUrl)
}
