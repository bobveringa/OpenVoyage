import {
  Clock3,
  MapPinned,
  Radio,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { isNativePlatform } from '@/native/platform'
import { cn } from '@/lib/utils'

export type AccountSettingsSection =
  | 'preferences'
  | 'privacy'
  | 'profile'
  | 'security'
  | 'tracking'

type AccountSettingsLayoutProps = {
  activeSection: AccountSettingsSection
  children: ReactNode
  onSectionChange: (section: AccountSettingsSection) => void
}

type AccountSettingsNavigationItem = {
  description: string
  icon: LucideIcon
  id: AccountSettingsSection
  label: string
}

const accountSettingsNavigationItems: readonly AccountSettingsNavigationItem[] = [
  {
    description: 'Your public details',
    icon: UserRound,
    id: 'profile',
    label: 'Profile',
  },
  {
    description: 'Time and display options',
    icon: Clock3,
    id: 'preferences',
    label: 'Preferences',
  },
  {
    description: 'Recorded location controls',
    icon: MapPinned,
    id: 'privacy',
    label: 'Privacy',
  },
  {
    description: 'Password and active devices',
    icon: ShieldCheck,
    id: 'security',
    label: 'Security',
  },
  {
    description: 'This device’s GPS options',
    icon: Radio,
    id: 'tracking',
    label: 'GPS tracking',
  },
]

export function AccountSettingsLayout({
  activeSection,
  children,
  onSectionChange,
}: AccountSettingsLayoutProps) {
  const navigationItems = accountSettingsNavigationItems.filter(
    (item) => item.id !== 'tracking' || isNativePlatform(),
  )

  return (
    <div className="space-y-7 py-6 sm:py-8 lg:space-y-8 lg:py-10">
      <div className="space-y-2 lg:pl-[calc(14.5rem+2rem)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Account
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Account settings
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Manage your profile, preferences, privacy, and account security.
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:items-start lg:gap-8 min-[1680px]:-ml-[16.5rem] min-[1680px]:w-[calc(100%+16.5rem)]">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <nav
            aria-label="Account settings sections"
            className="rounded-2xl border border-border bg-card/90 p-2 shadow-sm backdrop-blur-sm"
          >
            <div className="scrollbar-subtle flex gap-1 overflow-x-auto lg:grid lg:overflow-visible">
              {navigationItems.map((item) => {
                const Icon = item.icon
                const isActive = activeSection === item.id

                return (
                  <button
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group flex min-w-max items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:min-w-0',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    key={item.id}
                    onClick={() => onSectionChange(item.id)}
                    type="button"
                  >
                    <span
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
                        isActive
                          ? 'bg-card/15 text-primary-foreground'
                          : 'bg-muted text-primary group-hover:bg-card',
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-inherit">
                        {item.label}
                      </span>
                      <span
                        className={cn(
                          'hidden truncate text-xs lg:block',
                          isActive
                            ? 'text-primary-foreground/75'
                            : 'text-muted-foreground',
                        )}
                      >
                        {item.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </nav>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}

export function AccountSettingsSectionHeading({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        Account settings
      </p>
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}
