import type { Page } from '@playwright/test'
import { env } from 'node:process'

type AuthTokens = {
  access_token: string
  refresh_token: string
  id_token: string
  token_type: string
}

export async function seedAuthTokens(page: Page, tokens: AuthTokens, currentPage = false) {
  const serverUrl = new URL(
    env.E2E_API_BASE_URL ?? env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000',
  ).href.replace(/\/+$/, '')
  const storedTokens = { ...tokens, serverUrl }
  const store = (value: typeof storedTokens) => {
    window.localStorage.setItem('openvoyage.auth', JSON.stringify(value))
  }
  if (currentPage) {
    await page.evaluate(store, storedTokens)
  } else {
    await page.addInitScript(store, storedTokens)
  }
}
