import { expect, test, type Page, type Route } from '@playwright/test'

test('changes a password and signs out all devices', async ({ page }) => {
  const api = await mockSecurityApi(page, false)

  await page.goto('/settings/security')
  await expect(
    page.getByRole('heading', { name: 'Account security' }),
  ).toBeVisible()

  await page.getByLabel('Current password').fill('CurrentPassword123!')
  await page
    .getByLabel('New password', { exact: true })
    .fill('NewPrivatePassword456!')
  await page.getByLabel('Confirm new password').fill('DifferentPassword789!')
  await page.getByRole('button', { name: 'Update password' }).click()

  await expect(page.getByRole('alert')).toHaveText('New passwords do not match')
  expect(api.passwordChanges).toHaveLength(0)

  await page.getByLabel('Confirm new password').fill('NewPrivatePassword456!')
  await page.getByRole('button', { name: 'Update password' }).click()

  await expect(page.getByRole('status')).toContainText(
    'Other devices have been signed out',
  )
  expect(api.passwordChanges).toEqual([
    {
      current_password: 'CurrentPassword123!',
      new_password: 'NewPrivatePassword456!',
    },
  ])
  const storedAfterChange = await page.evaluate(() =>
    window.localStorage.getItem('openvoyage.auth'),
  )
  expect(JSON.parse(storedAfterChange ?? '{}').access_token).toBe(
    api.replacementAccessToken,
  )

  await page.getByRole('button', { name: 'Sign out all devices' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Sign out all devices' })
    .click()

  await expect(page).toHaveURL(/\/login$/)
  expect(api.signOutAllCalls).toBe(1)
  expect(
    await page.evaluate(() => window.localStorage.getItem('openvoyage.auth')),
  ).toBeNull()
})

test('forces an assigned-password user onto account security', async ({ page }) => {
  await mockSecurityApi(page, true)

  await page.goto('/setup')

  await expect(page).toHaveURL(/\/settings\/security$/)
  await expect(
    page.getByText('must be replaced before you can use other features'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Sign out all devices' }),
  ).toHaveCount(0)

  await page.getByLabel('Current password').fill('AssignedPassword123!')
  await page
    .getByLabel('New password', { exact: true })
    .fill('PrivatePassword456!')
  await page.getByLabel('Confirm new password').fill('PrivatePassword456!')
  await page.getByRole('button', { name: 'Update password' }).click()

  await expect(page).toHaveURL(/\/setup$/)
})

async function mockSecurityApi(page: Page, passwordChangeRequired: boolean) {
  const passwordChanges: Record<string, unknown>[] = []
  let signOutAllCalls = 0
  const initialAccessToken = createJwt('initial-access')
  const replacementAccessToken = createJwt('replacement-access')

  await page.addInitScript((accessToken) => {
    window.localStorage.setItem(
      'openvoyage.auth',
      JSON.stringify({
        access_token: accessToken,
        id_token: 'initial-id-token',
        refresh_token: 'initial-refresh-token',
        token_type: 'bearer',
      }),
    )
  }, initialAccessToken)

  await page.route('**/api/v1/settings/public', (route) =>
    fulfillJson(route, { settings: {}, updated_at: null }),
  )
  await page.route('**/api/v1/users/me', (route) =>
    fulfillJson(route, {
      id: '10000000-0000-4000-8000-000000000001',
      password_change_required: passwordChangeRequired,
      profile: null,
      role: 'USER',
    }),
  )
  await page.route('**/api/v1/users/me/password', async (route) => {
    passwordChanges.push(route.request().postDataJSON() as Record<string, unknown>)
    await fulfillJson(route, {
      access_token: replacementAccessToken,
      id_token: 'replacement-id-token',
      refresh_token: 'replacement-refresh-token',
      token_type: 'bearer',
    })
  })
  await page.route('**/api/v1/users/me/sign-out-all', async (route) => {
    signOutAllCalls += 1
    await route.fulfill({ status: 204 })
  })

  return {
    passwordChanges,
    replacementAccessToken,
    get signOutAllCalls() {
      return signOutAllCalls
    },
  }
}

function createJwt(label: string) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60, label }),
  ).toString('base64url')
  return `test.${payload}.signature`
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}
