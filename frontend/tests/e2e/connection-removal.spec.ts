import { expect, test } from '@playwright/test'

for (const mobile of [false, true]) {
  for (const side of ['departure', 'return']) {
    test(`${mobile ? 'mobile' : 'desktop'} ${side} uses one in-app removal confirmation`, async ({ page }, testInfo) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
      const browserDialogs: string[] = []
      page.on('dialog', async (dialog) => { browserDialogs.push(dialog.message()); await dialog.dismiss() })
      let deletes = 0
      let finish: (() => void) | undefined
      const completed = new Promise<void>((resolve) => { finish = resolve })
      await page.route('**/api/v1/trips/trip/itinerary/legs/saved-*?**', async (route) => {
        deletes += 1
        expect(route.request().method()).toBe('DELETE')
        expect(new URL(route.request().url()).searchParams.get('confirm_travel_deletion')).toBe('true')
        if (deletes === 1) {
          await route.fulfill({ status: 409, json: { detail: { code: 'TRAVEL_DELETION_REQUIRED', message: 'Could not remove connection' } } })
          return
        }
        await completed
        await route.fulfill({ json: { trip_id: 'trip', itinerary_revision: 3, stops: [], legs: [{
          id: 'interior', trip_id: 'trip', connection_type: 'BETWEEN_STOPS', from: { type: 'STOP', stop_id: 'first' }, to: { type: 'STOP', stop_id: 'last' },
          notes: '', duration_seconds: null, duration_scope: null, warnings: [],
          segments: [{ id: 'segment', input_version: 1, mode_source: 'USER', intent: { travel_mode: 'TRAIN' },
            route_state: 'UNSUPPORTED', geometry: null, from_endpoint: null, to_endpoint: null }],
          route: { type: 'SIMPLE', geometry: { type: 'LineString', coordinates: [[4.9, 52.37], [5.12, 52.09]] }, distance_meters: null, duration_seconds: null },
          created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
        }] } })
      })
      await page.goto('/tests/e2e/fixtures/connections.html?connection=' + side)
      const card = page.getByLabel(side + ' connection', { exact: true })
      await card.getByRole('button', { name: 'Remove ' + side + ' connection', exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: 'Remove ' + side + '?', exact: true })
      await expect(confirmation).toContainText('London')
      await expect(confirmation.getByRole('button', { name: 'Keep ' + side, exact: true })).toBeFocused()
      if (!mobile && side === 'departure') await page.screenshot({ path: testInfo.outputPath('removal.png') })
      await confirmation.getByRole('button', { name: 'Keep ' + side, exact: true }).click()
      expect(deletes).toBe(0)
      await card.getByRole('button', { name: /Train.*London/ }).click()
      const chooser = mobile ? page.getByRole('dialog', { name: 'Select your route', exact: true }) : page.getByRole('region', { name: 'Select your route', exact: true })
      const location = page.getByRole('group', { name: (side === 'departure' ? 'Departure' : 'Return') + ' location', exact: true })
      const removeAction = location.getByRole('button', { name: 'Remove ' + side, exact: true })
      await expect(location.getByRole('button', { name: 'Clear ' + side + ' location', exact: true })).toBeVisible()
      await expect(removeAction).toBeVisible()
      expect(await removeAction.evaluate((button) => button.previousElementSibling?.textContent)).toBe('Clear ' + side + ' location')
      const clearBounds = await location.getByRole('button', { name: 'Clear ' + side + ' location', exact: true }).boundingBox()
      const removeBounds = await removeAction.boundingBox()
      expect(removeBounds!.y).toBe(clearBounds!.y)
      expect(removeBounds!.x).toBeGreaterThan(clearBounds!.x)
      if (!mobile && side === 'departure') await page.screenshot({ path: testInfo.outputPath('removal-action.png') })
      await removeAction.click()
      await page.keyboard.press('Escape')
      await expect(confirmation).toHaveCount(0)
      await expect(chooser).toBeVisible()
      await removeAction.click()
      await confirmation.getByRole('button', { name: 'Remove ' + side, exact: true }).click()
      await expect(confirmation.getByRole('alert')).toContainText('Could not remove connection')
      expect(browserDialogs).toEqual([])
      await confirmation.getByRole('button', { name: 'Remove ' + side, exact: true }).click()
      await expect(confirmation.getByRole('button', { name: 'Keep ' + side, exact: true })).toBeDisabled()
      await expect(confirmation.getByRole('button', { name: 'Removing...', exact: true })).toBeDisabled()
      finish!()
      await expect(confirmation).toHaveCount(0)
      await expect(chooser).toHaveCount(0)
      await expect(card).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Delete Amsterdam', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Delete Utrecht', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /Train Amsterdam to Utrecht/ })).toBeVisible()
      expect(deletes).toBe(2)
      expect(browserDialogs).toEqual([])
    })
  }
}
