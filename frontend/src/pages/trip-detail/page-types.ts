import type * as L from 'leaflet'

import type { UserSearchResult } from '@/api/client'
import type {
  PostMedia,
  TravelMode,
  TripRole,
  TripVisibility,
} from './models'

export type MapPointTarget = 'post' | 'stop'

export type DraftMediaUploadStatus =
  | 'existing'
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'failed'

export type DraftMediaUploadState = {
  error: string | null
  loadedBytes: number | null
  mediaId: string | null
  progress: number | null
  status: DraftMediaUploadStatus
  totalBytes: number | null
}

export type DraftPostMedia = PostMedia & {
  clientId: string
  upload: DraftMediaUploadState
}

export type DraftPostLocation = {
  coordinates: L.LatLngTuple
  label: string
}

export type PostScrollRequest = {
  postId: string
  sequence: number
}

export type CreateStopDraft = {
  afterStopId: string | null
  coordinates: L.LatLngTuple
  notes: string
  placeId: string | null
  plannedNights: number
  plannedStartDate: string
  title: string
}

export type StopInsertionPoint = {
  afterStopId: string | null
  plannedStartDate: string
}

export type StopEditDraft = {
  notes: string
  plannedNights: number
  plannedStartDate: string
  title: string
}

export type TravelLegEditDraft = {
  notes: string
  operator: string | null
  reference: string | null
  travelMode: TravelMode
}

export type PostSubmitDraft = {
  coordinates: L.LatLngTuple
  locationLabel: string
  media: readonly PostMedia[]
  occurredAt: string
  placeId: string | null
  publish: boolean
  publicationAction?: 'draft' | 'publish'
  story: string
  title: string
}

export type PostSubmitIntent = 'draft' | 'publish' | 'save'

export type PendingPostSubmit = {
  draft: Omit<PostSubmitDraft, 'media'>
  intent: PostSubmitIntent
}

export type TripSettingsDraft = {
  coverFile: File | null
  description: string
  endDate: string | null
  name: string
  startDate: string
  visibility: TripVisibility
}

export type ShareLinkCreateDraft = {
  displayName: string | null
  displayNameLocked: boolean
  expiresAt: string | null
  interactionsEnabled: boolean
  label: string | null
}

export type UserLookupDraft = {
  role?: TripRole
  user: UserSearchResult
}
