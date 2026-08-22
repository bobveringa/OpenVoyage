import createClient from 'openapi-fetch'

import type { components, paths } from '@/api/types'

// A deployed OpenVoyage instance serves the UI and API from the same origin.
// Keeping that as the default means a build can be moved to another host
// without baking a backend address into its JavaScript bundle. In the
// Capacitor native shell there is no meaningful same-origin default (the
// webview's own origin is not the API), so the native settings UI can call
// setApiBaseUrl() to override this at runtime — see native/server-config.ts.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? window.location.origin

let currentApiBaseUrl = API_BASE_URL.replace(/\/+$/, '')

export function getApiBaseUrl(): string {
  return currentApiBaseUrl
}

export function setApiBaseUrl(nextBaseUrl: string): void {
  currentApiBaseUrl = nextBaseUrl.replace(/\/+$/, '')
}

export const api = createClient<paths>({
  baseUrl: currentApiBaseUrl,
})

// openapi-fetch bakes the base URL into each client at creation time, so a
// runtime override (native "Server" field) needs to rewrite already-built
// request URLs rather than mutate `api` itself.
api.use({
  onRequest({ request }) {
    const target = new URL(request.url)
    const current = new URL(currentApiBaseUrl)
    if (target.origin === current.origin) {
      return undefined
    }
    return new Request(
      new URL(target.pathname + target.search, currentApiBaseUrl).toString(),
      request,
    )
  },
})

const API_V1_PREFIX = '/api/v1'
const SHARE_TOKEN_HEADER = 'X-Trip-Share-Token'
const API_REQUEST_TIMEOUT_MS = 10 * 1000

export type AuthTokens = components['schemas']['Token']
export type CurrentUser = components['schemas']['CurrentUserResponse']
export type SetupCreatePayload = components['schemas']['SetupCreateRequest']
export type SetupStatus = components['schemas']['SetupStatusResponse']
export type User = components['schemas']['UserResponse']
export type Trip = components['schemas']['TripResponse']
export type TripCreatePayload = components['schemas']['TripCreateRequest']
export type TripSortField = components['schemas']['TripSortField']
export type TripStatusFilter = components['schemas']['TripStatusFilter']
export type TripVisibility = components['schemas']['TripVisibility']
export type GeoJsonLineString = components['schemas']['GeoJsonLineString']
export type Itinerary = components['schemas']['ItineraryResponse']
export type ItineraryStop = components['schemas']['ItineraryStopResponse']
export type ItineraryTravelLeg =
  components['schemas']['ItineraryTravelLegResponse']
export type ItineraryTravelRoute =
  components['schemas']['ItineraryTravelRouteResponse']
export type ItineraryRouteType = components['schemas']['ItineraryRouteType']
export type ItineraryStopCreatePayload =
  components['schemas']['ItineraryStopCreateRequest']
export type ItineraryStopUpdatePayload =
  components['schemas']['ItineraryStopUpdateRequest']
export type ItineraryTravelReplacePayload =
  components['schemas']['ItineraryTravelReplaceRequest']
export type Media = components['schemas']['MediaResponse']
export type MediaUploadResponse = components['schemas']['MediaUploadResponse']
export type MediaUploadProgress = {
  lengthComputable: boolean
  loaded: number
  progress: number | null
  total: number | null
}
export type AdminSetting = components['schemas']['AdminSettingResponse']
export type AdminSettingsList =
  components['schemas']['AdminSettingsListResponse']
export type AdminSettingUpdatePayload =
  components['schemas']['AppSettingUpdateRequest']
export type AdminUser = components['schemas']['AdminUserResponse']
export type AdminUserCreatePayload =
  components['schemas']['AdminUserCreateRequest']
export type AdminUserDeleteResult =
  components['schemas']['AdminUserDeleteResponse']
export type AdminUserUpdatePayload =
  components['schemas']['AdminUserUpdateRequest']
export type AdminUserPasswordSetPayload =
  components['schemas']['AdminUserPasswordSetRequest']
export type AdminUsersList = components['schemas']['AdminUsersListResponse']
export type PublicSettings = components['schemas']['PublicSettingsResponse']
export type SettingValidation = NonNullable<AdminSetting['validation']>
export type SettingValueType = components['schemas']['SettingValueType']
export type SettingVisibility = components['schemas']['SettingVisibility']
export type Place = components['schemas']['PlaceResponse']
export type ReverseGeocodeResult =
  components['schemas']['ReverseGeocodeResponse']
export type Post = components['schemas']['PostResponse']
export type PostCreatePayload = components['schemas']['PostCreateRequest']
export type PostTimelineEntry =
  components['schemas']['PostTimelineEntryResponse']
export type PostTimelineRoute =
  components['schemas']['PostTimelineRouteResponse']
export type PostTimelineOpeningRoute =
  components['schemas']['PostTimelineOpeningRouteResponse']
export type PostTimeline = components['schemas']['PostTimelineResponse']
export type PostTimelineRouteSegment =
  components['schemas']['PostTimelineRouteSegmentResponse']
export type GpsPrivacyZone = components['schemas']['GpsPrivacyZoneResponse']
export type GpsPrivacyZonePayload =
  components['schemas']['GpsPrivacyZoneRequest']
