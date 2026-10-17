import { expect, test } from '@playwright/test'
import { env } from 'node:process'
import { waitForMediaReady } from './helpers/media'

const apiBase =
  env.E2E_API_BASE_URL ?? env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

test('live viewer refreshes geometry without moving the map and retains it during an outage', async ({
  page,
  request,
}) => {
  test.skip(
    !env.E2E_LOGIN_EMAIL || !env.E2E_LOGIN_PASSWORD,
    'Local E2E credentials required',
  )
  const login = await request.post(`${apiBase}/api/v1/login/access-token`, {
    form: { username: env.E2E_LOGIN_EMAIL!, password: env.E2E_LOGIN_PASSWORD! },
  })
  expect(login.ok()).toBe(true)
  const tokens = (await login.json()) as { access_token: string }
  const headers = { Authorization: `Bearer ${tokens.access_token}` }
  const mediaResponse = await request.post(`${apiBase}/api/v1/media`, {
    headers,
    multipart: {
      file: {
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
          'base64',
        ),
        mimeType: 'image/png',
        name: 'viewer-cover.png',
      },
    },
  })
  expect(mediaResponse.ok()).toBe(true)
  const media = (await mediaResponse.json()) as { id: string }
  await waitForMediaReady(request, apiBase, media.id, headers)
  const created = await request.post(`${apiBase}/api/v1/trips`, {
    headers,
    data: {
      name: 'E2E live viewer refresh',
      media_id: media.id,
      visibility: 'PUBLIC',
      start_date: new Date().toISOString().slice(0, 10),
    },
  })
  expect(created.ok()).toBe(true)
  const trip = (await created.json()) as { id: string }
  const base = `${apiBase}/api/v1/trips/${trip.id}`
  const session = crypto.randomUUID()
  const started = Date.now() - 300_000
  const point = (offset: number, latitude: number) => ({
    id: crypto.randomUUID(),
    recorded_at: new Date(started + offset).toISOString(),
    latitude,
    longitude: 5.5,
    travel_mode: 'WALK',
  })
  const timelinePath = `**/api/v1/trips/${trip.id}/posts/timeline*`
  try {
    expect(
      (
        await request.put(`${base}/live-location-settings`, {
          headers,
          data: { share_live_location: true },
        })
      ).ok(),
    ).toBe(true)
    expect(
      (
        await request.post(`${base}/tracking/sessions/${session}`, {
          headers,
          data: { started_at: new Date(started).toISOString() },
        })
      ).status(),
    ).toBe(201)
    const uploaded = await request.post(
      `${base}/tracking/sessions/${session}/samples/batch`,
      {
        headers,
        data: { samples: [point(60_000, 51.5), point(120_000, 51.501)] },
      },
    )
    expect((await uploaded.json()).accepted_samples).toBe(2)
    await page.clock.install()
    await page.goto(`/trips/${trip.id}?tab=travel`)
    await expect(
      page.getByRole('heading', { name: 'E2E live viewer refresh' }),
    ).toBeVisible()
    const map = page.getByLabel('Interactive trip route map')
    const route = map.locator('.leaflet-overlay-pane svg path').first()
    await expect(route).toHaveAttribute('d', /M/)
    const firstGeometry = await route.getAttribute('d')
    const bounds = await map.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(
      bounds!.x + bounds!.width / 2,
      bounds!.y + bounds!.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      bounds!.x + bounds!.width / 2 + 140,
      bounds!.y + bounds!.height / 2 + 80,
      { steps: 8 },
    )
    await page.mouse.up()
    await page.clock.runFor(1_000)
    const transform = await map
      .locator('.leaflet-map-pane')
      .evaluate((element) => element.getAttribute('style'))
    await request.post(`${base}/tracking/sessions/${session}/samples/batch`, {
      headers,
      data: { samples: [point(180_000, 51.503)] },
    })
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().includes(`/trips/${trip.id}/posts/timeline`) &&
        response.status() === 200,
    )
    await page.clock.runFor(61_000)
    await refreshed
    await expect(route).not.toHaveAttribute('d', firstGeometry!)
    expect(
      await map
        .locator('.leaflet-map-pane')
        .evaluate((element) => element.getAttribute('style')),
    ).toBe(transform)
    const freshGeometry = await route.getAttribute('d')
    await page.route(timelinePath, (route) =>
      route.fulfill({ status: 503, json: { detail: 'Temporary outage' } }),
    )
    await page.clock.runFor(60_000)
    await expect(route).toHaveAttribute('d', freshGeometry!)
    await expect(
      page.getByRole('heading', { name: 'E2E live viewer refresh' }),
    ).toBeVisible()
    await page.unroute(timelinePath)
    const foreground = page.waitForResponse(
      (response) =>
        response.url().includes(`/trips/${trip.id}/posts/timeline`) &&
        response.status() === 200,
    )
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await foreground
    expect(
      await map
        .locator('.leaflet-map-pane')
        .evaluate((element) => element.getAttribute('style')),
    ).toBe(transform)
  } finally {
    await request.delete(base, { headers })
  }
})
