import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'
import { env } from 'node:process'

type AuthTokens = {
  access_token: string
  id_token: string
  refresh_token: string
  token_type: string
}

type CreatedTrip = {
  id: string
}

type CreatedPost = {
  id: string
}

const apiBaseUrl =
  env.E2E_API_BASE_URL ??
  env.VITE_API_BASE_URL ??
  'http://127.0.0.1:8000'

test.setTimeout(90_000)

test('creates itinerary stops, refreshes route geometry, and publishes a post', async ({
  page,
  request,
}) => {
  const email = env.E2E_LOGIN_EMAIL
  const password = env.E2E_LOGIN_PASSWORD

  test.skip(
    !email || !password,
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD to run trip detail API tests.',
  )

  if (!email || !password) {
    return
  }

  const tokens = await loginWithApi(request, email, password)
  const trip = await createTripWithApi(request, tokens)

  try {
    await seedBrowserAuth(page, tokens)
    await page.goto(`/trips/${trip.id}`)

    await expect(page.getByRole('heading', { name: /E2E API trip/ })).toBeVisible()
    await page.getByRole('button', { name: 'Plan' }).click()
    await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible()
    await expectMapTilesRequested(page)

    await page.getByRole('button', { name: 'Manage trip' }).click()
    await page.getByLabel('Trip title').fill('E2E API trip updated')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(
      page.getByRole('heading', { name: 'E2E API trip updated' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Manage trip' }).click()
    await page.getByRole('button', { name: 'People & sharing' }).click()
    await page.getByRole('button', { name: 'Sharing', exact: true }).click()
    await page.getByLabel('Link label').fill('E2E share link')
    await page.getByRole('button', { name: 'Create link' }).click()
    await expect(page.getByText('E2E share link')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    await createStop(page, {
      search: 'Coimbra',
      title: 'E2E Coimbra',
    })
    await expect(page.getByText('E2E Coimbra')).toBeVisible()

    await createStop(page, {
      search: 'Porto',
      title: 'E2E Porto',
    })
    await expect(page.getByText('E2E Porto', { exact: true })).toBeVisible()

    await page
      .getByRole('button', { name: /E2E Coimbra to E2E Porto/ })
      .click()
    await page.getByRole('button', { name: 'Mode' }).click()
    await page.getByRole('option', { name: 'Car' }).click()
    await page.getByRole('button', { name: 'Save leg' }).click()

    if (expectsProviderBackedRoutes()) {
      await expect(page.getByText('Provider route').first()).toBeVisible({
        timeout: 12000,
      })
    } else {
      await expect(page.getByText('Simple route').first()).toBeVisible()
    }

    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Travel' }).click()
    await page.getByRole('button', { name: 'New post' }).click()
    await expectReverseGeocodeForExactMapPoint(page)
    await selectPlaceSearchResult(page, 'Porto')
    await page.getByLabel('Title').fill('E2E API post')
    await page.getByLabel('Story').fill('Published from the API-backed trip page.')
    await page.locator('input[type="file"][multiple]').setInputFiles({
      buffer: tinyPngBuffer(),
      mimeType: 'image/png',
      name: 'e2e-post.png',
    })
    await expect(page.getByRole('button', { name: 'Publish post' })).toBeEnabled()
    await page.getByRole('button', { name: 'Publish post' }).click()

    await expect(page.getByRole('heading', { name: 'Travel posts' })).toBeVisible()
    await expect(page.getByText('E2E API post')).toBeVisible()

    await page.getByRole('button', { name: 'Edit E2E API post' }).click()
    await page.getByRole('button', { name: 'Delete post' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete post' })
      .click()
    await expect(page.getByText('E2E API post')).toHaveCount(0)
  } finally {
    await deleteTripWithApi(request, tokens, trip.id)
  }
})

test('revokes, restores, and permanently deletes a share link', async ({
  page,
  request,
}) => {
  const email = env.E2E_LOGIN_EMAIL
  const password = env.E2E_LOGIN_PASSWORD

  test.skip(
    !email || !password,
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD to run trip detail API tests.',
  )

  if (!email || !password) {
    return
  }

  const tokens = await loginWithApi(request, email, password)
  const trip = await createTripWithApi(request, tokens)

  try {
    await seedBrowserAuth(page, tokens)
    await page.goto(`/trips/${trip.id}`)
    await openShareLinkManagement(page)

    await page.getByLabel('Link label').fill('Lifecycle share link')
    await page.getByRole('button', { name: 'Create link' }).click()
    await expect(page.getByText('Active', { exact: true })).toBeVisible()

    await page
      .getByRole('button', { name: 'Revoke access for Lifecycle share link' })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Revoke access', exact: true })
      .click()
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible()

    await page.reload()
    await openShareLinkManagement(page)
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible()

    await page
      .getByRole('button', { name: 'Restore access for Lifecycle share link' })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Restore access', exact: true })
      .click()
    await expect(page.getByText('Active', { exact: true })).toBeVisible()

    await page
      .getByRole('button', { name: 'Revoke access for Lifecycle share link' })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Revoke access', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Delete Lifecycle share link permanently' })
      .click()

    const permanentDeleteButton = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete permanently', exact: true })
    await expect(permanentDeleteButton).toBeEnabled({ timeout: 5000 })
    await permanentDeleteButton.click()

    await expect(page.getByText('No share links yet.')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Lifecycle share link/ }),
    ).toHaveCount(0)
  } finally {
    await deleteTripWithApi(request, tokens, trip.id)
  }
})

test('creates nested comment replies and deletes reply subtrees', async ({
  page,
  request,
}) => {
  const email = env.E2E_LOGIN_EMAIL
  const password = env.E2E_LOGIN_PASSWORD

  test.skip(
    !email || !password,
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD to run trip detail API tests.',
  )

  if (!email || !password) {
    return
  }

  const tokens = await loginWithApi(request, email, password)
  const trip = await createTripWithApi(request, tokens)
  const postTitle = `E2E comment thread ${Date.now()}`
  await createPublishedPostWithApi(request, tokens, trip.id, postTitle)

  try {
    await seedBrowserAuth(page, tokens)
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByText(postTitle, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '0 comments' }).click()
    const rootBody = 'E2E root comment'
    await createRootComment(page, rootBody)

    const levelOneBody = 'E2E level one reply'
    const levelTwoBody = 'E2E level two reply'
    const levelThreeBody = 'E2E level three reply'
    await createReply(page, commentCard(page, rootBody), levelOneBody)
    await createReply(page, commentCard(page, levelOneBody), levelTwoBody)
    await createReply(page, commentCard(page, levelTwoBody), levelThreeBody)
    await expect(page.getByRole('button', { name: '4 comments' })).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: '4 comments' }).click()

    const rootCard = commentCard(page, rootBody)
    const levelOneCard = commentCard(page, levelOneBody)
    const levelTwoCard = commentCard(page, levelTwoBody)
    const levelThreeCard = commentCard(page, levelThreeBody)
    await expect(rootCard).toHaveAttribute('data-comment-depth', '0')
    await expect(levelOneCard).toHaveAttribute('data-comment-depth', '1')
    await expect(levelTwoCard).toHaveAttribute('data-comment-depth', '2')
    await expect(levelThreeCard).toHaveAttribute('data-comment-depth', '3')
    await expect(
      levelThreeCard.getByRole('button', { name: 'Reply', exact: true }),
    ).toHaveCount(0)

    await levelOneCard.getByRole('button', { name: 'Delete comment' }).click()
    const subtreeDeleteDialog = page.getByRole('dialog')
    await expect(subtreeDeleteDialog).toContainText(
      'every reply beneath it, including replies written by other people',
    )
    await subtreeDeleteDialog
      .getByRole('button', { name: 'Delete comment' })
      .click()

    await expect(rootCard).toBeVisible()
    await expect(levelOneCard).toHaveCount(0)
    await expect(levelTwoCard).toHaveCount(0)
    await expect(levelThreeCard).toHaveCount(0)
    await expect(page.getByRole('button', { name: '1 comments' })).toBeVisible()

    await rootCard.getByRole('button', { name: 'Delete comment' }).click()
    const leafDeleteDialog = page.getByRole('dialog')
    await expect(leafDeleteDialog).toContainText(
      'This permanently deletes the comment. This action cannot be undone.',
    )
    await leafDeleteDialog
      .getByRole('button', { name: 'Delete comment' })
      .click()

    await expect(rootCard).toHaveCount(0)
    await expect(page.getByRole('button', { name: '0 comments' })).toBeVisible()
  } finally {
    await deleteTripWithApi(request, tokens, trip.id)
  }
})

