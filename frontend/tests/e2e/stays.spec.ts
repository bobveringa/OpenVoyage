import { expect, test, type Page } from '@playwright/test'
import type { Itinerary, ItineraryStop, Stay } from '../../src/api/client'
import { seedAuthTokens } from './helpers/auth'

const timestamp = '2026-10-20T12:00:00Z'
const creator = { id: 'owner', first_name: 'Route', last_name: 'Tester', username: 'tester' }
const artifacts = '../private/artifacts/stays'

function location(id: string, name: string, latitude: number, longitude: number, country: string) {
  return { id, name, full_name: name, latitude, longitude, region: '', country_code: country, timezone: 'Europe/Madrid' }
}

function stop(id: string, name: string, start: string, nights: number, latitude: number, longitude: number, country: string, stays: Stay[] = []): ItineraryStop {
  return {
    id, title: name, trip_id: 'trip', notes: '', notes_updated_at: null, planned_nights: nights, stays,
    planned_start_date: start, visited: false, created_at: timestamp, updated_at: timestamp, created_by: creator,
    location: location(id, name, latitude, longitude, country),
    original_location: location(id, name, latitude, longitude, country),
  }
}

function stay(id: string, name: string, status: Stay['status'], checkIn: string, checkOut: string, pin: [number, number] | null = null): Stay {
  return {
    id, stop_id: 'b', name, status, stay_type: 'HOTEL', check_in_date: checkIn, check_out_date: checkOut,
    address: null, location: pin ? location('loc-' + id, 'Barcelona', pin[0], pin[1], 'ES') : null,
    check_in_time: status === 'BOOKED' ? '15:00' : null, check_out_time: null,
    booking_reference: status === 'BOOKED' ? '4821-XK' : null, booking_url: null, contact_phone: null, contact_email: null,
  }
}

type Calls = {
  stays: { method: string; path: string; body: unknown }[]
  deletes: string[]
  trip: unknown[]
  addresses: { kind: string; params: Record<string, string> }[]
}

type AddressAnswer = { status: number; body: unknown; delayMs?: number }
const HOTEL_ARTS = { name: 'Hotel Arts Barcelona', address: 'Carrer de la Marina 19-21, 08005 Barcelona, Spain', latitude: 41.3866, longitude: 2.1963 }

