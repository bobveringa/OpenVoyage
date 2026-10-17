import type { Page } from '@playwright/test'

type AuthTokens = {
  access_token: string
  refresh_token: string
  id_token: string
  token_type: string
}

export async function seedAuthTokens(page: Page, tokens: AuthTokens, currentPage = false) {
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
