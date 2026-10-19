import type { PlanningPreview } from '@/api/client'
import type { TravelLegEditDraft } from './page-types'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  )
  return value
}

// Match the server's preview binding: notes and selecting an option don't change a route.
export function planningPreviewKey(draft: TravelLegEditDraft) {
  return JSON.stringify(canonical({ segments: draft.segments.map((segment) => ({
    id: segment.id ?? null,
    travel_mode: segment.travel_mode,
    from: segment.from ?? null,
    to: segment.to ?? null,
    via: segment.via ?? null,
    service_company: segment.service_company ?? null,
    service_number: segment.service_number ?? null,
    flight: segment.flight ? {
      flight_number: segment.flight.flight_number ?? null,
      departure_date: segment.flight.departure_date ?? null,
      departure_airport_place_id: segment.flight.departure_airport_place_id ?? null,
      arrival_airport_place_id: segment.flight.arrival_airport_place_id ?? null,
      airline_name: segment.flight.airline_name ?? null,
      candidate_id: segment.flight.candidate_id ?? null,
    } : null,
  })) }))
}

/** In-memory choices for one open editor; the server remains authoritative on Save. */
export class PlanningPreviewCache {
  private entries = new Map<string, { revision: number; preview: PlanningPreview }>()

  get(draft: TravelLegEditDraft, revision: number, now = Date.now()) {
    const key = planningPreviewKey(draft)
    const cached = this.entries.get(key)
    if (!cached) return null
    if (cached.revision !== revision || !(Date.parse(cached.preview.expires_at) > now)) {
      this.entries.delete(key)
      return null
    }
    return cached.preview
  }

  put(draft: TravelLegEditDraft, revision: number, preview: PlanningPreview) {
    const key = planningPreviewKey(draft)
    this.entries.delete(key)
    this.entries.set(key, { revision, preview })
    if (this.entries.size > 40) this.entries.delete(this.entries.keys().next().value!)
  }

  clear() { this.entries.clear() }
}
