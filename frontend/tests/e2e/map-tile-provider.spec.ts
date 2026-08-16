import { expect, test, type Page, type Route } from '@playwright/test'

const tripId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const firstStopId = '33333333-3333-4333-8333-333333333333'
const secondStopId = '44444444-4444-4444-8444-444444444444'
const secondPostId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-08-05T10:00:00Z'
const customTileUrl = 'https://tiles.example.test/{z}/{x}/{y}.png'
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7QAAAABJRU5ErkJggg==',
  'base64',
)

test('swaps only the base tiles and preserves routes and point selection', async ({
  page,
}) => {
  await seedBrowserAuth(page)
  await mockTripApi(page)
  await mockTileServers(page)

  await page.goto(`/trips/${tripId}`)
  await expect(page.getByRole('heading', { name: 'Provider test trip' })).toBeVisible()

  const map = page.getByLabel('Interactive trip route map')
  const routePath = map.locator('.leaflet-overlay-pane path.leaflet-interactive').first()

  await expect(
    map.locator('img.leaflet-tile[src*="tile.openstreetmap.org"]').first(),
  ).toBeAttached()
  await expect(routePath).toBeAttached()
  await routePath.evaluate((element) => {
    element.setAttribute('data-route-before-tile-swap', 'true')
  })

  await expect(
    map.locator('img.leaflet-tile[src*="tiles.example.test"]').first(),
  ).toBeAttached()
  await expect(
    map.locator('[data-route-before-tile-swap="true"]'),
  ).toBeAttached()

  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect(page.getByText('2 hr 32 min')).toBeVisible()
  await expect(map.locator('path[stroke="#7c3aed"]')).toBeAttached()
  const unknownRoute = map.locator('path[stroke="#587064"]').first()
  await unknownRoute.dispatchEvent('mouseover')
  await expect(map.locator('.leaflet-tooltip')).toHaveCount(0)

  const secondPostMarker = map.locator(
    '.leaflet-marker-icon:has(img[alt="Second timeline post media placeholder"])',
  )
  const timelineScrollRoot = page.locator('aside .scrollbar-subtle').first()
  const scrollTopBeforeSelection = await timelineScrollRoot.evaluate(
    (element) => element.scrollTop,
  )
  await secondPostMarker.click()
  await expect(map.locator('.leaflet-popup')).toHaveCount(0)
  await expect
    .poll(() => timelineScrollRoot.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(scrollTopBeforeSelection)

  const secondPostCard = page.locator(
    `[data-trip-post-id="${secondPostId}"]:visible`,
  )
  await expect(secondPostCard).toHaveClass(/border-primary\/55/)
  await expect(secondPostCard.locator('p')).toHaveText('First line\nSecond line')
  await expect(secondPostCard.locator('p')).toHaveCSS('white-space', 'pre-wrap')

  await page.getByRole('button', { name: 'Plan' }).click()
  await page.getByRole('button', { name: 'Add stop after this stop' }).click()
  await page.getByText('Exact point', { exact: true }).click()
  await expect(map).toHaveClass(/trip-leaflet-map--selecting/)

  await map.click({ position: { x: 520, y: 320 } })

  await expect(page.getByText(/Map point ·/)).toBeVisible()
  await expect(map.locator('.trip-map-draft-post-marker')).toBeVisible()
  await expect(routePath).toBeAttached()
})

async function seedBrowserAuth(page: Page) {
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
}

async function mockTripApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.endsWith('/settings/public')) {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      await fulfillJson(route, {
        settings: {
          'map.tile_provider': customTileUrl,
        },
        updated_at: timestamp,
      })
      return
    }

    if (url.pathname.endsWith('/users/me')) {
      await fulfillJson(route, {
        id: userId,
        profile: null,
        role: 'USER',
      })
      return
    }

    if (url.pathname.endsWith(`/trips/${tripId}`)) {
      await fulfillJson(route, {
        cover_media: null,
        description: 'A deterministic trip used to exercise the map.',
        end_date: '2027-05-12',
        id: tripId,
        name: 'Provider test trip',
        start_date: '2027-05-10',
        visibility: 'PRIVATE',
      })
      return
    }

    if (url.pathname.endsWith(`/trips/${tripId}/itinerary`)) {
      await fulfillJson(route, createItinerary())
      return
    }

    if (url.pathname.endsWith(`/trips/${tripId}/posts/timeline`)) {
      await fulfillJson(route, createPostTimeline())
      return
    }

    if (url.pathname.endsWith(`/trips/${tripId}/members`)) {
      await fulfillJson(route, [
        {
          role: 'MEMBER',
          trip_id: tripId,
          user: {
            first_name: 'Map',
            id: userId,
            last_name: 'Tester',
            username: 'map-tester',
          },
          user_id: userId,
        },
      ])
      return
    }

    if (url.pathname.endsWith('/places/reverse-geocode')) {
      await fulfillJson(route, [
        {
          distance_km: 0.1,
          place: createLocation(
            '55555555-5555-4555-8555-555555555555',
            'Selected place',
            48.8566,
            2.3522,
          ),
        },
      ])
      return
    }

    await fulfillJson(route, { detail: `Unhandled mock API path: ${url.pathname}` }, 404)
  })
}

