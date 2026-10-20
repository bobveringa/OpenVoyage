import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configureAuthTokenRefresh,
  deleteItineraryTravelLeg,
  deleteTripShareLink,
  restoreTripShareLink,
  revokeTripShareLink,
  provisionTrackingUploadToken,
} from './client'

const shareLinkResponse = {
  created_at: '2026-09-18T10:00:00Z',
  display_name: null,
  display_name_locked: false,
  expires_at: null,
  id: 'link-id',
  interactions_enabled: true,
  label: 'Family',
  last_used_at: null,
  revoked_at: null,
  trip_id: 'trip-id',
}

describe('share-link lifecycle API calls', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    configureAuthTokenRefresh(null)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it.each([
    ['revoke', revokeTripShareLink, true],
    ['restore', restoreTripShareLink, false],
  ] as const)('uses a narrow PATCH to %s access', async (_, action, revoked) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...shareLinkResponse, revoked_at: revoked ? '2026-09-18T11:00:00Z' : null }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )

    await action({
      accessToken: 'access-token',
      shareLinkId: 'link/id',
      tripId: 'trip/id',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]!
    expect(String(url)).toMatch(
      /\/api\/v1\/trips\/trip%2Fid\/share-links\/link%2Fid$/,
    )
    expect(request?.method).toBe('PATCH')
    expect(request?.body).toBe(JSON.stringify({ revoked }))
    expect(new Headers(request?.headers).get('Authorization')).toBe(
      'Bearer access-token',
    )
  })

  it('reserves DELETE for permanent deletion and sends no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await deleteTripShareLink({
      accessToken: 'access-token',
      shareLinkId: 'link-id',
      tripId: 'trip-id',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, request] = fetchMock.mock.calls[0]!
    expect(request?.method).toBe('DELETE')
    expect(request?.body).toBeUndefined()
  })
})

describe('background upload authorization', () => {
  const body = {
    upload_token: 'scoped-token', token_type: 'bearer', trip_id: 'trip', session_id: 'session',
    recorded_by_user_id: 'user', expires_at: '2026-10-16T10:20:00Z',
  }
  beforeEach(() => {
    configureAuthTokenRefresh(null)
  })

  it('uses server time for the lease even when the device date is far ahead', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
      headers: { Date: 'Fri, 16 Oct 2026 10:00:00 GMT' },
    })))
    const result = await provisionTrackingUploadToken({ tripId: 'trip', sessionId: 'session', accessToken: 'access' })
    expect(result.remainingMs).toBeGreaterThan(1_198_000)
    expect(result.remainingMs).toBeLessThanOrEqual(1_199_000)
    vi.restoreAllMocks()
  })

  it.each([
    { ...body, trip_id: 'other-trip' }, { ...body, session_id: 'other-session' },
    { ...body, expires_at: 'invalid' }, { ...body, upload_token: '' },
  ])('rejects a malformed or incorrectly scoped response', async invalid => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid), {
      headers: { Date: 'Fri, 16 Oct 2026 10:00:00 GMT' },
    })))
    await expect(provisionTrackingUploadToken({ tripId: 'trip', sessionId: 'session', accessToken: 'access' })).rejects.toThrow('Invalid upload authorization response')
  })

  it('uses the existing account refresh flow before requesting an upload credential', async () => {
    const refresh = vi.fn().mockResolvedValue('fresh-access')
    configureAuthTokenRefresh(refresh)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
      headers: { Date: 'Fri, 16 Oct 2026 10:00:00 GMT' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await provisionTrackingUploadToken({ tripId: 'trip', sessionId: 'session', accessToken: 'old-access' })
    expect(refresh).toHaveBeenCalled()
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer fresh-access')
    configureAuthTokenRefresh(null)
  })
})


describe('outer connection deletion confirmation', () => {
  it.each([200, 409])('never prompts again after in-app confirmation, including response %s', async (status) => {
    configureAuthTokenRefresh(null)
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const snapshot = { trip_id: 'trip', itinerary_revision: 8, stops: [], legs: [] }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(status === 200 ? snapshot : {
      detail: { code: 'TRAVEL_DELETION_REQUIRED', message: 'Could not remove connection', connections: [{ from: 'London', to: 'Amsterdam' }] },
    }), { status, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = deleteItineraryTravelLeg({ tripId: 'trip', legId: 'leg', accessToken: 'token', itineraryRevision: 7, confirmTravelDeletion: true })
      if (status === 200) expect(await result).toEqual(snapshot)
      else await expect(result).rejects.toThrow('Could not remove connection')
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(String(fetchMock.mock.calls[0][0])).toContain('/itinerary/legs/leg?confirm_travel_deletion=true')
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-Match')).toBe('"7"')
      expect(confirmation).not.toHaveBeenCalled()
    } finally { confirmation.mockRestore() }
  })
  it.each([false, true])('keeps the current revision and handles confirmation %s', async (confirm) => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(confirm)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: {
      code: 'TRAVEL_DELETION_REQUIRED', connections: [{ from: 'Schiphol', to: 'Paris' }, { from: 'Paris', to: 'Brussels' }],
    } }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
    const snapshot = { trip_id: 'trip', itinerary_revision: confirm ? 8 : 7, stops: [], legs: [] }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } }))
    expect(await deleteItineraryTravelLeg({ tripId: 'trip', legId: 'leg', accessToken: 'token', itineraryRevision: 7 })).toEqual(snapshot)
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining('Schiphol to Paris, Paris to Brussels'))
    const [url, options] = fetchMock.mock.calls[1]
    if (confirm) {
      expect(String(url)).toContain('/itinerary/legs/leg?confirm_travel_deletion=true')
      expect(options?.method).toBe('DELETE')
      expect(new Headers(options?.headers).get('If-Match')).toBe('"7"')
    } else {
      expect(String(url)).toMatch(/\/itinerary$/)
      expect(options?.method).toBe('GET')
    }
    confirmation.mockRestore()
  })
})
