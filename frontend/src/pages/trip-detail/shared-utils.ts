import type * as L from 'leaflet'

import { formatDateTime } from '@/lib/date-time'

import type {
  PostMedia,
  Stop,
  TravelMode,
  TravelPost,
} from './models'
import { travelModeOptions } from './planning-utils'

export function getPrimaryPostMedia(post: TravelPost): PostMedia {
  return (
    post.media.find((media) => getMediaType(media) === 'image') ?? post.media[0]
  )
}

export function getMapBubbleMedia(post: TravelPost): PostMedia {
  const bubbleMedia = post.media.find(
    (media) => media.media_id === post.bubbleMediaId,
  )
  if (!bubbleMedia) {
    throw new Error(`Post ${post.id} is missing its selected bubble media`)
  }
  return bubbleMedia
}

export function getMediaType(
  media: PostMedia,
): NonNullable<PostMedia['type']> {
  return media.type ?? 'image'
}

export function getMediaThumbnailSrc(media: PostMedia) {
  return media.thumbnail ?? media.poster ?? media.src
}

const mapBubblePlaceholder =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"%3E%3Crect width="44" height="44" fill="%23e2e8f0"/%3E%3Cpath d="m10 31 8-9 6 6 4-4 6 7H10Z" fill="%2394a3b8"/%3E%3C/svg%3E'

export function getMapBubbleThumbnailSrc(media: PostMedia) {
  if (getMediaType(media) === 'video') {
    return media.thumbnail ?? media.poster ?? mapBubblePlaceholder
  }
  return getMediaThumbnailSrc(media)
}

export function getTravelModeLabel(travelMode: TravelMode) {
  return (
    travelModeOptions.find((option) => option.value === travelMode)?.label ??
    'Unknown'
  )
}

export function getStopCoordinates(stop: Stop): L.LatLngTuple {
  return [stop.location.latitude, stop.location.longitude]
}

export function formatGpsCandidateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return formatDateTime(date, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
