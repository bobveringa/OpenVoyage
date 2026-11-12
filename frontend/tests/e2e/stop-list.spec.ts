import { expect, test, type Page } from '@playwright/test'
import type { Itinerary, ItineraryConnection, ItineraryStop } from '../../src/api/client'
import { seedAuthTokens } from './helpers/auth'

const timestamp = '2026-10-20T12:00:00Z'
const creator = { id: 'owner', first_name: 'Route', last_name: 'Tester', username: 'tester' }
const artifacts = '../private/artifacts/stop-list'

function stop(id: string, name: string, start: string, nights: number, [latitude, longitude]: [number, number], timezone: string, country: string): ItineraryStop {
  return {
    id, title: name, trip_id: 'trip', notes: '', notes_updated_at: null, stays: [], planned_nights: nights,
    planned_start_date: start, visited: false, created_at: timestamp, updated_at: timestamp, created_by: creator,
    location: { id, name, full_name: name, latitude, longitude, region: '', country_code: country, timezone },
    original_location: { id, name, full_name: name, latitude, longitude, region: '', country_code: country, timezone },
  }
}

function connection(from: ItineraryStop, to: ItineraryStop, mode: 'FLIGHT' | 'CAR', ready: boolean): ItineraryConnection {
  const geometry = { type: 'LineString' as const, coordinates: [
    [from.location.longitude, from.location.latitude] as [number, number],
    [to.location.longitude, to.location.latitude] as [number, number],
  ] }
  const duration = mode === 'FLIGHT' ? 6_960 : ready ? 5_400 : null
  return {
    id: `${from.id}-${to.id}`, trip_id: 'trip', connection_type: 'BETWEEN_STOPS',
    from: { type: 'STOP', stop_id: from.id }, to: { type: 'STOP', stop_id: to.id },
    notes: '', created_at: timestamp, updated_at: timestamp, warnings: [],
    duration_seconds: duration, duration_scope: duration ? (mode === 'FLIGHT' ? 'FLIGHT_JOURNEY' : 'JOURNEY') : null,
    route: { type: ready && mode === 'CAR' ? 'PROVIDER_BACKED' : 'SIMPLE', geometry, distance_meters: ready && mode === 'CAR' ? 101_000 : null, duration_seconds: duration },
    segments: [{
      id: `${from.id}-${to.id}-segment`, input_version: 1, mode_source: 'USER',
      intent: { travel_mode: mode, mode_selected: false, notes: '', route_option: 0 },
      from_endpoint: from.location, to_endpoint: to.location,
      route_state: mode === 'FLIGHT' ? 'UNSUPPORTED' : ready ? 'READY' : 'NOT_CALCULATED', geometry,
    }],
  } as ItineraryConnection
}

const london = stop('a', 'London', '2026-10-01', 2, [51.5074, -0.1278], 'Europe/London', 'GB')
const barcelona = stop('b', 'Barcelona', '2026-10-03', 3, [41.39, 2.16], 'Europe/Madrid', 'ES')
const girona = stop('c', 'Girona', '2026-10-06', 1, [41.98, 2.82], 'Europe/Madrid', 'ES')

async function openTrip(page: Page, { mobile = false, stayEnds = false } = {}) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
  const token = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await seedAuthTokens(page, { access_token: `test.${token}.sig`, id_token: 'id', refresh_token: 'refresh', token_type: 'bearer' })
  const itinerary: Itinerary = {
    trip_id: 'trip', itinerary_revision: 4, stops: [london, barcelona, girona],
    connections: [connection(london, barcelona, 'FLIGHT', false), connection(barcelona, girona, 'CAR', true)],
  }
  if (stayEnds) {
    // The car route leaves from a hotel and arrives at another, away from both town pins.
    const road = itinerary.connections[1]!
    const geometry = { type: 'LineString' as const, coordinates: [[2.1963, 41.3866], [2.5, 41.7], [2.84, 42.0]] as [number, number][] }
    road.route = { ...road.route, geometry }
    road.segments = road.segments.map((segment) => ({ ...segment, geometry }))
  }
  const calls = { patches: [] as unknown[] }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (path.endsWith('/admin/setup')) return json({ setup_required: false })
    if (path.endsWith('/settings/public')) return json({ settings: {}, updated_at: timestamp })
    if (path.endsWith('/users/me')) return json({ id: 'owner', password_change_required: false, permissions: ['trip:create'], profile: null, role: 'USER' })
    if (path.endsWith('/trips/trip')) return json({ id: 'trip', name: 'Stop list trip', start_date: '2026-10-01', end_date: '2026-10-07', description: '', cover_media: null, visibility: 'PRIVATE' })
    if (path.endsWith('/members')) return json([{ role: 'OWNER', user_id: 'owner', user: creator, trip_id: 'trip' }])
    if (path.endsWith('/posts/timeline')) return json({ entries: [], opening_route: null })
    if (path.endsWith('/viewers') || path.endsWith('/share-links')) return json([])
    if (path.endsWith('/itinerary') || path.endsWith('/itinerary/overview')) return json(itinerary)
    const moved = /\/itinerary\/stops\/(\w+)$/.exec(path)
    if (moved && request.method() === 'PATCH') {
      const body = request.postDataJSON()
      calls.patches.push({ stop: moved[1], ...body })
      const stopId = moved[1]!
      const rest = itinerary.stops.filter((item) => item.id !== stopId)
      const index = body.placement.after_stop_id === null ? 0 : rest.findIndex((item) => item.id === body.placement.after_stop_id) + 1
      itinerary.stops = [...rest.slice(0, index), itinerary.stops.find((item) => item.id === stopId)!, ...rest.slice(index)]
      itinerary.itinerary_revision += 1
      return json(itinerary)
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } })
  })
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/trips/trip?tab=plan')
  await expect(page.locator('[data-stop-row="c"]')).toBeVisible()
  return { calls, itinerary }
}

