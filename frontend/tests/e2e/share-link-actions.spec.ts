import { expect, test, type Page } from '@playwright/test'
import { seedAuthTokens } from './helpers/auth'

const timestamp = '2026-10-20T12:00:00Z'
const member = { id: 'owner', first_name: 'Share', last_name: 'Tester', username: 'tester' }
const token = 'secret-token'

async function mockTripWithShareLinks(page: Page) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url')
  await seedAuthTokens(page, {
    access_token: `test.${payload}.sig`,
    id_token: 'id',
    refresh_token: 'refresh',
    token_type: 'bearer',
  })

  const itinerary = { trip_id: 'trip', itinerary_revision: 1, stops: [], connections: [] }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown) => route.fulfill({ json: body })
    if (path.endsWith('/admin/setup')) return json({ setup_required: false })
    if (path.endsWith('/settings/public')) return json({ settings: {}, updated_at: timestamp })
    if (path.endsWith('/users/me')) {
      return json({ id: 'owner', password_change_required: false, permissions: ['trip:create'], profile: null, role: 'USER' })
    }
    if (path.endsWith('/trips/trip')) {
      return json({ id: 'trip', name: 'Lisbon weekend', start_date: '2026-10-01', end_date: '2026-10-05', description: '', cover_media: null, visibility: 'PRIVATE' })
    }
    if (path.endsWith('/members')) {
      return json([{ role: 'OWNER', user_id: 'owner', user: member, trip_id: 'trip' }])
    }
    if (path.endsWith('/share-links') && request.method() === 'POST') {
      return json({
        created_at: timestamp,
        display_name: null,
        display_name_locked: false,
        expires_at: null,
        id: 'link',
        interactions_enabled: true,
        label: 'Family',
        last_used_at: null,
        revoked_at: null,
        token,
        trip_id: 'trip',
      })
    }
    if (path.endsWith('/posts/timeline')) return json({ entries: [], opening_route: null })
    if (path.endsWith('/viewers') || path.endsWith('/share-links')) return json([])
    if (path.endsWith('/itinerary/overview') || path.endsWith('/itinerary')) return json(itinerary)
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } })
  })
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
}

async function createShareLink(page: Page) {
  await page.goto('/trips/trip?dialog=management&section=sharing')
  await page.getByLabel('Link label').fill('Family')
  await page.getByRole('button', { name: 'Create link' }).click()
  await expect(page.getByText('Active', { exact: true })).toBeVisible()
}

test.describe('share link actions', () => {
  test('opens the system share sheet with the share link', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: ShareData[] = []
      Object.assign(window, { __shareCalls: calls })
      Object.defineProperty(Navigator.prototype, 'canShare', {
        configurable: true,
        value: () => true,
      })
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          calls.push(data)
        },
      })
    })
    await mockTripWithShareLinks(page)
    await createShareLink(page)

    await page.getByRole('button', { name: 'Share Family' }).click()

    const calls = await page.evaluate(
      () => (window as unknown as { __shareCalls: ShareData[] }).__shareCalls,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      text: 'Follow Lisbon weekend on OpenVoyage',
      title: 'Lisbon weekend',
    })
    expect(calls[0].url).toMatch(/\/trips\/trip\?share=secret-token$/)
  })

  test('hides Share where the browser has no share sheet and still copies', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.addInitScript(() => {
      delete (Navigator.prototype as Partial<Navigator>).share
      delete (Navigator.prototype as Partial<Navigator>).canShare
    })
    await mockTripWithShareLinks(page)
    await createShareLink(page)

    await expect(page.getByRole('button', { name: 'Share Family' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Copy Family' }).click()
    await expect(page.getByText('Family copied to clipboard.')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /\/trips\/trip\?share=secret-token$/,
    )
  })
})
