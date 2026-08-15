import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

loadRootEnvFile()

const apiBaseUrl = (
  process.env.E2E_API_BASE_URL ??
  process.env.VITE_API_BASE_URL ??
  'http://127.0.0.1:8000'
).replace(/\/$/, '')

const email = process.env.E2E_LOGIN_EMAIL
const password = process.env.E2E_LOGIN_PASSWORD
const shouldEndSession = process.argv.includes('--end-session')

if (!email || !password) {
  throw new Error(
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD in the root .env file before seeding debug data.',
  )
}

const accessToken = await login(email, password)
const trip = await createTrip(accessToken)
await enableLiveSharing(accessToken, trip.id)
const startedAt = addMinutes(new Date(), -24)
const sessionId = await startTracking(accessToken, trip.id, startedAt)
const beforePostCount = await uploadSamples(accessToken, trip.id, sessionId, [
  [52.3676, 4.9041, -20, 'WALK'],
  [52.3687, 4.9018, -16, 'WALK'],
  [52.3701, 4.8995, -12, 'WALK'],
])
const post = await createPost(accessToken, trip.id, addMinutes(new Date(), -9))
const afterPostCount = await uploadSamples(accessToken, trip.id, sessionId, [
  [52.3714, 4.8972, -7, 'BIKE'],
  [52.3731, 4.8938, -3, 'BIKE'],
  [52.3742, 4.8915, -1, 'BIKE'],
])
if (shouldEndSession) {
  await endTracking(accessToken, trip.id, sessionId)
}
const routeEndpoint = await verifyPostRouteState(accessToken, trip.id, post.id)

console.log(`Created ${shouldEndSession ? 'closed' : 'live'} post-route debug data:`)
console.log(`Trip: ${trip.name}`)
console.log(`Trip ID: ${trip.id}`)
console.log(`${shouldEndSession ? 'Closed' : 'Open'} GPS session: ${sessionId}`)
console.log(`GPS samples before post: ${beforePostCount}`)
console.log(`Post: ${post.title}`)
console.log(`GPS samples after post: ${afterPostCount}`)
console.log(
  `${shouldEndSession ? 'Last-seen' : 'Live'} route endpoint: ${routeEndpoint.latitude.toFixed(5)}, ${routeEndpoint.longitude.toFixed(5)}`,
)
console.log(`Open it at: http://localhost:5173/trips/${trip.id}`)