export type TripLiveLocationSettings =
  components['schemas']['TripLiveLocationSettingsResponse']
export type TrackingSession = components['schemas']['TrackingSessionResponse']
export type TrackSample = components['schemas']['TrackSampleResponse']
export type GpsPostCandidate = components['schemas']['GpsPostCandidateResponse']
export type TrackSamplePage =
  components['schemas']['CursorPaginatedResponse_TrackSampleResponse_']
export type TrackSampleBatchResult =
  components['schemas']['TrackSampleBatchResponse']
export type TrackSampleInput = components['schemas']['TrackSampleRequest']
export type TravelMode = components['schemas']['TravelMode']
export type PostUpdatePayload = components['schemas']['PostUpdateRequest']
export type UserProfileUpdatePayload =
  components['schemas']['UserProfileUpdateRequest']
export type PasswordChangePayload = components['schemas']['PasswordChangeRequest']
export type UserSummary = components['schemas']['UserSummaryResponse']
export type UserSearchResult = components['schemas']['UserSearchResultResponse']
export type UsernameAvailability =
  components['schemas']['UsernameAvailabilityResponse']
export type PaginatedPosts =
  components['schemas']['PaginatedResponse_PostResponse_']
export type PaginatedTrips =
  components['schemas']['PaginatedResponse_TripResponse_']
export type PaginatedUsers =
  components['schemas']['PaginatedResponse_UserSearchResultResponse_']
export type TripMember = components['schemas']['TripMemberResponse']
export type TripMemberCreatePayload =
  components['schemas']['TripMemberCreateRequest']
export type TripMemberUpdatePayload =
  components['schemas']['TripMemberUpdateRequest']
export type TripShareLink = components['schemas']['TripShareLinkResponse']
export type TripShareLinkCreatePayload =
  components['schemas']['TripShareLinkCreateRequest']
export type TripShareLinkCreateResponse =
  components['schemas']['TripShareLinkCreateResponse']
export type TripUpdatePayload = components['schemas']['TripUpdateRequest']
export type TripViewer = components['schemas']['TripViewerResponse']
export type TripViewerCreatePayload =
  components['schemas']['TripViewerCreateRequest']

type QueryValue = string | number | boolean | null | undefined

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  accessToken?: string | null
  headers?: Record<string, string>
  ifMatchRevision?: number
  shareToken?: string | null
  query?: Record<string, QueryValue>
  json?: unknown
  formData?: FormData
  urlEncoded?: URLSearchParams
}

type AuthTokenRefreshHandler = (options: {
  accessToken: string
  forceRefresh: boolean
}) => Promise<string | null>

type PasswordChangeRequiredHandler = () => void

let authTokenRefreshHandler: AuthTokenRefreshHandler | null = null
let passwordChangeRequiredHandler: PasswordChangeRequiredHandler | null = null

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, message: string, detail: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

class ApiRequestTimeoutError extends Error {
  constructor() {
    super('The server did not respond in time. Please try again shortly.')
    this.name = 'ApiRequestTimeoutError'
  }
}

export function configureAuthTokenRefresh(
  handler: AuthTokenRefreshHandler | null,
) {
  authTokenRefreshHandler = handler
}

export function configurePasswordChangeRequired(
  handler: PasswordChangeRequiredHandler | null,
) {
  passwordChangeRequiredHandler = handler
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Something went wrong'
}

export async function login(
  email: string,
  password: string,
): Promise<AuthTokens> {
  const body = new URLSearchParams()
  body.set('username', email)
  body.set('password', password)

  return requestJson<AuthTokens>(`${API_V1_PREFIX}/login/access-token`, {
    method: 'POST',
    urlEncoded: body,
  })
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return requestJson<SetupStatus>(`${API_V1_PREFIX}/admin/setup`)
}

export async function createSetupAdmin(
  payload: SetupCreatePayload,
): Promise<void> {
  await requestJson(`${API_V1_PREFIX}/admin/setup`, {
    method: 'POST',
    json: payload,
  })
}

export async function refreshAuthTokens(
  refreshToken: string,
): Promise<AuthTokens> {
  return requestJson<AuthTokens>(`${API_V1_PREFIX}/login/refresh-token`, {
    method: 'POST',
    json: {
      refresh_token: refreshToken,
    },
  })
}

export async function readCurrentUser(accessToken: string): Promise<CurrentUser> {
  return requestJson<CurrentUser>(`${API_V1_PREFIX}/users/me`, {
    accessToken,
  })
}

export async function changeOwnPassword(
  payload: PasswordChangePayload,
  accessToken: string,
): Promise<AuthTokens> {
  return requestJson<AuthTokens>(`${API_V1_PREFIX}/users/me/password`, {
    method: 'PUT',
    accessToken,
    json: payload,
  })
}

export async function signOutAllDevices(accessToken: string): Promise<void> {
  return requestJson<void>(`${API_V1_PREFIX}/users/me/sign-out-all`, {
    method: 'POST',
    accessToken,
  })
}