test('keeps the mobile post open when closing its media viewer', async ({
  page,
  request,
}) => {
  const email = env.E2E_LOGIN_EMAIL
  const password = env.E2E_LOGIN_PASSWORD

  test.skip(
    !email || !password,
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD to run trip detail API tests.',
  )

  if (!email || !password) {
    return
  }

  const tokens = await loginWithApi(request, email, password)
  const trip = await createTripWithApi(request, tokens)
  const postTitle = `E2E mobile media ${Date.now()}`
  await createPublishedPostWithApi(request, tokens, trip.id, postTitle)

  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedBrowserAuth(page, tokens)
    await page.goto(`/trips/${trip.id}?tab=travel`)
    await page.getByRole('button', { name: `Open ${postTitle}` }).click()
    const mobileBackButton = page.getByRole('button', {
      name: 'Back to post carousel',
    })
    const mobilePost = mobileBackButton.locator('xpath=ancestor::article[1]')
    await expect(mobileBackButton).toBeVisible()

    const gallery = mobilePost.getByRole('region', {
      name: 'Post media: 1 items',
    })
    await gallery.getByRole('button').click()
    const mediaViewer = page.getByRole('dialog', {
      name: `${postTitle} media viewer`,
    })
    await expect(mediaViewer).toBeVisible()
    await mediaViewer.getByRole('button', { name: 'Close media viewer' }).click()

    await expect(mediaViewer).toHaveCount(0)
    await expect(mobileBackButton).toBeVisible()
    await expect(
      mobilePost.getByRole('heading', { name: postTitle }),
    ).toBeVisible()

    await gallery.getByRole('button').click()
    await expect(mediaViewer).toBeVisible()
    await page.goBack()

    await expect(mediaViewer).toHaveCount(0)
    await expect(mobileBackButton).toBeVisible()
    await expect(
      mobilePost.getByRole('heading', { name: postTitle }),
    ).toBeVisible()
  } finally {
    await deleteTripWithApi(request, tokens, trip.id)
  }
})

