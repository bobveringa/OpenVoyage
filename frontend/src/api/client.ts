import createClient from 'openapi-fetch'

import type { components, paths } from '@/api/types'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
})

const API_ROOT = API_BASE_URL.replace(/\/+$/, '')
const API_V1_PREFIX = '/api/v1'
const SHARE_TOKEN_HEADER = 'X-Trip-Share-Token'

export type AuthTokens = components['schemas']['Token']
export type CurrentUser = components['schemas']['CurrentUserResponse']
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
export type PlaceImportDataset =
  components['schemas']['PlaceImportRequest']['dataset']
export type PlaceImportPayload = components['schemas']['PlaceImportRequest']
export type PlaceImportResult = components['schemas']['PlaceImportResponse']
export type Place = components['schemas']['PlaceResponse']
export type ReverseGeocodeResult =
  components['schemas']['ReverseGeocodeResponse']
export type Post = components['schemas']['PostResponse']
export type PostCreatePayload = components['schemas']['PostCreateRequest']
export type PostUpdatePayload = components['schemas']['PostUpdateRequest']
export type UserProfileUpdatePayload =
  components['schemas']['UserProfileUpdateRequest']
export type UserSummary = components['schemas']['UserSummaryResponse']
export type UsernameAvailability =
  components['schemas']['UsernameAvailabilityResponse']
export type PaginatedPosts =
  components['schemas']['PaginatedResponse_PostResponse_']
export type PaginatedTrips =
  components['schemas']['PaginatedResponse_TripResponse_']
export type PaginatedUsers =
  components['schemas']['PaginatedResponse_UserSummaryResponse_']
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

let authTokenRefreshHandler: AuthTokenRefreshHandler | null = null

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

export function configureAuthTokenRefresh(
  handler: AuthTokenRefreshHandler | null,
) {
  authTokenRefreshHandler = handler
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

export async function importPlaces(
  payload: PlaceImportPayload,
  accessToken: string,
): Promise<PlaceImportResult> {
  return requestJson<PlaceImportResult>(`${API_V1_PREFIX}/admin/places/import`, {
    method: 'POST',
    accessToken,
    json: payload,
  })
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
  const formData = new FormData()
  formData.set('file', file)

  const response = await requestJson<components['schemas']['MediaUploadResponse']>(
    `${API_V1_PREFIX}/media`,
    {
      method: 'POST',
      accessToken,
      formData,
    },
  )

  return response.id
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
    throw await buildApiError(response)
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

  return fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body,
  })
}

function buildApiUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_ROOT}${path}`)
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

function readEtagRevision(response: Response) {
  const etag = response.headers.get('ETag')
  const match = /^"([0-9]+)"$/.exec(etag ?? '')
  return match ? Number(match[1]) : null
}
