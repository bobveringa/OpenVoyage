import { expect, test, type Page, type Request } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import type { Itinerary, ItineraryStop } from '../../src/api/client'
import { seedAuthTokens } from './helpers/auth'

const timestamp = '2026-10-20T12:00:00Z'
const creator = { id: 'owner', first_name: 'Route', last_name: 'Tester', username: 'tester' }
const artifacts = '../private/artifacts/stop-card'
// The screenshot uses a real example photo when it's around (it's git-ignored);
// otherwise a 1×1 PNG keeps the test working.
const examplePhoto = '../private/artifacts/stop-header-examples/eindhoven-wp.jpg'
const photoBody = existsSync(examplePhoto)
  ? { body: readFileSync(examplePhoto), contentType: 'image/jpeg' }
  : { body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), contentType: 'image/png' }

function stop(id: string, name: string, start: string, nights: number, latitude: number, longitude: number, region: string, country: string): ItineraryStop {
  return {
    id, title: name, trip_id: 'trip', notes: '', notes_updated_at: null, stays: [], planned_nights: nights,
    planned_start_date: start, visited: false, created_at: timestamp, updated_at: timestamp, created_by: creator,
    location: { id, name, full_name: name, latitude, longitude, region, country_code: country, timezone: 'Europe/Madrid' },
    original_location: { id, name, full_name: name, latitude, longitude, region, country_code: country, timezone: 'Europe/Madrid' },
  }
}

type Calls = { patches: unknown[]; notes: { body: unknown; at: number }[]; photos: string[] }

async function openTrip(page: Page, { mobile = false, replacedBy = false, loadMapTiles = false } = {}) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
  const token = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await seedAuthTokens(page, { access_token: `test.${token}.sig`, id_token: 'id', refresh_token: 'refresh', token_type: 'bearer' })
  const itinerary: Itinerary = {
    trip_id: 'trip', itinerary_revision: 3, connections: [],
    stops: [
      stop('a', 'Eindhoven', '2027-05-10', 2, 51.44, 5.48, 'North Brabant', 'NL'),
      { ...stop('b', 'Barcelona', '2027-05-12', 1, 41.39, 2.16, 'Catalonia', 'ES'), notes: 'Tickets: https://example.com/tickets', notes_updated_at: '2026-11-01T10:00:00Z' },
    ],
  }
  const calls: Calls = { patches: [], notes: [], photos: [] }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (path.endsWith('/admin/setup')) return json({ setup_required: false })
    if (path.endsWith('/settings/public')) return json({ settings: {}, updated_at: timestamp })
    if (path.endsWith('/users/me')) return json({ id: 'owner', password_change_required: false, permissions: ['trip:create'], profile: null, role: 'USER' })
    if (path.endsWith('/trips/trip')) return json({ id: 'trip', name: 'Card trip', start_date: '2027-05-10', end_date: '2027-05-20', description: '', cover_media: null, visibility: 'PRIVATE' })
    if (path.endsWith('/members')) return json([{ role: 'OWNER', user_id: 'owner', user: creator, trip_id: 'trip' }])
    if (path.endsWith('/posts/timeline')) return json({ entries: [], opening_route: null })
    if (path.endsWith('/viewers') || path.endsWith('/share-links')) return json([])
    if (path.endsWith('/itinerary') || path.endsWith('/itinerary/overview')) return json(itinerary)
    // Eindhoven has a header photo; Barcelona gets the designed header.
    if (path.endsWith('/photo') && path.includes('/itinerary/stops/')) {
      calls.photos.push(path)
      return json(path.endsWith('/stops/a/photo') ? {
        url: '/api/v1/places/eindhoven/photo?token=signed',
        credit: 'Example Photographer',
        license: 'CC BY-SA 4.0',
        source_url: 'https://commons.wikimedia.org/wiki/File:Eindhoven.jpg',
      } : null)
    }
    if (path.endsWith('/places/eindhoven/photo')) {
      expect(new URL(request.url()).searchParams.get('token')).toBe('signed')
      return route.fulfill({ status: 200, ...photoBody })
    }
    if (path.endsWith('/stops/b/notes') && request.method() === 'PUT') {
      expect(request.headers()['if-match']).toBeUndefined()
      const body = request.postDataJSON()
      calls.notes.push({ body, at: Date.now() })
      const saved = { notes: body.notes, notes_updated_at: `2026-11-11T10:00:0${calls.notes.length}Z`, replaced_change_by: replacedBy ? { id: 'anna', first_name: 'Anna', last_name: null, username: null } : null }
      itinerary.stops[1] = { ...itinerary.stops[1], notes: saved.notes, notes_updated_at: saved.notes_updated_at }
      return json(saved)
    }
    if (path.endsWith('/stops/b') && request.method() === 'PATCH') {
      expect(request.headers()['if-match']).toBe(`"${itinerary.itinerary_revision}"`)
      const body = request.postDataJSON()
      calls.patches.push(body)
      const current = itinerary.stops[1]!
      const { marker, ...fields } = body
      const location = marker === undefined ? current.location
        : marker === null ? current.original_location
          : { ...current.original_location, id: 'moved', ...marker }
      itinerary.stops[1] = { ...current, ...fields, location }
      itinerary.itinerary_revision += 1
      return json(itinerary)
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } })
  })
  await page.route('https://tile.openstreetmap.org/**', (route) => loadMapTiles
    ? route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#dbead7"/></svg>',
    })
    : route.abort())
  await page.goto('/trips/trip?tab=plan')
  await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible()
  return { calls, itinerary }
}

