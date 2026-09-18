import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  configureAuthTokenRefresh,
  deleteTripShareLink,
  restoreTripShareLink,
  revokeTripShareLink,
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