async function createRootComment(page: Page, body: string) {
  const composer = page.locator('[data-comment-composer]').filter({
    has: page.getByPlaceholder('Write a comment'),
  })
  await composer.getByPlaceholder('Write a comment').fill(body)
  await composer.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(commentCard(page, body)).toBeVisible()
}

async function createReply(page: Page, parent: Locator, body: string) {
  await parent.locator('[data-comment-reply-action]').click()
  const composer = parent.locator('[data-comment-composer]')
  await composer.getByPlaceholder('Write a reply').fill(body)
  await composer.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(commentCard(page, body)).toBeVisible()
  await expect(composer).toHaveCount(0)
}

function commentCard(page: Page, body: string) {
  return page.locator('[data-comment-card]').filter({ hasText: body })
}

async function openShareLinkManagement(page: Page) {
  await page.getByRole('button', { name: 'Manage trip' }).click()
  await page.getByRole('button', { name: 'People & sharing' }).click()
  await page.getByRole('button', { name: 'Sharing', exact: true }).click()
}

async function expectMapTilesRequested(page: Page) {
  await expect(
    page.locator('.trip-leaflet-map img.leaflet-tile').first(),
  ).toBeAttached({
    timeout: 5000,
  })
}

async function createStop(
  page: Page,
  {
    search,
    title,
  }: {
    search: string
    title: string
  },
) {
  await openCreateStopPanel(page)
  const place = await selectPlaceSearchResult(page, search)
  await expect(page.getByLabel('Title')).toHaveValue(place.name)
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: 'Create stop' }).click()
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible()
}

async function openCreateStopPanel(page: Page) {
  const firstStopButton = page.getByRole('button', {
    name: 'Create your first stop',
  })

  if ((await firstStopButton.count()) > 0) {
    await firstStopButton.click()
    return
  }

  await page.getByRole('button', { name: /Add stop/ }).last().click()
}