async function openTrip(page: Page, { endDate = '2026-10-20', mobile = false, addressProvider = 'none', addressAnswer = (query: string): AddressAnswer => ({ status: 200, body: query.includes('arts') ? [HOTEL_ARTS] : [] }) } = {}) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
  const token = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await seedAuthTokens(page, { access_token: `test.${token}.sig`, id_token: 'id', refresh_token: 'refresh', token_type: 'bearer' })
  const itinerary: Itinerary = {
    trip_id: 'trip', itinerary_revision: 7, connections: [],
    stops: [
      stop('a', 'Eindhoven', '2026-10-01', 2, 51.44, 5.48, 'NL'),
      stop('b', 'Barcelona', '2026-10-03', 3, 41.39, 2.16, 'ES', [
        stay('arts', 'Hotel Arts', 'BOOKED', '2026-10-03', '2026-10-05', [41.3866, 2.1963]),
        stay('casa', 'Casa Bonay', 'IDEA', '2026-10-05', '2026-10-06', [41.3925, 2.1745]),
      ]),
    ],
  }
  const calls: Calls = { stays: [], deletes: [], trip: [], addresses: [] }
  let trip = { id: 'trip', name: 'Stay trip', start_date: '2026-10-01', end_date: endDate, description: '', cover_media: null, visibility: 'PRIVATE' }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (path.endsWith('/admin/setup')) return json({ setup_required: false })
    if (path.endsWith('/settings/public')) return json({ settings: { 'address_search.provider': addressProvider }, updated_at: timestamp })
    if (path.includes('/itinerary/addresses/')) {
      const params = Object.fromEntries(new URL(request.url()).searchParams)
      const kind = path.split('/').pop()!
      calls.addresses.push({ kind, params })
      if (kind === 'reverse-geocode') return json({ name: 'Carrer de Mallorca 401', address: 'Carrer de Mallorca 401, 08013 Barcelona, Spain', latitude: Number(params.latitude), longitude: Number(params.longitude) })
      const answer = addressAnswer(params.query ?? '')
      if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs))
      return json(answer.body, answer.status)
    }
    if (path.endsWith('/users/me')) return json({ id: 'owner', password_change_required: false, permissions: ['trip:create'], profile: null, role: 'USER' })
    if (path.endsWith('/trips/trip')) {
      if (request.method() === 'PATCH') {
        calls.trip.push(request.postDataJSON())
        trip = { ...trip, ...request.postDataJSON() }
      }
      return json(trip)
    }
    if (path.endsWith('/members')) return json([{ role: 'OWNER', user_id: 'owner', user: creator, trip_id: 'trip' }])
    if (path.endsWith('/posts/timeline')) return json({ entries: [], opening_route: null })
    if (path.endsWith('/viewers') || path.endsWith('/share-links')) return json([])
    if (path.endsWith('/itinerary') || path.endsWith('/itinerary/overview')) return json(itinerary)
    const barcelona = itinerary.stops[1]!
    if (path.includes('/itinerary/stays')) {
      expect(request.headers()['if-match']).toBe(`"${itinerary.itinerary_revision}"`)
      const body = request.method() === 'DELETE' ? null : request.postDataJSON()
      calls.stays.push({ method: request.method(), path, body })
      if (request.method() === 'POST') {
        const { location: pin, stop_id: _stop, ...fields } = body
        void _stop
        barcelona.stays = [...barcelona.stays, { ...stay('new', '', null, '', ''), ...fields, location: pin ? location('loc-new', 'Barcelona', pin.latitude, pin.longitude, 'ES') : null }]
      } else if (request.method() === 'PATCH') {
        const id = path.split('/').pop()!
        barcelona.stays = barcelona.stays.map((item) => item.id === id ? { ...item, ...body } : item)
      } else {
        const id = path.split('/').pop()!
        barcelona.stays = barcelona.stays.filter((item) => item.id !== id)
      }
      itinerary.itinerary_revision += 1
      return json(itinerary, request.method() === 'POST' ? 201 : 200)
    }
    if (path.endsWith('/stops/b') && request.method() === 'DELETE') {
      calls.deletes.push('b')
      itinerary.stops = [itinerary.stops[0]!]
      itinerary.itinerary_revision += 1
      return json(itinerary)
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } })
  })
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/trips/trip?tab=plan&stop=b')
  return { calls, itinerary }
}

const card = (page: Page) => page.getByRole('region', { name: 'Barcelona, stop details' })

test('stay pins show with no card open and dim while another stop is open', async ({ page }) => {
  await openTrip(page)
  await page.goto('/trips/trip?tab=plan')
  const pins = page.locator('[data-stay-pin]')
  await expect(pins).toHaveCount(2)
  await expect(page.locator('[data-stay-pin="arts"]')).toHaveAttribute('data-dimmed', 'false')
  await page.goto('/trips/trip?tab=plan&stop=a')
  await expect(pins).toHaveCount(2)
  await expect(page.locator('[data-stay-pin="arts"]')).toHaveAttribute('data-dimmed', 'true')
})

test('stays show calmly in the card, with details in a modal and bed pins on the map', async ({ page }) => {
  await openTrip(page)
  await expect(card(page).getByText('2/3 nights booked')).toBeVisible()
  await expect(page.locator('[data-stop-row="b"]')).toContainText('1 night not booked')
  const arts = card(page).getByRole('button', { name: /^Hotel Arts, .* · 2 nights · Booked$/ })
  await expect(card(page).getByRole('button', { name: /^Casa Bonay, .* · 1 night · Idea$/ })).toBeVisible()
  // Bed pins: booked filled, ideas outlined.
  const pins = page.locator('[data-stay-pin]')
  await expect(pins).toHaveCount(2)
  await expect(page.locator('[data-stay-pin="arts"]')).toHaveAttribute('data-dimmed', 'false')
  await expect(page.locator('[data-stay-pin="arts"]')).toHaveAttribute('data-booked', 'true')
  await expect(page.locator('[data-stay-pin="casa"]')).toHaveAttribute('data-booked', 'false')
  await arts.hover()
  await expect(page.locator('[data-stay-pin="arts"]')).toHaveAttribute('data-highlighted', 'true')
  await page.screenshot({ path: `${artifacts}/desktop-stays.png` })
  // Details live in the edit modal. Escape closes the modal, not the card.
  await arts.click()
  const modal = page.getByRole('dialog', { name: 'Hotel Arts' })
  await expect(modal.getByRole('textbox', { name: 'Booking reference' })).toHaveValue('4821-XK')
  await expect(modal.getByRole('button', { name: 'Check-in time' })).toContainText(/15:00|3:00\sPM/)
  await page.screenshot({ path: `${artifacts}/desktop-stay-modal.png` })
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(card(page)).toBeVisible()
  await card(page).getByRole('button', { name: 'Close stop details' }).click()
  await expect(pins).toHaveCount(2)
})

