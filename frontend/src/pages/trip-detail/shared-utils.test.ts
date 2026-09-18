import { describe, expect, it } from 'vitest'

import type { TravelPost } from './models'
import {
  getMapBubbleMedia,
  getMapBubbleThumbnailSrc,
  getPrimaryPostMedia,
} from './shared-utils'

const post = {
  bubbleMediaId: 'video-id',
  id: 'post-id',
  media: [
    {
      alt: 'Lead photo',
      media_id: 'photo-id',
      src: 'https://example.test/photo.jpg',
      type: 'image',
    },
    {
      alt: 'Selected video',
      media_id: 'video-id',
      src: 'https://example.test/video.mp4',
      type: 'video',
    },
  ],
} as unknown as TravelPost

describe('map bubble media helpers', () => {
  it('uses the persisted bubble selection without changing lead media', () => {
    expect(getPrimaryPostMedia(post).media_id).toBe('photo-id')
    expect(getMapBubbleMedia(post).media_id).toBe('video-id')
  })

  it('does not use a video content URL as a map image fallback', () => {
    expect(getMapBubbleThumbnailSrc(getMapBubbleMedia(post))).not.toBe(
      'https://example.test/video.mp4',
    )
  })
})
