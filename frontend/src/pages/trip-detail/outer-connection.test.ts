import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlanningPanel } from './planning-ui'
import { PlanningSessionContext } from './planning-session'
import { ClockFormatContext } from '@/lib/date-time'
import type { Stop, TravelLeg } from './models'
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
const noop = () => {}
function Harness({ legs = [] }: { legs?: TravelLeg[] }) {
  const [location, setLocation] = useState<DraftPostLocation | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => { selectMapPoint = setLocation }, [])
  return createElement(PlanningSessionContext.Provider, { value: {
    accessToken: 'token', itineraryRevision: 2, panelHost, onPreview: noop, onPanelOpenChange: noop,
    connectionMap: { location, active, start: (point) => { setLocation(point); setActive(true) }, stop: () => setActive(false) },
  } }, createElement(ClockFormatContext.Provider, { value: { preference: '24-hour', setPreference: noop } },
    createElement(PlanningPanel, {
      canMutate: true, isMutating: false, stops: [stop], tripStartDate: '2026-11-18', travelLegs: legs, pendingAction: null,
      onAddStop: noop, onRefreshTravelLegRoute: noop, onStopChange: noop, onStopDelete: noop, onStopSave: noop,
      onTravelLegSave: save, onConnectionCreate: create, onConnectionDelete: noop,
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
it('opens an existing outer flight with its mode and both endpoints intact', async () => {
  const leg: TravelLeg = {
    ...createOuterConnectionDraft('DEPARTURE', stop), id: 'saved',
    from: { type: 'LOCATION', location: { ...stop.location, latitude: 51.5, longitude: -0.1, name: 'London' } },
    segments: [{ id: 'flight', input_version: 1, mode_source: 'USER', intent: { travel_mode: 'FLIGHT', mode_selected: false, notes: '', route_option: 0 },
      route_state: 'UNSUPPORTED', geometry: null, from_endpoint: null, to_endpoint: null }],
  }
  await act(async () => root.render(createElement(Harness, { legs: [leg] })))
  await click([...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes('London to Amsterdam'))!)
  expect(radio('Flight').getAttribute('aria-checked')).toBe('true')
  await click(button('Select this route'))
  expect(save).toHaveBeenCalledWith('saved', expect.objectContaining({
    from: { type: 'LOCATION', location: { latitude: 51.5, longitude: -0.1 } },
    to: { type: 'STOP', stop_id: stop.id }, segments: [expect.objectContaining({ travel_mode: 'FLIGHT' })],
  }))
})
