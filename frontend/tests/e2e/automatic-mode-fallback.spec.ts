import { expect, test } from '@playwright/test'

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} suggests Other for unavailable automatic car routing and preserves an explicit Car choice`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
    const requests: Record<string, unknown>[] = []
    const geometry = { type: 'LineString', coordinates: [[-0.1, 51.5], [4.9, 52.37]] }
    const outside = { type: 'LOCATION', location: {
      id: 'outside', name: 'London', full_name: 'London', region: '', country_code: 'GB', latitude: 51.5, longitude: -0.1,
    } }
    await page.route('**/api/v1/trips/trip/itinerary/connections/preview**', async route => {
      const payload = route.request().postDataJSON()
      requests.push(payload)
      const intent = payload.segments?.[0] ?? { travel_mode: 'OTHER', mode_selected: false, notes: '', route_option: 0 }
      await route.fulfill({ json: { preview_id: 'preview', expires_at: '2099-01-01T00:00:00Z', connection: {
        id: 'draft', trip_id: 'trip', connection_type: 'DEPARTURE', from: outside, to: payload.to,
        notes: '', duration_seconds: null, duration_scope: null, warnings: [],
        segments: [{ id: 'segment', input_version: 1, mode_source: payload.segments ? 'USER' : 'AUTO', intent,
          route_state: intent.travel_mode === 'CAR' ? 'FAILED' : 'UNSUPPORTED', error_code: intent.travel_mode === 'CAR' ? 'ROUTE_UNAVAILABLE' : null,
          geometry, from_endpoint: null, to_endpoint: null, route_options: [] }],
        route: { type: 'SIMPLE', geometry, duration_seconds: null, distance_meters: null },
        created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
      } } })
    })
    await page.goto('/tests/e2e/fixtures/connections.html')
    await page.getByRole('button', { name: 'Add departure', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search places', exact: true }).fill('51.5, -0.1')
    await page.getByRole('button', { name: 'Use coordinates', exact: true }).click()
    const chooser = page.getByRole(mobile ? 'dialog' : 'region', { name: 'Select your route', exact: true })
    await expect(chooser.getByRole('radio', { name: 'Other', exact: true })).toBeChecked()
    await expect(chooser.getByRole('button', { name: 'Add departure', exact: true })).toBeEnabled()
    expect(requests).toHaveLength(1)
    expect(requests[0].segments).toBeUndefined()
    await chooser.getByRole('radio', { name: /Car/ }).click()
    await expect(chooser.getByRole('radio', { name: /Car/ })).toBeChecked()
    await expect(chooser.getByText('Route unavailable', { exact: false }).first()).toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[1].segments).toMatchObject([{ travel_mode: 'CAR', mode_selected: true }])
  })
}
