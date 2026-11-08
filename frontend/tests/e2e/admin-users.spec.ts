import { seedAuthTokens } from './helpers/auth'
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
  expect(api.deleteContentParam).toBe('false')
})

test('warns that comments and replies go with the deleted user', async ({ page }) => {
  const mayaId = '40000000-0000-4000-8000-000000000001'
  await mockAdminUsersApi(page, {
    impacts: {
      [mayaId]: {
        comments_on_remaining_posts_count: 0,
        deleted_comment_count: 4,
        deleted_reply_count: 2,
        deleted_shared_trip_count: 0,
        deleted_trip_count: 0,
        likes_on_remaining_posts_count: 0,
        photos_in_others_posts_count: 0,
        remaining_media_count: 0,
        remaining_post_count: 0,
        remaining_track_count: 0,
        user_id: mayaId,
      },
    },
  })

  await page.goto('/admin#users')
  await page.getByRole('button', { name: 'Delete maya@example.com' }).click()

  await expect(
    page.getByRole('dialog').getByText(
      '4 comments they left in other people’s trips will be deleted, along with 2 replies from other people.',
    ),
  ).toBeVisible()
})

test('can retry when checking what goes with the user fails', async ({ page }) => {
  const api = await mockAdminUsersApi(page, { impactFailures: 1 })

  await page.goto('/admin#users')
  await page.getByRole('button', { name: 'Delete maya@example.com' }).click()
  const dialog = page.getByRole('dialog')
  const deleteButton = dialog.getByRole('button', { name: 'Delete user' })

  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByText('Checking what they added…')).toHaveCount(0)
  await expect(dialog.getByText('Not available until we know what they added.')).toBeVisible()
  await expect(deleteButton).toBeDisabled()

  await dialog.getByRole('button', { name: 'Try again' }).click()

  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(deleteButton).toBeEnabled()
  await deleteButton.click()
  await expect(dialog).toBeHidden()
  expect(api.deletedUserId).toBe('40000000-0000-4000-8000-000000000001')
})

test('shows what goes by now when it changed since the check', async ({ page }) => {
  const mayaId = '40000000-0000-4000-8000-000000000001'
  const impact = {
    comments_on_remaining_posts_count: 0,
    deleted_comment_count: 0,
    deleted_reply_count: 0,
    deleted_shared_trip_count: 0,
    deleted_trip_count: 0,
    likes_on_remaining_posts_count: 0,
    photos_in_others_posts_count: 0,
    remaining_media_count: 0,
    remaining_post_count: 0,
    remaining_track_count: 0,
    user_id: mayaId,
  }
  const impacts = { [mayaId]: impact }
  const api = await mockAdminUsersApi(page, { deleteConflicts: 1, impacts })

  await page.goto('/admin#users')
  await page.getByRole('button', { name: 'Delete maya@example.com' }).click()
  const dialog = page.getByRole('dialog')
  const deleteButton = dialog.getByRole('button', { name: 'Delete user' })
  await expect(deleteButton).toBeEnabled()
  await expect(dialog.getByText(/will be deleted/)).toHaveCount(0)

  // The trip's other owner leaves while the dialog is open.
  impacts[mayaId] = { ...impact, deleted_trip_count: 1 }
  await deleteButton.click()

  await expect(dialog.getByRole('alert')).toHaveText('The trips have changed')
  await expect(dialog.getByText('Their trip will be deleted.')).toBeVisible()
  expect(api.deletedUserId).toBeNull()
  expect(api.expectedDeletedTripCountParam).toBe('0')

  await deleteButton.click()

  await expect(dialog).toBeHidden()
  expect(api.deletedUserId).toBe(mayaId)
  expect(api.expectedDeletedTripCountParam).toBe('1')
})

