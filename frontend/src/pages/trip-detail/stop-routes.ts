import { refreshItineraryTravelLegRoute, type Itinerary } from '@/api/client'

export async function calculateNewStopRoutes(options: {
  itinerary: Itinerary
  previousStopIds: string[]
  accessToken: string
  onUpdate: (itinerary: Itinerary) => void
}) {
  let itinerary = options.itinerary
  const previousStopIds = new Set(options.previousStopIds)
  const newStopIds = new Set(itinerary.stops
    .filter((stop) => !previousStopIds.has(stop.id))
    .map((stop) => stop.id))
  const pending = itinerary.legs.filter((leg) => (
    (leg.from.type === 'STOP' && newStopIds.has(leg.from.stop_id)) ||
    (leg.to.type === 'STOP' && newStopIds.has(leg.to.stop_id))
  ) && leg.segments.some((segment) =>
    ['CAR', 'BIKE', 'WALK'].includes(segment.intent.travel_mode) &&
    segment.route_state === 'NOT_CALCULATED' &&
    segment.from_endpoint && segment.to_endpoint,
  ))

  // Each calculation advances the revision, so adjacent routes must be saved in order.
  for (const leg of pending) {
    const result = await refreshItineraryTravelLegRoute({
      accessToken: options.accessToken,
      tripId: itinerary.trip_id,
      legId: leg.id,
      itineraryRevision: itinerary.itinerary_revision,
    })
    itinerary = {
      ...itinerary,
      itinerary_revision: result.itineraryRevision ?? itinerary.itinerary_revision,
      legs: itinerary.legs.map((current) => current.id === leg.id ? result.leg : current),
    }
    options.onUpdate(itinerary)
  }
}
