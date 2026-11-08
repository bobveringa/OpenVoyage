import type { Post } from '@/api/client'
import type { TravelPost } from './models'

export const DELETED_USER_NAME = 'Deleted user'

// The API returns a null author once the author's account is deleted; the
// post itself stays with the trip.
export function toPostAuthorViewModel(
  author: Post['author'],
): TravelPost['author'] {
  if (!author) {
    return {
      displayName: DELETED_USER_NAME,
      id: null,
      initials: '?',
      profilePicture: null,
    }
  }
  const displayName =
    [author.first_name, author.last_name].filter(Boolean).join(' ') ||
    author.username ||
    'User'
  const initials =
    [author.first_name?.[0], author.last_name?.[0]].filter(Boolean).join('') ||
    author.username?.slice(0, 2) ||
    'U'

  return {
    displayName,
    id: author.id,
    initials: initials.toUpperCase(),
    profilePicture: author.profile_picture,
  }
}
