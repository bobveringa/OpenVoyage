import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { loadDemoTrip, tripName } from './demo-trip'

type View = 'travel' | 'planning' | 'reader' | 'dark'

async function waitForImages(page: Page) {
  await expect.poll(() => page.locator('img:visible').evaluateAll((images) => images.flatMap((image) => {
    if (!(image instanceof HTMLImageElement)) return []
    const rect = image.getBoundingClientRect()
    const inViewport = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
    return inViewport && (!image.complete || !image.naturalWidth) ? [image.src] : []
  })), { timeout: 25_000, message: 'Wait for photographs and map tiles in view' }).toEqual([])
  await page.evaluate(() => document.fonts.ready)
}

async function capture(browser: Browser, baseURL: string, info: TestInfo, view: View, mobile = false) {
  const page = await browser.newPage({
    baseURL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, colorScheme: 'light',
    locale: 'en-GB', timezoneId: 'Europe/Lisbon', reducedMotion: 'reduce',
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const blockedTiles = new Set<string>()
    page.on('response', (response) => {
      if (new URL(response.url()).hostname === 'tile.openstreetmap.org' && response.headers()['x-blocked']) {
        blockedTiles.add(response.url())
      }
    })
    if (view === 'dark') {
      await page.addInitScript(() => localStorage.setItem('openvoyage.theme-mode.v1', 'dark'))
    }
    await loadDemoTrip(page, view === 'planning')
    await expect(page.getByRole('heading', { name: tripName })).toBeVisible()
    if (view === 'planning') await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible()
    const map = page.getByLabel('Interactive trip route map').filter({ visible: true })
    if (mobile && view === 'planning') {
      // Mobile planning presents the stop list without the desktop map.
      await expect(page.getByRole('button', { name: 'Add one night to Lisbon', exact: true })).toBeVisible()
    } else {
      await expect.poll(() => map.locator('.leaflet-tile').evaluateAll((tiles) =>
        tiles.length > 0 && tiles.every((tile) => tile.classList.contains('leaflet-tile-loaded') && getComputedStyle(tile).opacity === '1'),
      ), { timeout: 25_000, message: 'Wait for the basemap to fade in' }).toBe(true)
    }
    // Frame the desktop journey using the same drag gesture as a visitor.
    if (!mobile && view !== 'planning') {
      const bounds = (await map.boundingBox())!
      await page.mouse.move(bounds.x + 220, bounds.y + 250)
      await page.mouse.down()
      await page.mouse.move(bounds.x + 90, bounds.y + 190, { steps: 20 })
      await page.mouse.up()
    }
    if (view === 'reader') {
      await page.getByRole('button', { name: 'Open Golden hour in Alfama', exact: true }).click()
      await expect(page.getByRole('article', { name: 'Post reader' })).toBeVisible()
    }
    await waitForImages(page)
    expect(blockedTiles.size, 'Map tiles must be free of block notices').toBe(0)
    expect(errors).toEqual([])
    return await page.screenshot({ animations: 'disabled' })
  } catch (error) {
    await info.attach(`${view}-page`, { body: await page.locator('body').ariaSnapshot(), contentType: 'text/plain' })
    await info.attach(`${view}-errors`, { body: errors.join('\n'), contentType: 'text/plain' })
    throw error
  } finally {
    await page.close()
  }
}

async function compose(browser: Browser, name: string, images: Buffer[], layout: 'hero' | 'desktop' | 'phones') {
  const size = layout === 'phones' ? { width: 1440, height: 1040 } : { width: 1680, height: 1080 }
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1.5 })
  try {
    const frames = images.map((image, index) => {
      const phone = layout === 'phones' || (layout === 'hero' && index === 1)
      return `<div class="frame ${phone ? 'phone' : 'desktop'}">${phone ? '' : '<div class="chrome"><i></i><i></i><i></i><span>OpenVoyage</span></div>'}<img src="data:image/png;base64,${image.toString('base64')}" /></div>`
    }).join('')
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; overflow: hidden;
          background: radial-gradient(ellipse at 15% 10%, #d9e9dc, transparent 65%),
                      radial-gradient(ellipse at 90% 90%, #f4e8cd, transparent 65%), #f7fbf7; }
        main { position: relative; width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; gap: 42px; }
        .frame { overflow: hidden; background: #fff; border: 1px solid #b8cdbc;
          box-shadow: 0 32px 70px -22px #18302640, 0 2px 6px #18302612; }
        img { display: block; width: 100%; }
        .desktop { width: 1512px; border-radius: 20px; }
        .chrome { height: 36px; display: flex; align-items: center; gap: 6px; padding: 0 15px; background: #eaf3eb; border-bottom: 1px solid #d4e1d6; }
        i { width: 7px; height: 7px; border-radius: 100%; background: #a8bdae; }
        span { margin: auto; padding-right: 39px; color: #587064; font: 11px system-ui; letter-spacing: .03em; }
        .phone { width: 366px; border: 7px solid #183026; border-radius: 38px; }
        .hero .desktop { position: absolute; left: 54px; top: 70px; width: 1400px; }
        .hero .phone { position: absolute; right: 36px; bottom: 130px; width: 310px; }
        .phones .phone:nth-child(2) { transform: translateY(-32px); }
      </style><main class="${layout}">${frames}</main>
    `)
    await waitForImages(page)
    const png = await page.screenshot()
    const webp = await page.evaluate(async (source) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d')!.drawImage(image, 0, 0)
      return canvas.toDataURL('image/webp', 0.94).split(',')[1]
    }, `data:image/png;base64,${png.toString('base64')}`)
    return { name, data: Buffer.from(webp, 'base64') }
  } finally {
    await page.close()
  }
}

test('generate the README visual tour', async ({ browser, baseURL }, info) => {
  test.setTimeout(240_000)
  const desktop = await capture(browser, baseURL!, info, 'travel')
  const mobile = await capture(browser, baseURL!, info, 'travel', true)
  const planning = await capture(browser, baseURL!, info, 'planning')
  const mobilePlanning = await capture(browser, baseURL!, info, 'planning', true)
  const reader = await capture(browser, baseURL!, info, 'reader', true)
  const dark = await capture(browser, baseURL!, info, 'dark', true)
  const outputs = [
    await compose(browser, 'openvoyage-example.webp', [desktop, mobile], 'hero'),
    await compose(browser, 'openvoyage-planning.webp', [planning, mobilePlanning], 'hero'),
    await compose(browser, 'openvoyage-mobile.webp', [mobile, reader, dark], 'phones'),
  ]
  // Finish every capture before replacing the published images.
  for (const { name, data } of outputs) {
    await writeFile(new URL(`../../../images/${name}`, import.meta.url), data)
  }
})
