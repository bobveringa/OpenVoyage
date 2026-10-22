import type * as L from 'leaflet'

import type { ItineraryTravelLeg, Media, RouteOverview } from '@/api/client'

export type TripVisibility = 'PLATFORM_PUBLIC' | 'PRIVATE' | 'PUBLIC'
export type TripRole = 'MEMBER' | 'OWNER'
export type TravelMode =
  | 'BIKE'
  | 'BUS'
  | 'CAR'
  | 'FERRY'
  | 'FLIGHT'
  | 'MOTORCYCLE'
  | 'OTHER'
  | 'TRAIN'
  | 'UNKNOWN'
  | 'WALK'

export type TripViewModel = {
  description: string
  endDate: string
  id: string
  name: string
  startDate: string
  visibility: TripVisibility
}

export type TripMemberViewModel = {
  email: string
  id: string
  name: string
  profilePicture: Media | null
  role: TripRole
  userId?: string
  username: string | null
}

export type TripViewerViewModel = {
  email: string
  id: string
  name: string
  userId?: string
}

export type ShareLinkViewModel = {
  displayName: string | null
  displayNameLocked: boolean
  expiresAt: string | null
  id: string
  label: string
  lastUsedAt: string | null
  interactionsEnabled: boolean
  revokedAt: string | null
  token?: string | null
  tripId?: string
}

export type UserSummaryViewModel = {
  first_name: string | null
  id: string
  last_name: string | null
  username: string | null
}

export type ItineraryLocation = {
  country_code: string
  full_name: string
  id: string
  latitude: number
  longitude: number
  name: string
  region: string
}

export type Stop = {
  created_at: string
  created_by: UserSummaryViewModel
  id: string
  location: ItineraryLocation
  notes: string
  planned_nights: number
  planned_start_date: string
  same_day_position: number
  title: string
  trip_id: string
  updated_at: string
  visited: boolean
}

export type TravelLeg = ItineraryTravelLeg

// Map rendering accepts only the fields available to trip viewers. Planning
// models are structurally compatible and may supply editor-only decorations.
export type MapStop = Pick<Stop, 'id' | 'title' | 'location'> & { notes?: string }
export type MapTravelLeg = Omit<RouteOverview['legs'][number], 'segments'> & {
  segments: (RouteOverview['legs'][number]['segments'][number] & {
    route_options?: { geometry: ItineraryTravelLeg['route']['geometry'] }[]
  })[]
}

export type PostMedia = {
  alt: string
  file?: File
  media_id?: string
  poster?: string
  src: string
  thumbnail?: string
  type?: 'image' | 'video'
}

export type TravelPost = {
  author: {
    displayName: string
    id: string
    initials: string
    profilePicture: Media | null
  }
  coordinates: L.LatLngTuple
  bubbleMediaId: string | null
  excerpt: string
  id: string
  isDraft: boolean
  location: string
  media: readonly PostMedia[]
  occurredAt: string
  publishedAt: string | null
  revision: number
  routeAfter: TravelPostRoute | null
  time: string
  title: string
  social: {
    canInteract: boolean
    canLike: boolean
    commentCount: number
    likeCount: number
    viewerHasLiked: boolean
  }
}

export type TravelPostRoute = {
  durationSeconds: number | null
  segments: readonly TravelPostRouteSegment[]
}

export type TravelPostRouteSegment = {
  coordinates: L.LatLngTuple[]
  travelMode: TravelMode
  visibleToMembersOnly?: boolean
}

/** GPS-derived map data that does not belong to any single post. */
export type TripTrackingGeometry = {
  openingRoute: TravelPostRoute | null
}

export const EMPTY_TRACKING_GEOMETRY: TripTrackingGeometry = {
  openingRoute: null,
}
