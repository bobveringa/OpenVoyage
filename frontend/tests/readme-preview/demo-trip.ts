import type { Page } from '@playwright/test'
import type { Itinerary, PostTimeline, RouteOverview, Trip, TripMember } from '@/api/client'
import { seedAuthTokens } from '../e2e/helpers/auth'

export const tripId = 'iberian-summer'
export const tripName = 'Iberian Summer: Lisbon to Paris'
const timestamp = '2026-08-22T08:00:00Z'
const author = { id: 'demo-author', first_name: 'Alex', last_name: 'Rivera', username: 'alex', profile_picture: null }
const timezones = { PT: 'Europe/Lisbon', ES: 'Europe/Madrid', FR: 'Europe/Paris' }

const stops = [
  location('lisbon', 'Lisbon', 'PT', -9.1393, 38.7223),
  location('porto', 'Porto', 'PT', -8.6291, 41.1579),
  location('madrid', 'Madrid', 'ES', -3.7038, 40.4168),
  location('barcelona', 'Barcelona', 'ES', 2.1734, 41.3851),
  location('paris', 'Paris', 'FR', 2.3522, 48.8566),
]

function location(id: string, name: string, countryCode: keyof typeof timezones, longitude: number, latitude: number) {
  return { id, name, full_name: name, country_code: countryCode, longitude, latitude, region: '', timezone: timezones[countryCode] }
}

// Approximate the journey with waypoints through the cities along each leg.
const waypoints: [number, number][][] = [
  [[-9.1393, 38.7223], [-8.708, 39.24], [-8.81, 39.74], [-8.43, 40.21], [-8.64, 40.64], [-8.6291, 41.1579]],
  [[-8.6291, 41.1579], [-7.74, 41.31], [-6.75, 41.81], [-5.74, 41.5], [-4.69, 41.65], [-4.13, 40.95], [-3.7038, 40.4168]],
  [[-3.7038, 40.4168], [-3.17, 40.63], [-1.64, 41.35], [-0.88, 41.65], [0.62, 41.62], [1.25, 41.2], [2.1734, 41.3851]],
  [[2.1734, 41.3851], [2.82, 41.98], [2.9, 42.7], [3, 43.18], [1.43, 43.61], [1.45, 44.45], [1.25, 45.85], [2.04, 47.08], [2.3522, 48.8566]],
]
const geometries = waypoints.map((coordinates) => ({ type: 'LineString' as const, coordinates }))

const overview: RouteOverview = {
  trip_id: tripId,
  stops: stops.map((place, index) => ({ id: place.id, location: place, title: place.name, visited: index < 3 })),
  connections: geometries.map((geometry, index) => {
    const from = stops[index]
    const to = stops[index + 1]
    return {
      id: `${from.id}-${to.id}`,
      from: { type: 'STOP', stop_id: from.id },
      to: { type: 'STOP', stop_id: to.id },
      route: { type: 'SIMPLE', geometry },
      segments: [{ intent: { travel_mode: 'CAR' }, from_endpoint: from, to_endpoint: to, geometry, route_state: 'READY' }],
    }
  }),
}

// These photographs also appear in backend/scripts/seed_demo_trip.py.
function media(id: string, photo: string, caption: string) {
  const url = `https://images.unsplash.com/photo-${photo}?auto=format&fit=crop&w=1000&q=85`
  return {
    id, media_type: 'IMAGE' as const, status: 'READY' as const, technical_info: null,
    metadata: { caption, created_at: timestamp, updated_at: timestamp },
    urls: { content: url, thumbnail: url },
  }
}

const stories = [
  {
    title: 'Golden hour in Alfama', occurred: '2026-08-16T18:40:00Z',
    body: 'Our first evening in Lisbon. We followed the tram tracks uphill, then watched the light move across the rooftops and down to the Tagus.',
    photos: [
      media('alfama', '1536663815808-535e2280d2c2', 'Alfama rooftops above the Tagus'),
      media('lisbon-tram', '1585208798174-6cedd86e019a', 'Tram 28 passing through Baixa'),
    ],
  },
  {
    title: 'An evening by the Douro', occurred: '2026-08-18T19:15:00Z',
    body: 'We crossed the bridge on foot and found a spot on the riverbank to watch the lights come on in Ribeira.',
    photos: [media('douro', '1513735492246-483525079686', 'Sunset on the Douro in Porto')],
  },
  {
    title: 'Madrid after dark', occurred: '2026-08-20T20:45:00Z',
    body: 'We took the long way back after dinner, along Gran Vía and past the lit-up theatres.',
    photos: [media('gran-via', '1543783207-ec64e4d95325', 'The lights of Gran Vía in Madrid')],
  },
]

