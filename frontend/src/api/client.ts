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
export type Media = components['schemas']['MediaResponse']
export type UserProfileUpdatePayload =
  components['schemas']['UserProfileUpdateRequest']
export type UsernameAvailability =
  components['schemas']['UsernameAvailabilityResponse']
export type PaginatedTrips =
  components['schemas']['PaginatedResponse_TripResponse_']

type QueryValue = string | number | boolean | null | undefined

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  accessToken?: string | null
  shareToken?: string | null
  query?: Record<string, QueryValue>
  json?: unknown
  formData?: FormData
  urlEncoded?: URLSearchParams
}

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

async function requestJson<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = buildApiUrl(path, options.query)
  const headers = new Headers()
  let body: BodyInit | undefined

  if (options.accessToken) {
    headers.set('Authorization', `Bearer ${options.accessToken}`)
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

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body,
  })

  if (!response.ok) {
    throw await buildApiError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
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