test('warns which trips go with the deleted user', async ({ page }) => {
  const mayaId = '40000000-0000-4000-8000-000000000001'
  const api = await mockAdminUsersApi(page, {
    impacts: {
      [mayaId]: {
        comments_on_remaining_posts_count: 0,
        deleted_comment_count: 0,
        deleted_reply_count: 0,
        deleted_shared_trip_count: 8,
        deleted_trip_count: 30,
        likes_on_remaining_posts_count: 0,
        photos_in_others_posts_count: 0,
        remaining_media_count: 0,
        remaining_post_count: 0,
        remaining_track_count: 0,
        user_id: mayaId,
      },
    },
  })

  await page.goto('/admin#users')
  await page.getByRole('button', { name: 'Delete maya@example.com' }).click()
  const dialog = page.getByRole('dialog')

  await expect(dialog.getByRole('heading', { name: 'Delete Maya Chen?' })).toBeVisible()
  await expect(
    dialog.getByText(
      'Their 30 trips will be deleted, including 8 that are shared with other people.',
    ),
  ).toBeVisible()
  // The option stays in view, so admins know it exists, but has nothing to do.
  await expect(
    dialog.getByRole('checkbox', {
      name: /^Also delete their posts, photos and GPS tracks in other people’s trips/,
    }),
  ).toBeDisabled()
  await expect(
    dialog.getByText('Not available: they haven’t added posts, photos or GPS tracks to other people’s trips.'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete user' }).click()

  await expect(dialog).toBeHidden()
  expect(api.deletedUserId).toBe(mayaId)
  expect(api.deleteContentParam).toBe('false')
})

test('can also delete what the user added to other people’s trips', async ({ page }) => {
  const mayaId = '40000000-0000-4000-8000-000000000001'
  const api = await mockAdminUsersApi(page, {
    impacts: {
      [mayaId]: {
        comments_on_remaining_posts_count: 20,
        deleted_comment_count: 0,
        deleted_reply_count: 0,
        deleted_shared_trip_count: 0,
        deleted_trip_count: 0,
        likes_on_remaining_posts_count: 7,
        photos_in_others_posts_count: 5,
        remaining_media_count: 48,
        remaining_post_count: 12,
        remaining_track_count: 3,
        user_id: mayaId,
      },
    },
  })

  await page.goto('/admin#users')
  await page.getByRole('button', { name: 'Delete maya@example.com' }).click()
  const dialog = page.getByRole('dialog')
  const option = dialog.getByRole('checkbox', {
    name: /^Also delete their posts, photos and GPS tracks in other people’s trips/,
  })

  await expect(dialog.getByText(/trips will be deleted/)).toHaveCount(0)
  await expect(
    dialog.getByText('12 posts, 3 GPS tracks and 48 photos and videos, including 5 in other people’s posts.', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(
    dialog.getByText('This also deletes 20 comments and 7 likes from other people on those posts.', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(option).not.toBeChecked()
  await option.check()
  await dialog.getByRole('button', { name: 'Delete user' }).click()

  await expect(dialog).toBeHidden()
  expect(api.deleteContentParam).toBe('true')
})

async function mockAdminUsersApi(
  page: Page,
  options: {
    deleteConflicts?: number
    impactFailures?: number
    impacts?: Record<string, unknown>
  } = {},
) {
  let deleteConflicts = options.deleteConflicts ?? 0
  let expectedDeletedTripCountParam: string | null = null
  let impactFailures = options.impactFailures ?? 0
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
  let deleteContentParam: string | null = null
  let createdUser: Record<string, unknown> | null = null
  let updatedUser: Record<string, unknown> | null = null
  let deletedUserId: string | null = null
  let passwordAssignment: Record<string, unknown> | null = null
  const tokenPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60 }),
  ).toString('base64url')

  await seedAuthTokens(page, {
    access_token: `test.${tokenPayload}.signature`,
    id_token: 'test-id-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
  })

  await page.route('**/api/v1/users/me', (route) => fulfillJson(route, {
    id: '10000000-0000-4000-8000-000000000001', password_change_required: false, permissions: ['platform:administer', 'trip:create'], profile: null, role: 'ADMIN',
  }))
  await page.route('**/api/v1/users/me/preferences', (route) => fulfillJson(route, {
    theme_palette: null,
    time_format: '24-hour',
    updated_at: '2026-08-27T10:00:00Z',
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
    if (request.method() === 'GET' && pathParts.at(-1) === 'deletion-impact') {
      const impactUserId = pathParts.at(-2) ?? ''
      if (impactFailures > 0) {
        impactFailures -= 1
        await fulfillJson(route, { detail: 'Could not check this user' }, 500)
        return
      }
      await fulfillJson(
        route,
        options.impacts?.[impactUserId] ?? {
          comments_on_remaining_posts_count: 0,
          deleted_comment_count: 0,
          deleted_reply_count: 0,
          deleted_shared_trip_count: 0,
          deleted_trip_count: 0,
          likes_on_remaining_posts_count: 0,
          photos_in_others_posts_count: 0,
          remaining_media_count: 0,
          remaining_post_count: 0,
          remaining_track_count: 0,
          user_id: impactUserId,
        },
      )
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

    const searchParams = new URL(request.url()).searchParams
    expectedDeletedTripCountParam = searchParams.get('expected_deleted_trip_count')
    if (deleteConflicts > 0) {
      deleteConflicts -= 1
      await fulfillJson(route, { detail: 'The trips have changed' }, 409)
      return
    }

    deletedUserId = userId
    deleteContentParam = searchParams.get('delete_content')
    users.splice(index, 1)
    await fulfillJson(route, { deleted: true, id: userId })
  })

  return {
    get createdUser() {
      return createdUser
    },
    get deleteContentParam() {
      return deleteContentParam
    },
    get deletedUserId() {
      return deletedUserId
    },
    get expectedDeletedTripCountParam() {
      return expectedDeletedTripCountParam
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
