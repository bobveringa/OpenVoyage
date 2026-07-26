import type { ReactNode } from 'react'
import { Compass } from 'lucide-react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { AppBackground } from '@/components/layout/app-background'
import { UserMenu } from '@/components/layout/user-menu'
import { cn } from '@/lib/utils'
import { getUserUsername } from '@/lib/users'

type AppShellProps = {
  authStatus?: AuthStatus
  children: ReactNode
  currentUser?: CurrentUser | null
  onLogout?: () => void
  onNavigate?: (to: string) => void
  showHeader?: boolean
}

export function AppShell({
  authStatus = 'unauthenticated',
  children,
  currentUser,
  onLogout,
  onNavigate,
  showHeader = true,
}: AppShellProps) {
  const username = getUserUsername(currentUser)
  const homePath = username ? `/users/${encodeURIComponent(username)}` : '/'

  function handleNavigate(to: string) {
    onNavigate?.(to)
  }

  return (
    <div className="relative isolate min-h-dvh text-foreground">
      <AppBackground />
      {showHeader ? (
        <header className="sticky top-0 z-10 border-b border-emerald-100/80 bg-white/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-6xl min-w-0 items-center justify-between px-4 sm:px-6 lg:px-8">
            <button
              className="inline-flex items-center gap-3 rounded-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => handleNavigate(homePath)}
              type="button"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Compass className="size-5" aria-hidden="true" />
              </span>
              <span>OpenVoyage</span>
            </button>

            {currentUser && onLogout && onNavigate ? (
              <UserMenu
                currentUser={currentUser}
                onLogout={onLogout}
                onNavigate={onNavigate}
              />
            ) : authStatus === 'loading' ? (
              <span className="text-sm font-medium text-muted-foreground">
                Checking session
              </span>
            ) : (
              <Button
                onClick={() => handleNavigate('/')}
                size="sm"
                type="button"
                variant="outline"
              >
                Sign in
              </Button>
            )}
          </div>
        </header>
      ) : null}

      <main
        className={cn(
          'mx-auto min-w-0 w-full max-w-6xl px-4 sm:px-6 lg:px-8',
          !showHeader && 'max-w-none px-0 sm:px-0 lg:px-0',
        )}
      >
        {children}
      </main>
    </div>
  )
}
