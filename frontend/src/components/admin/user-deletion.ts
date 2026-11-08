import type { AdminUserDeletionImpact } from '@/api/client'
import { pluralize } from '@/lib/dates'

function joinList(parts: string[]): string {
  const last = parts[parts.length - 1] ?? ''
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${last}` : last
}

/** The trips that go with the user, or null when they own none alone. */
export function describeDeletedTrips(impact: AdminUserDeletionImpact): string | null {
  const trips = impact.deleted_trip_count
  if (trips === 0) {
    return null
  }
  const shared = impact.deleted_shared_trip_count
  const sharedText =
    shared === 0
      ? ''
      : trips === 1
        ? ', which is shared with other people'
        : shared === trips
          ? ', which are all shared with other people'
          : `, including ${shared} that ${shared === 1 ? 'is' : 'are'} shared with other people`
  return trips === 1
    ? `Their trip will be deleted${sharedText}.`
    : `Their ${trips} trips will be deleted${sharedText}.`
}

/** The comments that always go with the user, or null when there are none. */
export function describeDeletedComments(impact: AdminUserDeletionImpact): string | null {
  const comments = impact.deleted_comment_count
  if (comments === 0) {
    return null
  }
  const replies = impact.deleted_reply_count
  const repliesText =
    replies === 0
      ? ''
      : `, along with ${pluralize(replies, 'reply', 'replies')} from other people`
  return `${pluralize(comments, 'comment')} they left in other people’s trips will be deleted${repliesText}.`
}

/** What the user added to trips that stay, or null when there is nothing. */
export function describeContentElsewhere(impact: AdminUserDeletionImpact): string | null {
  const parts = [
    impact.remaining_post_count > 0 ? pluralize(impact.remaining_post_count, 'post') : null,
    impact.remaining_track_count > 0
      ? pluralize(impact.remaining_track_count, 'GPS track')
      : null,
    describeMedia(impact.remaining_media_count, impact.photos_in_others_posts_count),
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? joinList(parts) : null
}

/** What other people lose when the user's posts go, or null when nothing. */
export function describeReactionsOnPosts(impact: AdminUserDeletionImpact): string | null {
  const parts = [
    impact.comments_on_remaining_posts_count > 0
      ? pluralize(impact.comments_on_remaining_posts_count, 'comment')
      : null,
    impact.likes_on_remaining_posts_count > 0
      ? pluralize(impact.likes_on_remaining_posts_count, 'like')
      : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0
    ? `This also deletes ${joinList(parts)} from other people on those posts.`
    : null
}

function describeMedia(total: number, inOthersPosts: number): string | null {
  if (total === 0) {
    return null
  }
  const media = total === 1 ? '1 photo or video' : `${total} photos and videos`
  if (inOthersPosts === 0) {
    return media
  }
  return inOthersPosts === total
    ? `${media} in other people’s posts`
    : `${media}, including ${inOthersPosts} in other people’s posts`
}
