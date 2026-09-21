import { expect, test } from '@playwright/test'

const start = Date.parse('2026-09-20T12:00:00Z')
const points = Array.from({ length: 5 }, (_, i) => ({
  id: `point-${i}`,
  recorded_at: new Date(start + i * 60_000).toISOString(),
  latitude: 52.1 + i * 0.001,
  longitude: 5.1 + i * 0.001,
  travel_mode: 'UNKNOWN',
  accuracy_meters: 5,
  altitude_meters: null,
  speed_mps: null,
  heading_degrees: null,
}))

for (const mobile of [false, true]) {
  test.describe(mobile ? 'touch' : 'mouse', () => {
  test.use({ hasTouch: mobile, isMobile: mobile })
  test(`session editor uses a scoped timeline and explicit save (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    )
    const saves: unknown[] = []
    const actions: string[] = []
    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url()
      if (url.endsWith('/points')) {
        saves.push(route.request().postDataJSON())
        await route.fulfill({ status: 204 })
        return
      }
      if (url.endsWith('/stop')) {
        actions.push('stop')
        await route.fulfill({
          json: { id: 'session', ended_at: new Date().toISOString() },
        })
        return
      }
      if (url.includes('/samples')) {
        await route.fulfill({ json: { items: points, next_cursor: null } })
        return
      }
      if (url.endsWith('/sessions')) {
        await route.fulfill({
          json: {
            sessions: [
              {
                id: 'session',
                started_at: new Date(start).toISOString(),
                ended_at: null,
                recorded_by_user_id: 'other-user',
                sample_count: 5,
              },
            ],
          },
        })
        return
      }
      if (url.endsWith('/live-location-settings')) {
        await route.fulfill({ json: { share_live_location: false } })
        return
      }
      await route.fulfill({ json: {} })
    })
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 204 }),
    )
    await page.goto('/tests/e2e/fixtures/tracking-editor.html')
    await expect(
      page.getByRole('heading', { name: 'Recordings', exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Recording paths map')).toHaveCount(0)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(
      page.getByRole('alertdialog', { name: 'Stop recording?' }),
    ).toBeVisible()
    expect(actions).toHaveLength(0)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button').filter({ hasText: '5 points' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Recording details' }),
    ).toBeVisible()
    await expect(
      page.getByRole('dialog', { name: 'Recording details' }),
    ).toHaveCSS('position', 'fixed')
    await expect(page.getByLabel('Recording paths map')).toBeVisible()
    const editor = page.getByRole('dialog', { name: 'Recording details' })
    const panel = await editor.locator(':scope > div').boundingBox()
    if (!mobile) {
      expect(panel!.width).toBeLessThan(1280)
      expect(panel!.height).toBeLessThan(900)
    }
    await expect(page.getByRole('button', { name: 'Bulk transport', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Delete point', exact: true })).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('editor-default.png') })
    const mapPane = page.locator('.leaflet-map-pane')
    const mapTransformBeforeMove = await mapPane.getAttribute('style')
    const marker = page.locator('.leaflet-marker-icon').first()
    await marker.scrollIntoViewIfNeeded()
    const box = (await marker.boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    if (mobile) {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 70, y: y - 50 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await cdp.detach()
    } else {
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 1000, y, { steps: 15 })
      await page.mouse.up()
      await expect(page.getByRole('status')).toHaveText('400 m move limit reached.')
    }
    await expect.poll(() => mapPane.getAttribute('style')).toBe(mapTransformBeforeMove)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    const map = page.getByLabel('Recording paths map')
    await map.scrollIntoViewIfNeeded()
    const mapBeforeInsert = (await map.boundingBox())!
    const markerBeforeInsert = (await marker.boundingBox())!
    const markerOffsetX =
      markerBeforeInsert.x + markerBeforeInsert.width / 2 - mapBeforeInsert.x
    const markerOffsetY =
      markerBeforeInsert.y + markerBeforeInsert.height / 2 - mapBeforeInsert.y
    await page.getByRole('button', { name: 'Insert after point' }).click()
    await map.scrollIntoViewIfNeeded()
    const mapBox = (await map.boundingBox())!
    const insertX = mapBox.x + markerOffsetX
    const insertY = mapBox.y + markerOffsetY
    if (mobile) await page.touchscreen.tap(insertX, insertY)
    else await page.mouse.click(insertX, insertY)
    await expect(page.locator('summary').filter({ hasText: 'Time range' })).toContainText('6 of 6 points')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.locator('summary').filter({ hasText: 'Time range' }).click()
    const lower = page.getByRole('slider', { name: 'Editing range start' })
    const upper = page.getByRole('slider', { name: 'Editing range end' })
    const initialMapTransform = await mapPane.getAttribute('style')
    await lower.fill(String(start + 60_000))
    await upper.fill(String(start + 180_000))
    await expect.poll(() => mapPane.getAttribute('style')).toBe(initialMapTransform)
    await expect(
      page.getByText('3 of 5 points in range.', { exact: false }),
    ).toBeVisible()
    await page.getByRole('heading', { name: 'Editing time range' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('session-editor.png') })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true)
    await page.getByRole('button', { name: 'Bulk transport', exact: true }).click()
    await page.getByRole('button', { name: 'Apply to 3 points' }).click()
    await expect(page.getByRole('button', { name: 'Apply to 3 points' })).toBeDisabled()
    expect(saves).toHaveLength(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await page.getByRole('button', { name: 'Apply to 3 points' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    expect(saves).toHaveLength(1)
    expect(saves.pop()).toMatchObject({ points: [
      { id: 'point-0', travel_mode: 'UNKNOWN' },
      { id: 'point-1', travel_mode: 'WALK' },
      { id: 'point-2', travel_mode: 'WALK' },
      { id: 'point-3', travel_mode: 'WALK' },
      { id: 'point-4', travel_mode: 'UNKNOWN' },
    ] })
    await page.getByRole('button').filter({ hasText: '5 points' }).click()
    await page.locator('summary').filter({ hasText: 'Time range' }).click()
    await lower.fill(String(start + 60_000))
    await upper.fill(String(start + 180_000))
    const pointMode = page.getByRole('button', { name: 'Point travel mode' })
    await pointMode.click()
    await page.getByRole('option', { name: 'Walk' }).click()
    await expect(pointMode).toHaveText('Walk')
    expect(saves).toHaveLength(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Save changes' }),
    ).toBeDisabled()
    await pointMode.click()
    await page.getByRole('option', { name: 'Walk' }).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Recording details' }),
    ).toHaveCount(0)
    expect(saves).toHaveLength(1)
    expect(saves[0]).toMatchObject({
      points: [
        { id: 'point-0', travel_mode: 'UNKNOWN' },
        { id: 'point-1', travel_mode: 'WALK' },
        { id: 'point-2', travel_mode: 'UNKNOWN' },
        { id: 'point-3', travel_mode: 'UNKNOWN' },
        { id: 'point-4', travel_mode: 'UNKNOWN' },
      ],
    })
    await page.getByRole('button').filter({ hasText: '5 points' }).click()
    await page
      .getByRole('button', { name: 'Delete point', exact: true })
      .click()
    await page.getByRole('button', { name: '← Recordings' }).click()
    await expect(
      page.getByRole('alertdialog', { name: 'Discard point changes?' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    expect(saves).toHaveLength(1)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page
      .getByRole('button', { name: 'Stop recording', exact: true })
      .click()
    await expect.poll(() => actions.length).toBe(1)
    await page
      .getByRole('button', { name: 'Delete recording', exact: true })
      .click()
    await expect(
      page.getByRole('alertdialog', { name: 'Delete recording?' }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('button', { name: 'Delete recording', exact: true })
        .last(),
    ).toHaveClass(/bg-destructive/)
  })
  })
}
