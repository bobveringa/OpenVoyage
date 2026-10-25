import { expect, test } from '@playwright/test'

test('observed flight uses a stationary dot, a solid retained path and dashed remaining route', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/flight-guidance.html')
  await page.getByRole('button', { name: 'Observed flight', exact: true }).click()
  const marker = page.getByLabel('Observed flight position')
  await expect(marker).toBeAttached()
  await expect(marker).toHaveClass(/trip-map-flight-position/)
  const path = await marker.getAttribute('d')
  await expect(page.locator('path.trip-map-traveled-route').first()).not.toHaveAttribute('stroke-dasharray')
  await expect(page.locator('path.trip-map-journey-guidance').first()).toHaveAttribute('stroke-dasharray', '7 9')
  await page.clock.install()
  await page.clock.fastForward('05:00')
  await expect(marker).toHaveAttribute('d', path!)
  await expect(page.getByLabel('Estimated flight position')).toHaveCount(0)
})

test('current travel guidance replaces legs in order and preserves arrival transfers until landing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/tests/e2e/fixtures/flight-guidance.html')
  const current = page.locator('path[data-itinerary-connection-id="current"]')
  const future = page.locator('path[data-itinerary-connection-id="future"]')
  const guidance = page.locator('path.trip-map-journey-guidance')
  await expect(page.getByLabel('Interactive trip route map')).toBeVisible()
  await expect(page.locator('path.trip-map-traveled-route').first()).toBeAttached()
  await expect(current.first()).toBeAttached()
  const flight = page.locator('path[data-itinerary-connection-id="current"][data-itinerary-segment-index="0"]')
  const departureTransfer = page.locator('path[aria-label="Airport transfer: Eindhoven → Eindhoven Airport"]')
  const arrivalTransfer = page.locator('path[aria-label="Airport transfer: Stansted Airport → London"]')
  await expect(departureTransfer).toHaveCount(0)
  await expect(arrivalTransfer.first()).toBeAttached()
  await expect(future.first()).toBeAttached()
  await expect(guidance).toHaveCount(0)

  for (const stage of ['Ground guidance', 'In flight', 'Between flights', 'Arrived']) {
    await page.getByRole('button', { name: stage, exact: true }).click()
    await expect(departureTransfer).toHaveCount(0)
    if (stage === 'Arrived') await expect(current).toHaveCount(0)
    else await expect(arrivalTransfer.first()).toBeAttached()
    if (stage === 'In flight') await expect(flight).toHaveCount(0)
    if (stage === 'Ground guidance') await expect(flight.first()).toBeAttached()
    await expect(future.first()).toBeAttached()
    await expect(guidance.first()).toBeAttached()
    await expect(page.locator('path.trip-map-traveled-route').first()).toBeAttached()
    if (stage === 'In flight') await expect(page.getByLabel('Estimated flight position').first()).toBeAttached()
    else await expect(page.getByLabel('Estimated flight position')).toHaveCount(0)
  }

  await page.getByRole('button', { name: 'Toggle Plan' }).click()
  await expect(current.first()).toBeAttached()
  await expect(page.locator('path.trip-map-airport-transfer').first()).toBeAttached()
  await expect(guidance).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle Plan' }).click()
  await expect(current).toHaveCount(0)

  await page.getByRole('button', { name: 'Ground only', exact: true }).click()
  await expect(current).toHaveCount(0)
  await expect(guidance.first()).toBeAttached()

  for (const stage of ['Hidden journey', 'Unavailable journey']) {
    await page.getByRole('button', { name: stage, exact: true }).click()
    await expect(guidance).toHaveCount(0)
    await expect(current.first()).toBeAttached()
    await expect(future.first()).toBeAttached()
  }
  expect(errors).toEqual([])
})

test('a saved airport-to-hotel road route stays planned until landing', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/flight-guidance.html')
  await page.getByRole('button', { name: 'Toggle saved arrival transfer', exact: true }).click()
  const road = page.locator('path[data-itinerary-connection-id="current"][data-itinerary-segment-index="1"]')
  for (const stage of ['Ground guidance', 'In flight']) {
    await page.getByRole('button', { name: stage, exact: true }).click()
    await expect(road.first()).toBeAttached()
    await expect(road.first()).not.toHaveAttribute('stroke-dasharray')
  }
  await page.getByRole('button', { name: 'Arrived', exact: true }).click()
  await expect(road).toHaveCount(0)
  await expect(page.locator('path.trip-map-journey-guidance').first()).toBeAttached()
  await expect(page.locator('path.trip-map-traveled-route').first()).toBeAttached()
  await page.getByRole('button', { name: 'Toggle Plan', exact: true }).click()
  await expect(road.first()).toBeAttached()
})

test('arrival transfers remain visible when Travel filters out the visited departure stop', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/flight-guidance.html')
  await page.getByRole('button', { name: 'Hide visited departure stop', exact: true }).click()
  const arrival = page.locator('path[aria-label="Airport transfer: Stansted Airport → London"]')
  for (const stage of ['Ground guidance', 'In flight']) {
    await page.getByRole('button', { name: stage, exact: true }).click()
    await expect(arrival.first()).toBeAttached()
  }
  await page.getByRole('button', { name: 'Arrived', exact: true }).click()
  await expect(arrival).toHaveCount(0)
  await expect(page.locator('path.trip-map-traveled-route').first()).toBeAttached()
})
