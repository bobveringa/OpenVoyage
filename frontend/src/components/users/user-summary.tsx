import { MapPin, Plane } from 'lucide-react'

import type { User } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { MediaImage } from '@/components/ui/media-image'
import {
  getUserDisplayName,
  getUserInitials,
  getUserProfileMedia,
} from '@/lib/users'

type UserSummaryProps = {
  isOwner: boolean
  totalTrips: number
  user: User
}

export function UserSummary({
  isOwner,
  totalTrips,
  user,
}: UserSummaryProps) {
  const profile = user.profile
  const displayName = getUserDisplayName(user)
  const username = profile?.username
  const tripLabel = `${totalTrips} ${totalTrips === 1 ? 'trip' : 'trips'}`

  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <MediaImage
          alt=""
          className="size-20 rounded-2xl shadow-sm sm:size-24"
          fallback={
            <span className="text-xl font-semibold">{getUserInitials(user)}</span>
          }
          media={getUserProfileMedia(user)}
        />

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              {displayName}
            </h1>
            {isOwner ? <Badge variant="secondary">You</Badge> : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {username ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden="true" />@{username}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Plane className="size-4" aria-hidden="true" />
              {tripLabel}
            </span>
          </div>

          {profile?.biography ? (
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {profile.biography}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
