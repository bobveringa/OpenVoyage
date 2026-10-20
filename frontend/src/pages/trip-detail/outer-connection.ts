import type { PlanningSegment } from '@/api/client'
import type { ConnectionAnchor } from './connection-endpoints'
import type { Stop, TravelLeg } from './models'

export type OuterConnectionSide = 'DEPARTURE' | 'RETURN'
export type ConnectionLocation = {
  input: Exclude<NonNullable<PlanningSegment['via']>, { location_id: string }>
  anchor: ConnectionAnchor
}

// A local placeholder lets the regular route chooser render before location selection.
// It is never saved or sent to the preview API until both endpoints are selected.
export function createOuterConnectionDraft(side: OuterConnectionSide, stop: Stop): TravelLeg {
  const outside = { type: 'LOCATION' as const, location: { ...stop.location, name: side === 'DEPARTURE' ? 'Choose starting place' : 'Choose return destination' } }
  const inside = { type: 'STOP' as const, stop_id: stop.id }
  return {
    id: '00000000-0000-0000-0000-000000000000', trip_id: stop.trip_id,
    connection_type: side, from: side === 'DEPARTURE' ? outside : inside,
    to: side === 'DEPARTURE' ? inside : outside, notes: '',
    segments: [], duration_seconds: null, duration_scope: null, warnings: [],
    route: { type: 'SIMPLE', geometry: { type: 'LineString', coordinates: [] }, distance_meters: null, duration_seconds: null },
    created_at: stop.created_at, updated_at: stop.updated_at,
  }
}
