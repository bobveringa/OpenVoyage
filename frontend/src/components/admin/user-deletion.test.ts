import { describe, expect, it } from 'vitest'

import type { AdminUserDeletionImpact } from '@/api/client'
import {
  describeContentElsewhere,
  describeDeletedComments,
  describeDeletedTrips,
  describeReactionsOnPosts,
} from './user-deletion'

function impact(overrides: Partial<AdminUserDeletionImpact> = {}): AdminUserDeletionImpact {
  return {
    comments_on_remaining_posts_count: 0,
    deleted_comment_count: 0,
    deleted_reply_count: 0,
    deleted_shared_trip_count: 0,
    deleted_trip_count: 0,
    likes_on_remaining_posts_count: 0,
    photos_in_others_posts_count: 0,
    remaining_media_count: 0,
    remaining_post_count: 0,
    remaining_track_count: 0,
    user_id: 'user',
    ...overrides,
  }
}

describe('describeDeletedComments', () => {
  it('says nothing when the user left no comments', () => {
    expect(describeDeletedComments(impact())).toBeNull()
  })

  it('names the comments and the replies of other people that go with them', () => {
    expect(describeDeletedComments(impact({ deleted_comment_count: 1 }))).toBe(
      '1 comment they left in other people’s trips will be deleted.',
    )
    expect(
      describeDeletedComments(impact({ deleted_comment_count: 2, deleted_reply_count: 1 })),
    ).toBe(
      '2 comments they left in other people’s trips will be deleted, along with 1 reply from other people.',
    )
    expect(
      describeDeletedComments(impact({ deleted_comment_count: 4, deleted_reply_count: 3 })),
    ).toBe(
      '4 comments they left in other people’s trips will be deleted, along with 3 replies from other people.',
    )
  })
})

describe('describeReactionsOnPosts', () => {
  it('says nothing when other people did not react to the posts', () => {
    expect(describeReactionsOnPosts(impact())).toBeNull()
  })

  it('names the comments and likes of other people that go with the posts', () => {
    expect(describeReactionsOnPosts(impact({ comments_on_remaining_posts_count: 1 }))).toBe(
      'This also deletes 1 comment from other people on those posts.',
    )
    expect(describeReactionsOnPosts(impact({ likes_on_remaining_posts_count: 1 }))).toBe(
      'This also deletes 1 like from other people on those posts.',
    )
    expect(
      describeReactionsOnPosts(
        impact({ comments_on_remaining_posts_count: 20, likes_on_remaining_posts_count: 5 }),
      ),
    ).toBe('This also deletes 20 comments and 5 likes from other people on those posts.')
  })
})

describe('describeDeletedTrips', () => {
  it('says nothing when the user owns no trips alone', () => {
    expect(describeDeletedTrips(impact())).toBeNull()
  })

  it('warns when other people lose trips too', () => {
    expect(describeDeletedTrips(impact({ deleted_trip_count: 3 }))).toBe(
      'Their 3 trips will be deleted.',
    )
    expect(
      describeDeletedTrips(impact({ deleted_shared_trip_count: 8, deleted_trip_count: 30 })),
    ).toBe('Their 30 trips will be deleted, including 8 that are shared with other people.')
    expect(
      describeDeletedTrips(impact({ deleted_shared_trip_count: 1, deleted_trip_count: 2 })),
    ).toBe('Their 2 trips will be deleted, including 1 that is shared with other people.')
    expect(
      describeDeletedTrips(impact({ deleted_shared_trip_count: 2, deleted_trip_count: 2 })),
    ).toBe('Their 2 trips will be deleted, which are all shared with other people.')
    expect(
      describeDeletedTrips(impact({ deleted_shared_trip_count: 1, deleted_trip_count: 1 })),
    ).toBe('Their trip will be deleted, which is shared with other people.')
  })
})

describe('describeContentElsewhere', () => {
  it('lists what the user added to other trips', () => {
    expect(describeContentElsewhere(impact())).toBeNull()
    expect(describeContentElsewhere(impact({ remaining_post_count: 1 }))).toBe('1 post')
    expect(
      describeContentElsewhere(
        impact({
          photos_in_others_posts_count: 5,
          remaining_media_count: 48,
          remaining_post_count: 12,
          remaining_track_count: 3,
        }),
      ),
    ).toBe(
      '12 posts, 3 GPS tracks and 48 photos and videos, including 5 in other people’s posts',
    )
  })

  it('counts every photo and video, also outside other people’s posts', () => {
    expect(describeContentElsewhere(impact({ remaining_media_count: 1 }))).toBe(
      '1 photo or video',
    )
    expect(
      describeContentElsewhere(
        impact({ photos_in_others_posts_count: 2, remaining_media_count: 2 }),
      ),
    ).toBe('2 photos and videos in other people’s posts')
  })
})
