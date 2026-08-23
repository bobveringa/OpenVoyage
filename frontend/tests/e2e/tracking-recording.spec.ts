import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
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

const apiBaseUrl =
  env.E2E_API_BASE_URL ??
  env.VITE_API_BASE_URL ??
  'http://127.0.0.1:8000'

test.setTimeout(60_000)

test('starts and stops a GPS recording, syncing session lifecycle to the server', async ({
  context,
  page,
  request,
}) => {
  const email = env.E2E_LOGIN_EMAIL
  const password = env.E2E_LOGIN_PASSWORD

  test.skip(
    !email || !password,
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD to run tracking e2e tests.',
  )

  if (!email || !password) {
    return
  }

  const tokens = await loginWithApi(request, email, password)
  const trip = await createTripWithApi(request, tokens)

  try {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 51.4416, longitude: 5.4697 })

    await seedBrowserAuth(page, tokens)
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: /E2E tracking trip/ })).toBeVisible()

    await page.getByRole('button', { name: 'GPS tracking' }).click()
    await expect(
      page.getByRole('heading', { name: 'Recording', exact: true }),
    ).toBeVisible()

    const createResponsePromise = page.waitForResponse(
      (response) =>
        /\/tracking\/sessions\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname) &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Start tracking' }).click()
    const createResponse = await createResponsePromise
    expect(createResponse.status()).toBe(201)

    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()

    const endResponsePromise = page.waitForResponse(
      (response) =>
        /\/tracking\/sessions\/[0-9a-f-]{36}$/.test(new URL(response.url()).pathname) &&
        response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Stop' }).click()
    const endResponse = await endResponsePromise
    expect(endResponse.status()).toBe(200)

    // The end PATCH must never race ahead of the session's own create.
    expect(endResponse.request().timing().startTime).toBeGreaterThanOrEqual(
      createResponse.request().timing().startTime,
    )

    await expect(page.getByRole('button', { name: 'Start tracking' })).toBeVisible()
    await expect(page.getByText(/points$/).first()).toBeVisible()
  } finally {
    await deleteTripWithApi(request, tokens, trip.id)
  }
})

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
      description: 'Created by Playwright for GPS tracking e2e coverage.',
      end_date: '2027-05-16',
      media_id: media.id,
      name: `E2E tracking trip ${Date.now()}`,
      start_date: '2027-05-10',
      visibility: 'PRIVATE',
    },
    headers: authHeaders(tokens),
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as CreatedTrip
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  )
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