export type JobExecution = {
  id: string
  job_key: string
  trigger: 'SCHEDULED' | 'STARTUP' | 'MANUAL'
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'
  requested_by: string | null
  summary: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type ScheduledJob = {
  key: string
  name: string
  description: string
  schedule: {
    enabled: boolean
    cron: string
    timezone: string
    next_run_at: string | null
    error: string | null
  }
  defaults: {
    enabled: boolean
    cron: string
    timezone: string
  }
  executions: {
    active: JobExecution | null
    latest: JobExecution | null
  }
  audit: {
    updated_by: string | null
    updated_at: string
  }
}

export async function listJobs(accessToken: string): Promise<ScheduledJob[]> {
  const response = await requestJson<{ jobs: ScheduledJob[] }>(
    `${API_V1_PREFIX}/admin/jobs`,
    { accessToken },
  )
  return response.jobs
}

export async function updateJob(options: {
  accessToken: string
  key: string
  enabled: boolean
  cron: string
  timezone: string
}): Promise<ScheduledJob> {
  return requestJson<ScheduledJob>(
    `${API_V1_PREFIX}/admin/jobs/${encodeURIComponent(options.key)}`,
    {
      method: 'PATCH',
      accessToken: options.accessToken,
      json: {
        enabled: options.enabled,
        cron: options.cron,
        timezone: options.timezone,
      },
    },
  )
}

export async function resetJob(options: {
  accessToken: string
  key: string
}): Promise<ScheduledJob> {
  return requestJson<ScheduledJob>(
    `${API_V1_PREFIX}/admin/jobs/${encodeURIComponent(options.key)}/reset`,
    { method: 'POST', accessToken: options.accessToken },
  )
}

export async function runJob(options: {
  accessToken: string
  key: string
}): Promise<JobExecution> {
  return requestJson<JobExecution>(
    `${API_V1_PREFIX}/admin/jobs/${encodeURIComponent(options.key)}/executions`,
    { method: 'POST', accessToken: options.accessToken },
  )
}

export async function getJobExecution(options: {
  accessToken: string
  executionId: string
}): Promise<JobExecution> {
  return requestJson<JobExecution>(
    `${API_V1_PREFIX}/admin/job-executions/${encodeURIComponent(options.executionId)}`,
    { accessToken: options.accessToken },
  )
}

export async function listAdminSettings(
  accessToken: string,
): Promise<AdminSettingsList> {
  return requestJson<AdminSettingsList>(`${API_V1_PREFIX}/admin/settings`, {
    accessToken,
  })
}

export async function listAdminUsers(options: {
  accessToken: string
  page?: number
  pageSize?: number
  query?: string
  role?: 'ADMIN' | 'COMPANION' | 'USER'
}): Promise<AdminUsersList> {
  return requestJson<AdminUsersList>(`${API_V1_PREFIX}/admin/users`, {
    accessToken: options.accessToken,
    query: {
      page: options.page ?? 1,
      page_size: options.pageSize ?? 20,
      query: options.query || undefined,
      role: options.role,
    },
  })
}

export async function createAdminUser(options: {
  accessToken: string
  payload: AdminUserCreatePayload
}): Promise<AdminUser> {
  return requestJson<AdminUser>(`${API_V1_PREFIX}/admin/users`, {
    method: 'POST',
    accessToken: options.accessToken,
    json: options.payload,
  })
}

export async function updateAdminUser(options: {
  accessToken: string
  payload: AdminUserUpdatePayload
  userId: string
}): Promise<AdminUser> {
  return requestJson<AdminUser>(
    `${API_V1_PREFIX}/admin/users/${encodeURIComponent(options.userId)}`,
    {
      method: 'PATCH',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
}

export async function setAdminUserPassword(options: {
  accessToken: string
  payload: AdminUserPasswordSetPayload
  userId: string
}): Promise<void> {
  return requestJson<void>(
    `${API_V1_PREFIX}/admin/users/${encodeURIComponent(options.userId)}/password`,
    {
      method: 'PUT',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
}

export async function deleteAdminUser(options: {
  accessToken: string
  userId: string
}): Promise<AdminUserDeleteResult> {
  return requestJson<AdminUserDeleteResult>(
    `${API_V1_PREFIX}/admin/users/${encodeURIComponent(options.userId)}`,
    {
      method: 'DELETE',
      accessToken: options.accessToken,
    },
  )
}

export async function getPublicSettings(): Promise<PublicSettings> {
  return requestJson<PublicSettings>(`${API_V1_PREFIX}/settings/public`)
}

export async function updateAdminSetting(options: {
  accessToken: string
  key: string
  value: AdminSettingUpdatePayload['value']
}): Promise<AdminSetting> {
  return requestJson<AdminSetting>(
    `${API_V1_PREFIX}/admin/settings/${encodeURIComponent(options.key)}`,
    {
      accessToken: options.accessToken,
      json: { value: options.value },
      method: 'PATCH',
    },
  )
}

export async function resetAdminSetting(options: {
  accessToken: string
  key: string
}): Promise<AdminSetting> {
  return requestJson<AdminSetting>(
    `${API_V1_PREFIX}/admin/settings/${encodeURIComponent(options.key)}/reset`,
    {
      accessToken: options.accessToken,
      method: 'POST',
    },
  )
}

export async function geocodePlaces(options: {
  countryCode?: string | null
  limit?: number
  query: string
}): Promise<Place[]> {
  return requestJson<Place[]>(`${API_V1_PREFIX}/places/geocode`, {
    query: {
      country_code: options.countryCode,
      limit: options.limit ?? 10,
      query: options.query,
    },
  })
}

export async function reverseGeocodePlaces(options: {
  latitude: number
  limit?: number
  longitude: number
  maxDistanceKm?: number | null
}): Promise<ReverseGeocodeResult[]> {
  return requestJson<ReverseGeocodeResult[]>(
    `${API_V1_PREFIX}/places/reverse-geocode`,
    {
      query: {
        latitude: options.latitude,
        limit: options.limit ?? 1,
        longitude: options.longitude,
        max_distance_km: options.maxDistanceKm,
      },
    },
  )
}

export async function updateUserProfile(
  payload: UserProfileUpdatePayload,
  accessToken: string,
): Promise<CurrentUser> {
  return requestJson<CurrentUser>(`${API_V1_PREFIX}/users/me`, {
    method: 'PATCH',
    accessToken,
    json: payload,
  })
}

export async function checkUsernameAvailability(options: {
  accessToken?: string | null
  username: string
}): Promise<UsernameAvailability> {
  return requestJson<UsernameAvailability>(
    `${API_V1_PREFIX}/users/username-availability`,
    {
      accessToken: options.accessToken,
      query: {
        username: options.username,
      },
    },
  )
}

export async function searchUsers(options: {
  accessToken: string
  excludeCurrentUser?: boolean
  page?: number
  pageSize?: number
  query: string
}): Promise<PaginatedUsers> {
  return requestJson<PaginatedUsers>(`${API_V1_PREFIX}/users`, {
    accessToken: options.accessToken,
    query: {
      exclude_current_user: options.excludeCurrentUser,
      page: options.page ?? 1,
      page_size: options.pageSize ?? 10,
      query: options.query,
    },
  })
}

export async function getUserByUsername(username: string): Promise<User> {
  return requestJson<User>(
    `${API_V1_PREFIX}/users/by-username/${encodeURIComponent(username)}`,
  )
}

export async function listTrips(options: {
  accessToken?: string | null
  page?: number
  pageSize?: number
  sortBy?: TripSortField
  sortOrder?: 'asc' | 'desc'
  status?: TripStatusFilter
  userId: string
}): Promise<PaginatedTrips> {
  return requestJson<PaginatedTrips>(`${API_V1_PREFIX}/trips`, {
    accessToken: options.accessToken,
    query: {
      user_id: options.userId,
      sort_by: options.sortBy,
      sort_order: options.sortOrder,
      status: options.status,
      page: options.page ?? 1,
      page_size: options.pageSize ?? 50,
    },
  })
}

export async function uploadMedia(
  file: File,
  accessToken: string,
): Promise<string> {
  const response = await uploadMediaWithProgress({ accessToken, file })
  return response.id
}

export async function uploadMediaWithProgress(options: {
  accessToken: string
  file: File
  onProgress?: (progress: MediaUploadProgress) => void
  signal?: AbortSignal
}): Promise<MediaUploadResponse> {
  const requestedAccessToken = options.accessToken
  let accessToken = await resolveAccessToken(requestedAccessToken, false)

  try {
    return await sendMediaUploadRequest(options, accessToken)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error
    }

    const refreshedAccessToken = await resolveAccessToken(accessToken, true)
    if (!refreshedAccessToken || refreshedAccessToken === accessToken) {
      throw error
    }

    accessToken = refreshedAccessToken
    return sendMediaUploadRequest(options, accessToken)
  }
}

export async function createTrip(
  payload: TripCreatePayload,
  accessToken: string,
): Promise<Trip> {
  return requestJson<Trip>(`${API_V1_PREFIX}/trips`, {
    method: 'POST',
    accessToken,
    json: payload,
  })
}

export async function updateTrip(options: {
  tripId: string
  payload: TripUpdatePayload
  accessToken: string
}): Promise<Trip> {
  return requestJson<Trip>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}`,
    {
      method: 'PATCH',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
}

export async function deleteTrip(options: {
  tripId: string
  accessToken: string
}): Promise<void> {
  return requestJson<void>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}`,
    {
      method: 'DELETE',
      accessToken: options.accessToken,
    },
  )
}

export async function getTrip(options: {
  tripId: string
  accessToken?: string | null
  shareToken?: string | null
}): Promise<Trip> {
  return requestJson<Trip>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}`,
    {
      accessToken: options.accessToken,
      shareToken: options.shareToken,
    },
  )
}

export async function listTripMembers(options: {
  tripId: string
  accessToken?: string | null
  shareToken?: string | null
}): Promise<TripMember[]> {
  return requestJson<TripMember[]>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/members`,
    {
      accessToken: options.accessToken,
      shareToken: options.shareToken,
    },
  )
}