function card(page: Page) {
  return page.getByRole('region', { name: 'Barcelona, stop details' })
}

test('desktop stop card opens beside the map, keeps the URL and saves notes', async ({ page }) => {
  const { calls } = await openTrip(page)
  // Clicking the row (not its buttons) opens the card. The pencil is gone.
  await expect(page.getByRole('button', { name: /Show details for/ })).toHaveCount(0)
  await page.locator('[data-stop-row="b"]').click({ position: { x: 20, y: 20 } })
  await expect(card(page)).toBeVisible()
  await expect(page).toHaveURL(/[?&]stop=b/)
  await expect(page.getByRole('button', { name: 'Barcelona, rename stop' })).toBeFocused()
  // It sits over the map, 400 px wide, with the list still visible.
  const map = page.getByRole('region', { name: 'Trip map' })
  const [mapBox, cardBox] = await Promise.all([map.boundingBox(), card(page).boundingBox()])
  // 12 px inside the map's 1 px border.
  expect(cardBox!.x - mapBox!.x).toBeCloseTo(13, 0)
  expect(cardBox!.y - mapBox!.y).toBeCloseTo(13, 0)
  expect(cardBox!.width).toBeCloseTo(400, 0)
  await expect(page.locator('[data-stop-row="a"]')).toBeVisible()
  await expect(card(page).getByText('Spain', { exact: true })).toBeVisible()
  await expect(card(page).getByText('Catalonia')).toBeVisible()
  await expect(card(page).getByTestId('stop-header-pattern')).toBeVisible()
  await expect(card(page).getByRole('link', { name: 'https://example.com/tickets' })).toHaveAttribute('target', '_blank')
  await page.screenshot({ path: `${artifacts}/desktop-card.png` })

  // Notes save a second after typing stops, without If-Match, based on the last seen version.
  await card(page).getByTestId('stop-notes-view').click({ position: { x: 300, y: 60 } })
  const notes = card(page).getByRole('textbox', { name: 'Notes' })
  await expect(notes).toBeFocused()
  await notes.press('End')
  await notes.pressSequentially(' and dinner at 20:00')
  await expect(card(page).getByText('Saved')).toBeVisible()
  expect(calls.notes).toHaveLength(1)
  expect(calls.notes[0]!.body).toEqual({ notes: 'Tickets: https://example.com/tickets and dinner at 20:00', based_on: '2026-11-01T10:00:00Z' })
  // Notes never touch the stop: no PATCH, so no route recalculation.
  expect(calls.patches).toEqual([])

  // The last words are sent when the tab goes away.
  await notes.pressSequentially('!')
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect.poll(() => calls.notes.length).toBe(2)
  expect(calls.notes[1]!.body).toMatchObject({ notes: 'Tickets: https://example.com/tickets and dinner at 20:00!', based_on: '2026-11-11T10:00:01Z' })

  // Escape closes the card and puts focus back on the row.
  await notes.blur()
  await card(page).getByRole('button', { name: 'Barcelona, rename stop' }).focus()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]stop=/)
  await expect(page.locator('[data-stop-row="b"] [data-stop-open]')).toBeFocused()

  // Reloading keeps the card open; Back closes it.
  await page.locator('[data-stop-row="b"] [data-stop-open]').click()
  await page.reload()
  await expect(card(page)).toBeVisible()
  await page.locator('[data-stop-row="a"] [data-stop-open]').click()
  await expect(page.getByRole('region', { name: 'Eindhoven, stop details' })).toBeVisible()
  await expect(page).toHaveURL(/[?&]stop=a/)
  await page.goBack()
  await expect(page.getByRole('region', { name: /stop details/ })).toHaveCount(0)
})

