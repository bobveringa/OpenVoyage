import { useEffect, useState } from 'react'

import {
  geocodePlaces,
  getErrorMessage,
  type Place,
} from '@/api/client'

type PlaceSearchStatus = 'error' | 'idle' | 'loading' | 'success'

export function usePlaceSearch(query: string, enabled: boolean) {
  const [places, setPlaces] = useState<readonly Place[]>([])
  const [status, setStatus] = useState<PlaceSearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)

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
      void geocodePlaces({
        limit: 8,
        query: trimmedQuery,
      })
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
  }, [enabled, query])

  return { error, places, status }
}


