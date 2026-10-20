import { expect, test } from '@playwright/test'

for (const mobile of [false, true]) {
  for (const side of ['departure', 'return']) {
    test(`${mobile ? 'mobile' : 'desktop'} ${side} connects location and travel in one save`, async ({ page }, testInfo) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const saves: Record<string, unknown>[] = []
      await page.route('**/api/v1/places/geocode?**', (route) => route.fulfill({ json: [{
        id: 'london', name: 'London', full_name: 'London', latitude: 51.5, longitude: -0.1, region: 'England', country_code: 'GB',
      }] }))
      await page.route('**/api/v1/trips/trip/itinerary/legs/preview**', async (route) => {
        const payload = route.request().postDataJSON()
        const outside = { type: 'LOCATION', location: { id: 'location', name: 'London', full_name: 'London', region: '', country_code: 'GB', latitude: 51.5, longitude: -0.1 } }
        const geometry = { type: 'LineString', coordinates: [[-0.1, 51.5], [4.9, 52.37]] }
        await route.fulfill({ json: { preview_id: 'preview', expires_at: '2099-01-01T00:00:00Z', connection: {
          id: '00000000-0000-0000-0000-000000000000', trip_id: 'trip', connection_type: side.toUpperCase(),
          from: side === 'departure' ? outside : payload.from, to: side === 'return' ? outside : payload.to,
          notes: payload.notes, segments: [{ id: 'segment', input_version: 1, mode_source: 'USER', intent: payload.segments[0],
            route_state: 'UNSUPPORTED', geometry, from_endpoint: null, to_endpoint: null }],
          duration_seconds: null, duration_scope: null, warnings: [], route: { type: 'SIMPLE', geometry, duration_seconds: null, distance_meters: null },
          created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
        } } })
      })
      await page.route('**/api/v1/trips/trip/itinerary/legs', async (route) => {
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