async function login(username, loginPassword) {
  const response = await fetch(`${apiBaseUrl}/api/v1/login/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: loginPassword }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.access_token) {
    throw new Error(`Login failed: ${formatApiError(payload, response.status)}`)
  }
  return payload.access_token
}

async function createTrip(accessToken) {
  const media = await uploadCoverImage(accessToken)
  const now = new Date()
  return requestJson('/api/v1/trips', accessToken, {
    method: 'POST',
    body: {
      name: `Live post route debug ${timestampForName(now)}`,
      description:
        'Debug data with one open GPS session: samples before a post and a live route after it.',
      media_id: media.id,
      visibility: 'PRIVATE',
      start_date: calendarDate(now),
      end_date: calendarDate(addDays(now, 1)),
    },
  })
}

async function uploadCoverImage(accessToken) {
  const form = new FormData()
  form.append(
    'file',
    new Blob([tinyPngBuffer()], { type: 'image/png' }),
    'live-post-route-debug-cover.png',
  )
  const response = await fetch(`${apiBaseUrl}/api/v1/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  const payload = await response.json()
  if (!response.ok || !payload.id) {
    throw new Error(
      `Cover image upload failed: ${formatApiError(payload, response.status)}`,
    )
  }
  return payload
}

async function enableLiveSharing(accessToken, tripId) {
  const settings = await requestJson(
    `/api/v1/trips/${tripId}/live-location-settings`,
    accessToken,
    { method: 'PUT', body: { share_live_location: true } },
  )
  if (!settings.share_live_location) {
    throw new Error('The API did not enable live location sharing.')
  }
}

async function startTracking(accessToken, tripId, startedAt) {
  const sessionId = randomUUID()
  await requestJson(
    `/api/v1/trips/${tripId}/tracking/sessions/${sessionId}`,
    accessToken,
    {
      method: 'POST',
      body: { started_at: startedAt.toISOString() },
    },
  )
  return sessionId
}

async function endTracking(accessToken, tripId, sessionId) {
  await requestJson(
    `/api/v1/trips/${tripId}/tracking/sessions/${sessionId}`,
    accessToken,
    {
      method: 'PATCH',
      body: {
        ended_at: new Date().toISOString(),
      },
    },
  )
}

async function uploadSamples(accessToken, tripId, sessionId, points) {
  const result = await requestJson(
    `/api/v1/trips/${tripId}/tracking/sessions/${sessionId}/samples/batch`,
    accessToken,
    {
      method: 'POST',
      body: {
        samples: points.map(([latitude, longitude, minutesAgo, travelMode]) => ({
          id: randomUUID(),
          recorded_at: addMinutes(new Date(), minutesAgo).toISOString(),
          latitude,
          longitude,
          accuracy_meters: 8,
          travel_mode: travelMode,
        })),
      },
    },
  )
  return result.accepted_samples
}

async function createPost(accessToken, tripId, occurredAt) {
  return requestJson(`/api/v1/trips/${tripId}/posts`, accessToken, {
    method: 'POST',
    body: {
      title: 'Coffee break in Amsterdam',
      body: 'Paused the GPS track for a quick coffee, then continued cycling.',
      location: { latitude: 52.3708, longitude: 4.8984 },
      occurred_at: occurredAt.toISOString(),
      publish: true,
    },
  })
}

async function verifyPostRouteState(accessToken, tripId, postId) {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/trips/${tripId}/posts/timeline?status=all`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const payload = await response.json()
  const route = payload.entries?.find((entry) => entry.post.id === postId)?.route_after
  const segment = route?.segments[route.segments.length - 1]
  const coordinates = segment?.geometry.coordinates[segment.geometry.coordinates.length - 1]
  if (!response.ok || !route || !coordinates) {
    throw new Error(
      `The post did not receive the expected route state: ${formatApiError(payload, response.status)}`,
    )
  }
  return { latitude: coordinates[1], longitude: coordinates[0] }
}

async function requestJson(pathname, accessToken, { method, body }) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(
      `${method} ${pathname} failed: ${formatApiError(payload, response.status)}`,
    )
  }
  return payload
}

function addDays(value, days) {
  const result = new Date(value)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function addMinutes(value, minutes) {
  const result = new Date(value)
  result.setUTCMinutes(result.getUTCMinutes() + minutes)
  return result
}

function calendarDate(value) {
  return value.toISOString().slice(0, 10)
}

function timestampForName(value) {
  return value.toISOString().replace(/[:.]/g, '-').replace('T', ' ').replace('Z', '')
}

function formatApiError(payload, status) {
  return typeof payload?.detail === 'string' ? payload.detail : `HTTP ${status}`
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  )
}

function loadRootEnvFile() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
  const envPath = path.resolve(scriptDirectory, '..', '..', '.env')
  if (!fs.existsSync(envPath)) {
    return
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue
    }
    const assignment = trimmedLine.startsWith('export ')
      ? trimmedLine.slice('export '.length)
      : trimmedLine
    const equalsIndex = assignment.indexOf('=')
    if (equalsIndex === -1) {
      continue
    }
    const key = assignment.slice(0, equalsIndex).trim()
    const rawValue = assignment.slice(equalsIndex + 1).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) {
      continue
    }
    process.env[key] = parseEnvValue(rawValue)
  }
}

function parseEnvValue(value) {
  const quote = value[0]
  return quote && (quote === '"' || quote === "'") && value.endsWith(quote)
    ? value.slice(1, -1)
    : value
}
