import { expect, test } from '@playwright/test'
import type { Itinerary, ItineraryStop, ItineraryTravelLeg } from '../../src/api/client'
import { seedAuthTokens } from './helpers/auth'

const timestamp = '2026-10-20T12:00:00Z'
const creator = { id: 'owner', first_name: 'Route', last_name: 'Tester', username: 'tester' }

function stop(id: string, name: string, latitude: number, longitude: number): ItineraryStop {
  return {
    id, title: name, trip_id: 'trip', notes: '', planned_nights: 0,
    planned_start_date: '2027-05-10', same_day_position: 0, visited: false,
    created_at: timestamp, updated_at: timestamp, created_by: creator,
    location: { id, name, full_name: name, latitude, longitude, region: '', country_code: 'NL' },
  }
}

function connection(from: ItineraryStop, to: ItineraryStop, ready: boolean): ItineraryTravelLeg {
  const geometry = { type: 'LineString' as const, coordinates: [
    [from.location.longitude, from.location.latitude],
    [to.location.longitude, to.location.latitude],
  ] }
  return {
    id: `${from.id}-${to.id}`, trip_id: 'trip', connection_type: 'BETWEEN_STOPS',
    from: { type: 'STOP', stop_id: from.id }, to: { type: 'STOP', stop_id: to.id },
    notes: '', created_at: timestamp, updated_at: timestamp, warnings: [],
    duration_seconds: ready ? 600 : null, duration_scope: ready ? 'JOURNEY' : null,
    route: { type: ready ? 'PROVIDER_BACKED' : 'SIMPLE', geometry, distance_meters: ready ? 10000 : null, duration_seconds: ready ? 600 : null },
    segments: [{
      id: `${from.id}-${to.id}-segment`, input_version: 1, mode_source: 'AUTO',
      intent: { travel_mode: 'CAR', mode_selected: false, notes: '', route_option: 0 },
      from_endpoint: from.location, to_endpoint: to.location,
      route_state: ready ? 'READY' : 'NOT_CALCULATED', geometry,
    }],
  }
}

