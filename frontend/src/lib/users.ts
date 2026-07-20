import type { CurrentUser, Media, User } from '@/api/client'

type DisplayUser = CurrentUser | User

export function getUserDisplayName(user: DisplayUser | null | undefined): string {
  const profile = user?.profile
  const fullName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  return fullName || profile?.username || 'Traveler'
}

export function getUserInitials(user: DisplayUser | null | undefined): string {
  const profile = user?.profile
  const initials = [profile?.first_name?.[0], profile?.last_name?.[0]]
    .filter(Boolean)
    .join('')

  if (initials) {
    return initials.toUpperCase()
  }

  return (profile?.username?.slice(0, 2) || 'OV').toUpperCase()
}

export function getUserProfileMedia(
  user: DisplayUser | null | undefined,
): Media | null {
  return user?.profile?.profile_picture ?? null
}

export function getUserUsername(user: DisplayUser | null | undefined) {
  return user?.profile?.username ?? null
}