async function mockTileServers(page: Page) {
  const fulfillTile = (route: Route) =>
    route.fulfill({ body: transparentPng, contentType: 'image/png', status: 200 })

  await page.route('https://tile.openstreetmap.org/**', fulfillTile)
  await page.route('https://tiles.example.test/**', fulfillTile)
}

function createItinerary() {
  const creator = {
    first_name: 'Map',
    id: userId,
    last_name: 'Tester',
    username: 'map-tester',
  }
  const firstLocation = createLocation(
    '66666666-6666-4666-8666-666666666666',
    'Amsterdam',
    52.3676,
    4.9041,
  )
  const secondLocation = createLocation(
    '77777777-7777-4777-8777-777777777777',
    'Brussels',
    50.8503,
    4.3517,
  )

  return {
    itinerary_revision: 1,
    legs: [
      {
        created_at: timestamp,
        from_stop_id: firstStopId,
        id: '88888888-8888-4888-8888-888888888888',
        notes: '',
        operator: null,
        reference: null,
        route: {
          distance_meters: 210_000,
          duration_seconds: 7_200,
          geometry: {
            coordinates: [
              [firstLocation.longitude, firstLocation.latitude],
              [secondLocation.longitude, secondLocation.latitude],
            ],
            type: 'LineString',
          },
          type: 'SIMPLE',
        },
        to_stop_id: secondStopId,
        travel_mode: 'TRAIN',
        trip_id: tripId,
        updated_at: timestamp,
      },
    ],
    stops: [
      createStop(firstStopId, firstLocation, creator, '2027-05-10', 0),
      createStop(secondStopId, secondLocation, creator, '2027-05-11', 0),
    ],
    trip_id: tripId,
  }
}

function createPostTimeline() {
  const author = {
    first_name: 'Map',
    id: userId,
    last_name: 'Tester',
    username: 'map-tester',
  }
  const firstLocation = createLocation(
    '99999999-9999-4999-8999-999999999991',
    'First post',
    52.3702,
    4.8952,
  )
  const secondLocation = createLocation(
    '99999999-9999-4999-8999-999999999992',
    'Second post',
    52.0907,
    5.1214,
  )
  const post = (
    id: string,
    title: string,
    occurredAt: string,
    location: ReturnType<typeof createLocation>,
    body = title,
  ) => ({
    author,
    body,
    created_at: occurredAt,
    id,
    location,
    media: [],
    occurred_at: occurredAt,
    published_at: occurredAt,
    title,
    trip_id: tripId,
    updated_at: occurredAt,
  })

  return [
    {
      post: post(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'First timeline post',
        '2026-08-05T08:10:00Z',
        firstLocation,
      ),
      route_after: {
        duration_seconds: 9_120,
        segments: [
          {
            geometry: {
              coordinates: [
                [4.8952, 52.3702],
                [4.91, 52.36],
              ],
              type: 'LineString',
            },
            travel_mode: 'UNKNOWN',
          },
          {
            geometry: {
              coordinates: [
                [4.91, 52.36],
                [5.1214, 52.0907],
              ],
              type: 'LineString',
            },
            travel_mode: 'TRAIN',
          },
        ],
      },
    },
    {
      post: post(
        secondPostId,
        'Second timeline post',
        '2026-08-05T10:42:00Z',
        secondLocation,
        'First line\nSecond line',
      ),
      route_after: null,
    },
  ]
}

function createStop(
  id: string,
  location: ReturnType<typeof createLocation>,
  createdBy: Record<string, string>,
  plannedStartDate: string,
  sameDayPosition: number,
) {
  return {
    created_at: timestamp,
    created_by: createdBy,
    id,
    location,
    notes: '',
    planned_nights: 1,
    planned_start_date: plannedStartDate,
    same_day_position: sameDayPosition,
    title: location.name,
    trip_id: tripId,
    updated_at: timestamp,
    visited: false,
  }
}

function createLocation(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
) {
  return {
    country_code: 'NL',
    full_name: name,
    id,
    latitude,
    longitude,
    name,
    region: '',
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}
