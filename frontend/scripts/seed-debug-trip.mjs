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

const token = await login(email, password)
const trip = await createTrip(token)
const posts = await createPosts(token, trip.id)
const tracking = await createTrackingData(token, trip.id)

console.log('Created debug trip data:')
console.log(`Trip: ${trip.name}`)
console.log(`Trip ID: ${trip.id}`)
console.log(`Posts: ${posts.length}`)
console.log(`GPS samples: ${tracking.accepted_samples}`)
console.log(`Open it at: http://localhost:5173/trips/${trip.id}`)

async function login(username, loginPassword) {
  const body = new URLSearchParams({
    username,
    password: loginPassword,
  })
  const response = await fetch(`${apiBaseUrl}/api/v1/login/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
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
  const startDate = calendarDate(addDays(now, -6))
  const endDate = calendarDate(addDays(now, 1))
  const name = `Debug trip ${timestampForName(now)}`

  return requestJson('/api/v1/trips', accessToken, {
    method: 'POST',
    body: {
      name,
      description:
        'Debug data created by frontend/scripts/seed-debug-trip.mjs. It can be deleted from the trip settings.',
      media_id: media.id,
      visibility: 'PRIVATE',
      start_date: startDate,
      end_date: endDate,
    },
  })
}

async function uploadCoverImage(accessToken) {
  const form = new FormData()
  form.append(
    'file',
    new Blob([tinyPngBuffer()], { type: 'image/png' }),
    'debug-trip-cover.png',
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

async function createPosts(accessToken, tripId) {
  const startedAt = addDays(new Date(), -6)
  const posts = [
    {
      title: 'Arrived in Porto',
      body: 'Checked in, found a quiet café, and started exploring the riverfront.',
      latitude: 41.1496,
      longitude: -8.6109,
      offsetHours: 3,
    },
    {
      title: 'Along the Douro',
      body: 'A slow day following the river through vineyards and small villages.',
      latitude: 41.1632,
      longitude: -8.5964,
      offsetHours: 32,
    },
    {
      title: 'Sunset in Braga',
      body: 'Finished the day with a long walk through the old town at golden hour.',
      latitude: 41.5454,
      longitude: -8.4265,
      offsetHours: 70,
    },
  ]

  return Promise.all(
    posts.map((post) =>
      requestJson(`/api/v1/trips/${tripId}/posts`, accessToken, {
        method: 'POST',
        body: {
          title: post.title,
          body: post.body,
          location: {
            latitude: post.latitude,
            longitude: post.longitude,
          },
          occurred_at: addHours(startedAt, post.offsetHours).toISOString(),
          publish: true,
        },
      }),
    ),
  )
}

async function createTrackingData(accessToken, tripId) {
  const sessionId = randomUUID()
  const startedAt = addHours(addDays(new Date(), -6), 1)
  const points = [
    [41.1496, -8.6109],
    [41.1518, -8.6078],
    [41.1547, -8.6035],
    [41.1578, -8.5998],
    [41.1611, -8.5968],
    [41.1632, -8.5964],
    [41.1824, -8.5702],
    [41.2118, -8.5327],
    [41.2575, -8.4959],
    [41.3112, -8.4606],
    [41.3815, -8.4311],
    [41.4549, -8.4205],
    [41.5142, -8.4237],
    [41.5454, -8.4265],
  ]
  const endedAt = addMinutes(startedAt, (points.length - 1) * 20)

  await requestJson(
    `/api/v1/trips/${tripId}/tracking/sessions/${sessionId}`,
    accessToken,
    {
      method: 'POST',
      body: {
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
      },
    },
  )

  return requestJson(
    `/api/v1/trips/${tripId}/tracking/sessions/${sessionId}/samples/batch`,
    accessToken,
    {
      method: 'POST',
      body: {
        samples: points.map(([latitude, longitude], index) => ({
          id: randomUUID(),
          recorded_at: addMinutes(startedAt, index * 20).toISOString(),
          latitude,
          longitude,
          accuracy_meters: 8,
          travel_mode: index < 6 ? 'WALK' : 'CAR',
        })),
      },
    },
  )
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

function addHours(value, hours) {
  const result = new Date(value)
  result.setUTCHours(result.getUTCHours() + hours)
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
