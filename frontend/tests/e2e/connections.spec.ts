import { expect, test } from '@playwright/test'
import type { ItineraryTravelReplacePayload } from '../../src/api/client'

for (const mobile of [false, true]) {
  for (const side of ['departure', 'return']) {
    test(`${mobile ? 'mobile' : 'desktop'} ${side} connects location and travel in one save`, async ({ page }, testInfo) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const saves: Record<string, unknown>[] = []
      const previews: ItineraryTravelReplacePayload[] = []
      await page.route('**/api/v1/places/geocode?**', (route) => route.fulfill({ json: [{
        id: 'london', name: 'London', full_name: 'London', latitude: 51.5, longitude: -0.1, region: 'England', country_code: 'GB',
      }] }))
      await page.route('**/api/v1/trips/trip/itinerary/connections/preview**', async (route) => {
        const payload = route.request().postDataJSON()
        previews.push(payload)
        const segment = payload.segments?.[0] ?? { travel_mode: 'CAR', mode_selected: false, notes: '', route_option: 0 }
        const outside = { type: 'LOCATION', location: { id: 'location', name: 'London', full_name: 'London', region: '', country_code: 'GB', latitude: 51.5, longitude: -0.1 } }
        const geometry = { type: 'LineString', coordinates: [[-0.1, 51.5], [4.9, 52.37]] }
        const car = segment.travel_mode === 'CAR'
        await route.fulfill({ json: { preview_id: 'preview', expires_at: '2099-01-01T00:00:00Z', connection: {
          id: '00000000-0000-0000-0000-000000000000', trip_id: 'trip', connection_type: side.toUpperCase(),
          from: side === 'departure' ? outside : payload.from, to: side === 'return' ? outside : payload.to,
          notes: payload.notes, segments: [{ id: 'segment', input_version: 1, mode_source: payload.segments ? 'USER' : 'AUTO', intent: segment,
            route_state: car ? 'READY' : 'UNSUPPORTED', geometry, from_endpoint: null, to_endpoint: null,
            route_options: car ? [
              { geometry, duration_seconds: 600, distance_meters: 10000 },
              { geometry, duration_seconds: 800, distance_meters: 12000 },
            ] : [], }],
          duration_seconds: car ? 600 : null, duration_scope: car ? 'JOURNEY' : null, warnings: [],
          route: { type: car ? 'PROVIDER_BACKED' : 'SIMPLE', geometry, duration_seconds: car ? 600 : null, distance_meters: car ? 10000 : null },
          created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
        } } })
      })
      await page.route('**/api/v1/trips/trip/itinerary/connections', async (route) => {
        const payload = route.request().postDataJSON()
        saves.push(payload)
        // A failed save must keep the chosen location and mode editable.
        if (saves.length === 1) {
          await route.fulfill({ status: 409, json: { detail: 'Please retry saving' } })
          return
        }
        const outside = { type: 'LOCATION', location: { id: 'location', name: 'London', full_name: 'London', region: '', country_code: 'GB', latitude: 51.5, longitude: -0.1 } }
        await route.fulfill({ status: 201, headers: { ETag: '"3"' }, json: {
          id: 'saved', trip_id: 'trip', connection_type: side.toUpperCase(),
          from: side === 'departure' ? outside : payload.from, to: side === 'return' ? outside : payload.to,
          notes: payload.notes, segments: [{ id: 'segment', input_version: 1, mode_source: 'USER', intent: payload.segments[0],
            route_state: 'UNSUPPORTED', geometry: null, from_endpoint: null, to_endpoint: null }],
          duration_seconds: null, duration_scope: null, warnings: [],
          route: { type: 'SIMPLE', geometry: { type: 'LineString', coordinates: [[-0.1, 51.5], [4.9, 52.37]] }, duration_seconds: null, distance_meters: null },
          created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
        } })
      })
      await page.goto('/tests/e2e/fixtures/connections.html')
      await page.getByRole('button', { name: 'Add ' + side, exact: true }).click()
      const chooser = mobile ? page.getByRole('dialog', { name: 'Select your route', exact: true })
        : page.getByRole('region', { name: 'Select your route', exact: true })
      await expect(chooser).toBeVisible()
      await expect(chooser.getByRole('radio', { name: 'Train', exact: true })).toBeDisabled()
      await expect(chooser.getByRole('button', { name: 'Add ' + side, exact: true })).toBeDisabled()
      expect(saves).toHaveLength(0)
      if (!mobile) {
        await expect(page.getByRole('heading', { name: 'New ' + side, exact: true })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toHaveCount(0)
      }
      if (!mobile && side === 'departure') await page.screenshot({ path: testInfo.outputPath('disabled.png') })
      if (side === 'departure') {
        await page.getByRole('textbox', { name: 'Search places', exact: true }).fill('London')
        await page.getByRole('option', { name: /London/ }).click()
      } else {
        await page.getByRole('button', { name: /Exact point/ }).click()
        const map = mobile ? page.getByRole('dialog', { name: 'Choose a map location' }).locator('.leaflet-container') : page.locator('.leaflet-container')
        await map.click({ position: mobile ? { x: 250, y: 300 } : { x: 700, y: 350 } })
        if (mobile) await page.getByRole('button', { name: 'Use location' }).click()
      }
      await expect(chooser.getByRole('radio', { name: 'Train', exact: true })).toBeEnabled()
      await expect(chooser.getByRole('radio', { name: 'Car route 1', exact: true })).toBeChecked()
      await expect(chooser.getByRole('radio', { name: 'Car route 2', exact: true })).toBeVisible()
      expect(previews).toHaveLength(1)
      expect(previews[0].segments).toBeUndefined()
      await chooser.getByRole('radio', { name: 'Flight', exact: true }).click()
      const departureDate = chooser.getByRole('button', { name: 'Departure date', exact: true })
      await expect(departureDate).toBeEnabled()
      await departureDate.click()
      const calendar = chooser.getByRole('dialog')
      await expect(calendar.getByRole('button', { name: side === 'departure' ? '18' : '20', exact: true })).toHaveClass(/bg-primary/)
      if (mobile && side === 'departure') {
        await calendar.scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath('flight-date.png') })
      }
      await calendar.getByRole('button', { name: '17', exact: true }).click()
      await expect(departureDate).toContainText(/17.*2026/)
      await chooser.getByRole('radio', { name: 'Train', exact: true }).click()
      await expect(chooser.getByRole('button', { name: 'Add ' + side, exact: true })).toBeEnabled()
      if (!mobile && side === 'departure') await page.screenshot({ path: testInfo.outputPath('selected.png') })
      await chooser.getByRole('button', { name: 'Add ' + side, exact: true }).click()
      await expect(chooser.getByRole('alert')).toContainText('Please retry saving')
      await expect(chooser.getByRole('radio', { name: 'Train', exact: true })).toBeChecked()
      await chooser.getByRole('button', { name: 'Add ' + side, exact: true }).click()
      await expect(chooser).toHaveCount(0)
      expect(saves).toHaveLength(2)
      expect(saves[1]).toEqual(saves[0])
      expect(saves[0]).toMatchObject({
        [side === 'departure' ? 'from' : 'to']: { type: 'LOCATION' },
        [side === 'departure' ? 'to' : 'from']: { type: 'STOP', stop_id: side === 'departure' ? 'first' : 'last' },
        segments: [{ travel_mode: 'TRAIN' }],
      })
      await page.getByRole('button', { name: /Train.*London/ }).first().click()
      await expect(chooser).toBeVisible()
      await expect(chooser.getByRole('radio', { name: 'Train', exact: true })).toBeEnabled()
      await expect(page.getByRole('textbox', { name: 'Search places', exact: true })).toBeVisible()
      expect(errors).toEqual([])
    })
  }
}

