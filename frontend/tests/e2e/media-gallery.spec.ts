import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/gallery-*.svg', route => route.fulfill({ contentType: 'image/svg+xml', headers: { 'cache-control': 'no-store' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#427a86"/><path d="M0 1000L700 100 1100 700 1300 400 1600 1000" fill="#183e49"/></svg>' }))
})

test('preloads neighbors and reuses mounted photos without another request', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/gallery-photo-')) requests.push(request.url()) })
  await page.goto('/tests/e2e/fixtures/media-gallery.html')
  await page.getByRole('button', { name: 'Open gallery' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect.poll(() => requests.length).toBe(3)
  await page.getByRole('button', { name: 'Next media' }).click()
  await expect(page.getByRole('img', { name: 'Photo 2', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Previous media' }).click()
  await expect(page.getByRole('img', { name: 'Photo 1', exact: true })).toBeVisible()
  expect(requests.filter(url => url.endsWith('/gallery-photo-0.svg'))).toHaveLength(1)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('150%')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open gallery' })).toBeFocused()
})

test('mobile pinch and pan do not navigate; swipe and rotation work', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tests/e2e/fixtures/media-gallery.html')
  await page.getByRole('button', { name: 'Open gallery' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  const photo = page.getByRole('img', { name: 'Photo 1', exact: true })
  async function pointer(type: string, id: number, x: number, y: number) {
    await photo.dispatchEvent(type, { pointerId: id, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true })
  }
  // Synthetic pointers are used to exercise the same gesture handlers on desktop Chromium.
  await page.evaluate(() => { Element.prototype.setPointerCapture = () => {} })
  await pointer('pointerdown', 1, 140, 400)
  await pointer('pointerdown', 2, 240, 400)
  await pointer('pointermove', 1, 90, 400)
  await pointer('pointermove', 2, 290, 400)
  await pointer('pointerup', 1, 90, 400)
  await pointer('pointerup', 2, 290, 400)
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('200%')
  await pointer('pointerdown', 1, 290, 400)
  await pointer('pointermove', 1, 100, 400)
  await pointer('pointerup', 1, 100, 400)
  await expect(photo).toBeVisible()
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%')
  await pointer('pointerdown', 1, 600, 200)
  await pointer('pointermove', 1, 200, 200)
  await pointer('pointerup', 1, 200, 200)
  await expect(page.getByRole('img', { name: 'Photo 2', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('gallery-landscape.png'), animations: 'disabled' })
})

test('keeps a thumbnail visible when full resolution fails and supports retry', async ({ page }) => {
  let fail = true
  await page.route('**/gallery-photo-0.svg', async route => {
    if (fail) await route.abort()
    else await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' })
  })
  await page.goto('/tests/e2e/fixtures/media-gallery.html')
  await page.getByRole('button', { name: 'Open gallery' }).click()
  const retry = page.getByRole('button', { name: 'Unable to load photo. Retry' })
  await expect(retry).toBeVisible()
  await expect(page.locator('img[src="/gallery-thumb-0.svg"]')).toBeVisible()
  fail = false
  await retry.click()
  await expect(retry).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Photo 1', exact: true })).toHaveCSS('opacity', '1')
})

test('shows the thumbnail while the original is still downloading', async ({ page }) => {
  let release!: () => void
  const download = new Promise<void>(resolve => { release = resolve })
  await page.route('**/gallery-photo-0.svg', async route => {
    await download
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>' })
  })
  await page.goto('/tests/e2e/fixtures/media-gallery.html')
  await page.getByRole('button', { name: 'Open gallery' }).click()
  try {
    await expect(page.getByRole('status')).toHaveText('Loading photo…')
    await expect(page.locator('img[src="/gallery-thumb-0.svg"]')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Photo 1', exact: true })).toHaveCSS('opacity', '0')
  } finally {
    release()
  }
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Photo 1', exact: true })).toHaveCSS('opacity', '1')
})

test('double tap zooms and a single tap hides controls without closing', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tests/e2e/fixtures/media-gallery.html')
  await page.getByRole('button', { name: 'Open gallery' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.mouse.dblclick(195, 420)
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('250%')
  await page.mouse.dblclick(195, 420)
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%')
  await page.screenshot({ path: testInfo.outputPath('gallery-portrait.png'), animations: 'disabled' })
  await page.mouse.click(195, 420)
  await expect(page.getByRole('button', { name: 'Close media viewer' })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Show gallery controls' }).click()
  await page.getByRole('button', { name: 'Close media viewer' }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeFocused()
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
  await page.getByRole('button', { name: 'Exit fullscreen' }).click()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