export async function addTripMember(options: {
  tripId: string
  payload: TripMemberCreatePayload
  accessToken: string
}): Promise<TripMember> {
  return requestJson<TripMember>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/members`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
}

export async function updateTripMember(options: {
  tripId: string
  userId: string
  payload: TripMemberUpdatePayload
  accessToken: string
}): Promise<TripMember> {
  const tripId = encodeURIComponent(options.tripId)
  const userId = encodeURIComponent(options.userId)

  return requestJson<TripMember>(`${API_V1_PREFIX}/trips/${tripId}/members/${userId}`, {
    method: 'PATCH',
    accessToken: options.accessToken,
    json: options.payload,
  })
}

export async function removeTripMember(options: {
  tripId: string
  userId: string
  accessToken: string
}): Promise<void> {
  const tripId = encodeURIComponent(options.tripId)
  const userId = encodeURIComponent(options.userId)

  return requestJson<void>(`${API_V1_PREFIX}/trips/${tripId}/members/${userId}`, {
    method: 'DELETE',
    accessToken: options.accessToken,
  })
}

export async function listTripViewers(options: {
  tripId: string
  accessToken: string
}): Promise<TripViewer[]> {
  return requestJson<TripViewer[]>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/viewers`,
    {
      accessToken: options.accessToken,
    },
  )
}