type GeocodedPlace = {
  name: string
}

async function selectPlaceSearchResult(page: Page, search: string) {
  const geocodeResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url())
      return (
        url.pathname.endsWith('/api/v1/places/geocode') &&
        url.searchParams.get('query') === search &&
        response.ok()
      )
    },
  )

  await page.getByLabel('Search places').fill(search)
  const geocodeResponse = await geocodeResponsePromise
  const places = (await geocodeResponse.json()) as GeocodedPlace[]
  const place = places[0]
  if (!place) {
    throw new Error(`No geocode result found for ${search}.`)
  }
  await page
    .getByRole('listbox', { name: 'Place search results' })
    .getByRole('option')
    .first()
    .click()
  return place
}

async function expectReverseGeocodeForExactMapPoint(page: Page) {
  await page.getByRole('button', { name: /Exact point/ }).click()
  const reverseGeocodeResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/v1/places/reverse-geocode') &&
    response.ok(),
  )

  await page.locator('.trip-leaflet-map').click({
    position: {
      x: 520,
      y: 320,
    },
  })
  await reverseGeocodeResponsePromise
}

async function loginWithApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const response = await request.post(`${apiBaseUrl}/api/v1/login/access-token`, {
    form: {
      password,
      username: email,
    },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as AuthTokens
}

async function createTripWithApi(
  request: APIRequestContext,
  tokens: AuthTokens,
): Promise<CreatedTrip> {
  const mediaResponse = await request.post(`${apiBaseUrl}/api/v1/media`, {
    headers: authHeaders(tokens),
    multipart: {
      file: {
        buffer: tinyPngBuffer(),
        mimeType: 'image/png',
        name: 'e2e-cover.png',
      },
    },
  })
  expect(mediaResponse.ok()).toBe(true)
  const media = (await mediaResponse.json()) as { id: string }

  const response = await request.post(`${apiBaseUrl}/api/v1/trips`, {
    data: {
      description: 'Created by Playwright for API-backed trip detail coverage.',
      end_date: '2027-05-16',
      media_id: media.id,
      name: `E2E API trip ${Date.now()}`,
      start_date: '2027-05-10',
      visibility: 'PRIVATE',
    },
    headers: authHeaders(tokens),
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as CreatedTrip
}

async function createPublishedPostWithApi(
  request: APIRequestContext,
  tokens: AuthTokens,
  tripId: string,
  title: string,
): Promise<CreatedPost> {
  const mediaResponse = await request.post(`${apiBaseUrl}/api/v1/media`, {
    headers: authHeaders(tokens),
    multipart: {
      file: {
        buffer: tinyPngBuffer(),
        mimeType: 'image/png',
        name: 'e2e-comment-post.png',
      },
    },
  })
  expect(mediaResponse.ok()).toBe(true)
  const media = (await mediaResponse.json()) as { id: string }

  const response = await request.post(
    `${apiBaseUrl}/api/v1/trips/${tripId}/posts`,
    {
      data: {
        body: 'Published for nested comment end-to-end coverage.',
        location: {
          latitude: 52.3676,
          longitude: 4.9041,
        },
        media_ids: [media.id],
        occurred_at: '2027-05-11T12:00:00Z',
        publish: true,
        title,
      },
      headers: authHeaders(tokens),
    },
  )
  expect(response.ok()).toBe(true)
  return (await response.json()) as CreatedPost
}

async function deleteTripWithApi(
  request: APIRequestContext,
  tokens: AuthTokens,
  tripId: string,
) {
  await request.delete(`${apiBaseUrl}/api/v1/trips/${tripId}`, {
    headers: authHeaders(tokens),
  })
}

async function seedBrowserAuth(page: Page, tokens: AuthTokens) {
  await page.goto('/login')
  await page.evaluate((authTokens) => {
    window.localStorage.setItem('openvoyage.auth', JSON.stringify(authTokens))
  }, tokens)
}

function authHeaders(tokens: AuthTokens) {
  return {
    Authorization: `Bearer ${tokens.access_token}`,
  }
}

function expectsProviderBackedRoutes() {
  return env.E2E_EXPECT_PROVIDER_ROUTES?.toLowerCase() === 'true'
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  )
}
