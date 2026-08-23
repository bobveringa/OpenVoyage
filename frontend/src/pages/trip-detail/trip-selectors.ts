import type { Stop, TravelPost } from './models'

export function getUpcomingStops(stops: readonly Stop[]) {
  return stops.filter((stop) => !stop.visited)
}

export function getTravelPostsInRouteOrder(
  travelPosts: readonly TravelPost[],
) {
  return [...travelPosts]
}

export function getMapFocusedPostId(
  postId: string,
  travelPosts: readonly TravelPost[],
) {
  const firstPost = getTravelPostsInRouteOrder(travelPosts)[0] ?? null

  return firstPost?.id === postId ? null : postId
}