for (const mobile of [false, true]) {
  for (const inserting of [false, true]) {
    test(`${mobile ? 'mobile' : 'desktop'} automatically calculates car routes after ${inserting ? 'inserting' : 'appending'} a stop`, async ({ page }) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('dialog', async dialog => { errors.push('Unexpected browser confirmation'); await dialog.dismiss() })
      const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
      await seedAuthTokens(page, { access_token: `test.${payload}.sig`, id_token: 'id', refresh_token: 'refresh', token_type: 'bearer' })
      const a = stop('a', 'Amsterdam', 52.37, 4.9)
      const b = stop('b', 'Utrecht', 52.09, 5.12)
      const c = stop('c', 'Eindhoven', 51.44, 5.48)
      const added = stop('new', 'New stop', 52.2, 5)
      const itinerary: Itinerary = { trip_id: 'trip', itinerary_revision: 3, stops: [a, b, c], legs: [connection(a, b, true), connection(b, c, true)] }
      const refreshed: string[] = []
      let creates = 0
      await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        const json = (body: unknown) => route.fulfill({ json: body })
        if (path.endsWith('/admin/setup')) return json({ setup_required: false })
        if (path.endsWith('/settings/public')) return json({ settings: {}, updated_at: timestamp })
        if (path.endsWith('/users/me')) return json({ id: 'owner', password_change_required: false, permissions: ['trip:create'], profile: null, role: 'USER' })
        if (path.endsWith('/trips/trip')) return json({ id: 'trip', name: 'Route test trip', start_date: '2027-05-10', end_date: '2027-05-12', description: '', cover_media: null, visibility: 'PRIVATE' })
        if (path.endsWith('/members')) return json([{ role: 'OWNER', user_id: 'owner', user: creator, trip_id: 'trip' }])
        if (path.endsWith('/posts/timeline')) return json({ entries: [], opening_route: null })
        if (path.endsWith('/viewers') || path.endsWith('/share-links')) return json([])
        if (path.endsWith('/places/geocode')) return json([added.location])
        if (path.endsWith('/itinerary')) return json(itinerary)
        if (path.endsWith('/itinerary/stops') && request.method() === 'POST') {
          if (inserting && new URL(request.url()).searchParams.get('confirm_travel_deletion') !== 'true') {
            return route.fulfill({ status: 409, json: { detail: {
              code: 'TRAVEL_DELETION_REQUIRED', connections: [{ from: 'Amsterdam', to: 'Utrecht' }],
            } } })
          }
          creates += 1
          expect(request.headers()['if-match']).toBe('"3"')
          expect(request.postDataJSON().placement.after_stop_id).toBe(inserting ? 'a' : 'c')
          itinerary.stops = inserting ? [a, added, b, c] : [a, b, c, added]
          itinerary.legs = inserting
            ? [connection(a, added, false), connection(added, b, false), itinerary.legs[1]]
            : [...itinerary.legs, connection(c, added, false)]
          itinerary.itinerary_revision += 1
          return route.fulfill({ status: 201, json: itinerary })
        }
        if (path.endsWith('/route-refresh')) {
          const id = path.split('/').slice(-2)[0]
          expect(request.method()).toBe('POST')
          expect(request.headers()['if-match']).toBe(`"${itinerary.itinerary_revision}"`)
          expect(request.headers()['authorization']).toContain('Bearer ')
          refreshed.push(id)
          const index = itinerary.legs.findIndex(leg => leg.id === id)
          const leg = itinerary.legs[index]
          const from = itinerary.stops.find(stop => leg.from.type === 'STOP' && stop.id === leg.from.stop_id)!
          const to = itinerary.stops.find(stop => leg.to.type === 'STOP' && stop.id === leg.to.stop_id)!
          itinerary.legs[index] = connection(from, to, true)
          itinerary.itinerary_revision += 1
          return route.fulfill({ json: itinerary.legs[index], headers: { ETag: `"${itinerary.itinerary_revision}"` } })
        }
        return route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } })
      })
      await page.route('https://tile.openstreetmap.org/**', route => route.abort())
      await page.goto('/trips/trip')
      await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible()
      const paths = page.locator('[aria-label="Interactive trip route map"]:visible .leaflet-overlay-pane path.leaflet-interactive:not([stroke-dasharray])')
      if (!mobile) await expect(paths).toHaveCount(2)
      await page.getByRole('button', { name: inserting ? 'Add stop here' : 'Add stop after this stop', exact: true }).first().click()
      await page.getByRole('textbox', { name: 'Search places', exact: true }).fill('New stop')
      await page.getByRole('option', { name: /New stop/ }).click()
      await page.getByRole('button', { name: 'Create stop', exact: true }).click()
      if (inserting) {
        const confirmation = page.getByRole('dialog', { name: 'Discard travel details?', exact: true })
        await expect(confirmation).toContainText('Amsterdam → Utrecht')
        await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
        expect(creates).toBe(0)
        expect(refreshed).toEqual([])
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.getByLabel('Title', { exact: true })).toHaveValue('New stop')
        await page.getByRole('button', { name: 'Create stop', exact: true }).click()
        await expect(confirmation).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(confirmation).toHaveCount(0)
        await expect(page.getByLabel('Title', { exact: true })).toHaveValue('New stop')
        await page.getByRole('button', { name: 'Create stop', exact: true }).click()
        await confirmation.getByRole('button', { name: 'Discard and continue', exact: true }).click()
      }
      await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible()
      await expect.poll(() => refreshed).toEqual(inserting ? ['a-new', 'new-b'] : ['c-new'])
      await expect(page.getByRole('button', { name: 'Add stop after this stop', exact: true })).toBeEnabled()
      if (mobile) await page.getByRole('button', { name: 'Travel', exact: true }).click()
      await expect(paths).toHaveCount(3)
      expect(creates).toBe(1)
      expect(errors).toEqual([])
      // Reloading uses the saved geometry, with no additional calculation requests.
      await page.reload()
      await expect(paths).toHaveCount(3)
      expect(refreshed).toHaveLength(inserting ? 2 : 1)
    })
  }
}
