import {
  ChevronDown,
  LogOut,
  Monitor,
  Server,
  Shield,
  UserCog,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { CurrentUser } from '@/api/client'
import { Button } from '@/components/ui/button'
import { MediaImage } from '@/components/ui/media-image'
import { CLIENT_VERSION, useSoftwareInfo } from '@/software/software-info-context'
import {
  getUserDisplayName,
  getUserInitials,
  getUserProfileMedia,
  getUserUsername,
} from '@/lib/users'

type UserMenuProps = {
  currentUser: CurrentUser
  onLogout: () => void
  onNavigate: (to: string) => void
}

export function UserMenu({
  currentUser,
  onLogout,
  onNavigate,
}: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const username = getUserUsername(currentUser)
  const displayName = getUserDisplayName(currentUser)
  const { serverVersion, serverLoading } = useSoftwareInfo()

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  function navigate(to: string) {
    setOpen(false)
    onNavigate(to)
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={open}
        className="inline-flex h-10 max-w-[13rem] items-center gap-2 rounded-xl border border-border bg-card px-2 text-sm font-semibold shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <MediaImage
          alt=""
          className="size-7 rounded-lg"
          fallback={<span className="text-xs">{getUserInitials(currentUser)}</span>}
          media={getUserProfileMedia(currentUser)}
        />
        <span className="hidden truncate sm:block">{displayName}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {username ? (
              <p className="truncate text-xs text-muted-foreground">@{username}</p>
            ) : null}
          </div>

          {username ? (
            <MenuButton
              icon={UserRound}
              label="My trips"
              onClick={() => navigate(`/users/${encodeURIComponent(username)}`)}
            />
          ) : null}

          <MenuButton
            icon={UserCog}
            label="Settings"
            onClick={() => navigate('/settings')}
          />

          {currentUser.role === 'ADMIN' ? (
            <MenuButton
              icon={Shield}
              label="Admin"
              onClick={() => navigate('/admin')}
            />
          ) : null}

          <MenuButton icon={LogOut} label="Log out" onClick={onLogout} />
          <div className="mt-1 border-t border-border px-1 pt-2 pb-1">
            <dl aria-label="Installed versions" className="divide-y divide-border/60 rounded-xl bg-muted/60 px-3">
              <div className="flex min-w-0 items-baseline justify-between gap-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Monitor aria-hidden="true" className="size-3" />
                  Client
                </dt>
                <dd className="min-w-0 break-all text-right font-mono text-xs font-semibold leading-5 text-popover-foreground">v{CLIENT_VERSION}</dd>
              </div>
              <div className="flex min-w-0 items-baseline justify-between gap-3 py-2.5">
                <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Server aria-hidden="true" className="size-3" />
                  Server
                </dt>
                <dd className="min-w-0 break-all text-right font-mono text-xs font-semibold leading-5 text-popover-foreground">
                  {serverVersion ? `v${serverVersion}` : <span className="font-sans font-normal text-muted-foreground">{serverLoading ? 'Loading…' : 'Unavailable'}</span>}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type MenuButtonProps = {
  icon: typeof UserRound
  label: string
  onClick: () => void
}

function MenuButton({ icon: Icon, label, onClick }: MenuButtonProps) {
  return (
    <Button
      className="h-9 w-full justify-start px-2"
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </Button>
  )
}
