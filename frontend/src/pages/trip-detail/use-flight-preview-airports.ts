import { useEffect, useState } from 'react'

import { geocodePlaces, type Place } from '@/api/client'

export function useFlightPreviewAirports(enabled: boolean) {
  const [airports, setAirports] = useState<[Place, Place] | null>(null)

  useEffect(() => {
    if (!enabled) return
    let current = true
    void Promise.all(['AMS', 'LIS'].map((query) =>
      geocodePlaces({ query, type: 'AIRPORT', limit: 1 }),
    )).then(([departures, arrivals]) => {
      if (!current) return
      const departure = departures.find((place) => place.iata_code === 'AMS')
      const arrival = arrivals.find((place) => place.iata_code === 'LIS')
      if (departure && arrival) setAirports([departure, arrival])
    }).catch(() => { /* A failed preview lookup must not interrupt the timeline. */ })
    return () => { current = false }
  }, [enabled])

  return enabled ? airports : null
}
