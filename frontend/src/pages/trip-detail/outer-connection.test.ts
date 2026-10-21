import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlanningPanel } from './planning-ui'
import { PlanningSessionContext } from './planning-session'
import { ClockFormatContext } from '@/lib/date-time'
import type { Stop, TravelLeg, TravelMode } from './models'
import { createOuterConnectionDraft } from './outer-connection'
import type { DraftPostLocation } from './page-types'

vi.mock('./trip-map', () => ({ TripLeafletMap: () => null }))
const api = vi.hoisted(() => ({ previewTravel: vi.fn(), lookupFlight: vi.fn() }))
vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), ...api }))
const stop: Stop = {
  id: 'first', trip_id: 'trip', title: 'Amsterdam', planned_start_date: '2026-11-18', planned_nights: 2,
  notes: '', same_day_position: 0, visited: false, created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
  created_by: { id: 'owner', first_name: null, last_name: null, username: null },
  location: { id: 'amsterdam', latitude: 52.37, longitude: 4.9, name: 'Amsterdam', full_name: 'Amsterdam', region: '', country_code: 'NL' },
}
let container: HTMLDivElement
let panelHost: HTMLDivElement
let root: Root
let selectMapPoint: (point: DraftPostLocation) => void
const create = vi.fn()
const save = vi.fn()
const remove = vi.fn()
const noop = () => {}
function automaticPreview(side: 'DEPARTURE' | 'RETURN', mode: TravelMode) {
  return { preview_id: 'automatic-preview', expires_at: '2099-01-01T00:00:00Z', connection: {
    ...createOuterConnectionDraft(side, stop),
    segments: [{ id: 'temporary-segment', input_version: 1, mode_source: 'AUTO',
      intent: { travel_mode: mode, mode_selected: false, notes: '', route_option: 0 },
      route_state: mode === 'FLIGHT' ? 'UNSUPPORTED' : 'READY', geometry: null, from_endpoint: null, to_endpoint: null }],
  } }
}
function Harness({ legs = [], canMutate = true, saving = false, saveError = null }: {
  legs?: TravelLeg[]; canMutate?: boolean; saving?: boolean; saveError?: string | null
}) {
  const [location, setLocation] = useState<DraftPostLocation | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => { selectMapPoint = setLocation }, [])
  return createElement(PlanningSessionContext.Provider, { value: {
    accessToken: 'token', itineraryRevision: 2, panelHost, onPreview: noop, onPanelOpenChange: noop, saveError,
    connectionMap: { location, active, start: (point) => { setLocation(point); setActive(true) }, stop: () => setActive(false) },
  } }, createElement(ClockFormatContext.Provider, { value: { preference: '24-hour', setPreference: noop } },
    createElement(PlanningPanel, {
      canMutate, isMutating: saving, stops: [stop], tripStartDate: '2026-11-18', travelLegs: legs, pendingAction: null,
      onAddStop: noop, onRefreshTravelLegRoute: noop, onStopChange: noop, onStopDelete: noop, onStopSave: noop,
      onTravelLegSave: save, onConnectionCreate: create, onConnectionDelete: remove,
    })))
}
function button(label: string, scope: ParentNode = document) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)
  if (!result) throw new Error('Missing button: ' + label)
  return result
}
function radio(label: string) { return document.querySelector<HTMLButtonElement>('[role="radio"][aria-label="' + label + '"]')! }
async function click(item: HTMLElement) { await act(async () => item.click()) }
async function point(latitude = 51.5, label = 'London') {
  await act(async () => selectMapPoint({ coordinates: [latitude, -0.1], label }))
}
beforeEach(async () => {
  vi.clearAllMocks()
  api.previewTravel.mockRejectedValue(new Error('Preview unavailable'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: noop, removeEventListener: noop }))
  container = document.createElement('div'); panelHost = document.createElement('div')
  document.body.append(container, panelHost)
  root = createRoot(container)
  await act(async () => root.render(createElement(Harness)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); panelHost.remove(); vi.unstubAllGlobals()
})
for (const side of ['departure', 'return']) {
  it('requests the automatic travel mode when the ' + side + ' location becomes available', async () => {
    await click(button('Add ' + side))
    expect(api.previewTravel).not.toHaveBeenCalled()
    await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Exact point'))!)
    await point()
    expect(api.previewTravel).toHaveBeenCalledTimes(1)
    expect(api.previewTravel.mock.calls[0][0]).toMatchObject({
      payload: {
        [side === 'departure' ? 'from' : 'to']: { type: 'LOCATION', location: { latitude: 51.5, longitude: -0.1 } },
        [side === 'departure' ? 'to' : 'from']: { type: 'STOP', stop_id: stop.id },
      },
    })
    expect(api.previewTravel.mock.calls[0][0].payload.segments).toBeUndefined()
    await point(51.5, 'Near London')
    expect(api.previewTravel).toHaveBeenCalledTimes(1)
    await point(50.85, 'Brussels')
    expect(api.previewTravel).toHaveBeenCalledTimes(2)
    expect(api.previewTravel.mock.calls[1][0].payload[side === 'departure' ? 'from' : 'to'].location.latitude).toBe(50.85)
    await click(button('Clear ' + side + ' location'))
    expect(api.previewTravel).toHaveBeenCalledTimes(2)
    expect(radio('Car').disabled).toBe(true)
  })
  it('uses the server default for ' + side + ' and keeps an explicit mode after the location changes', async () => {
    const connectionSide = side === 'departure' ? 'DEPARTURE' : 'RETURN'
    api.previewTravel.mockResolvedValueOnce(automaticPreview(connectionSide, 'FLIGHT'))
    await click(button('Add ' + side))
    await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Exact point'))!)
    await point(-33.92, 'Cape Town')
    expect(radio('Flight').getAttribute('aria-checked')).toBe('true')
    const date = document.querySelector<HTMLButtonElement>('[aria-label="Departure date"]')!
    await click(date)
    const selectedDate = document.querySelector('[role="dialog"] .bg-primary')
    expect(selectedDate?.textContent).toBe(side === 'departure' ? '18' : '20')
    await click(date)
    expect(api.lookupFlight).not.toHaveBeenCalled()
    api.previewTravel.mockResolvedValueOnce(automaticPreview(connectionSide, 'CAR'))
    await point()
    expect(radio('Car').getAttribute('aria-checked')).toBe('true')
    expect(api.previewTravel.mock.calls[1][0].payload.segments).toBeUndefined()
    await click(radio('Train'))
    await point(-33.92, 'Cape Town')
    expect(radio('Train').getAttribute('aria-checked')).toBe('true')
    const lastRequest = api.previewTravel.mock.calls[api.previewTravel.mock.calls.length - 1][0]
    expect(lastRequest.payload.segments[0].travel_mode).toBe('TRAIN')
    expect(lastRequest.payload.segments[0].mode_selected).toBe(true)
  })
  it('prefills a manually selected ' + side + ' flight and preserves a chosen date when switching modes', async () => {
    await click(button('Add ' + side))
    await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Exact point'))!)
    await point()
    await click(radio('Flight'))
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Departure date"]')!)
    expect(document.querySelector('[role="dialog"] .bg-primary')?.textContent).toBe(side === 'departure' ? '18' : '20')
    await click(button('17'))
    await click(radio('Train')); await click(radio('Flight'))
    await click(button('Add ' + side, panelHost))
    expect(create.mock.calls[0][0].segments[0].flight.departure_date).toBe('2026-11-17')
  })
  it('opens ' + side + ' travel alongside the location and saves both together', async () => {
    await click(button('Add ' + side))
    expect(panelHost.textContent).toContain('Select your route')
    expect(container.querySelector('input')?.closest('label')?.textContent).toContain('Search places')
    expect(container.textContent).toContain('New ' + side)
    expect(container.querySelector('article')).toBeNull()
    expect(radio('Train').disabled).toBe(true)
    expect(create).not.toHaveBeenCalled()
    expect(api.previewTravel).not.toHaveBeenCalled()
    await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Exact point'))!); await point()
    expect(radio('Train').disabled).toBe(false)
    await click(radio('Train')); await point(50.85, 'Brussels')
    expect(radio('Train').getAttribute('aria-checked')).toBe('true')
    await click(button('Add ' + side, panelHost))
    expect(create).toHaveBeenCalledTimes(1)
    const payload = create.mock.calls[0][0]
    expect(payload[side === 'departure' ? 'from' : 'to']).toEqual({ type: 'LOCATION', location: { latitude: 50.85, longitude: -0.1 } })
    expect(payload[side === 'departure' ? 'to' : 'from']).toEqual({ type: 'STOP', stop_id: stop.id })
    expect(payload.segments[0].travel_mode).toBe('TRAIN')
    expect(payload.segments[0].id).toBeUndefined()
  })
}
it('cancels without creating a connection and resets the next draft', async () => {
  await click(button('Add departure')); await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Exact point'))!); await point()
  await click(radio('Flight')); await click(button('Cancel'))
  expect(panelHost.textContent).toBe(''); expect(create).not.toHaveBeenCalled()
  await click(button('Add return'))
  expect(radio('Flight').disabled).toBe(true)
  expect(radio('Flight').getAttribute('aria-checked')).toBe('false')
})
it('clearing the endpoint disables saving and travel again', async () => {
  await click(button('Add departure')); await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Exact point'))!); await point()
  await click(button('Clear departure location'))
  expect(radio('Train').disabled).toBe(true)
  expect(button('Add departure', panelHost).disabled).toBe(true)
  expect(create).not.toHaveBeenCalled()
})
it.each([undefined, '2026-11-15'])('opens an existing outer flight with date %s and both endpoints intact', async (departureDate) => {
  const leg: TravelLeg = {
    ...createOuterConnectionDraft('DEPARTURE', stop), id: 'saved',
    from: { type: 'LOCATION', location: { ...stop.location, latitude: 51.5, longitude: -0.1, name: 'London' } },
    segments: [{ id: 'flight', input_version: 1, mode_source: 'USER', intent: { travel_mode: 'FLIGHT', mode_selected: false, notes: '', route_option: 0, flight: departureDate ? { departure_date: departureDate } : null },
      route_state: 'UNSUPPORTED', geometry: null, from_endpoint: null, to_endpoint: null }],
  }
  await act(async () => root.render(createElement(Harness, { legs: [leg] })))
  await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('London to Amsterdam'))!)
  expect(radio('Flight').getAttribute('aria-checked')).toBe('true')
  await click(button('Select this route'))
  expect(save).toHaveBeenCalledWith('saved', expect.objectContaining({
    from: { type: 'LOCATION', location: { latitude: 51.5, longitude: -0.1 } },
    to: { type: 'STOP', stop_id: stop.id }, segments: [expect.objectContaining({ travel_mode: 'FLIGHT', flight: { departure_date: departureDate ?? stop.planned_start_date } })],
  }))
})

