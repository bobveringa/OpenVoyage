import { expect, test, type Route } from '@playwright/test'

test('routes a new instance to setup and signs in its first administrator', async ({
  page,
}) => {
  const tokenPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60 }),
  ).toString('base64url')
  let createdUser: Record<string, unknown> | null = null

  await page.route('**/api/v1/admin/setup', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, { setup_required: true })
      return
    }

    createdUser = route.request().postDataJSON() as Record<string, unknown>
    await fulfillJson(route, {
      email: 'admin@example.com',
      id: '10000000-0000-4000-8000-000000000001',
    }, 201)
  })
  await page.route('**/api/v1/login/access-token', (route) =>
    fulfillJson(route, {
      access_token: `test.${tokenPayload}.signature`,
      id_token: 'test-id-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
    }),
  )
  await page.route('**/api/v1/users/me', (route) =>
    fulfillJson(route, {
      id: '10000000-0000-4000-8000-000000000001',
      password_change_required: false,
      permissions: ['trip:create'],
      profile: {
        biography: '',
        first_name: 'First',
        last_name: 'Admin',
        profile_picture: null,
        username: 'first-admin',
      },
      role: 'ADMIN',
    }),
  )
  await page.route('**/api/v1/users/by-username/first-admin', (route) =>
    fulfillJson(route, {
      id: '10000000-0000-4000-8000-000000000001',
      profile: {
        biography: '',
        first_name: 'First',
        last_name: 'Admin',
        profile_picture: null,
        username: 'first-admin',
      },
      role: 'ADMIN',
    }),
  )
  await page.route('**/api/v1/trips?*', (route) =>
    fulfillJson(route, {
      items: [],
      page: 1,
      page_size: 12,
      total: 0,
    }),
  )
  await page.route('**/api/v1/settings/public', (route) =>
    fulfillJson(route, { settings: {}, updated_at: null }),
  )

  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Set up OpenVoyage' }),
  ).toBeVisible()
  await page.getByLabel('First name').fill('First')
  await page.getByLabel('Last name').fill('Admin')
  await page.getByLabel('Email').fill('admin@example.com')
  await page.getByLabel('Username').fill('first-admin')
  await page.getByLabel('Password').fill('FirstAdminPass123!')
  await page.getByRole('button', { name: 'Create administrator' }).click()

  await expect(page).toHaveURL('/users/first-admin')
  await expect(
    page.getByRole('heading', { name: 'First Admin' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Account settings' }),
  ).toHaveCount(0)
  expect(createdUser).toEqual({
    email: 'admin@example.com',
    first_name: 'First',
    last_name: 'Admin',
    password: 'FirstAdminPass123!',
    username: 'first-admin',
  })
})

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}
