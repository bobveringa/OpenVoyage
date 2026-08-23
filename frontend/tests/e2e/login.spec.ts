import { expect, test } from '@playwright/test'
import { env } from 'node:process'

test('signs in with valid credentials', async ({ page }) => {
  const email = env.E2E_LOGIN_EMAIL
  const password = env.E2E_LOGIN_PASSWORD

  test.skip(
    !email || !password,
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD to run the login E2E test.',
  )

  if (!email || !password) {
    return
  }

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/v1/login/access-token'),
  )

  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByLabel('Password').fill('')

  const loginResponse = await loginResponsePromise
  expect(loginResponse.ok()).toBe(true)
  await expect(page).toHaveURL(/\/(?:setup|users\/[^/?#]+)$/)

  const storedAuth = await page.evaluate(() =>
    window.localStorage.getItem('openvoyage.auth'),
  )
  expect(storedAuth).toBeTruthy()

  const tokens = JSON.parse(storedAuth ?? '{}') as Record<string, unknown>
  expect(tokens.access_token).toEqual(expect.any(String))
  expect(tokens.refresh_token).toEqual(expect.any(String))
  expect(tokens.token_type).toEqual(expect.any(String))
})
