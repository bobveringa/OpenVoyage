import { describe, expect, it } from 'vitest'
import type { Stop, Connection } from './models'
import { getAirportTransfers } from './airport-transfers'

const fromStop = { title: 'Amsterdam', location: { latitude: 52.37, longitude: 4.9 } } as Stop
const toStop = { title: 'Paris', location: { latitude: 48.85, longitude: 2.35 } } as Stop
const flight = {
  intent: { travel_mode: 'FLIGHT' },
  from_endpoint: { latitude: 52.31, longitude: 4.76, name: 'Schiphol' },
  to_endpoint: { latitude: 49.01, longitude: 2.55, name: 'Charles de Gaulle' },
} as Connection['segments'][number]
const connection = { id: 'connection', segments: [flight] } as Connection

describe('automatic airport transfers', () => {
  it('connects both city stops to the actual airports without needing a flight lookup', () => {
    expect(getAirportTransfers(connection, fromStop, toStop)).toEqual([
      { connectionId: 'connection', side: 'departure', from: { ...fromStop.location, name: 'Amsterdam' }, to: flight.from_endpoint },
      { connectionId: 'connection', side: 'arrival', from: flight.to_endpoint, to: { ...toStop.location, name: 'Paris' } },
    ])
  })

  it('uses existing transport segments even when their route is not calculated', () => {
    const ground = { ...flight, intent: { travel_mode: 'CAR' }, route_state: 'NOT_CALCULATED' } as typeof flight
    expect(getAirportTransfers({ ...connection, segments: [ground, flight] }, fromStop, toStop).map(t => t.side)).toEqual(['arrival'])
    expect(getAirportTransfers({ ...connection, segments: [flight, ground] }, fromStop, toStop).map(t => t.side)).toEqual(['departure'])
    expect(getAirportTransfers({ ...connection, segments: [ground, flight, ground] }, fromStop, toStop)).toEqual([])
  })

  it('omits unknown airports and airport stops, including small coordinate differences', () => {
    expect(getAirportTransfers({ ...connection, segments: [{ ...flight, from_endpoint: null, to_endpoint: null }] }, fromStop, toStop)).toEqual([])
    const atDeparture = { ...fromStop, location: { ...fromStop.location, ...flight.from_endpoint!, latitude: 52.31001 } }
    const atArrival = { ...toStop, location: { ...toStop.location, ...flight.to_endpoint! } }
    expect(getAirportTransfers(connection, atDeparture, atArrival)).toEqual([])
  })

  it('handles zero coordinates and does not invent transfers for other modes', () => {
    const atEquator = { ...flight, from_endpoint: { latitude: 0, longitude: 0, name: 'Airport' } }
    expect(getAirportTransfers({ ...connection, segments: [atEquator] }, fromStop, toStop)).toHaveLength(2)
    expect(getAirportTransfers({ ...connection, segments: [{ ...flight, intent: { ...flight.intent, travel_mode: 'TRAIN' } }] }, fromStop, toStop)).toEqual([])
  })
})
