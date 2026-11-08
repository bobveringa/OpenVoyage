import { expect, test, type Page } from '@playwright/test'
import { seedAuthTokens } from './helpers/auth'

const timestamp = '2026-10-20T12:00:00Z'
const member = { id: 'owner', first_name: 'Tab', last_name: 'Tester', username: 'tester' }

function daysFromToday(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const dates = {
  upcoming: { start_date: daysFromToday(3), end_date: daysFromToday(6) },
  ongoing: { start_date: daysFromToday(-3), end_date: daysFromToday(3) },
  openEnded: { start_date: daysFromToday(-3), end_date: null },
  completed: { start_date: daysFromToday(-6), end_date: daysFromToday(-3) },
}

async function mockTrip(
  page: Page,
  tripDates: { start_date: string; end_date: string | null },
  { isMember = true }: { isMember?: boolean } = {},
) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url')
  await seedAuthTokens(page, {
    access_token: `test.${payload}.sig`,
    id_token: 'id',
    refresh_token: 'refresh',
    token_type: 'bearer',
  })

  const planningRequests: string[] = []
  const itinerary = { trip_id: 'trip', itinerary_revision: 1, stops: [], connections: [] }

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body: unknown) => route.fulfill({ json: body })
    if (path.endsWith('/admin/setup')) return json({ setup_required: false })
    if (path.endsWith('/settings/public')) return json({ settings: {}, updated_at: timestamp })
    if (path.endsWith('/users/me')) {
      return json({ id: 'owner', password_change_required: false, permissions: ['trip:create'], profile: null, role: 'USER' })
    }
    if (path.endsWith('/trips/trip')) {
      return json({ id: 'trip', name: 'Opening tab trip', ...tripDates, description: '', cover_media: null, visibility: 'PUBLIC' })
    }
    if (path.endsWith('/members')) {
      return json(isMember ? [{ role: 'OWNER', user_id: 'owner', user: member, trip_id: 'trip' }] : [])
    }
    if (path.endsWith('/posts/timeline')) return json({ entries: [], opening_route: null })
    if (path.endsWith('/viewers') || path.endsWith('/share-links')) return json([])
    if (path.endsWith('/itinerary/overview')) return json(itinerary)
    if (path.endsWith('/itinerary')) {
      planningRequests.push(path)
      return json(itinerary)
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } })
  })
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())

  return { planningRequests }
}

async function expectTravelTab(page: Page) {
  await expect(page.getByRole('button', { name: 'New post', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toHaveCount(0)
}

async function expectPlanTab(page: Page) {
  await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible()
}

test.describe('trip opening tab', () => {
  test('opens an upcoming trip on Plan', async ({ page }) => {
    await mockTrip(page, dates.upcoming)
    await page.goto('/trips/trip')
    await expectPlanTab(page)
  })

  for (const [label, tripDates] of [
    ['an ongoing trip', dates.ongoing],
    ['an open-ended trip that has started', dates.openEnded],
    ['a completed trip', dates.completed],
  ] as const) {
    test(`opens ${label} on Travel without loading planning data`, async ({ page }) => {
      const { planningRequests } = await mockTrip(page, tripDates)
      await page.goto('/trips/trip')
      await expectTravelTab(page)
      expect(new URL(page.url()).searchParams.has('tab')).toBe(false)
      expect(planningRequests).toEqual([])
    })
  }

  test('keeps an explicit tab on an ongoing trip', async ({ page }) => {
    await mockTrip(page, dates.ongoing)
    await page.goto('/trips/trip?tab=plan')
    await expectPlanTab(page)
  })

  test('keeps the chosen tab on reload and returns to the default on back', async ({ page }) => {
    await mockTrip(page, dates.ongoing)
    await page.goto('/trips/trip')
    await expectTravelTab(page)

    await page.getByRole('button', { name: 'Plan', exact: true }).click()
    await expectPlanTab(page)
    await expect(page).toHaveURL(/tab=plan/)

    await page.reload()
    await expectPlanTab(page)

    await page.goBack()
    await expectTravelTab(page)
  })

  test('never shows Plan to a signed-in non-member of an upcoming trip', async ({ page }) => {
    const { planningRequests } = await mockTrip(page, dates.upcoming, { isMember: false })
    await page.goto('/trips/trip')
    await expect(page.getByRole('heading', { name: /Opening tab trip/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Plan', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toHaveCount(0)
    expect(planningRequests).toEqual([])
  })
})