for (const side of ['DEPARTURE', 'RETURN'] as const) {
  it('confirms ' + side.toLowerCase() + ' removal without losing edits, and retains failures for retry', async () => {
    const label = side.toLowerCase()
    const outside = { type: 'LOCATION' as const, location: { ...stop.location, name: 'London' } }
    const leg: TravelLeg = { ...createOuterConnectionDraft(side, stop), id: 'saved-' + label,
      from: side === 'DEPARTURE' ? outside : { type: 'STOP', stop_id: stop.id },
      to: side === 'RETURN' ? outside : { type: 'STOP', stop_id: stop.id },
      segments: [{ id: 'flight', input_version: 1, mode_source: 'USER', intent: { travel_mode: 'FLIGHT', mode_selected: false, notes: '', route_option: 0 },
        route_state: 'UNSUPPORTED', geometry: null, from_endpoint: null, to_endpoint: null }],
    }
    const legs = [leg]
    await act(async () => root.render(createElement(Harness, { legs })))
    const trigger = () => document.querySelector<HTMLButtonElement>('[aria-label="Remove ' + label + ' connection"]')!
    await click(trigger())
    expect(document.body.textContent).toContain('Remove ' + label + '?')
    expect(document.body.textContent).toContain('Your itinerary stops will stay.')
    expect(remove).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button('Keep ' + label))
    await click(button('Keep ' + label))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
    await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('Flight'))!)
    await click(radio('Train'))
    const removeAction = () => button('Remove ' + label)
    expect(removeAction().previousElementSibling?.textContent).toBe('Clear ' + label + ' location')
    expect(document.querySelector('[aria-label="Remove ' + label + ' connection"]')).toBeNull()
    await click(removeAction())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(radio('Train').getAttribute('aria-checked')).toBe('true')
    await click(removeAction()); await click([...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => item.textContent === 'Remove ' + label)!)
    expect(remove).toHaveBeenCalledExactlyOnceWith(leg.id)
    await act(async () => root.render(createElement(Harness, { legs, saving: true })))
    expect(button('Removing...').disabled).toBe(true)
    expect(button('Keep ' + label).disabled).toBe(true)
    await act(async () => root.render(createElement(Harness, { legs, saveError: 'Could not remove connection' })))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Could not remove connection')
    await click(button('Keep ' + label))
    expect(radio('Train').getAttribute('aria-checked')).toBe('true')
  })
}

it('does not offer connection removal to a reader', async () => {
  const leg: TravelLeg = { ...createOuterConnectionDraft('DEPARTURE', stop), id: 'saved' }
  await act(async () => root.render(createElement(Harness, { legs: [leg], canMutate: false })))
  expect(document.querySelector('[aria-label="Remove departure connection"]')).toBeNull()
})
