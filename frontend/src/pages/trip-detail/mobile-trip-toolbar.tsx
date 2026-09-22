import { ArrowLeft, CalendarDays, Settings, UserRound } from 'lucide-react'
import { useState } from 'react'

import { useAuth } from '@/auth/use-auth'
import { TrackingIndicator } from '@/components/layout/app-shell'
import { ThemeModeToggle } from '@/components/layout/theme-mode-toggle'
import { TripMemberPresence } from '@/components/trips/trip-member-presence'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { MediaImage } from '@/components/ui/media-image'
import { getUserInitials, getUserProfileMedia, getUserUsername } from '@/lib/users'
import { formatTripDateRange } from './management-utils'
import { parseDateOnly } from './date-utils'
import type { TripMemberViewModel, TripViewModel } from './models'
import type { TripManagementSection } from './url-state'

export function MobileTripToolbar({ trip, members, canManageTrip, onOpenManagement }: {
  trip: TripViewModel
  members: readonly TripMemberViewModel[]
  canManageTrip: boolean
  onOpenManagement: (section: TripManagementSection) => void
}) {
  const { currentUser, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const username = getUserUsername(currentUser)
  const home = username ? `/users/${encodeURIComponent(username)}` : '/'
  const startDate = parseDateOnly(trip.startDate)
  const endDate = parseDateOnly(trip.endDate)
  const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const dateLabel = startDate && endDate && endDate >= startDate && 'formatRange' in dateFormatter && typeof dateFormatter.formatRange === 'function'
    ? dateFormatter.formatRange(startDate, endDate) as string
    : formatTripDateRange(trip.startDate, trip.endDate)
  const navigate = (to: string) => { window.location.assign(to) }

  return (
    <>
      <div className="mobile-trip-toolbar shrink-0 border-b border-border bg-gradient-to-b from-card to-primary/5 pt-[env(safe-area-inset-top)] lg:hidden">
        <div className="flex h-12 items-center gap-1 px-2">
          <a aria-label="Back to trips" href={home} className="grid size-11 shrink-0 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="size-5" aria-hidden="true" />
          </a>
          <h1 className="min-w-0 flex-1 truncate px-1 text-lg font-semibold" title={trip.name}>
            {trip.name}
          </h1>
          {canManageTrip ? (
            <Button aria-label="Trip settings" title="Trip settings" className="size-11 shrink-0" onClick={() => onOpenManagement('general')} size="icon" variant="ghost">
              <Settings className="size-5" aria-hidden="true" />
            </Button>
          ) : null}
          {currentUser ? <TrackingIndicator onNavigate={navigate} /> : null}
          <Button aria-label="Account menu" aria-expanded={menuOpen} className="size-11 shrink-0 rounded-full" onClick={() => setMenuOpen(true)} size="icon" variant="ghost">
            {currentUser ? (
              <MediaImage alt="" className="size-8 rounded-full border border-border" media={getUserProfileMedia(currentUser)} fallback={<span className="text-xs font-semibold">{getUserInitials(currentUser)}</span>} />
            ) : <UserRound className="size-5" aria-hidden="true" />}
          </Button>
        </div>
        <div className="flex min-w-0 items-center gap-3 px-4 pb-2">
          <p className="flex max-w-[60%] shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" title={formatTripDateRange(trip.startDate, trip.endDate)}>
            <CalendarDays className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{dateLabel}</span>
          </p>
          <TripMemberPresence currentUserId={currentUser?.id} members={members} />
        </div>
      </div>
      <Modal bottomSheetOnMobile open={menuOpen} onClose={() => setMenuOpen(false)} title="Your account" contentClassName="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="grid gap-2">
            <a className="rounded-xl px-4 py-3 text-sm font-semibold hover:bg-muted" href={home}>{currentUser ? 'My trips' : 'Sign in'}</a>
            {currentUser ? <a className="rounded-xl px-4 py-3 text-sm font-semibold hover:bg-muted" href="/settings">Account settings</a> : null}
            {currentUser?.role === 'ADMIN' ? <a className="rounded-xl px-4 py-3 text-sm font-semibold hover:bg-muted" href="/admin">Admin</a> : null}
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm"><span>Appearance</span><ThemeModeToggle /></div>
            {currentUser ? <Button className="h-11 justify-start" variant="ghost" onClick={() => { signOut(); navigate('/') }}>Log out</Button> : null}
          </div>
      </Modal>
    </>
  )
}