test('card dates and name send only what changed', async ({ page }) => {
  const { calls } = await openTrip(page)
  await page.locator('[data-stop-row="b"] [data-stop-open]').click()
  await card(page).getByRole('button', { name: 'One night more' }).click()
  await expect(card(page).getByText('2 nights', { exact: true })).toBeVisible()
  await card(page).getByRole('button', { name: 'Barcelona, rename stop' }).click()
  const name = card(page).getByRole('textbox', { name: 'Stop name' })
  await name.fill('Barcelona old town')
  await name.press('Enter')
  await expect(page.getByRole('region', { name: 'Barcelona old town, stop details' })).toBeVisible()
  expect(calls.patches).toEqual([{ planned_nights: 2 }, { title: 'Barcelona old town' }])
})

test('a save that replaced another member’s change says so', async ({ page }) => {
  await openTrip(page, { replacedBy: true })
  await page.locator('[data-stop-row="b"] [data-stop-open]').click()
  await card(page).getByTestId('stop-notes-view').click({ position: { x: 300, y: 60 } })
  await card(page).getByRole('textbox', { name: 'Notes' }).pressSequentially(' x')
  await expect(card(page).getByText('This replaced a change by Anna.')).toBeVisible()
})

test('failed note saves keep the text and can be retried', async ({ page }) => {
  await openTrip(page)
  let fail = true
  await page.route('**/stops/b/notes', (route) => fail
    ? route.fulfill({ status: 500, json: { detail: 'down' } })
    : route.fallback())
  await page.locator('[data-stop-row="b"] [data-stop-open]').click()
  await card(page).getByTestId('stop-notes-view').click({ position: { x: 300, y: 60 } })
  const notes = card(page).getByRole('textbox', { name: 'Notes' })
  await notes.pressSequentially(' later')
  await expect(card(page).getByText('Not saved,')).toBeVisible()
  await expect(notes).toHaveValue('Tickets: https://example.com/tickets later')
  fail = false
  const saved = page.waitForRequest((request: Request) => request.url().endsWith('/stops/b/notes') && request.method() === 'PUT')
  await card(page).getByRole('button', { name: 'Retry' }).click()
  await saved
  await expect(card(page).getByText('Saved')).toBeVisible()
})

test('mobile stop card is a full-screen page with a back button', async ({ page }) => {
  await openTrip(page, { mobile: true })
  await page.locator('[data-stop-row="b"] [data-stop-open]').click()
  await expect(card(page)).toBeVisible()
  const box = await card(page).boundingBox()
  expect(box).toMatchObject({ x: 0, y: 0, width: 390 })
  await expect(card(page).getByRole('button', { name: 'Close stop details' })).toHaveCount(0)
  await page.screenshot({ path: `${artifacts}/mobile-card.png` })
  await card(page).getByRole('button', { name: 'Back to stops' }).click()
  await expect(card(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]stop=/)
})

