import { refreshItineraryConnectionRoute, type Itinerary, type ItineraryConnection } from '@/api/client'

function routingInputs(connection: ItineraryConnection) {
  return JSON.stringify({
    from: connection.from, to: connection.to,
    segments: connection.segments.map(segment => ({
      id: segment.id, version: segment.input_version, mode: segment.intent.travel_mode,
      from: segment.from_endpoint, to: segment.to_endpoint, via: segment.via_endpoint,
      state: segment.route_state,
    })),
  })
}

export async function calculateChangedConnectionRoutes(options: {
  itinerary: Itinerary
  previousConnections: readonly ItineraryConnection[]
  accessToken: string
  onUpdate: (itinerary: Itinerary) => void
}) {
  let itinerary = options.itinerary
  const previous = new Map(options.previousConnections.map(connection => [connection.id, routingInputs(connection)]))
  const pending = itinerary.connections.filter(connection =>
    previous.get(connection.id) !== routingInputs(connection) &&
    connection.segments.some(segment =>
      ['CAR', 'BIKE', 'WALK'].includes(segment.intent.travel_mode) &&
      segment.route_state === 'NOT_CALCULATED' &&
      segment.from_endpoint && segment.to_endpoint,
    ),
  )

  // Each calculation advances the revision, so adjacent routes must be saved in order.
  for (const connection of pending) {
    const result = await refreshItineraryConnectionRoute({
      accessToken: options.accessToken,
      tripId: itinerary.trip_id,
      connectionId: connection.id,
      itineraryRevision: itinerary.itinerary_revision,
    })
    itinerary = {
      ...itinerary,
      itinerary_revision: result.itineraryRevision,
      connections: itinerary.connections.map((current) => current.id === connection.id ? result.connection : current),
    }
    options.onUpdate(itinerary)
  }
}