export async function addTripViewer(options: {
  tripId: string
  payload: TripViewerCreatePayload
  accessToken: string
}): Promise<TripViewer> {
  return requestJson<TripViewer>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/viewers`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
}

export async function removeTripViewer(options: {
  tripId: string
  userId: string
  accessToken: string
}): Promise<void> {
  const tripId = encodeURIComponent(options.tripId)
  const userId = encodeURIComponent(options.userId)

  return requestJson<void>(`${API_V1_PREFIX}/trips/${tripId}/viewers/${userId}`, {
    method: 'DELETE',
    accessToken: options.accessToken,
  })
}

export async function listTripShareLinks(options: {
  tripId: string
  accessToken: string
}): Promise<TripShareLink[]> {
  return requestJson<TripShareLink[]>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/share-links`,
    {
      accessToken: options.accessToken,
    },
  )
}

export async function createTripShareLink(options: {
  tripId: string
  payload: TripShareLinkCreatePayload
  accessToken: string
}): Promise<TripShareLinkCreateResponse> {
  return requestJson<TripShareLinkCreateResponse>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/share-links`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
}

export async function revokeTripShareLink(options: {
  tripId: string
  shareLinkId: string
  accessToken: string
}): Promise<void> {
  const tripId = encodeURIComponent(options.tripId)
  const shareLinkId = encodeURIComponent(options.shareLinkId)

  return requestJson<void>(
    `${API_V1_PREFIX}/trips/${tripId}/share-links/${shareLinkId}`,
    {
      method: 'DELETE',
      accessToken: options.accessToken,
    },
  )
}

export async function getItinerary(options: {
  tripId: string
  accessToken?: string | null
  shareToken?: string | null
}): Promise<Itinerary> {
  return requestJson<Itinerary>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/itinerary`,
    {
      accessToken: options.accessToken,
      shareToken: options.shareToken,
    },
  )
}

export async function createItineraryStop(options: {
  tripId: string
  payload: ItineraryStopCreatePayload
  accessToken: string
  itineraryRevision: number
}): Promise<Itinerary> {
  return requestJson<Itinerary>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/itinerary/stops`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      ifMatchRevision: options.itineraryRevision,
      json: options.payload,
    },
  )
}

export async function updateItineraryStop(options: {
  tripId: string
  stopId: string
  payload: ItineraryStopUpdatePayload
  accessToken: string
  itineraryRevision: number
}): Promise<Itinerary> {
  const tripId = encodeURIComponent(options.tripId)
  const stopId = encodeURIComponent(options.stopId)

  return requestJson<Itinerary>(
    `${API_V1_PREFIX}/trips/${tripId}/itinerary/stops/${stopId}`,
    {
      method: 'PATCH',
      accessToken: options.accessToken,
      ifMatchRevision: options.itineraryRevision,
      json: options.payload,
    },
  )
}

export async function deleteItineraryStop(options: {
  tripId: string
  stopId: string
  accessToken: string
  itineraryRevision: number
}): Promise<Itinerary> {
  const tripId = encodeURIComponent(options.tripId)
  const stopId = encodeURIComponent(options.stopId)

  return requestJson<Itinerary>(
    `${API_V1_PREFIX}/trips/${tripId}/itinerary/stops/${stopId}`,
    {
      method: 'DELETE',
      accessToken: options.accessToken,
      ifMatchRevision: options.itineraryRevision,
    },
  )
}

export async function replaceItineraryTravelLeg(options: {
  tripId: string
  legId: string
  payload: ItineraryTravelReplacePayload
  accessToken: string
  itineraryRevision: number
}): Promise<{ itineraryRevision: number | null; leg: ItineraryTravelLeg }> {
  const tripId = encodeURIComponent(options.tripId)
  const legId = encodeURIComponent(options.legId)

  const result = await requestJsonResponse<ItineraryTravelLeg>(
    `${API_V1_PREFIX}/trips/${tripId}/itinerary/legs/${legId}`,
    {
      method: 'PUT',
      accessToken: options.accessToken,
      ifMatchRevision: options.itineraryRevision,
      json: options.payload,
    },
  )

  return {
    itineraryRevision: readEtagRevision(result.response),
    leg: result.data,
  }
}

export async function refreshItineraryTravelLegRoute(options: {
  tripId: string
  legId: string
  accessToken: string
}): Promise<{ itineraryRevision: number | null; leg: ItineraryTravelLeg }> {
  const tripId = encodeURIComponent(options.tripId)
  const legId = encodeURIComponent(options.legId)

  const result = await requestJsonResponse<ItineraryTravelLeg>(
    `${API_V1_PREFIX}/trips/${tripId}/itinerary/legs/${legId}/route-refresh`,
    {
      method: 'POST',
      accessToken: options.accessToken,
    },
  )

  return {
    itineraryRevision: readEtagRevision(result.response),
    leg: result.data,
  }
}

export async function listPosts(options: {
  tripId: string
  accessToken?: string | null
  page?: number
  pageSize?: number
  shareToken?: string | null
  sortBy?: components['schemas']['PostSortField']
  sortOrder?: 'asc' | 'desc'
  status?: components['schemas']['PostStatusFilter']
}): Promise<PaginatedPosts> {
  return requestJson<PaginatedPosts>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/posts`,
    {
      accessToken: options.accessToken,
      shareToken: options.shareToken,
      query: {
        page: options.page ?? 1,
        page_size: options.pageSize ?? 50,
        sort_by: options.sortBy,
        sort_order: options.sortOrder,
        status: options.status,
      },
    },
  )
}

