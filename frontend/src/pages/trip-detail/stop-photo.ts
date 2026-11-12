import { useContext, useEffect, useState } from 'react'

import { getStopPhoto, type StopPhoto } from '@/api/client'
import type { Stop } from './models'
import { PlanningSessionContext } from './planning-session'

/** Photo links carry a 24-hour token; reuse an answer for an hour at most. */
const CACHE_MS = 60 * 60 * 1000
const cache = new Map<string, { photo: StopPhoto | null; at: number }>()

function cacheKey(stop: Pick<Stop, 'id' | 'location'>) {
  // A new location means a new town, so a new photo.
  return `${stop.id}:${stop.location.id}`
}

/** For tests. */
export function clearStopPhotoCache() {
  cache.clear()
}

/** "Photo: Diego Delso · CC BY-SA 3.0" */
export function formatPhotoCredit(photo: Pick<StopPhoto, 'credit' | 'license'>) {
  const parts = [photo.credit, photo.license].filter(Boolean)
  return parts.length ? `Photo: ${parts.join(' · ')}` : 'Photo: Wikimedia Commons'
}

/**
 * The header photo for a stop, or null while it loads and when the stop gets
 * the designed header. Never blocks the card: failures just keep the pattern.
 */
export function useStopPhoto(stop: Pick<Stop, 'id' | 'location' | 'trip_id'>): StopPhoto | null {
  const { accessToken } = useContext(PlanningSessionContext)
  const key = cacheKey(stop)
  const [result, setResult] = useState<{ key: string; photo: StopPhoto | null } | null>(null)

  useEffect(() => {
    const cached = cache.get(key)
    if ((cached && Date.now() - cached.at < CACHE_MS) || !accessToken) return
    const controller = new AbortController()
    getStopPhoto({ accessToken, signal: controller.signal, stopId: stop.id, tripId: stop.trip_id })
      .then((photo) => {
        cache.set(key, { photo, at: Date.now() })
        setResult({ key, photo })
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, photo: null })
      })
    return () => controller.abort()
  }, [accessToken, key, stop.id, stop.trip_id])

  if (result?.key === key) return result.photo
  return cache.get(key)?.photo ?? null
}
