import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { TrackedFlight } from '@/api/client'
import { formatDateTime, zoneLabel } from '@/lib/date-time'
import { FlightCard } from '@/pages/trip-detail/flight-card-prototype'

const wellington = {
  id: 'wlg', name: 'Wellington', iata_code: 'WLG', latitude: -41.33, longitude: 174.81, timezone: 'Pacific/Auckland',
}
const tokyo = {
  id: 'hnd', name: 'Tokyo Haneda', iata_code: 'HND', latitude: 35.55, longitude: 139.78, timezone: 'Asia/Tokyo',
}
const flight = {
  id: 'flight', flight_number: 'NZ99', airline_name: 'Air New Zealand',
  departure_airport: wellington, arrival_airport: tokyo,
  status: 'SCHEDULED', scheduled_departure: '2026-10-23T18:00:00Z', scheduled_arrival: '2026-10-24T05:00:00Z',
  actual_departure: null, estimated_departure: null, estimated_arrival: null, actual_arrival: null,
  completion_source: null, stop_reason: null, progress: null, estimate_basis: null, position_at: null,
  status_updated_at: '2026-10-23T12:00:00Z', update_state: 'CURRENT', visible_to_members_only: false,
  can_complete: false, gps_tracking_session_id: null,
} as unknown as TrackedFlight

describe('flight card zone labels', () => {
  it.each([true, false])('labels each airport with its own zone (preview=%s)', (preview) => {
    const html = renderToStaticMarkup(createElement(FlightCard, { flight, preview, tripId: 'trip' }))

    const departureLabel = zoneLabel(new Date(flight.scheduled_departure), 'Pacific/Auckland')
    const arrivalLabel = zoneLabel(new Date(flight.scheduled_arrival!), 'Asia/Tokyo')
    expect(departureLabel).not.toBe(arrivalLabel)
    expect(html).toContain(`>${departureLabel}</span>`)
    expect(html).toContain(`>${arrivalLabel}</span>`)
  })

  it("shows the viewer's time and zone for an airport zone the browser doesn't know", () => {
    const unknownZoneFlight = {
      ...flight,
      arrival_airport: { ...tokyo, timezone: 'Not/A_Zone' },
    } as unknown as TrackedFlight

    const html = renderToStaticMarkup(
      createElement(FlightCard, { flight: unknownZoneFlight, preview: false, tripId: 'trip' }),
    )

    const arrival = new Date(flight.scheduled_arrival!)
    const viewerTime = formatDateTime(arrival, { hour: '2-digit', minute: '2-digit' })
    expect(html).toContain(`>${viewerTime}</time>`)
    expect(html).toContain(`>${zoneLabel(arrival, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>`)
  })
})