export async function getPostTimeline(options: {
  tripId: string
  accessToken?: string | null
  shareToken?: string | null
  status?: components['schemas']['PostStatusFilter']
}): Promise<PostTimeline> {
  return requestJson<PostTimeline>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/posts/timeline`,
    {
      accessToken: options.accessToken,
      shareToken: options.shareToken,
      query: {
        status: options.status,
      },
    },
  )
}

export async function createPost(options: {
  tripId: string
  payload: PostCreatePayload
  accessToken: string
}): Promise<Post> {
  return requestJson<Post>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/posts`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
}

export async function updatePost(options: {
  tripId: string
  postId: string
  payload: PostUpdatePayload
  accessToken: string
}): Promise<Post> {
  const tripId = encodeURIComponent(options.tripId)
  const postId = encodeURIComponent(options.postId)

  return requestJson<Post>(`${API_V1_PREFIX}/trips/${tripId}/posts/${postId}`, {
    method: 'PATCH',
    accessToken: options.accessToken,
    json: options.payload,
  })
}

export async function deletePost(options: {
  tripId: string
  postId: string
  accessToken: string
}): Promise<void> {
  const tripId = encodeURIComponent(options.tripId)
  const postId = encodeURIComponent(options.postId)

  return requestJson<void>(`${API_V1_PREFIX}/trips/${tripId}/posts/${postId}`, {
    method: 'DELETE',
    accessToken: options.accessToken,
  })
}

export async function publishPost(options: {
  tripId: string
  postId: string
  accessToken: string
}): Promise<Post> {
  const tripId = encodeURIComponent(options.tripId)
  const postId = encodeURIComponent(options.postId)

  return requestJson<Post>(
    `${API_V1_PREFIX}/trips/${tripId}/posts/${postId}/publish`,
    {
      method: 'POST',
      accessToken: options.accessToken,
    },
  )
}


// ---------------------------------------------------------------------------
// GPS tracking
//
// Zones live under the current user because their configuration never leaves
// the owning account. Everything else is trip-scoped.
// ---------------------------------------------------------------------------
export async function listGpsPrivacyZones(options: {
  accessToken: string
}): Promise<GpsPrivacyZone[]> {
  return requestJson<GpsPrivacyZone[]>(
    `${API_V1_PREFIX}/users/me/gps-privacy-zones`,
    { accessToken: options.accessToken },
  )
}

export async function createGpsPrivacyZone(options: {
  payload: GpsPrivacyZonePayload
  accessToken: string
}): Promise<GpsPrivacyZone> {
  const result = await requestJson<{ zone: GpsPrivacyZone }>(
    `${API_V1_PREFIX}/users/me/gps-privacy-zones`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
  return result.zone
}

export async function replaceGpsPrivacyZone(options: {
  zoneId: string
  payload: GpsPrivacyZonePayload
  accessToken: string
}): Promise<GpsPrivacyZone> {
  const result = await requestJson<{ zone: GpsPrivacyZone }>(
    `${API_V1_PREFIX}/users/me/gps-privacy-zones/${encodeURIComponent(options.zoneId)}`,
    {
      method: 'PUT',
      accessToken: options.accessToken,
      json: options.payload,
    },
  )
  return result.zone
}

export async function deleteGpsPrivacyZone(options: {
  zoneId: string
  accessToken: string
}): Promise<void> {
  await requestJson<void>(
    `${API_V1_PREFIX}/users/me/gps-privacy-zones/${encodeURIComponent(options.zoneId)}`,
    { method: 'DELETE', accessToken: options.accessToken },
  )
}

export async function getTripLiveLocationSettings(options: {
  tripId: string
  accessToken: string
}): Promise<TripLiveLocationSettings> {
  return requestJson<TripLiveLocationSettings>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/live-location-settings`,
    { accessToken: options.accessToken },
  )
}

export async function replaceTripLiveLocationSettings(options: {
  tripId: string
  shareLiveLocation: boolean
  accessToken: string
}): Promise<TripLiveLocationSettings> {
  return requestJson<TripLiveLocationSettings>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/live-location-settings`,
    {
      method: 'PUT',
      accessToken: options.accessToken,
      json: { share_live_location: options.shareLiveLocation },
    },
  )
}

