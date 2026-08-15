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

if (!email || !password) {
  throw new Error(
    'Set E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD in the root .env file before seeding debug data.',
  )
}

const accessToken = await login(email, password)
const trip = await createTrip(accessToken)
await enableLiveSharing(accessToken, trip.id)
const tracking = await createOpenTrackingSession(accessToken, trip.id)
const liveRouteEndpoint = await getLiveRouteEndpoint(accessToken, trip.id)

console.log('Created live-location debug data:')
console.log(`Trip: ${trip.name}`)
console.log(`Trip ID: ${trip.id}`)
console.log('Live sharing: enabled')
console.log(`Open session: ${tracking.sessionId}`)
console.log(`GPS samples: ${tracking.acceptedSamples}`)
console.log(
  `Live route endpoint: ${liveRouteEndpoint.latitude.toFixed(5)}, ${liveRouteEndpoint.longitude.toFixed(5)}`,
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
      name: `Live location debug ${timestampForName(now)}`,
      description:
        'Debug data created by frontend/scripts/seed-live-location-debug-trip.mjs. Live sharing is enabled and the GPS session remains open.',
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
    'live-location-debug-cover.png',
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
    {
      method: 'PUT',
      body: { share_live_location: true },
    },
  )
  if (!settings.share_live_location) {
    throw new Error('The API did not enable live location sharing.')
  }
}

async function createOpenTrackingSession(accessToken, tripId) {
  const sessionId = randomUUID()
  const now = new Date()
  const startedAt = addMinutes(now, -10)
  const points = [
    [52.3676, 4.9041, 4],
    [52.3687, 4.9018, 2],
    [52.3701, 4.8995, 0.25],
  ]

  await requestJson(
    `/api/v1/trips/${tripId}/tracking/sessions/${sessionId}`,
    accessToken,
    {
      method: 'POST',
      body: { started_at: startedAt.toISOString() },
    },
  )

  const result = await requestJson(
    `/api/v1/trips/${tripId}/tracking/sessions/${sessionId}/samples/batch`,
    accessToken,
    {
      method: 'POST',
      body: {
        samples: points.map(([latitude, longitude, minutesAgo]) => ({
          id: randomUUID(),
          recorded_at: addMinutes(now, -minutesAgo).toISOString(),
          latitude,
          longitude,
          accuracy_meters: 8,
          travel_mode: 'WALK',
        })),
      },
    },
  )

  return { acceptedSamples: result.accepted_samples, sessionId }
}

async function getLiveRouteEndpoint(accessToken, tripId) {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/trips/${tripId}/posts/timeline?status=all`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const payload = await response.json()
  const route = payload.opening_route
  const segment = route?.segments.at(-1)
  const coordinates = segment?.geometry.coordinates.at(-1)
  if (!response.ok || !route || !coordinates) {
    throw new Error(
      `Live route endpoint is unavailable: ${formatApiError(payload, response.status)}`,
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
  if (typeof payload?.detail === 'string') {
    return payload.detail
  }
  return `HTTP ${status}`
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
  if (quote && (quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1)
  }
  return value
}
