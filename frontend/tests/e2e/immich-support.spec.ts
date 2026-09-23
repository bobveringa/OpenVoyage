import { expect, test, type Page, type Route } from '@playwright/test'

test('configures Immich without redisplaying the saved API key', async ({ page }) => {
  const requests = await mockAccountApi(page, true)

  await page.goto('/settings#immich')

  await expect(page.getByRole('heading', { exact: true, name: 'Immich' })).toBeVisible()
  await expect(page.getByLabel('Server URL')).toHaveValue('https://photos.example.com')
  await expect(page.getByLabel('API key')).toHaveValue('')
  await expect(page.getByText('album.read, asset.read, asset.view, asset.download, and user.read')).toBeVisible()

  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.getByRole('status')).toContainText('Connection successful')
  expect(requests.tests).toEqual([
    { api_key: '', server_url: 'https://photos.example.com' },
  ])

  await page.getByLabel('API key').fill('rotated-secret')
  await page.getByRole('button', { exact: true, name: 'Save' }).click()
  await expect(page.getByLabel('API key')).toHaveValue('')
  expect(requests.saves).toEqual([
    { api_key: 'rotated-secret', server_url: 'https://photos.example.com' },
  ])
})

test('hides Immich settings when the public feature flag is disabled', async ({ page }) => {
  await mockAccountApi(page, false)

  await page.goto('/settings#immich')

  await expect(page).toHaveURL(/\/settings#profile$/)
  await expect(page.getByRole('button', { name: 'Immich' })).toHaveCount(0)
  await expect(page.getByRole('heading', { exact: true, name: 'Profile' })).toBeVisible()
})

async function mockAccountApi(page: Page, immichEnabled: boolean) {
  const tests: Record<string, unknown>[] = []
  const saves: Record<string, unknown>[] = []
  const tokenPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60 }),
  ).toString('base64url')

  await page.addInitScript((accessToken) => {
    window.localStorage.setItem(
      'openvoyage.auth',
      JSON.stringify({
        access_token: accessToken,
        id_token: 'test-id-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
      }),
    )
  }, `test.${tokenPayload}.signature`)

  await page.route('**/api/v1/settings/public', (route) =>
    fulfillJson(route, {
      settings: { 'immich.enabled': immichEnabled },
      updated_at: null,
    }),
  )
  await page.route('**/api/v1/admin/setup', (route) =>
    fulfillJson(route, { setup_required: false }),
  )
  await page.route('**/api/v1/users/me/preferences', (route) =>
    fulfillJson(route, {
      theme_palette: null,
      time_format: '24-hour',
      updated_at: '2026-09-23T10:00:00Z',
    }),
  )
  await page.route('**/api/v1/users/me', (route) =>
    fulfillJson(route, {
      id: '10000000-0000-4000-8000-000000000001',
      password_change_required: false,
      permissions: [],
      profile: null,
      role: 'USER',
    }),
  )
  await page.route('**/api/v1/users/me/immich/test', async (route) => {
    tests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 204 })
  })
  await page.route('**/api/v1/users/me/immich', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, {
        connection: { server_url: 'https://photos.example.com' },
      })
      return
    }
    saves.push(route.request().postDataJSON() as Record<string, unknown>)
    await fulfillJson(route, { server_url: 'https://photos.example.com' })
  })

  return { saves, tests }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}
