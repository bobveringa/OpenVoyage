import type { UserSummary } from '@/api/client'
import { parseDateOnly, parseDateTime } from './date-utils'
import type { TripRole, TripVisibility } from './models'

export function getVisibilityLabel(visibility: TripVisibility) {
  switch (visibility) {
    case 'PRIVATE':
      return 'Private'
    case 'PLATFORM_PUBLIC':
      return 'Platform public'
    case 'PUBLIC':
      return 'Public'
  }
}

export function getVisibilityDescription(visibility: TripVisibility) {
  switch (visibility) {
    case 'PRIVATE':
      return 'Only members and explicitly allowed viewers can see this trip.'
    case 'PLATFORM_PUBLIC':
      return 'Signed-in OpenVoyage users can find and open this trip.'
    case 'PUBLIC':
      return 'Anyone with the route can view the published trip.'
  }
}

export function getRoleLabel(role: TripRole) {
  return role === 'OWNER' ? 'Owner' : 'Member'
}

export function getUserDisplayName(user: UserSummary) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return fullName || user.username || 'Traveler'
}

export function getUserSubtitle(user: UserSummary) {
  return user.username ? `@${user.username}` : user.id
}

export function formatTripDateRange(startDate: string, endDate: string) {
  if (!endDate) {
    return `${formatDateLabel(startDate)} onward`
  }

  return `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`
}

export function formatDateTimeLabel(value: string) {
  const date = parseDateTime(value)
  if (!date) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function getShareUrl(token: string, tripId: string | undefined) {
  const origin =
    typeof window === 'undefined'
      ? 'https://openvoyage.example'
      : window.location.origin
  const tripPath = tripId ? `/trips/${encodeURIComponent(tripId)}` : '/trips'

  return `${origin}${tripPath}?share=${encodeURIComponent(token)}`
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function formatDateLabel(value: string) {
  const date = parseDateOnly(value)
  if (!date) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}
