import type { TravelPost } from './models'

const renewalWindowMs = 2 * 60_000

// Reuse only URLs returned in the preceding authorized response. The caller
// scopes that response to the trip, user and share link, and drops removed media.
// A fresh URL still wins for a different resource/version or an expiring token.
export function retainMediaUrl(
  previous: string | null | undefined,
  incoming: string | null | undefined,
  now = Date.now(),
) {
  if (!previous || !incoming || previous === incoming) return incoming
  try {
    const oldUrl = new URL(previous, window.location.origin)
    const newUrl = new URL(incoming, window.location.origin)
    const token = oldUrl.searchParams.get('media_token')
    if (!token || !newUrl.searchParams.has('media_token')) return incoming
    oldUrl.searchParams.delete('media_token')
    newUrl.searchParams.delete('media_token')
    if (oldUrl.href !== newUrl.href) return incoming
    const payload = token.split('.')[1]
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now + renewalWindowMs) return incoming
    return previous
  } catch {
    return incoming
  }
}

export function retainTravelMedia(
  previous: readonly TravelPost[],
  incoming: readonly TravelPost[],
  now = Date.now(),
): readonly TravelPost[] {
  const posts = new Map(previous.map(post => [post.id, post]))
  return incoming.map(post => {
    const old = posts.get(post.id)
    if (!old) return post
    const media = new Map(old.media.filter(item => item.media_id).map(item => [item.media_id, item]))
    const picture = post.author.profilePicture
    const oldPicture = old.author.profilePicture
    return {
      ...post,
      author: picture && picture.id === oldPicture?.id ? {
        ...post.author,
        profilePicture: {
          ...picture,
          urls: {
            ...picture.urls,
            content: retainMediaUrl(oldPicture.urls.content, picture.urls.content, now) ?? null,
            thumbnail: retainMediaUrl(oldPicture.urls.thumbnail, picture.urls.thumbnail, now) ?? null,
          },
        },
      } : post.author,
      media: post.media.map(item => {
        const existing = item.media_id ? media.get(item.media_id) : undefined
        return existing ? {
          ...item,
          src: retainMediaUrl(existing.src, item.src, now) ?? '',
          thumbnail: retainMediaUrl(existing.thumbnail, item.thumbnail, now) ?? undefined,
          poster: retainMediaUrl(existing.poster, item.poster, now) ?? undefined,
        } : item
      }),
    }
  })
}
