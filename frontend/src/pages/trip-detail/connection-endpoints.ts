import type { ItineraryTravelLeg, ItineraryTravelReplacePayload } from '@/api/client'
import type { Stop } from './models'

export type ConnectionAnchor = {
  title: string
  location: { latitude: number; longitude: number; name: string }
  stop?: Stop
}

export function resolveConnectionEndpoint(endpoint: ItineraryTravelLeg['from'], stops: readonly Stop[]): ConnectionAnchor | null {
  if (endpoint.type === 'LOCATION') return { title: endpoint.location.name, location: endpoint.location }
  const stop = stops.find((item) => item.id === endpoint.stop_id)
  return stop ? { title: stop.title, location: stop.location, stop } : null
}

export function connectionEndpointInput(endpoint: ItineraryTravelLeg['from']): ItineraryTravelReplacePayload['from'] {
  return endpoint.type === 'STOP' ? endpoint : {
    type: 'LOCATION', location: { latitude: endpoint.location.latitude, longitude: endpoint.location.longitude },
  }
}
