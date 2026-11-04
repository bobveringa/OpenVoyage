import { useEffect, useRef, useState } from 'react'

import { getPlaceTimezone } from '@/api/client'

const DEBOUNCE_MS = 300

/**
 * IANA zone at a point, from `/places/timezone`, debounced so dragging a map
 * point or typing doesn't send a request per change. `null` while unknown,
 * loading or after an error: the caller then simply shows no hint.
 */
export function usePlaceTimezone(
  accessToken: string | null | undefined,
  latitude: number | null,
  longitude: number | null,
) {
  const [result, setResult] = useState<{ key: string; zone: string } | null>(null)
  const key = latitude === null || longitude === null ? null : `${latitude},${longitude}`
  // The effect reruns when a token first becomes available (the form can
  // open while sign-in is still resolving), but not when it is refreshed.
  const hasAccessToken = Boolean(accessToken)
  const accessTokenRef = useRef(accessToken)
  useEffect(() => {
    accessTokenRef.current = accessToken
  }, [accessToken])

  useEffect(() => {
    const token = accessTokenRef.current
    if (latitude === null || longitude === null || !token) {
      return undefined
    }

    const controller = new AbortController()
    const requestKey = `${latitude},${longitude}`
    const timeoutId = window.setTimeout(() => {
      void getPlaceTimezone({
        accessToken: accessTokenRef.current ?? token,
        latitude,
        longitude,
        signal: controller.signal,
      })
        .then((zone) => setResult({ key: requestKey, zone }))
        .catch(() => {
          // No hint is better than a wrong one; the post saves either way.
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [hasAccessToken, latitude, longitude])

  // Never show the previous point's zone for a new point.
  return result && result.key === key ? result.zone : null
}
