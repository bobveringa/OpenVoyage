import { describe, expect, it } from 'vitest'
import { connectionEndpointInput, resolveConnectionEndpoint } from './connection-endpoints'
import { getAirportTransfers } from './airport-transfers'
import { planningPreviewKey } from './planning-preview-cache'
import type { Stop, TravelLeg } from './models'

const stop = { id: 'stop', title: 'Paris', location: { name: 'Paris', latitude: 48.85, longitude: 2.35 } } as Stop
const outside = { type: 'LOCATION' as const, location: {
  id: 'outside', name: 'Amsterdam', latitude: 52.37, longitude: 4.9, country_code: 'NL', region: '', full_name: 'Amsterdam',
} }

describe('connection endpoints', () => {
  it('resolves stop references and embedded locations without adding stops', () => {
    expect(resolveConnectionEndpoint({ type: 'STOP', stop_id: stop.id }, [stop])).toEqual({ title: stop.title, location: stop.location, stop })
    expect(resolveConnectionEndpoint({ type: 'STOP', stop_id: 'missing' }, [stop])).toBeNull()
    expect(resolveConnectionEndpoint(outside, [stop])).toEqual({ title: 'Amsterdam', location: outside.location })
    expect(connectionEndpointInput(outside)).toEqual({ type: 'LOCATION', location: { latitude: 52.37, longitude: 4.9 } })
  })

  it('resolves airport transfers on either outside side of a one-stop trip', () => {
    const flight = { intent: { travel_mode: 'FLIGHT' },
      from_endpoint: { latitude: 52.31, longitude: 4.76, name: 'AMS' },
      to_endpoint: { latitude: 49, longitude: 2.5, name: 'CDG' } }
    const leg = { id: 'departure', from: outside, to: { type: 'STOP', stop_id: stop.id }, segments: [flight] } as TravelLeg
    const from = resolveConnectionEndpoint(leg.from, [stop])!
    const to = resolveConnectionEndpoint(leg.to, [stop])!
    expect(getAirportTransfers(leg, from, to).map((item) => [item.from.name, item.to.name])).toEqual([
      ['Amsterdam', 'AMS'], ['CDG', 'Paris'],
    ])
    expect(getAirportTransfers({ ...leg, from: leg.to, to: leg.from }, to, from).map((item) => item.side)).toEqual(['departure', 'arrival'])
  })

  it('invalidates client previews for a different outside location or stop anchor', () => {
    const draft = { notes: '', from: connectionEndpointInput(outside), to: { type: 'STOP' as const, stop_id: stop.id }, segments: [{ travel_mode: 'TRAIN' as const, mode_selected: false, notes: '', route_option: 0 }] }
    const key = planningPreviewKey(draft)
    expect(planningPreviewKey({ ...draft, from: { type: 'LOCATION', location: { latitude: 50, longitude: 4 } } })).not.toBe(key)
    expect(planningPreviewKey({ ...draft, to: { type: 'STOP', stop_id: 'other' } })).not.toBe(key)
  })
})