const timeline: PostTimeline = {
  opening_route: null,
  entries: stories.map(({ title, occurred, body, photos }, index) => ({
    post: {
      id: `post-${stops[index].id}`, trip_id: tripId, author, title, body, location: stops[index],
      created_at: occurred, occurred_at: occurred, published_at: occurred, updated_at: occurred,
      occurred_timezone: stops[index].timezone, revision: 1,
      media: photos, bubble_media_id: photos[0].id,
      social: { can_interact: false, can_like: false, comment_count: 0, like_count: 0, viewer_has_liked: false },
    },
    route_after: index < stories.length - 1 ? {
      duration_seconds: index === 0 ? 11_400 : 20_100,
      segments: [{
        geometry: geometries[index], travel_mode: 'CAR',
        source: 'MOBILE_GPS', visible_to_members_only: false,
      }],
    } : null,
  })),
}

const itinerary: Itinerary = {
  trip_id: tripId,
  itinerary_revision: 1,
  stops: overview.stops.map((stop, index) => ({
    ...stop, original_location: stop.location, created_by: author,
    created_at: timestamp, updated_at: timestamp, trip_id: tripId,
    notes: '', notes_updated_at: null, stays: [], planned_nights: 2,
    planned_start_date: `2026-08-${16 + index * 2}`,
  })),
  connections: overview.connections.map((connection) => ({
    ...connection, connection_type: 'BETWEEN_STOPS', trip_id: tripId,
    created_at: timestamp, updated_at: timestamp, notes: '', warnings: [],
    duration_seconds: null, duration_scope: null,
    route: { ...connection.route, duration_seconds: null, distance_meters: null },
    segments: connection.segments.map((segment) => ({
      ...segment, id: `${connection.id}-drive`, input_version: 1, mode_source: 'USER',
      intent: { ...segment.intent, notes: '', mode_selected: true, route_option: 0 },
    })),
  })),
}

export async function loadDemoTrip(page: Page, planning = false) {
  const tripPath = `/api/v1/trips/${tripId}`
  const responses = new Map<string, unknown>([
    ['/api/v1/admin/setup', { setup_required: false }],
    ['/api/v1/settings/public', { settings: {}, updated_at: timestamp }],
    ['/api/v1/users/me', { id: author.id, profile: author, role: 'USER', permissions: ['trip:create'], password_change_required: false }],
    [tripPath, {
      id: tripId, name: tripName, visibility: 'PUBLIC', cover_media: null,
      description: 'From the Tagus to the Seine, with two nights in every city.',
      start_date: '2026-08-16', end_date: '2026-08-26',
    } satisfies Trip],
    [`${tripPath}/itinerary/overview`, overview],
    [`${tripPath}/itinerary`, itinerary],
    [`${tripPath}/viewers`, []],
    [`${tripPath}/share-links`, []],
    [`${tripPath}/posts/timeline`, timeline],
    [`${tripPath}/members`, [{ role: 'OWNER', user: author, user_id: author.id, trip_id: tripId }] satisfies TripMember[]],
  ])

  // Every API request stays in the fixture, including any new endpoint the UI calls.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const path = new URL(route.request().url()).pathname
    return responses.has(path)
      ? route.fulfill({ json: responses.get(path) })
      : route.fulfill({ status: 404, json: { detail: `No preview data for ${path}` } })
  })
  await page.clock.install({ time: new Date(timestamp) })
  if (planning) {
    const payload = Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')
    await seedAuthTokens(page, { access_token: `demo.${payload}.signature`, id_token: 'demo', refresh_token: 'demo', token_type: 'bearer' })
  }
  await page.goto(`/trips/${tripId}?tab=${planning ? 'plan' : 'travel'}`)
}
