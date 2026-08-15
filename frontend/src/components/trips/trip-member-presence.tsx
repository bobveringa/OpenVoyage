import { useEffect, useId, useMemo, useRef, useState } from 'react'

import type { Media } from '@/api/client'
import { MediaImage } from '@/components/ui/media-image'

const MAX_VISIBLE_AVATARS = 4
const MAX_NAMES_IN_LABEL = 3

export type TripMemberPresenceMember = {
  id: string
  name: string
  profilePicture: Media | null
  role: 'MEMBER' | 'OWNER'
  username: string | null
}

type TripMemberPresenceProps = {
  currentUserId?: string | null
  isLoading?: boolean
  members: readonly TripMemberPresenceMember[]
}

export function TripMemberPresence({
  currentUserId = null,
  isLoading = false,
  members,
}: TripMemberPresenceProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [visibleAvatarLimit, setVisibleAvatarLimit] =
    useState(MAX_VISIBLE_AVATARS)
  const counterButtonRef = useRef<HTMLButtonElement | null>(null)
  const popoverId = useId()
  const presenceRef = useRef<HTMLDivElement | null>(null)
  const orderedMembers = useMemo(
    () => orderTripMembers(members, currentUserId),
    [currentUserId, members],
  )
  const hiddenMemberCount = Math.max(orderedMembers.length - visibleAvatarLimit, 0)

  useEffect(() => {
    if (!isPopoverOpen) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      setIsPopoverOpen(false)
      counterButtonRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPopoverOpen])

  useEffect(() => {
    const presenceElement = presenceRef.current
    if (!presenceElement || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    function updateVisibleAvatarLimit(width: number) {
      setVisibleAvatarLimit(getVisibleAvatarLimit(width))
    }

    updateVisibleAvatarLimit(presenceElement.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        updateVisibleAvatarLimit(entry.contentRect.width)
      }
    })
    observer.observe(presenceElement)
    return () => observer.disconnect()
  }, [])

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading travelers"
        className="flex h-8 items-center gap-2"
      >
        <span className="size-7 animate-pulse rounded-full bg-muted sm:size-8" />
        <span className="h-3 w-40 animate-pulse rounded-full bg-muted" />
      </div>
    )
  }

  if (orderedMembers.length === 0) {
    return null
  }

  const visibleMembers = orderedMembers.slice(0, visibleAvatarLimit)
  const travelerLabel = getTripMemberPresenceLabel(orderedMembers, currentUserId)

  return (
    <div
      aria-label={travelerLabel}
      className="flex min-w-0 flex-1 items-center gap-2"
      ref={presenceRef}
    >
      <div className="flex shrink-0 -space-x-2">
        {visibleMembers.map((member, index) => (
          <TripMemberAvatar
            currentUserId={currentUserId}
            key={member.id}
            member={member}
            stackIndex={index}
          />
        ))}
        {hiddenMemberCount > 0 ? (
          <div className="relative ml-0">
            <button
              aria-controls={popoverId}
              aria-expanded={isPopoverOpen}
              aria-haspopup="dialog"
              aria-label={`Show all ${orderedMembers.length} travelers`}
              className="relative z-10 grid size-7 place-items-center rounded-full border-2 border-card bg-secondary text-[10px] font-semibold text-secondary-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:size-8"
              onClick={() => setIsPopoverOpen((open) => !open)}
              ref={counterButtonRef}
              type="button"
            >
              +{hiddenMemberCount}
            </button>
            {isPopoverOpen ? (
              <TripMemberListPopover
                currentUserId={currentUserId}
                id={popoverId}
                members={orderedMembers}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="min-w-0 truncate text-xs text-muted-foreground" title={travelerLabel}>
        {travelerLabel}
      </p>
    </div>
  )
}

function TripMemberAvatar({
  currentUserId,
  member,
  stackIndex,
}: {
  currentUserId: string | null
  member: TripMemberPresenceMember
  stackIndex: number
}) {
  const isCurrentUser = member.id === currentUserId
  const shortName = getMemberFirstName(member.name)
  const accessibleName = isCurrentUser
    ? 'View your profile'
    : `View ${shortName}'s profile`
  const image = (
    <MediaImage
      alt={shortName}
      className="size-7 rounded-full border-2 border-card text-[10px] font-semibold shadow-sm sm:size-8"
      fallback={getMemberInitials(member.name)}
      media={member.profilePicture}
    />
  )

  if (!member.username) {
    return (
      <span
        aria-label={shortName}
        className="relative block"
        style={{ zIndex: stackIndex + 1 }}
        title={shortName}
      >
        {image}
      </span>
    )
  }

  return (
    <a
      aria-label={accessibleName}
      className="relative block rounded-full focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      href={`/users/${encodeURIComponent(member.username)}`}
      style={{ zIndex: stackIndex + 1 }}
      title={isCurrentUser ? 'Your profile' : shortName}
    >
      {image}
    </a>
  )
}

function TripMemberListPopover({
  currentUserId,
  id,
  members,
}: {
  currentUserId: string | null
  id: string
  members: readonly TripMemberPresenceMember[]
}) {
  return (
    <div
      aria-label="Trip travelers"
      className="absolute left-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-lg"
      id={id}
      role="dialog"
    >
      <p className="px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
        Travelers
      </p>
      <ul className="max-h-64 overflow-y-auto" role="list">
        {members.map((member) => (
          <li
            className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm"
            key={member.id}
          >
            <span className="min-w-0 truncate font-medium text-foreground">
              {member.id === currentUserId ? 'You' : getMemberFirstName(member.name)}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {member.role === 'OWNER' ? 'Owner' : 'Member'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function getTripMemberPresenceLabel(
  members: readonly TripMemberPresenceMember[],
  currentUserId: string | null = null,
) {
  if (members.length === 0) {
    return ''
  }

  const names = members
    .slice(0, MAX_NAMES_IN_LABEL)
    .map((member) => getMemberReference(member, currentUserId))

  if (members.length === 1) {
    return names[0] === 'You'
      ? 'You are traveling'
      : `${names[0]} is traveling`
  }

  const subject =
    members.length > MAX_NAMES_IN_LABEL
      ? `${formatNameList(names)}, and ${members.length - MAX_NAMES_IN_LABEL} others`
      : formatNameList(names)
  return `${subject} are traveling`
}

function getVisibleAvatarLimit(availableWidth: number) {
  if (availableWidth < 92) {
    return 1
  }
  if (availableWidth < 120) {
    return 2
  }
  if (availableWidth < 148) {
    return 3
  }
  return MAX_VISIBLE_AVATARS
}

function orderTripMembers(
  members: readonly TripMemberPresenceMember[],
  currentUserId: string | null,
) {
  return [...members].sort((left, right) => {
    const priorityDifference =
      getMemberOrderPriority(left, currentUserId) -
      getMemberOrderPriority(right, currentUserId)
    if (priorityDifference !== 0) {
      return priorityDifference
    }

    const nameDifference = left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base',
    })
    return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id)
  })
}

function getMemberOrderPriority(
  member: TripMemberPresenceMember,
  currentUserId: string | null,
) {
  if (member.id === currentUserId) {
    return 0
  }
  return member.role === 'OWNER' ? 1 : 2
}

function getMemberReference(
  member: TripMemberPresenceMember,
  currentUserId: string | null,
) {
  return member.id === currentUserId ? 'You' : getMemberFirstName(member.name)
}

function formatNameList(names: readonly string[]) {
  if (names.length === 1) {
    return names[0] ?? ''
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`
  }
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function getMemberInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')

  return initials ? initials.toUpperCase() : 'OV'
}

function getMemberFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || 'Traveler'
}