export async function listTrackingSessions(options: {
  tripId: string
  accessToken: string
}): Promise<TrackingSession[]> {
  const result = await requestJson<{ sessions: TrackingSession[] }>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/sessions`,
    { accessToken: options.accessToken },
  )
  return result.sessions
}

export async function listGpsPostCandidates(options: {
  tripId: string
  accessToken: string
}): Promise<GpsPostCandidate[]> {
  return requestJson<GpsPostCandidate[]>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/post-candidates`,
    { accessToken: options.accessToken },
  )
}

// Same request as listTrackingSessions, but also surfaces the response's
// Date header so the pre-start flow can run its clock-skew check (§3.1)
// without a second round trip.
export async function listTrackingSessionsWithServerDate(options: {
  tripId: string
  accessToken: string
}): Promise<{ sessions: TrackingSession[]; serverDate: Date | null }> {
  const { data, response } = await requestJsonResponse<{
    sessions: TrackingSession[]
  }>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/sessions`,
    { accessToken: options.accessToken },
  )
  const dateHeader = response.headers.get('Date')
  const serverDate = dateHeader ? new Date(dateHeader) : null
  return {
    serverDate: serverDate && !Number.isNaN(serverDate.getTime()) ? serverDate : null,
    sessions: data.sessions,
  }
}

export async function createTrackingSession(options: {
  tripId: string
  sessionId: string
  startedAt: string
  endedAt?: string | null
  accessToken: string
}): Promise<TrackingSession> {
  return requestJson<TrackingSession>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/sessions/${encodeURIComponent(options.sessionId)}`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: {
        started_at: options.startedAt,
        ended_at: options.endedAt ?? null,
      },
    },
  )
}

export async function endTrackingSession(options: {
  tripId: string
  sessionId: string
  endedAt: string
  accessToken: string
}): Promise<TrackingSession> {
  return requestJson<TrackingSession>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/sessions/${encodeURIComponent(options.sessionId)}`,
    {
      method: 'PATCH',
      accessToken: options.accessToken,
      json: { ended_at: options.endedAt },
    },
  )
}

export async function deleteTrackingSession(options: {
  tripId: string
  sessionId: string
  accessToken: string
}): Promise<void> {
  await requestJson<void>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/sessions/${encodeURIComponent(options.sessionId)}`,
    { method: 'DELETE', accessToken: options.accessToken },
  )
}

// Also surfaces the response's Date header (same pattern as
// listTrackingSessionsWithServerDate) so the uploader can re-check clock
// skew whenever a batch comes back with a non-zero discarded count, without
// a second round trip (U1).
export async function uploadTrackSamples(options: {
  tripId: string
  sessionId: string
  samples: TrackSampleInput[]
  accessToken: string
}): Promise<{ result: TrackSampleBatchResult; serverDate: Date | null }> {
  const { data, response } = await requestJsonResponse<TrackSampleBatchResult>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/sessions/${encodeURIComponent(options.sessionId)}/samples/batch`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: { samples: options.samples },
    },
  )
  const dateHeader = response.headers.get('Date')
  const serverDate = dateHeader ? new Date(dateHeader) : null
  return {
    result: data,
    serverDate: serverDate && !Number.isNaN(serverDate.getTime()) ? serverDate : null,
  }
}

export async function listTrackSamples(options: {
  tripId: string
  sessionId: string
  limit?: number
  cursor?: string | null
  accessToken: string
}): Promise<TrackSamplePage> {
  return requestJson<TrackSamplePage>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/sessions/${encodeURIComponent(options.sessionId)}/samples`,
    {
      accessToken: options.accessToken,
      query: {
        limit: options.limit,
        cursor: options.cursor ?? undefined,
      },
    },
  )
}

