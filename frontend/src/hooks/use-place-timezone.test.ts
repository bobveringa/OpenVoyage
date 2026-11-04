import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { getPlaceTimezone } from '@/api/client'
import { usePlaceTimezone } from '@/hooks/use-place-timezone'

vi.mock('@/api/client', () => ({ getPlaceTimezone: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('fetches once a token arrives, and not again when the token is refreshed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.mocked(getPlaceTimezone).mockResolvedValue('Asia/Tokyo')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let zone: string | null = null
  function Probe({ accessToken }: { accessToken: string | null }) {
    zone = usePlaceTimezone(accessToken, 35.0116, 135.7681)
    return null
  }
  const render = async (accessToken: string | null) => {
    await act(async () => root.render(createElement(Probe, { accessToken })))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
  }

  try {
    // The form opened while sign-in was still resolving.
    await render(null)
    expect(getPlaceTimezone).not.toHaveBeenCalled()
    expect(zone).toBeNull()

    await render('first-token')
    expect(getPlaceTimezone).toHaveBeenCalledTimes(1)
    expect(getPlaceTimezone).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'first-token', latitude: 35.0116, longitude: 135.7681 }),
    )
    expect(zone).toBe('Asia/Tokyo')

    await render('refreshed-token')
    expect(getPlaceTimezone).toHaveBeenCalledTimes(1)
    expect(zone).toBe('Asia/Tokyo')
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