test('a big town fades its Wikipedia photo in over the designed header, with the credit', async ({ page }) => {
  const { calls } = await openTrip(page)
  await page.locator('[data-stop-row="a"] [data-stop-open]').click()
  const eindhoven = page.getByRole('region', { name: 'Eindhoven, stop details' })
  const header = eindhoven.locator('header')
  // The designed header shows straight away; the photo lands on top of it.
  await expect(eindhoven.getByTestId('stop-header-pattern')).toBeVisible()
  const photo = eindhoven.getByTestId('stop-header-photo')
  await expect(photo).toBeVisible()
  await expect(photo.locator('xpath=..')).toHaveClass(/opacity-100/)
  // Wait for the fade to finish.
  await expect.poll(() => photo.locator('xpath=..').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  expect((await header.boundingBox())!.height).toBeCloseTo(216, 0)
  const credit = eindhoven.getByRole('link', { name: 'Photo: Example Photographer · CC BY-SA 4.0' })
  await expect(credit).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Eindhoven.jpg')
  await expect(credit).toHaveAttribute('target', '_blank')
  // The credit sits bottom right, below the name, which keeps its full width.
  const name = eindhoven.getByRole('button', { name: 'Eindhoven, rename stop' })
  const [nameBox, creditBox, headerBox] = await Promise.all([name.boundingBox(), credit.boundingBox(), header.boundingBox()])
  expect(creditBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1)
  expect(headerBox!.x + headerBox!.width - (creditBox!.x + creditBox!.width)).toBeLessThan(24)
  expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await credit.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: `${artifacts}/desktop-card-photo.png` })

  // Switching to a stop without a photo keeps the same height and no credit.
  await page.locator('[data-stop-row="b"] [data-stop-open]').click()
  await expect(card(page).getByTestId('stop-header-photo')).toHaveCount(0)
  await expect(card(page).getByRole('link', { name: /^Photo:/ })).toHaveCount(0)
  expect((await card(page).locator('header').boundingBox())!.height).toBeCloseTo(216, 0)

  // Coming back uses the answer it already has.
  await page.locator('[data-stop-row="a"] [data-stop-open]').click()
  await expect(eindhoven.getByTestId('stop-header-photo')).toBeVisible()
  expect(calls.photos.filter((path) => path.endsWith('/stops/a/photo'))).toHaveLength(1)
})

test('the marker moves to the only stay and back without touching travel', async ({ page }) => {
  const { calls, itinerary } = await openTrip(page)
  const place = itinerary.stops[1]!.location
  itinerary.stops[1] = {
    ...itinerary.stops[1]!,
    stays: [{
      id: 'arts', stop_id: 'b', name: 'Hotel Arts', status: 'BOOKED', stay_type: 'HOTEL',
      check_in_date: '2027-05-12', check_out_date: '2027-05-13', address: null,
      location: { ...place, id: 'loc-arts', latitude: 41.3866, longitude: 2.1963 },
      check_in_time: null, check_out_time: null, booking_reference: null, booking_url: null, contact_phone: null, contact_email: null,
    }],
  }
  await page.reload()
  const stayPin = page.locator('[data-stay-pin="arts"]')
  await expect(stayPin).toHaveCount(1)
  await expect(stayPin).toBeHidden()
  await page.locator('[data-stop-row="b"] [data-stop-open]').click()
  await expect(stayPin).toBeVisible()
  const marker = card(page).getByRole('region', { name: 'Map marker' })
  await expect(marker.getByText('At the centre of Barcelona')).toBeVisible()
  const sharedPin = page.locator('[data-stop-pin="b"][data-stay-pin="arts"]')
  await expect(sharedPin).toHaveCount(0)
  await marker.getByRole('button', { name: 'Use stay location' }).click()
  await expect(marker.getByText('At the stay location')).toBeVisible()
  await expect(marker.getByRole('button', { name: 'Use stay location' })).toHaveCount(0)
  await expect(sharedPin).toHaveText('2')
  await expect(sharedPin.locator('svg')).toHaveCount(1)
  await page.screenshot({ path: `${artifacts}/marker-moved.png` })

  await card(page).getByRole('button', { name: 'Close stop details' }).click()
  await sharedPin.click()
  await expect(card(page)).toBeVisible()
  await marker.getByRole('button', { name: 'Move marker' }).click()
  await marker.getByRole('button', { name: 'Reset to original location' }).click()
  await expect(marker.getByText('At the centre of Barcelona')).toBeVisible()
  await expect(sharedPin).toHaveCount(0)
  expect(calls.patches).toEqual([{ marker: { latitude: 41.3866, longitude: 2.1963 } }, { marker: null }])
  expect(calls.photos.filter((path) => path.endsWith('/stops/b/photo'))).toHaveLength(1)
})

