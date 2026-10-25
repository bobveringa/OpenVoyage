import { expect, test } from '@playwright/test'
import { env } from 'node:process'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

// Optional local verification target; other accounts need not contain this trip.
const tripId = env.E2E_FLIGHT_TRIP_ID ?? ''
const artifacts = path.resolve('..', 'private', 'artifacts', 'flight-tracking')

async function signIn(page: import('@playwright/test').Page) {
  test.skip(!tripId || !env.E2E_LOGIN_EMAIL || !env.E2E_LOGIN_PASSWORD, 'Set E2E_FLIGHT_TRIP_ID and local E2E credentials to verify an existing trip')
  await page.goto('/login')
  await page.getByLabel('Email').fill(env.E2E_LOGIN_EMAIL!)
  await page.getByLabel('Password').fill(env.E2E_LOGIN_PASSWORD!)
  const login = page.waitForResponse((response) => response.url().includes('/api/v1/login/access-token'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await login).ok()).toBe(true)
  await expect(page).not.toHaveURL(/\/login/)
}

test('checks the requested local trip after signing in', async ({ page }) => {
  await signIn(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const timeline = page.waitForResponse((response) => response.url().includes(`/trips/${tripId}/posts/timeline`))
  const journey = page.waitForResponse((response) => response.url().includes(`/trips/${tripId}/tracking/journey`))
  await page.goto(`/trips/${tripId}?tab=travel`)
  const timelineResponse = await timeline
  expect(timelineResponse.ok()).toBe(true)
  const timelineData = await timelineResponse.json()
  const journeyResponse = await journey
  expect(journeyResponse.ok()).toBe(true)
  const journeyData = await journeyResponse.json()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByLabel('Interactive trip route map').first()).toBeVisible()
  for (const journey of timelineData.flight_journeys ?? []) {
    for (const flight of journey.flights) {
      await expect(page.getByRole('article', { name: new RegExp(`^${flight.flight_number} ·`) }).last()).toBeVisible()
    }
  }
  if (journeyData.current_connection_id && journeyData.current_flight_segment_index == null) {
    await expect(page.locator(`path[data-itinerary-connection-id="${journeyData.current_connection_id}"]`)).toHaveCount(0)
  }
  expect(errors).toEqual([])
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: path.join(artifacts, 'local-trip-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByLabel('Interactive trip route map').last()).toBeVisible()
  await page.screenshot({ path: path.join(artifacts, 'local-trip-mobile.png') })
})

test('approved cards show real contract data, estimated progress, connections, and editable owner completion', async ({ page }) => {
  await signIn(page)
  const now = Date.now()
  const iso = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  const airport = (name: string, iata_code: string, latitude: number, longitude: number, timezone: string) => ({ id: crypto.randomUUID(), name, iata_code, latitude, longitude, timezone })
  const departure = airport('Sydney', 'SYD', -33.95, 151.18, 'Australia/Sydney')
  const arrival = airport('Melbourne', 'MEL', -37.67, 144.84, 'Australia/Melbourne')
  const flight = {
    id: crypto.randomUUID(), flight_number: 'QF4826', airline_name: 'Example airline',
    departure_airport: departure, arrival_airport: arrival, status: 'IN_FLIGHT',
    scheduled_departure: iso(-75), estimated_departure: iso(-60), actual_departure: iso(-60),
    scheduled_arrival: iso(45), estimated_arrival: iso(60), actual_arrival: null,
    completion_source: null, stop_reason: null, progress: .5, estimate_basis: 'PROVIDER_TIMES',
    position_at: iso(0), status_updated_at: iso(-10), update_state: 'CURRENT',
    visible_to_members_only: true, can_complete: true, gps_tracking_session_id: crypto.randomUUID(),
  }
  let completed = false
  let completionBody: { estimated_arrival?: string } = {}
  await page.route(`**/api/v1/trips/${tripId}/posts/timeline*`, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.flight_journeys = [{ itinerary_connection_id: crypto.randomUUID(), flights: [
      completed ? { ...flight, status: 'ARRIVED', progress: 1, completion_source: 'OWNER', can_complete: false, position_at: null } : flight,
      { ...flight, id: crypto.randomUUID(), flight_number: 'QF5938', scheduled_departure: iso(180), actual_departure: null, estimated_departure: iso(180), scheduled_arrival: iso(300), estimated_arrival: iso(300), progress: null, position_at: null, status: 'DELAYED', can_complete: false },
    ] }]
    await route.fulfill({ response, json: body })
  })
  await page.route(`**/api/v1/trips/${tripId}/tracking/flights/*/complete`, async (route) => {
    completionBody = route.request().postDataJSON()
    completed = true
    await route.fulfill({ json: { flight_id: flight.id, completion_source: 'OWNER', session: { id: flight.gps_tracking_session_id, started_at: flight.actual_departure, ended_at: completionBody.estimated_arrival, recorded_by_user_id: null, sample_count: 65, source: 'FLIGHT_ESTIMATE' } } })
  })
  await page.goto(`/trips/${tripId}?tab=travel`)
  const card = page.getByRole('article', { name: 'QF4826 · In flight' }).last()
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  await expect(card.getByText('Members only · Live sharing is off')).toBeVisible()
  await expect(card.getByText(/Provider updated/)).toBeVisible()
  await expect(page.getByText(/Connecting flight/).last()).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: path.join(artifacts, 'flight-cards-desktop.png') })
  await card.getByRole('button', { name: 'Finish flight', exact: true }).click()
  const input = card.getByLabel('Estimated arrival', { exact: true })
  expect(Math.abs(new Date(await input.inputValue()).getTime() - Date.now())).toBeLessThan(120_000)
  const adjusted = new Date(now - 15 * 60_000)
  const value = new Date(adjusted.getTime() - adjusted.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  await input.fill(value)
  await card.getByRole('button', { name: 'Save arrival', exact: true }).click()
  await expect(page.getByText('Completion confirmed by owner · Estimated arrival').last()).toBeVisible()
  expect(completionBody.estimated_arrival).toBe(new Date(value).toISOString())
  await page.setViewportSize({ width: 390, height: 844 })
  const mobileFlight = page.getByRole('article', { name: 'QF4826 · Arrived' }).first()
  await mobileFlight.getByRole('button', { name: 'Show flight details for QF4826', exact: true }).click()
  await mobileFlight.scrollIntoViewIfNeeded()
  await expect(mobileFlight).toBeInViewport()
  await page.screenshot({ path: path.join(artifacts, 'flight-cards-mobile.png') })
})