test('adding a stay with a pin, and booking an idea', async ({ page }) => {
  const { calls } = await openTrip(page)
  await card(page).getByRole('button', { name: /^Casa Bonay,/ }).click()
  const casa = page.getByRole('dialog', { name: 'Casa Bonay' })
  await casa.getByRole('radio', { name: 'Booked' }).click()
  await casa.getByRole('button', { name: 'Save' }).click()
  await expect(casa).toHaveCount(0)
  expect(calls.stays.at(-1)).toMatchObject({ method: 'PATCH', body: { status: 'BOOKED', name: 'Casa Bonay' } })
  expect(calls.stays.at(-1)!.body).not.toHaveProperty('location')
  await expect(card(page).getByText('3/3 nights booked')).toBeVisible()

  await card(page).getByRole('button', { name: 'Add a stay' }).click()
  const modal = page.getByRole('dialog', { name: 'New stay' })
  await modal.getByRole('button', { name: 'Type' }).click()
  await page.getByRole('option', { name: 'With friends or family' }).click()
  await expect(modal.getByRole('button', { name: 'Type' })).toContainText('With friends or family')
  await expect(modal.getByRole('radiogroup', { name: 'Status' })).toHaveCount(0)
  await modal.getByRole('textbox', { name: 'Name' }).fill('Marta')
  // The modal steps aside while you click the map, then comes back.
  await modal.getByRole('button', { name: /Drop a pin on the map/ }).click()
  await expect(modal).toHaveCount(0)
  // A hint over the map says what is happening, with the stay's name.
  await expect(page.getByRole('status').filter({ hasText: 'Click the map to place Marta' })).toBeVisible()
  await page.getByRole('region', { name: 'Trip map' }).click({ position: { x: 600, y: 500 } })
  await expect(modal.getByText(/^Pin at /)).toBeVisible()
  await expect(modal.getByRole('textbox', { name: 'Name' })).toHaveValue('Marta')
  await modal.getByRole('button', { name: 'Add stay' }).click()
  await expect(modal).toHaveCount(0)
  const created = calls.stays.at(-1)!
  expect(created.method).toBe('POST')
  expect(created.body).toMatchObject({
    stop_id: 'b', stay_type: 'FRIENDS', status: null, name: 'Marta',
    check_in_date: '2026-10-03', check_out_date: '2026-10-06', booking_url: null, contact_email: null,
  })
  expect((created.body as { location: { latitude: number } }).location.latitude).toEqual(expect.any(Number))
  await expect(card(page).getByRole('button', { name: /^Marta,/ })).toBeVisible()
})

test('a stay is deleted from its modal after a second click', async ({ page }) => {
  const { calls } = await openTrip(page)
  await card(page).getByRole('button', { name: /^Casa Bonay,/ }).click()
  const modal = page.getByRole('dialog', { name: 'Casa Bonay' })
  await modal.getByRole('button', { name: 'Delete', exact: true }).click()
  expect(calls.stays).toEqual([])
  await modal.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect(calls.stays.at(-1)).toMatchObject({ method: 'DELETE', path: expect.stringContaining('/itinerary/stays/casa') })
})

