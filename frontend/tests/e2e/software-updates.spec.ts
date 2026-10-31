import { expect, test, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { seedAuthTokens } from './helpers/auth'
import type { SoftwareUpdate } from '../../src/api/client'

const { version: clientVersion } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
function status(changes: Partial<SoftwareUpdate> = {}): SoftwareUpdate {
  return {
    installed_version: clientVersion, comparison: 'update_available', check_status: 'ok', checks_enabled: true,
    latest_release: { version: '99.0.0', url: 'https://github.com/bobveringa/OpenVoyage/releases/tag/v99.0.0', published_at: '2026-10-29T12:00:00Z' },
    last_attempt_at: new Date().toISOString(), last_success_at: new Date().toISOString(),
    next_allowed_check_at: null, error_code: null, is_stale: false, ...changes,
  }
}

async function mockSoftware(page: Page, options: { admin?: boolean; initial?: SoftwareUpdate } = {}) {
  const admin = options.admin ?? true
  let state = options.initial ?? status()
  let requests = 0
  let checks = 0
  let pendingReads = 0
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await seedAuthTokens(page, { access_token: `test.${payload}.signature`, refresh_token: 'refresh', id_token: 'id', token_type: 'bearer' })
  await page.route('**/api/v1/admin/setup', (route) => json(route, { setup_required: false }))
  await page.route('**/api/v1/settings/public', (route) => json(route, { settings: {}, updated_at: null }))
  await page.route('**/api/v1/users/me', (route) => json(route, {
    id: '10000000-0000-4000-8000-000000000001', role: admin ? 'ADMIN' : 'USER',
    permissions: admin ? ['platform:administer', 'trip:create'] : ['trip:create'], password_change_required: false, profile: null,
  }))
  await page.route('**/api/v1/users/me/preferences', (route) => json(route, { theme_palette: null, time_format: '24-hour', updated_at: null }))
  await page.route('**/api/v1/server/version', (route) => json(route, { version: clientVersion }))
  await page.route('**/api/v1/admin/updates', (route) => {
    requests++
    if (checks && ++pendingReads >= 2) state = status({ comparison: 'up_to_date', latest_release: { version: clientVersion, url: 'https://github.com/bobveringa/OpenVoyage/releases/tag/v' + clientVersion, published_at: new Date().toISOString() }, next_allowed_check_at: new Date(Date.now() + 300_000).toISOString() })
    return json(route, state)
  })
  await page.route('**/api/v1/admin/jobs/software_update_check/executions', (route) => {
    checks++; state = { ...state, check_status: 'checking' }
    return json(route, { id: 'queued-check', status: 'QUEUED' }, 202)
  })
  return { get requests() { return requests }, get checks() { return checks } }
}

test('admins see the update on the server version while the menu stays neutral', async ({ page }, info) => {
  await mockSoftware(page)
  await page.goto('/admin#system')
  await expect(page.getByText('Update available', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View release notes' })).toHaveAttribute('href', /releases\/tag\/v99\.0\.0$/)
  const serverVersion = page.getByText('Server version', { exact: true }).locator('..')
  await expect(serverVersion.getByText('Update available', { exact: true })).toBeVisible()
  await expect(serverVersion.locator('svg.lucide-circle-alert')).toBeVisible()
  await page.getByRole('banner').locator('button[aria-expanded]').click()
  const admin = page.getByRole('button', { name: 'Admin', exact: true })
  await expect(admin).toBeVisible()
  await expect(page.getByRole('button', { name: /software update available/ })).toHaveCount(0)
  await expect(page.getByRole('banner').locator('svg.lucide-circle-alert')).toHaveCount(0)
  const versions = page.getByLabel('Installed versions')
  await expect(versions.getByText('Client', { exact: true })).toBeVisible()
  await expect(versions.getByText('Server', { exact: true })).toBeVisible()
  await expect(versions.getByText('v' + clientVersion, { exact: true })).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('update-menu.png'), fullPage: true })
  await admin.click()
  await expect(page).toHaveURL(/\/admin#system$/)
  await expect(page.getByText('Client version', { exact: true })).toBeVisible()
  await expect(page.getByText('Server version', { exact: true })).toBeVisible()
  await expect(page.getByText(clientVersion, { exact: true })).toHaveCount(2)
})

test('regular users see menu versions and no About settings or update requests', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const api = await mockSoftware(page, { admin: false })
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.getByText('About', { exact: true })).toHaveCount(0)
  await page.getByRole('banner').locator('button[aria-expanded]').click()
  await expect(page.getByLabel('Installed versions').getByText('v' + clientVersion, { exact: true })).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('versions-menu-mobile.png'), fullPage: true })
  await expect(page.getByRole('button', { name: /software update available/ })).toHaveCount(0)
  expect(api.requests).toBe(0)
  await page.goto('/admin#system')
  await expect(page.getByRole('heading', { name: 'Admin access required' })).toBeVisible()
  expect(api.requests).toBe(0)
})

test('Check now queues a job and refreshes the result', async ({ page }) => {
  const api = await mockSoftware(page, { initial: status({ comparison: 'unknown', check_status: 'never_checked', latest_release: null, last_success_at: null }) })
  await page.goto('/admin#system')
  await page.getByRole('button', { name: 'Check now' }).click()
  await expect(page.getByRole('button', { name: 'Checking…' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'OpenVoyage is up to date' })).toBeVisible({ timeout: 10_000 })
  expect(api.checks).toBe(1)
  await expect(page.getByRole('button', { name: 'Check now' })).toBeDisabled()
})

test('a failed check retains the available update and respects the retry cooldown', async ({ page }) => {
  await mockSoftware(page, { initial: status({ check_status: 'failed', error_code: 'timeout', is_stale: true, next_allowed_check_at: new Date(Date.now() + 60_000).toISOString() }) })
  await page.goto('/admin#system')
  await expect(page.getByText('Update available', { exact: true })).toBeVisible()
  await expect(page.getByText(/Showing the last successfully verified result/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check now' })).toBeDisabled()
})

test('no published stable release is not reported as up to date', async ({ page }) => {
  await mockSoftware(page, { initial: status({ latest_release: null, comparison: 'unknown' }) })
  await page.goto('/admin#system')
  await expect(page.getByText('No published stable release was found.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'OpenVoyage is up to date' })).toHaveCount(0)
})

test('the System panel fits a phone screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockSoftware(page)
  await page.goto('/admin#system')
  await expect(page.getByText('Update available', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: /System/ })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('system-mobile.png'), fullPage: true })
})

function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
}
