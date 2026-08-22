import type * as L from 'leaflet'

import type {
  PostMedia,
  Stop,
  TravelMode,
  TravelPost,
} from './models'

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
  switch (travelMode) {
    case 'BIKE':
      return 'Bike'
    case 'BUS':
      return 'Bus'
    case 'CAR':
      return 'Car'
    case 'FERRY':
      return 'Ferry'
    case 'FLIGHT':
      return 'Flight'
    case 'MOTORCYCLE':
      return 'Motorcycle'
    case 'OTHER':
      return 'Other'
    case 'TRAIN':
      return 'Train'
    case 'WALK':
      return 'Walk'
    case 'UNKNOWN':
      return 'Unknown'
  }
}

export function getStopCoordinates(stop: Stop): L.LatLngTuple {
  return [stop.location.latitude, stop.location.longitude]
}

export function formatGpsCandidateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