for (const mobile of [false, true]) {
  test(`the ${mobile ? 'mobile' : 'desktop'} marker picker previews before saving`, async ({ page }) => {
    const { calls } = await openTrip(page, { mobile, loadMapTiles: true })
    await page.locator('[data-stop-row="b"] [data-stop-open]').click()
    const marker = card(page).getByRole('region', { name: 'Map marker' })
    const picker = mobile
      ? page.getByRole('dialog', { name: 'Choose a map location' })
      : page.getByRole('group', { name: 'Choose marker location' })
    const confirm = picker.getByRole('button', { name: 'Move marker here' })
    const map = page.locator('.trip-leaflet-map--selecting-marker')

    async function openPicker() {
      await marker.getByRole('button', { name: 'Move marker' }).click()
      await marker.getByRole('button', { name: 'Choose on map' }).click()
      await expect(confirm).toBeDisabled()
      await expect(map).toHaveClass(/\bleaflet-container\b/)
      await expect(map.locator('.leaflet-tile-loaded[src^="https://tile.openstreetmap.org/14/"]').first()).toBeVisible()
    }

    async function choosePoint() {
      const stopPin = map.locator(mobile ? '.trip-map-place-marker--numbered' : '[data-stop-pin="b"]').last()
      const box = (await stopPin.boundingBox())!
      await page.mouse.click(box.x + box.width / 2 + 15, box.y + box.height / 2)
      await expect(confirm).toBeEnabled()
      await expect(map.locator('.trip-map-draft-post-marker svg')).toBeVisible()
      expect(calls.patches).toHaveLength(0)
    }

    await openPicker()
    await choosePoint()
    await picker.getByRole('button', { name: 'Cancel' }).click()
    await expect(marker.getByText('At the centre of Barcelona')).toBeVisible()
    if (!mobile) await expect(page.locator('.trip-leaflet-map')).toHaveClass(/\bleaflet-container\b/)
    expect(calls.patches).toHaveLength(0)

    await openPicker()
    await choosePoint()
    await confirm.click()
    await expect(picker).toBeHidden()
    await expect.poll(() => calls.patches.length).toBe(1)
  })
}

test('the first two stops center beside their cards immediately after a refresh', async ({ page }) => {
  await openTrip(page, { loadMapTiles: true })
  await page.reload()
  const map = page.locator('.trip-leaflet-map')
  const detailTiles = map.locator('.leaflet-tile-loaded[src^="https://tile.openstreetmap.org/14/"]')

  for (const id of ['a', 'b', 'a']) {
    await page.locator(`[data-stop-row="${id}"] [data-stop-open]`).click()
    const pin = map.locator(`[data-stop-pin="${id}"]`).first()
    const stopCard = page.locator(`[data-stop-card="${id}"]`)
    await expect(detailTiles.first()).toBeVisible()
    await expect.poll(async () => {
      const [pinBox, cardBox, mapBox] = await Promise.all([pin.boundingBox(), stopCard.boundingBox(), map.boundingBox()])
      if (!pinBox || !cardBox || !mapBox) return false
      return pinBox.x > cardBox.x + cardBox.width && pinBox.x + pinBox.width < mapBox.x + mapBox.width
    }).toBe(true)
  }

  await page.getByRole('button', { name: 'Trip overview' }).click()
  await expect(page.locator('[data-stop-card]')).toHaveCount(0)
  await expect(page).toHaveURL(/\?tab=plan$/)
  await expect(detailTiles).toHaveCount(0)
})
