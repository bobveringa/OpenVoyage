import {
  Database,
  Image,
  Palette,
  Route,
  type LucideIcon,
} from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'

import { cn } from '@/lib/utils'

export type AdminSectionId =
  | 'appearance'
  | 'data'
  | 'media'
  | 'routing'

type AdminNavigationItem = {
  description: string
  icon: LucideIcon
  id: AdminSectionId
  label: string
}

type AdminNavigationProps = {
  activeSection: AdminSectionId
  onSectionChange: (section: AdminSectionId) => void
}

const adminNavigationItems: readonly AdminNavigationItem[] = [
  {
    description: 'Theme preferences',
    icon: Palette,
    id: 'appearance',
    label: 'Appearance',
  },
  {
    description: 'Routes and providers',
    icon: Route,
    id: 'routing',
    label: 'Routing',
  },
  {
    description: 'Uploads and storage',
    icon: Image,
    id: 'media',
    label: 'Media',
  },
  {
    description: 'Shared place data',
    icon: Database,
    id: 'data',
    label: 'Data tools',
  },
]

export function AdminNavigation({
  activeSection,
  onSectionChange,
}: AdminNavigationProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % adminNavigationItems.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex =
        (currentIndex - 1 + adminNavigationItems.length) %
        adminNavigationItems.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = adminNavigationItems.length - 1
    }

    if (nextIndex === null) {
      return
    }

    event.preventDefault()
    const nextItem = adminNavigationItems[nextIndex]
    if (!nextItem) {
      return
    }

    onSectionChange(nextItem.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-2xl border border-emerald-100 bg-white/90 p-2 shadow-sm backdrop-blur-sm">
        <div
          aria-label="Admin sections"
          className="scrollbar-subtle flex gap-1 overflow-x-auto lg:grid lg:overflow-visible"
          role="tablist"
        >
          {adminNavigationItems.map((item, index) => {
            const Icon = item.icon
            const isActive = activeSection === item.id

            return (
              <button
                aria-controls={`admin-panel-${item.id}`}
                aria-selected={isActive}
                className={cn(
                  'group flex min-w-max items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:min-w-0',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-emerald-50 hover:text-foreground',
                )}
                id={`admin-tab-${item.id}`}
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(node) => {
                  tabRefs.current[index] = node
                }}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
                    isActive
                      ? 'bg-white/15 text-primary-foreground'
                      : 'bg-emerald-50 text-primary group-hover:bg-white',
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
      </div>
    </aside>
  )
}
