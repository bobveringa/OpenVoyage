import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import process from 'node:process'

type AuthTokens = {
  access_token: string
  id_token: string
  refresh_token: string
  token_type: string
}

type CreatedTrip = {
  id: string
}

const apiBaseUrl =
  process.env.E2E_API_BASE_URL ??
  process.env.VITE_API_BASE_URL ??
  'http://127.0.0.1:8000'

test.setTimeout(90_000)

test('creates itinerary stops, refreshes route geometry, and publishes a post', async ({
  page,
  request,
}) => {
  const email = process.env.E2E_LOGIN_EMAIL
  const password = process.env.E2E_LOGIN_PASSWORD

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

    await page.getByRole('button', { name: 'People & sharing' }).click()
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
    await page.getByRole('button', { name: 'Add', exact: true }).click()
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
      .getByRole('dialog', { name: 'Delete post' })
      .getByRole('button', { name: 'Delete post' })
      .click()
    await expect(page.getByText('E2E API post')).toHaveCount(0)
  } finally {
    await deleteTripWithApi(request, tokens, trip.id)
  }
})

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
  return process.env.E2E_EXPECT_PROVIDER_ROUTES?.toLowerCase() === 'true'
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  )
}
