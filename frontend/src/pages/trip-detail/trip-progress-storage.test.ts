import { beforeEach, describe, expect, it } from 'vitest'

import {
  getLatestPublishedAt,
  getNewPostIds,
  readTripProgress,
  updateLastViewedPost,
  writeTripProgress,
} from './trip-progress-storage'

const progressKey = { tripId: 'trip-1', userId: 'user-1' }

describe('trip progress storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps progress separate for each user and visitor', () => {
    writeTripProgress(progressKey, {
      lastViewedPostId: 'post-1',
      seenThroughPublishedAt: '2026-09-18T10:00:00Z',
    })
    writeTripProgress({ tripId: 'trip-1', userId: null }, {
      lastViewedPostId: 'post-2',
      seenThroughPublishedAt: '2026-09-19T10:00:00Z',
    })

    expect(readTripProgress(progressKey)?.lastViewedPostId).toBe('post-1')
    expect(
      readTripProgress({ tripId: 'trip-1', userId: null })?.lastViewedPostId,
    ).toBe('post-2')
  })

  it('updates the viewed post without losing the publication watermark', () => {
    writeTripProgress(progressKey, {
      lastViewedPostId: 'post-1',
      seenThroughPublishedAt: '2026-09-18T10:00:00Z',
    })

    updateLastViewedPost(progressKey, 'post-2')

    expect(readTripProgress(progressKey)).toEqual({
      lastViewedPostId: 'post-2',
      seenThroughPublishedAt: '2026-09-18T10:00:00Z',
    })
  })

  it('does not label every post new on a first visit', () => {
    expect(
      getNewPostIds(
        [{ id: 'post-1', publishedAt: '2026-09-18T10:00:00Z' }],
        null,
      ),
    ).toEqual([])
  })

  it('labels only posts published after the previous visit', () => {
    const posts = [
      { id: 'old', publishedAt: '2026-09-18T10:00:00Z' },
      { id: 'draft', publishedAt: null },
      { id: 'new', publishedAt: '2026-09-19T10:00:00Z' },
    ]

    expect(
      getNewPostIds(posts, {
        lastViewedPostId: 'old',
        seenThroughPublishedAt: '2026-09-18T12:00:00Z',
      }),
    ).toEqual(['new'])
    expect(getLatestPublishedAt(posts)).toBe('2026-09-19T10:00:00Z')
  })

  it('treats the first publication after an empty visit as new', () => {
    expect(
      getNewPostIds(
        [{ id: 'new', publishedAt: '2026-09-19T10:00:00Z' }],
        { lastViewedPostId: null, seenThroughPublishedAt: null },
      ),
    ).toEqual(['new'])
  })
})
