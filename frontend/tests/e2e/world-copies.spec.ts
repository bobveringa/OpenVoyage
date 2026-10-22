import { expect, test, type Locator, type Page } from '@playwright/test'

async function visibleCopy(locator: Locator) {
  let result: Locator | undefined
  await expect.poll(async () => {
    for (const candidate of await locator.all()) {
      if (await candidate.evaluate((element) => {
        const marker = element.getBoundingClientRect()
        const map = element.closest('.leaflet-container')!.getBoundingClientRect()
        return marker.left > map.left && marker.right < map.right && marker.top > map.top && marker.bottom < map.bottom
      })) {
        result = candidate
        return true
      }
    }
    return false
  }).toBe(true)
  return result!
}

async function assertFlightMeetsHonolulu(page: Page) {
  await expect.poll(async () => {
    return page.locator('.leaflet-container').evaluate((map) => {
      const rect = map.getBoundingClientRect()
      const marker = [...map.querySelectorAll('.leaflet-marker-icon')].find((element) => {
        const box = element.getBoundingClientRect()
        return element.textContent?.trim() === '2' && box.left >= rect.left && box.right <= rect.right
      })
      if (!marker) return Infinity
      const box = marker.getBoundingClientRect()
      const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      const distances = [...map.querySelectorAll<SVGPathElement>('path.leaflet-interactive')].map((path) => {
        const matrix = path.getScreenCTM()
        if (!matrix || path.getTotalLength() === 0) return Infinity
        const point = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix)
        return Math.hypot(point.x - center.x, point.y - center.y)
      })
      return Math.min(...distances)
    })
  }).toBeLessThan(2)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#acd4df"/></svg>',
  }))
})

test('Honolulu flight and stop stay connected through multiple world copies', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/tests/e2e/fixtures/world-copies.html')
  await page.getByRole('button', { name: 'Hawaii', exact: true }).click()
  for (const direction of [null, 'East one world', 'East one world', 'West one world', 'West one world', 'West one world']) {
    if (direction) await page.getByRole('button', { name: direction, exact: true }).click()
    await assertFlightMeetsHonolulu(page)
    await (await visibleCopy(page.locator('.leaflet-marker-icon').filter({ hasText: /^\s*2\s*$/ }))).click()
    await expect(page.locator('.leaflet-popup')).toHaveCount(1)
    await expect(page.locator('.leaflet-popup')).toContainText('Honolulu')
    await page.locator('.leaflet-popup-close-button').click()
    await expect(page.locator('.leaflet-popup')).toHaveCount(0)
  }
  await page.locator('.leaflet-container').click({ position: { x: 850, y: 500 } })
  await expect.poll(async () => JSON.parse(await page.getByTestId('picked').textContent() || '[0,999]')[1]).toBeGreaterThanOrEqual(-180)
  expect(JSON.parse(await page.getByTestId('picked').textContent() || '[0,999]')[1]).toBeLessThan(180)
  expect(errors).toEqual([])
})

test('GPS endpoint, candidates and posts repeat and retain their actions', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/world-copies.html')
  await page.getByRole('button', { name: 'Toggle timeline' }).click()
  await page.getByRole('button', { name: 'Hawaii', exact: true }).click()
  for (const direction of ['East one world', 'West one world', 'West one world']) {
    await page.getByRole('button', { name: direction, exact: true }).click()
    await visibleCopy(page.locator('.trip-map-route-endpoint'))
    const candidate = await visibleCopy(page.getByRole('button', { name: 'Create post from GPS point' }))
    await candidate.click()
    await expect(page.getByTestId('selected')).toHaveText('candidate')
    await (await visibleCopy(page.locator('.trip-map-post-bubble'))).click()
    await expect(page.getByTestId('selected')).toHaveText('hawaii-post')
  }
  await page.getByRole('button', { name: 'Toggle timeline' }).click()
  await expect(page.locator('.trip-map-post-bubble')).toHaveCount(0)
  await expect(page.locator('.trip-map-route-endpoint')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create post from GPS point' })).toHaveCount(0)
})

test('GPS recording dots and editing keep original point IDs and coordinates in a mirror', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/world-copies.html?editor')
  await page.getByRole('button', { name: 'Hawaii', exact: true }).click()
  await page.getByRole('button', { name: 'East one world', exact: true }).click()
  await expect(page.locator('.leaflet-container canvas')).toBeVisible()
  const marker = await visibleCopy(page.locator('.tracking-selected-point'))
  const box = (await marker.boundingBox())!
  // The canvas draws sample dots; the neighboring sample remains selectable
  // by proximity in the shifted world, using the same original sample ID.
  await page.mouse.click(box.x + box.width / 2 + 58, box.y + box.height / 2 - 62)
  await expect(page.getByTestId('selected')).toHaveText('point-1')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('moved')).not.toBeEmpty()
  const moved = JSON.parse((await page.getByTestId('moved').textContent())!)
  expect(moved[1]).toBeGreaterThan(-180)
  expect(moved[1]).toBeLessThan(180)
  await marker.click()
  await expect(page.getByTestId('selected')).toHaveText('point-0')
})
