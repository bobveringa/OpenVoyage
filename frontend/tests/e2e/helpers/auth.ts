import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }

type AuthTokens = {
  access_token: string
  refresh_token: string
  id_token: string
  token_type: string
}

export async function seedAuthTokens(page: Page, tokens: AuthTokens, currentPage = false) {
  // Fake sessions need local responses for the global software-info requests;
  // otherwise their fake JWTs reach the real API and trigger token refresh.
  // Tests for software updates register more specific responses afterward.
  await page.route('**/api/v1/server/version', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ version }),
  }))
  await page.route('**/api/v1/admin/updates', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      installed_version: version, latest_release: null, comparison: 'unknown',
      check_status: 'never_checked', checks_enabled: true, last_attempt_at: null,
      last_success_at: null, next_allowed_check_at: null, error_code: null, is_stale: true,
    }),
  }))
  // Browser requests use Vite's same-origin API proxy. The auth store binds
  // sessions to that origin, rather than the proxy's upstream backend URL.
  const store = (value: AuthTokens) => {
    window.localStorage.setItem('openvoyage.auth', JSON.stringify({
      ...value, serverUrl: window.location.origin,
    }))
  }
  if (currentPage) {
    await page.evaluate(store, tokens)
  } else {
    await page.addInitScript(store, tokens)
  }
}
