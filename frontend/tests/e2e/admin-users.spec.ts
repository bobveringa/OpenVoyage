import { expect, test, type Page, type Route } from '@playwright/test'

type AdminUser = {
  created_at: string
  email: string
  first_name: string
  id: string
  last_name: string
  password_change_required: boolean
  role: 'ADMIN' | 'COMPANION' | 'USER'
  updated_at: string
  username: string
}

test('creates and manages users from the admin area', async ({ page }) => {
  const api = await mockAdminUsersApi(page)

  await page.goto('/admin#users')

  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(page.getByText('Maya Chen')).toBeVisible()
  await expect(page.getByText('maya@example.com')).toBeVisible()

  await page.getByRole('button', { exact: true, name: 'Create user' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email').fill('henk@example.com')
  await dialog.getByLabel('First name').fill('Henk')
  await dialog.getByLabel('Last name').fill('Traveler')
  await dialog.getByLabel('Username').fill('henk-travels')
  await dialog.locator('input[type="password"]').fill('HenkSecurePass123!')
  await expect(
    dialog.getByLabel('Require password change at next sign-in'),
  ).toBeChecked()
  await dialog.getByRole('button', { exact: true, name: 'Create user' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByText('Henk Traveler')).toBeVisible()
  expect(api.createdUser).toMatchObject({
    email: 'henk@example.com',
    first_name: 'Henk',
    last_name: 'Traveler',
    require_password_change: true,
    role: 'USER',
    username: 'henk-travels',
  })

  const henkRow = page
    .locator('.divide-y > div')
    .filter({ hasText: 'henk@example.com' })
  await henkRow.getByRole('button', { name: 'Edit' }).click()
  const editDialog = page.getByRole('dialog')
  await editDialog.getByLabel('First name').fill('Henri')
  await editDialog.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.getByText('Henri Traveler')).toBeVisible()
  expect(api.updatedUser).toMatchObject({
    first_name: 'Henri',
  })

  const henriPasswordRow = page
    .locator('.divide-y > div')
    .filter({ hasText: 'henk@example.com' })
  await henriPasswordRow.getByRole('button', { name: 'Set password' }).click()
  const passwordDialog = page.getByRole('dialog')
  await passwordDialog
    .locator('input[type="password"]')
    .fill('ReplacementPass123!')
  await passwordDialog
    .getByLabel('Require password change at next sign-in')
    .uncheck()
  await passwordDialog.getByRole('button', { name: 'Set password' }).click()
  await expect(passwordDialog).toBeHidden()

  expect(api.passwordAssignment).toEqual({
    password: 'ReplacementPass123!',
    require_password_change: false,
  })

  const henriRow = page
    .locator('.divide-y > div')
    .filter({ hasText: 'henk@example.com' })
  await henriRow.getByRole('button', { name: 'Delete henk@example.com' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete user' }).click()

  await expect(page.getByText('henk@example.com')).toHaveCount(0)
  expect(api.deletedUserId).toBe('40000000-0000-4000-8000-000000000002')
})

async function mockAdminUsersApi(page: Page) {
  const users: AdminUser[] = [
    {
      created_at: '2026-08-11T18:00:00Z',
      email: 'maya@example.com',
      first_name: 'Maya',
      id: '40000000-0000-4000-8000-000000000001',
      last_name: 'Chen',
      password_change_required: false,
      role: 'USER',
      updated_at: '2026-08-11T18:00:00Z',
      username: 'maya-travels',
    },
  ]
  let createdUser: Record<string, unknown> | null = null
  let updatedUser: Record<string, unknown> | null = null
  let deletedUserId: string | null = null
  let passwordAssignment: Record<string, unknown> | null = null
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

  await page.route('**/api/v1/users/me', (route) => fulfillJson(route, {
    id: '10000000-0000-4000-8000-000000000001', password_change_required: false, permissions: ['platform:administer', 'trip:create'], profile: null, role: 'ADMIN',
  }))
  await page.route('**/api/v1/settings/public', (route) => fulfillJson(route, {
    settings: {}, updated_at: null,
  }))
  await page.route(/\/api\/v1\/admin\/users(?:\?.*)?$/, async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      await fulfillJson(route, {
        page: 1,
        page_size: 20,
        total: users.length,
        users,
      })
      return
    }

    const payload = request.postDataJSON() as Omit<AdminUser, 'id' | 'created_at' | 'updated_at' | 'password_change_required'> & {
      password: string
      require_password_change: boolean
    }
    createdUser = payload
    users.push({
      created_at: '2026-08-11T18:10:00Z',
      email: payload.email,
      first_name: payload.first_name,
      id: '40000000-0000-4000-8000-000000000002',
      last_name: payload.last_name,
      password_change_required: payload.require_password_change,
      role: payload.role,
      updated_at: '2026-08-11T18:10:00Z',
      username: payload.username,
    })
    await fulfillJson(route, users[users.length - 1])
  })
  await page.route(/\/api\/v1\/admin\/users\/.+$/, async (route) => {
    const request = route.request()
    const pathParts = new URL(request.url()).pathname.split('/')
    if (request.method() === 'PUT' && pathParts.at(-1) === 'password') {
      passwordAssignment = request.postDataJSON() as Record<string, unknown>
      const passwordUserId = pathParts.at(-2) ?? ''
      const passwordUser = users.find((user) => user.id === passwordUserId)
      if (passwordUser) {
        passwordUser.password_change_required = Boolean(
          passwordAssignment.require_password_change,
        )
      }
      await route.fulfill({ status: 204 })
      return
    }

    const userId = pathParts.at(-1) ?? ''
    const index = users.findIndex((user) => user.id === userId)

    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON() as Record<string, unknown>
      updatedUser = payload
      const current = users[index]
      if (!current) {
        await fulfillJson(route, { detail: 'User not found' }, 404)
        return
      }
      const nextUser = { ...current, ...payload, updated_at: '2026-08-11T18:20:00Z' }
      users[index] = nextUser as AdminUser
      await fulfillJson(route, nextUser)
      return
    }

    deletedUserId = userId
    users.splice(index, 1)
    await fulfillJson(route, { deleted: true, id: userId })
  })

  return {
    get createdUser() {
      return createdUser
    },
    get deletedUserId() {
      return deletedUserId
    },
    get passwordAssignment() {
      return passwordAssignment
    },
    get updatedUser() {
      return updatedUser
    },
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}
