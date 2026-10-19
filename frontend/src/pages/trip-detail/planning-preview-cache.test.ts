import { describe, expect, it } from 'vitest'
import type { PlanningPreview } from '@/api/client'
import type { TravelLegEditDraft } from './page-types'
import { PlanningPreviewCache, planningPreviewKey } from './planning-preview-cache'

const now = Date.parse('2026-10-19T12:00:00Z')
const draft: TravelLegEditDraft = { notes: '', segments: [{ id: 'segment', travel_mode: 'CAR', mode_selected: false, notes: '', route_option: 0 }] }
const preview = { preview_id: 'preview', expires_at: '2026-10-19T12:10:00Z', connection: {} } as PlanningPreview

describe('planning preview reuse', () => {
  it('keeps an alternative selectable when only notes, source or selected option change', () => {
    const cache = new PlanningPreviewCache()
    cache.put(draft, 2, preview)
    const changed = { ...draft, notes: 'Pack a bag', segments: [{ ...draft.segments[0], notes: 'Scenic road', mode_selected: true, route_option: 1, via: null }] }
    expect(cache.get(changed, 2, now)).toBe(preview)
  })

  it('requires fresh results after route inputs or itinerary revision change', () => {
    const cache = new PlanningPreviewCache()
    cache.put(draft, 2, preview)
    for (const change of [
      { travel_mode: 'BIKE' as const },
      { via: { longitude: 4.8, latitude: 51.7 } },
      { to: { place_id: 'other-place' } },
    ]) expect(cache.get({ ...draft, segments: [{ ...draft.segments[0], ...change }] }, 2, now)).toBeNull()
    expect(cache.get(draft, 3, now)).toBeNull()
  })

  it('expires at the server deadline and clears results when the editor closes', () => {
    const cache = new PlanningPreviewCache()
    cache.put(draft, 2, preview)
    expect(cache.get(draft, 2, now + 599999)).toBe(preview)
    expect(cache.get(draft, 2, now + 600000)).toBeNull()
    cache.put(draft, 2, preview)
    cache.clear()
    expect(cache.get(draft, 2, now)).toBeNull()
  })

  it('binds every segment and flight detail while ignoring object property order', () => {
    const flight = { travel_mode: 'FLIGHT' as const, notes: '', mode_selected: true, route_option: 0, flight: { flight_number: 'KL597', departure_date: '2026-11-18' } }
    const journey = { ...draft, segments: [...draft.segments, flight] }
    const reordered = { ...journey, segments: [{ ...draft.segments[0], via: { longitude: 4.8, latitude: 51.7 } }, flight] }
    const same = { ...reordered, segments: [{ ...draft.segments[0], via: { latitude: 51.7, longitude: 4.8 } }, flight] }
    expect(planningPreviewKey(reordered)).toBe(planningPreviewKey(same))
    expect(planningPreviewKey(journey)).not.toBe(planningPreviewKey({ ...journey, segments: [...draft.segments, { ...flight, flight: { ...flight.flight, departure_date: '2026-11-19' } }] }))
  })
})
