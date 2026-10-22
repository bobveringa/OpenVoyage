import type { ItineraryConnection, ItineraryConnectionReplacePayload } from '@/api/client'
import type { MapStop } from './models'

export type ConnectionAnchor = {
  title: string
  location: { latitude: number; longitude: number; name: string }
  stop?: MapStop
}

export function resolveConnectionEndpoint(endpoint: ItineraryConnection['from'], stops: readonly MapStop[]): ConnectionAnchor | null {
  if (endpoint.type === 'LOCATION') return { title: endpoint.location.name, location: endpoint.location }
  const stop = stops.find((item) => item.id === endpoint.stop_id)
  return stop ? { title: stop.title, location: stop.location, stop } : null
}

export function connectionEndpointInput(endpoint: ItineraryConnection['from']): ItineraryConnectionReplacePayload['from'] {
  return endpoint.type === 'STOP' ? endpoint : {
    type: 'LOCATION', location: { latitude: endpoint.location.latitude, longitude: endpoint.location.longitude },
  }
}
