import { expect, test, type Page, type Route } from '@playwright/test'

const job = {
  key: 'geonames_import',
  name: 'GeoNames import',
  description: 'Refreshes place data.',
  schedule: {
    enabled: true,
    cron: '0 0 1 * *',
    timezone: 'UTC',
    next_run_at: null,
    error: null,
  },
  defaults: { enabled: true, cron: '0 0 1 * *', timezone: 'UTC' },
  executions: { active: null, latest: null },
  audit: { updated_by: null, updated_at: '2026-08-07T10:00:00Z' },
}

test('reports a rejected schedule update while retaining the entered value', async ({
  page,
}) => {
  await mockJobsApi(page)
  await page.goto('/admin#jobs')

  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible()
  const cronInput = page.getByLabel('GeoNames import cron')
  await cronInput.fill('henk')
  await page.getByRole('button', { name: 'Save schedule' }).click()

  await expect(page.getByRole('alert')).toContainText(
    'Schedule was not saved: Cron must be a valid five-field expression',
  )
  await expect(cronInput).toHaveValue('henk')
})

async function mockJobsApi(page: Page) {
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

  await page.route('**/api/v1/admin/setup', (route) => fulfillJson(route, {
    setup_required: false,
  }))
  await page.route('**/api/v1/users/me', (route) => fulfillJson(route, {
    id: '10000000-0000-4000-8000-000000000001',
    password_change_required: false,
    permissions: ['trip:create', 'platform:administer'],
    profile: null,
    role: 'ADMIN',
  }))
  await page.route('**/api/v1/users/me/preferences', (route) => fulfillJson(route, {
    theme_palette: null,
    time_format: '24-hour',
    updated_at: '2026-08-27T10:00:00Z',
  }))
  await page.route('**/api/v1/settings/public', (route) => fulfillJson(route, {
    settings: {}, updated_at: null,
  }))
  await page.route('**/api/v1/admin/settings', (route) => fulfillJson(route, {
    settings: [], updated_at: null,
  }))
  await page.route('**/api/v1/admin/jobs', (route) => fulfillJson(route, { jobs: [job] }))
  await page.route('**/api/v1/admin/jobs/geonames_import', (route) => fulfillJson(route, {
    detail: 'Cron must be a valid five-field expression',
  }, 422))
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}
