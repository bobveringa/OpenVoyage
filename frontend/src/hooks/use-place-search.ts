import { useContext, useEffect, useRef, useState } from 'react'

import { geocodePlaces, getErrorMessage, type Place } from '@/api/client'
import { AuthContext } from '@/auth/auth-context'
import type { PlaceSearchStatus } from '@/components/places/place-search-dropdown'

export function usePlaceSearch(query: string, enabled: boolean, type?: 'AIRPORT') {
  const [places, setPlaces] = useState<readonly Place[]>([])
  const [status, setStatus] = useState<PlaceSearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  // Place lookups need a signed-in user; every caller sits behind sign-in.
  // Kept in a ref so a token refresh doesn't repeat the search.
  const accessToken = useContext(AuthContext)?.accessToken ?? null
  const accessTokenRef = useRef(accessToken)
  useEffect(() => {
    accessTokenRef.current = accessToken
  }, [accessToken])

  useEffect(() => {
    const trimmedQuery = query.trim()
    if (!enabled || trimmedQuery.length === 0) {
      setPlaces([])
      setStatus('idle')
      setError(null)
      return undefined
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    const timeoutId = window.setTimeout(() => {
      void geocodePlaces({ accessToken: accessTokenRef.current, limit: 8, query: trimmedQuery, type })
        .then((results) => {
          if (cancelled) {
            return
          }

          setPlaces(results)
          setStatus('success')
        })
        .catch((searchError) => {
          if (cancelled) {
            return
          }

          setPlaces([])
          setStatus('error')
          setError(getErrorMessage(searchError))
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [enabled, query, type])

  return { error, places, status }
}
