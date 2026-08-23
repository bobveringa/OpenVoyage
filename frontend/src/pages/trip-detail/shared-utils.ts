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

export function getMediaType(
  media: PostMedia,
): NonNullable<PostMedia['type']> {
  return media.type ?? 'image'
}

export function getMediaThumbnailSrc(media: PostMedia) {
  return media.thumbnail ?? media.poster ?? media.src
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
