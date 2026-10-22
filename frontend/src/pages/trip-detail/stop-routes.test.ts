import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAuthTokenRefresh, type Itinerary, type ItineraryTravelLeg } from '@/api/client'
import { calculateNewStopRoutes } from './stop-routes'

function leg(id: string, from: string, to: string, mode = 'CAR', state = 'NOT_CALCULATED') {
  return {
    id, from: { type: 'STOP', stop_id: from }, to: { type: 'STOP', stop_id: to },
    segments: [{
      intent: { travel_mode: mode }, route_state: state,
      from_endpoint: { latitude: 52.1, longitude: 5 },
      to_endpoint: { latitude: 52.2, longitude: 5.1 },
    }],
  } as ItineraryTravelLeg
}

function snapshot(legs: ItineraryTravelLeg[]): Itinerary {
  return {
    trip_id: 'trip', itinerary_revision: 3,
    stops: ['a', 'new', 'b', 'c'].map((id) => ({ id })) as Itinerary['stops'],
    legs,
  }
}

describe('automatic routes after creating a stop', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const onUpdate = vi.fn<(itinerary: Itinerary) => void>()

  beforeEach(() => {
    configureAuthTokenRefresh(null)
    fetchMock.mockReset()
    onUpdate.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  function calculate(itinerary: Itinerary) {
    return calculateNewStopRoutes({
      itinerary, previousStopIds: ['a', 'b', 'c'], accessToken: 'token', onUpdate,
    })
  }

  function respond(ready: ItineraryTravelLeg, revision: number) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(ready), {
      headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` },
    }))
  }

  it('calculates the new route when appending a stop and keeps existing routes', async () => {
    const existing = leg('existing', 'a', 'b', 'CAR', 'READY')
    const added = leg('added', 'b', 'new')
    const itinerary = snapshot([existing, added])
    const ready = leg('added', 'b', 'new', 'CAR', 'READY')
    respond(ready, 4)

    await calculate(itinerary)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/trips/trip/itinerary/connections/added/route-refresh')
    expect(request?.method).toBe('POST')
    expect(new Headers(request?.headers).get('If-Match')).toBe('"3"')
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer token')
    expect(onUpdate).toHaveBeenLastCalledWith({ ...itinerary, itinerary_revision: 4, legs: [existing, ready] })
    expect(itinerary.legs[1].segments[0].route_state).toBe('NOT_CALCULATED')
  })

  it('calculates both sides of an inserted stop using each returned revision', async () => {
    const incoming = leg('incoming', 'a', 'new')
    const outgoing = leg('outgoing', 'new', 'b')
    const unrelated = leg('unrelated', 'b', 'c')
    const itinerary = snapshot([incoming, outgoing, unrelated])
    const readyIncoming = leg('incoming', 'a', 'new', 'CAR', 'READY')
    const readyOutgoing = leg('outgoing', 'new', 'b', 'CAR', 'READY')
    respond(readyIncoming, 4)
    respond(readyOutgoing, 5)

    await calculate(itinerary)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('/').slice(-2)[0])).toEqual(['incoming', 'outgoing'])
    expect(fetchMock.mock.calls.map(([, request]) => new Headers(request?.headers).get('If-Match'))).toEqual(['"3"', '"4"'])
    expect(onUpdate.mock.calls[0][0].legs).toEqual([readyIncoming, outgoing, unrelated])
    expect(onUpdate.mock.calls[1][0]).toEqual({ ...itinerary, itinerary_revision: 5, legs: [readyIncoming, readyOutgoing, unrelated] })
  })

  it('includes a return connection reanchored to an appended stop', async () => {
    const returning = leg('return', 'new', 'outside')
    returning.to = { type: 'LOCATION', location: {
      id: 'outside', name: 'Home', full_name: 'Home', region: '', country_code: 'NL', latitude: 52, longitude: 5,
    } }
    respond({ ...returning, segments: [{ ...returning.segments[0], route_state: 'READY' }] }, 4)
    await calculate(snapshot([returning]))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not calculate flights, unsupported modes, saved routes, or failed routes', async () => {
    await calculate(snapshot([
      leg('flight', 'a', 'new', 'FLIGHT', 'UNSUPPORTED'),
      leg('train', 'new', 'b', 'TRAIN', 'UNSUPPORTED'),
      leg('ready', 'a', 'new', 'CAR', 'READY'),
      leg('failed', 'new', 'b', 'CAR', 'FAILED'),
    ]))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('skips unresolved ground segments', async () => {
    const unresolved = leg('unresolved', 'a', 'new')
    unresolved.segments[0].to_endpoint = null
    await calculate(snapshot([unresolved]))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains completed results and stops on a revision conflict', async () => {
    const incoming = leg('incoming', 'a', 'new', 'CAR', 'READY')
    respond(incoming, 4)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Itinerary changed' }), { status: 412 }))
    const itinerary = snapshot([
      leg('incoming', 'a', 'new'), leg('outgoing', 'new', 'b'), leg('return', 'new', 'c'),
    ])
    await expect(calculate(itinerary)).rejects.toThrow('Itinerary changed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0].legs[0]).toEqual(incoming)
  })

  it('applies provider failures without retrying automatically', async () => {
    const failed = leg('added', 'a', 'new', 'CAR', 'FAILED')
    failed.segments[0].error_code = 'NOT_CONFIGURED'
    respond(failed, 4)
    await calculate(snapshot([leg('added', 'a', 'new')]))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0].legs[0]).toEqual(failed)
  })
})