const row = (page: Page, id: string) => page.locator(`[data-stop-row="${id}"]`)
const rowOrder = (page: Page) => page.locator('[data-stop-row]').evaluateAll((rows) => rows.map((item) => item.getAttribute('data-stop-row')))

test('the slim travel line shows distance, time and a clock change, and opens the editor', async ({ page }) => {
  await openTrip(page)
  const flight = page.locator('[data-travel-line="a-b"]')
  await expect(flight).toHaveText(/^1,1\d\d km · 1 hr 55 min \+$/)
  await expect(page.locator('[data-time-zone-change="a-b"]')).toHaveText('Time difference +1 h')
  await expect(flight).toHaveAccessibleName(/^Flight London to Barcelona, 1,1\d\d km · 1 hr 55 min \+, Time difference \+1 h$/)
  await expect(page.locator('[data-travel-line="b-c"]')).toHaveText('101 km · 1 hr 30 min +')
  // The wide dashed buttons are gone; a small + sits on the timeline.
  await expect(page.getByRole('button', { name: 'Add stop here' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Add stop after this stop' })).toBeVisible()
  await page.locator('[data-stop-row]').first().screenshot({ path: `${artifacts}/stop-row.png` })
  await page.screenshot({ path: `${artifacts}/desktop-list.png` })
  await flight.click()
  await expect(page.getByRole('heading', { name: 'Select your route' })).toBeVisible()
})

test('the small + adds a stop between two stops', async ({ page }) => {
  await openTrip(page)
  await page.getByRole('button', { name: 'Add stop here' }).first().click()
  await expect(page.getByRole('heading', { name: 'New stop' })).toBeVisible()
})

test('stops move with the arrow keys on the handle, and by dragging', async ({ page }) => {
  const { calls } = await openTrip(page)
  const handle = page.getByRole('button', { name: 'Move London' })
  await handle.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => calls.patches).toEqual([{ stop: 'a', placement: { after_stop_id: 'b' } }])
  await expect.poll(() => rowOrder(page)).toEqual(['b', 'a', 'c'])
  await expect(page.getByRole('button', { name: 'Move London' })).toBeFocused()
  await expect(page.getByText('London moved to position 2 of 3.')).toBeAttached()
  // Up from the top does nothing.
  await page.getByRole('button', { name: 'Move Barcelona' }).focus()
  await page.keyboard.press('ArrowUp')

  const grip = await page.getByRole('button', { name: 'Move Girona' }).boundingBox()
  const top = await row(page, 'b').boundingBox()
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip!.x, top!.y + 10, { steps: 8 })
  await expect(page.locator('[data-drop-indicator]')).toHaveCount(1)
  await page.screenshot({ path: `${artifacts}/desktop-drag.png` })
  await page.mouse.up()
  await expect.poll(() => calls.patches).toEqual([
    { stop: 'a', placement: { after_stop_id: 'b' } },
    { stop: 'c', placement: { after_stop_id: null } },
  ])
  await expect.poll(() => rowOrder(page)).toEqual(['c', 'b', 'a'])
})

test('a long press on the handle drags on a phone', async ({ page }) => {
  const { calls } = await openTrip(page, { mobile: true })
  const grip = page.getByRole('button', { name: 'Move London' })
  const box = (await grip.boundingBox())!
  const target = (await row(page, 'c').boundingBox())!
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const touch = (type: string, y: number) => grip.dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: y })
  // A quick touch is not a drag.
  await touch('pointerdown', point.y)
  await touch('pointerup', point.y)
  await touch('pointerdown', point.y)
  await page.waitForTimeout(500)
  await touch('pointermove', target.y + target.height - 4)
  await touch('pointerup', target.y + target.height - 4)
  await expect.poll(() => calls.patches).toEqual([{ stop: 'a', placement: { after_stop_id: 'c' } }])
})

test('rows and pins are linked both ways', async ({ page }) => {
  await openTrip(page)
  const pin = (id: string) => page.locator(`[data-stop-pin="${id}"]`).first()
  await row(page, 'b').hover()
  await expect(pin('b')).toHaveAttribute('data-highlighted', 'true')
  await expect(pin('a')).toHaveAttribute('data-highlighted', 'false')
  await page.screenshot({ path: `${artifacts}/desktop-hover-row.png` })
  await pin('c').hover()
  await expect(row(page, 'c')).toHaveAttribute('data-highlighted', 'true')
  await pin('c').click()
  await expect(page.getByRole('region', { name: 'Girona, stop details' })).toBeVisible()
  await expect(page).toHaveURL(/stop=c/)
})

test('mobile list keeps the slim line and the handle', async ({ page }) => {
  await openTrip(page, { mobile: true })
  await expect(page.locator('[data-time-zone-change="a-b"]')).toHaveText('Time difference +1 h')
  await expect(page.getByRole('button', { name: 'Move London' })).toBeVisible()
  await page.screenshot({ path: `${artifacts}/mobile-list.png` })
})

test('route ends at stays are joined to their stop pins', async ({ page }) => {
  await openTrip(page, { stayEnds: true })
  // Barcelona's hotel start and Girona's hotel end each get a faint join to the pin;
  // the flight that ends at the Barcelona pin needs none.
  await expect(page.locator('path.trip-map-stop-joiner')).toHaveCount(2)
})

test('routes that end at their pins need no joiners', async ({ page }) => {
  await openTrip(page)
  await expect(page.locator('[data-stop-pin]')).toHaveCount(3)
  await expect(page.locator('path.trip-map-stop-joiner')).toHaveCount(0)
})