test('a booked stay that no longer fits is flagged, and the trip end can follow the last stop', async ({ page }) => {
  const { calls, itinerary } = await openTrip(page, { endDate: '2026-10-05' })
  itinerary.stops[1]!.planned_start_date = '2026-10-04'
  await page.reload()
  await expect(card(page).getByText(/Hotel Arts is booked for .* but Barcelona is now/)).toBeVisible()
  await expect(page.locator('[data-stop-row="b"]')).toContainText(/Hotel Arts is booked for/)
  await expect(page.locator('[data-stop-row="b"]')).toContainText('Ends after the trip')
  await page.locator('[data-stop-row="b"]').getByRole('button', { name: /Move trip end to/ }).click()
  await expect.poll(() => calls.trip).toEqual([{ end_date: '2026-10-07' }])
  await expect(page.locator('[data-stop-row="b"]')).not.toContainText('Ends after the trip')
})

test('deleting a stop with a booked stay asks first', async ({ page }) => {
  const { calls } = await openTrip(page)
  await page.getByRole('button', { name: 'Delete Barcelona', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete Barcelona?' })
  await expect(dialog).toContainText('Barcelona has 1 booked stay. Delete the stop and its stays?')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(calls.deletes).toEqual([])
  await page.getByRole('button', { name: 'Delete Barcelona', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete Barcelona?' }).getByRole('button', { name: 'Delete stop' }).click()
  await expect.poll(() => calls.deletes).toEqual(['b'])
})

test('mobile stays live inside the full-screen card', async ({ page }) => {
  await openTrip(page, { mobile: true })
  await expect(card(page).getByText('2/3 nights booked')).toBeVisible()
  await card(page).getByRole('button', { name: 'Add a stay' }).click()
  await expect(page.getByRole('dialog', { name: 'New stay' })).toBeVisible()
  await page.screenshot({ path: `${artifacts}/mobile-stay-form.png`, fullPage: false })
})

test('address search fills in the stay, and dropping a pin fills in the address', async ({ page }) => {
  const { calls } = await openTrip(page, {
    addressProvider: 'photon',
    addressAnswer: (query) => query.includes('down')
      ? { status: 503, body: { detail: { code: 'ADDRESS_SEARCH_UNAVAILABLE', message: 'Address search unavailable.' } } }
      : { status: 200, body: query.includes('arts') ? [HOTEL_ARTS] : [], delayMs: 1500 },
  })
  await card(page).getByRole('button', { name: 'Add a stay' }).click()
  const modal = page.getByRole('dialog', { name: 'New stay' })
  const search = modal.getByRole('searchbox', { name: 'Search hotel or address' })
  // Photon searches after a short pause, with a clear indicator.
  await search.fill('hotel arts')
  await expect(modal.getByText('Searching…')).toBeVisible()
  const result = modal.getByRole('button', { name: /Hotel Arts Barcelona/ })
  await expect(result).toBeVisible()
  expect(calls.addresses).toHaveLength(1)
  expect(calls.addresses[0]).toMatchObject({ kind: 'geocode', params: { query: 'hotel arts', near_latitude: '41.39', near_longitude: '2.16' } })
  await page.screenshot({ path: `${artifacts}/desktop-address-search.png` })
  await result.click()
  await expect(modal.getByRole('textbox', { name: 'Name' })).toHaveValue('Hotel Arts Barcelona')
  await expect(modal.getByRole('textbox', { name: 'Address' })).toHaveValue(HOTEL_ARTS.address)
  await expect(modal.getByText('Pin at 41.3866, 2.1963')).toBeVisible()

  // "No results" and "unavailable" are messages, never an empty list.
  await search.fill('nowhere at all')
  await expect(modal.getByText('No results')).toBeVisible()
  await search.fill('provider down')
  await expect(modal.getByText('Address search unavailable.')).toBeVisible()

  await modal.getByRole('button', { name: 'Add stay' }).click()
  await expect(modal).toHaveCount(0)
  expect(calls.stays.at(-1)!.body).toMatchObject({
    name: 'Hotel Arts Barcelona', address: HOTEL_ARTS.address,
    location: { latitude: HOTEL_ARTS.latitude, longitude: HOTEL_ARTS.longitude },
  })

  // A dropped pin fills in the address of the point.
  await card(page).getByRole('button', { name: 'Add a stay' }).click()
  await modal.getByRole('textbox', { name: 'Name' }).fill('Somewhere')
  await modal.getByRole('button', { name: /Drop a pin on the map/ }).click()
  await page.getByRole('region', { name: 'Trip map' }).click({ position: { x: 600, y: 500 } })
  await expect(modal.getByRole('textbox', { name: 'Address' })).toHaveValue('Carrer de Mallorca 401, 08013 Barcelona, Spain')
  expect(calls.addresses.at(-1)!.kind).toBe('reverse-geocode')
})

test('nominatim searches on Enter only and asks to try again when too soon', async ({ page }) => {
  let answers = 0
  const { calls } = await openTrip(page, {
    addressProvider: 'nominatim',
    addressAnswer: () => ++answers === 1
      ? { status: 200, body: [HOTEL_ARTS] }
      : { status: 503, body: { detail: { code: 'ADDRESS_SEARCH_UNAVAILABLE', message: 'Try again in a moment.' } } },
  })
  await card(page).getByRole('button', { name: 'Add a stay' }).click()
  const modal = page.getByRole('dialog', { name: 'New stay' })
  const search = modal.getByRole('searchbox', { name: 'Search hotel or address' })
  await search.fill('hotel arts')
  await page.waitForTimeout(700)
  expect(calls.addresses).toHaveLength(0)
  await search.press('Enter')
  await expect(modal.getByRole('button', { name: /Hotel Arts Barcelona/ })).toBeVisible()
  // Enter searches; it never submits the stay form.
  await expect(modal).toBeVisible()
  expect(calls.stays).toEqual([])
  await search.press('Enter')
  await expect(modal.getByText('Try again in a moment.')).toBeVisible()
})

test('without an address provider the stay form has no search box', async ({ page }) => {
  await openTrip(page)
  await card(page).getByRole('button', { name: 'Add a stay' }).click()
  const modal = page.getByRole('dialog', { name: 'New stay' })
  await expect(modal.getByRole('button', { name: /Drop a pin on the map/ })).toBeVisible()
  await expect(modal.getByRole('searchbox', { name: 'Search hotel or address' })).toHaveCount(0)
})

test('stay times come from a styled menu with the usual times first, and pins show the stay type', async ({ page }) => {
  const { calls } = await openTrip(page)
  // Each stay's pin carries its type's icon.
  await expect(page.locator('[data-stay-pin="arts"]')).toHaveAttribute('data-stay-type', 'HOTEL')
  await expect(page.locator('[data-stay-pin="arts"] svg')).toHaveCount(1)

  await card(page).getByRole('button', { name: /^Casa Bonay,/ }).click()
  const modal = page.getByRole('dialog', { name: 'Casa Bonay' })
  await modal.getByRole('button', { name: 'Times, booking and contact' }).click()
  await modal.getByRole('button', { name: 'Check-in time' }).click()
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options.nth(0)).toHaveAccessibleName('Not set')
  await expect(options.nth(1)).toHaveAccessibleName(/^(15:00|3:00\sPM), Usual time$/)
  await expect(options.nth(2)).toHaveAccessibleName(/^(16:00|4:00\sPM), Usual time$/)
  await page.screenshot({ path: `${artifacts}/desktop-stay-times.png` })
  await options.nth(2).click()
  await modal.getByRole('button', { name: 'Check-out time' }).click()
  await expect(options.nth(1)).toHaveAccessibleName(/^(10:00|10:00\sAM), Usual time$/)
  await options.nth(2).click()
  await modal.getByRole('button', { name: 'Save' }).click()
  await expect(modal).toHaveCount(0)
  expect(calls.stays.at(-1)!.body).toMatchObject({ check_in_time: '16:00', check_out_time: '11:00' })
})

test('the calendar in the card floats above it instead of stretching it', async ({ page }) => {
  await openTrip(page)
  const before = (await card(page).boundingBox())!
  await card(page).getByRole('button', { name: /^Arrival date/ }).click()
  const calendar = page.getByRole('dialog', { name: 'Calendar' })
  await expect(calendar).toBeVisible()
  // It lives outside the card, fully on screen, and the card keeps its size.
  expect(await calendar.evaluate((element) => element.closest('[data-stop-card]'))).toBeNull()
  const box = (await calendar.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(960)
  expect((await card(page).boundingBox())!.height).toBeCloseTo(before.height, 0)
  await page.screenshot({ path: `${artifacts}/desktop-card-calendar.png` })
  await page.keyboard.press('Escape')
  await expect(calendar).toHaveCount(0)
  await expect(card(page)).toBeVisible()
})