for (const side of ['departure', 'return']) {
  test(`distant ${side} uses the server's Flight default and permits a manual override`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 })
    const outside = { id: 'cape-town', name: 'Cape Town', full_name: 'Cape Town', latitude: -33.92, longitude: 18.42, region: '', country_code: 'ZA' }
    const requests: ItineraryTravelReplacePayload[] = []
    let flightLookups = 0
    await page.route('**/api/v1/places/geocode?**', (route) => route.fulfill({ json: [outside] }))
    await page.route('**/api/v1/trips/trip/itinerary/connections/flight-lookups', (route) => {
      flightLookups += 1
      return route.fulfill({ json: { status: 'NOT_FOUND', candidates: [] } })
    })
    await page.route('**/api/v1/trips/trip/itinerary/connections/preview**', async (route) => {
      const payload: ItineraryTravelReplacePayload = route.request().postDataJSON()
      requests.push(payload)
      const segment = payload.segments?.[0] ?? { travel_mode: 'FLIGHT', mode_selected: false, notes: '', route_option: 0 }
      const endpoint = { type: 'LOCATION', location: outside }
      const geometry = { type: 'LineString', coordinates: [[18.42, -33.92], [4.9, 52.37]] }
      await route.fulfill({ json: { preview_id: 'preview', expires_at: '2099-01-01T00:00:00Z', connection: {
        id: '00000000-0000-0000-0000-000000000000', trip_id: 'trip', connection_type: side.toUpperCase(),
        from: side === 'departure' ? endpoint : payload.from, to: side === 'return' ? endpoint : payload.to,
        notes: payload.notes, segments: [{ id: 'temporary-segment', input_version: 1, mode_source: payload.segments ? 'USER' : 'AUTO',
          intent: segment, route_state: 'UNSUPPORTED', geometry, from_endpoint: null, to_endpoint: null }],
        duration_seconds: null, duration_scope: null, warnings: [],
        route: { type: 'SIMPLE', geometry, duration_seconds: null, distance_meters: null },
        created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
      } } })
    })
    await page.goto('/tests/e2e/fixtures/connections.html')
    await page.getByRole('button', { name: 'Add ' + side, exact: true }).click()
    await page.getByRole('textbox', { name: 'Search places', exact: true }).fill('Cape Town')
    await page.getByRole('option', { name: /Cape Town/ }).click()
    const chooser = page.getByRole('region', { name: 'Select your route', exact: true })
    await expect(chooser.getByRole('radio', { name: 'Flight', exact: true })).toBeChecked()
    await expect(chooser.getByLabel('Flight number', { exact: true })).toBeVisible()
    const departureDate = chooser.getByRole('button', { name: 'Departure date', exact: true })
    await departureDate.click()
    const calendar = chooser.getByRole('dialog')
    await expect(calendar.getByRole('button', { name: side === 'departure' ? '18' : '20', exact: true })).toHaveClass(/bg-primary/)
    await calendar.getByRole('button', { name: '17', exact: true }).click()
    await expect(departureDate).toContainText(/17.*2026/)
    expect(requests).toHaveLength(1)
    expect(requests[0].segments).toBeUndefined()
    expect(flightLookups).toBe(0)
    await chooser.getByRole('radio', { name: 'Car', exact: true }).click()
    await expect(chooser.getByRole('button', { name: 'Add ' + side, exact: true })).toBeEnabled()
    await expect(chooser.getByRole('radio', { name: 'Car', exact: true })).toBeChecked()
    expect(requests[1].segments?.[0]).toMatchObject({ travel_mode: 'CAR', mode_selected: true })
  })
}
