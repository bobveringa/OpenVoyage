const CACHE_VERSION = 1

export type TripProgress = {
  lastViewedPostId: string | null
  seenThroughPublishedAt: string | null
}

type CachedTripProgress = TripProgress & {
  cacheVersion: typeof CACHE_VERSION
}

type TripProgressKey = {
  tripId: string
  userId: string | null
}

type PublishedPost = {
  id: string
  publishedAt: string | null
}

function cacheKey({ tripId, userId }: TripProgressKey) {
  const viewerKey = userId ? `user.${userId}` : 'visitor'
  return `openvoyage.trip-progress.v1.${viewerKey}.${tripId}`
}

export function readTripProgress(key: TripProgressKey): TripProgress | null {
  try {
    const storageKey = cacheKey(key)
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null

    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') {
      window.localStorage.removeItem(storageKey)
      return null
    }

    const cached = value as Partial<CachedTripProgress>
    if (
      cached.cacheVersion !== CACHE_VERSION ||
      (cached.lastViewedPostId !== null &&
        typeof cached.lastViewedPostId !== 'string') ||
      (cached.seenThroughPublishedAt !== null &&
        typeof cached.seenThroughPublishedAt !== 'string')
    ) {
      window.localStorage.removeItem(storageKey)
      return null
    }

    return {
      lastViewedPostId: cached.lastViewedPostId ?? null,
      seenThroughPublishedAt: cached.seenThroughPublishedAt ?? null,
    }
  } catch {
    return null
  }
}

export function writeTripProgress(
  key: TripProgressKey,
  progress: TripProgress,
) {
  try {
    window.localStorage.setItem(
      cacheKey(key),
      JSON.stringify({ cacheVersion: CACHE_VERSION, ...progress }),
    )
  } catch {
    // Progress tracking must never prevent the trip from rendering.
  }
}

export function updateLastViewedPost(
  key: TripProgressKey,
  postId: string,
) {
  const current = readTripProgress(key)
  writeTripProgress(key, {
    lastViewedPostId: postId,
    seenThroughPublishedAt: current?.seenThroughPublishedAt ?? null,
  })
}

export function getNewPostIds(
  posts: readonly PublishedPost[],
  previousProgress: TripProgress | null,
) {
  if (!previousProgress) {
    return []
  }

  const seenThrough = previousProgress.seenThroughPublishedAt
    ? Date.parse(previousProgress.seenThroughPublishedAt)
    : null

  return posts
    .filter((post) => {
      if (!post.publishedAt) return false
      return seenThrough === null || Date.parse(post.publishedAt) > seenThrough
    })
    .map((post) => post.id)
}

export function getLatestPublishedAt(posts: readonly PublishedPost[]) {
  let latest: string | null = null
  let latestTimestamp = Number.NEGATIVE_INFINITY

  for (const post of posts) {
    if (!post.publishedAt) continue
    const timestamp = Date.parse(post.publishedAt)
    if (timestamp > latestTimestamp) {
      latest = post.publishedAt
      latestTimestamp = timestamp
    }
  }

  return latest
}