export async function updateTrackSampleModes(options: {
  tripId: string
  sampleIds: string[]
  travelMode: TravelMode
  accessToken: string
}): Promise<number> {
  const result = await requestJson<{ updated_count: number }>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/samples/travel-mode`,
    {
      method: 'PATCH',
      accessToken: options.accessToken,
      json: {
        sample_ids: options.sampleIds,
        travel_mode: options.travelMode,
      },
    },
  )
  return result.updated_count
}

export async function deleteTrackSamples(options: {
  tripId: string
  sampleIds: string[]
  accessToken: string
}): Promise<number> {
  const result = await requestJson<{ deleted_count: number }>(
    `${API_V1_PREFIX}/trips/${encodeURIComponent(options.tripId)}/tracking/samples/delete`,
    {
      method: 'POST',
      accessToken: options.accessToken,
      json: { sample_ids: options.sampleIds },
    },
  )
  return result.deleted_count
}

async function requestJson<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  return (await requestJsonResponse<T>(path, options)).data
}

async function requestJsonResponse<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<{ data: T; response: Response }> {
  const url = buildApiUrl(path, options.query)
  const requestedAccessToken = options.accessToken ?? null
  let accessToken = await resolveAccessToken(requestedAccessToken, false)

  let response = await sendApiRequest(url, options, accessToken)
  if (response.status === 401 && requestedAccessToken) {
    const refreshedAccessToken = await resolveAccessToken(accessToken, true)
    if (refreshedAccessToken && refreshedAccessToken !== accessToken) {
      accessToken = refreshedAccessToken
      response = await sendApiRequest(url, options, accessToken)
    }
  }

  if (!response.ok) {
    const error = await buildApiError(response)
    if (
      response.status === 403 &&
      error.message === 'Password change required'
    ) {
      passwordChangeRequiredHandler?.()
    }
    throw error
  }

  if (response.status === 204) {
    return { data: undefined as T, response }
  }

  const text = await response.text()
  return {
    data: (text ? JSON.parse(text) : undefined) as T,
    response,
  }
}

async function resolveAccessToken(
  accessToken: string | null,
  forceRefresh: boolean,
) {
  if (!accessToken || !authTokenRefreshHandler) {
    return accessToken
  }

  return authTokenRefreshHandler({
    accessToken,
    forceRefresh,
  })
}

async function sendApiRequest(
  url: string,
  options: ApiRequestOptions,
  accessToken: string | null,
) {
  const headers = new Headers()
  let body: BodyInit | undefined

  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers.set(key, value)
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  if (options.ifMatchRevision !== undefined) {
    headers.set('If-Match', `"${options.ifMatchRevision}"`)
  }
  if (options.shareToken) {
    headers.set(SHARE_TOKEN_HEADER, options.shareToken)
  }
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.json)
  }
  if (options.formData) {
    body = options.formData
  }
  if (options.urlEncoded) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
    body = options.urlEncoded
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    API_REQUEST_TIMEOUT_MS,
  )

  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiRequestTimeoutError()
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function sendMediaUploadRequest(
  options: {
    file: File
    onProgress?: (progress: MediaUploadProgress) => void
    signal?: AbortSignal
  },
  accessToken: string | null,
): Promise<MediaUploadResponse> {
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.set('file', options.file)

    const xhr = new XMLHttpRequest()

    function cleanup() {
      options.signal?.removeEventListener('abort', abortUpload)
    }

    function rejectWith(error: unknown) {
      cleanup()
      reject(error)
    }

    function abortUpload() {
      xhr.abort()
    }

    options.signal?.addEventListener('abort', abortUpload, { once: true })

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : null
      options.onProgress?.({
        lengthComputable: event.lengthComputable,
        loaded: event.loaded,
        progress: total === null ? null : event.loaded / total,
        total,
      })
    }

    xhr.onload = () => {
      cleanup()
      if (xhr.status < 200 || xhr.status >= 300) {
        const detail = readXhrDetail(xhr)
        reject(new ApiError(xhr.status, detailToMessage(detail), detail))
        return
      }

      try {
        resolve(JSON.parse(xhr.responseText) as MediaUploadResponse)
      } catch {
        reject(
          new ApiError(
            xhr.status,
            'Invalid response from server',
            xhr.responseText,
          ),
        )
      }
    }

    xhr.onerror = () => rejectWith(new TypeError('Network request failed'))
    xhr.onabort = () => rejectWith(createAbortError())

    xhr.open('POST', buildApiUrl(`${API_V1_PREFIX}/media`))
    if (accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    }
    xhr.send(formData)
  })
}

function buildApiUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${currentApiBaseUrl}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function buildApiError(response: Response): Promise<ApiError> {
  const detail = await readErrorDetail(response)
  return new ApiError(response.status, detailToMessage(detail), detail)
}

async function readErrorDetail(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return response.statusText
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function detailToMessage(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail
  }
  if (detail && typeof detail === 'object' && 'detail' in detail) {
    return detailToMessage((detail as { detail: unknown }).detail)
  }
  if (Array.isArray(detail)) {
    return detail.map(detailToMessage).join('; ')
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    const message = (detail as { msg: unknown }).msg
    if (typeof message === 'string') {
      return message
    }
  }
  return 'Request failed'
}

function readXhrDetail(xhr: XMLHttpRequest): unknown {
  if (!xhr.responseText) {
    return xhr.statusText
  }

  try {
    return JSON.parse(xhr.responseText)
  } catch {
    return xhr.responseText
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Upload aborted', 'AbortError')
  }

  const error = new Error('Upload aborted')
  error.name = 'AbortError'
  return error
}

function readEtagRevision(response: Response) {
  const etag = response.headers.get('ETag')
  const match = /^"([0-9]+)"$/.exec(etag ?? '')
  return match ? Number(match[1]) : null
}
