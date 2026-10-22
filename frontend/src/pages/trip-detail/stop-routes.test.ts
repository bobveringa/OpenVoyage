import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAuthTokenRefresh, type Itinerary, type ItineraryConnection } from '@/api/client'
import { calculateChangedConnectionRoutes } from './stop-routes'

function makeConnection(id: string, from: string, to: string, mode = 'CAR', state = 'NOT_CALCULATED') {
  return {
    id, from: { type: 'STOP', stop_id: from }, to: { type: 'STOP', stop_id: to },
    segments: [{
      intent: { travel_mode: mode }, route_state: state,
      from_endpoint: { latitude: 52.1, longitude: 5 },
      to_endpoint: { latitude: 52.2, longitude: 5.1 },
    }],
  } as ItineraryConnection
}

function snapshot(connections: ItineraryConnection[]): Itinerary {
  return {
    trip_id: 'trip', itinerary_revision: 3,
    stops: ['a', 'new', 'b', 'c'].map((id) => ({ id })) as Itinerary['stops'],
    connections,
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
    return calculateChangedConnectionRoutes({
      itinerary, previousConnections: itinerary.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.type === 'STOP' && endpoint.stop_id === 'new')), accessToken: 'token', onUpdate,
    })
  }

  function respond(ready: ItineraryConnection, revision: number) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ itinerary_revision: revision, connection: ready }), {
      headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` },
    }))
  }

  it('calculates the new route when appending a stop and keeps existing routes', async () => {
    const existing = makeConnection('existing', 'a', 'b', 'CAR', 'READY')
    const added = makeConnection('added', 'b', 'new')
    const itinerary = snapshot([existing, added])
    const ready = makeConnection('added', 'b', 'new', 'CAR', 'READY')
    respond(ready, 4)

    await calculate(itinerary)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, request] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/trips/trip/itinerary/connections/added/route-refresh')
    expect(request?.method).toBe('POST')
    expect(new Headers(request?.headers).get('If-Match')).toBe('"3"')
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer token')
    expect(onUpdate).toHaveBeenLastCalledWith({ ...itinerary, itinerary_revision: 4, connections: [existing, ready] })
    expect(itinerary.connections[1].segments[0].route_state).toBe('NOT_CALCULATED')
  })

  it('calculates both sides of an inserted stop using each returned revision', async () => {
    const incoming = makeConnection('incoming', 'a', 'new')
    const outgoing = makeConnection('outgoing', 'new', 'b')
    const unrelated = makeConnection('unrelated', 'b', 'c')
    const itinerary = snapshot([incoming, outgoing, unrelated])
    const readyIncoming = makeConnection('incoming', 'a', 'new', 'CAR', 'READY')
    const readyOutgoing = makeConnection('outgoing', 'new', 'b', 'CAR', 'READY')
    respond(readyIncoming, 4)
    respond(readyOutgoing, 5)

    await calculate(itinerary)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('/').slice(-2)[0])).toEqual(['incoming', 'outgoing'])
    expect(fetchMock.mock.calls.map(([, request]) => new Headers(request?.headers).get('If-Match'))).toEqual(['"3"', '"4"'])
    expect(onUpdate.mock.calls[0][0].connections).toEqual([readyIncoming, outgoing, unrelated])
    expect(onUpdate.mock.calls[1][0]).toEqual({ ...itinerary, itinerary_revision: 5, connections: [readyIncoming, readyOutgoing, unrelated] })
  })

  it('includes a return connection reanchored to an appended stop', async () => {
    const returning = makeConnection('return', 'new', 'outside')
    returning.to = { type: 'LOCATION', location: {
      id: 'outside', name: 'Home', full_name: 'Home', region: '', country_code: 'NL', latitude: 52, longitude: 5,
    } }
    respond({ ...returning, segments: [{ ...returning.segments[0], route_state: 'READY' }] }, 4)
    await calculate(snapshot([returning]))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not calculate flights, unsupported modes, saved routes, or failed routes', async () => {
    await calculate(snapshot([
      makeConnection('flight', 'a', 'new', 'FLIGHT', 'UNSUPPORTED'),
      makeConnection('train', 'new', 'b', 'TRAIN', 'UNSUPPORTED'),
      makeConnection('ready', 'a', 'new', 'CAR', 'READY'),
      makeConnection('failed', 'new', 'b', 'CAR', 'FAILED'),
    ]))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('skips unresolved ground segments', async () => {
    const unresolved = makeConnection('unresolved', 'a', 'new')
    unresolved.segments[0].to_endpoint = null
    await calculate(snapshot([unresolved]))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains completed results and stops on a revision conflict', async () => {
    const incoming = makeConnection('incoming', 'a', 'new', 'CAR', 'READY')
    respond(incoming, 4)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Itinerary changed' }), { status: 412 }))
    const itinerary = snapshot([
      makeConnection('incoming', 'a', 'new'), makeConnection('outgoing', 'new', 'b'), makeConnection('return', 'new', 'c'),
    ])
    await expect(calculate(itinerary)).rejects.toThrow('Itinerary changed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0].connections[0]).toEqual(incoming)
  })

  it('applies provider failures without retrying automatically', async () => {
    const failed = makeConnection('added', 'a', 'new', 'CAR', 'FAILED')
    failed.segments[0].error_code = 'NOT_CONFIGURED'
    respond(failed, 4)
    await calculate(snapshot([makeConnection('added', 'a', 'new')]))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0].connections[0]).toEqual(failed)
  })

  it('recalculates a surviving connection whose endpoint changed after a stop edit', async () => {
    const before = makeConnection('retained', 'a', 'b', 'CAR', 'READY')
    const after = structuredClone(before)
    after.segments[0].route_state = 'NOT_CALCULATED'
    after.segments[0].input_version = 2
    after.segments[0].to_endpoint = { name: 'Updated destination', latitude: 53, longitude: 6 }
    const untouched = makeConnection('unrelated', 'b', 'c')
    respond({ ...after, segments: [{ ...after.segments[0], route_state: 'READY' }] }, 4)
    await calculateChangedConnectionRoutes({
      itinerary: snapshot([after, untouched]), previousConnections: [before, untouched], accessToken: 'token', onUpdate,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/connections/retained/route-refresh')
  })

  it('calculates the bridge created by deleting a stop', async () => {
    const bridge = makeConnection('bridge', 'a', 'c')
    respond({ ...bridge, segments: [{ ...bridge.segments[0], route_state: 'READY' }] }, 4)
    await calculateChangedConnectionRoutes({
      itinerary: snapshot([bridge]), previousConnections: [makeConnection('left', 'a', 'b'), makeConnection('right', 'b', 'c')],
      accessToken: 'token', onUpdate,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0].connections[0].segments[0].route_state).toBe('READY')
  })

  it('does not calculate unrelated pending connections or metadata-only changes', async () => {
    const existing = makeConnection('existing', 'a', 'b')
    await calculateChangedConnectionRoutes({
      itinerary: snapshot([{ ...existing, notes: 'Updated notes' }]), previousConnections: [existing], accessToken: 'token', onUpdate,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
