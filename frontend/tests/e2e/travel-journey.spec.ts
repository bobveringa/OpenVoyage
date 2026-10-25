import { expect, test } from '@playwright/test'

test('both flights and the final drive preserve all later travel in its future color', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/travel-journey.html')
  const leg = (index: number) => page.locator(`path[data-itinerary-connection-id="to-lisbon"][data-itinerary-segment-index="${index}"]`)
  const porto = page.locator('path[data-itinerary-connection-id="to-porto"]')
  await expect(porto).toHaveCount(1)
  const green = (await porto.getAttribute('stroke'))!
  const guidance = page.locator('path.trip-map-journey-guidance')
  const cases = [
    { stage: 'Before departure', visible: [1, 2, 3], guidance: 1 },
    { stage: 'AMS-FRA', visible: [2, 3], guidance: 1 },
    { stage: 'Frankfurt layover', visible: [2, 3], guidance: 0 },
    { stage: 'FRA-LIS', visible: [3], guidance: 1 },
    { stage: 'Lisbon ground', visible: [], guidance: 1 },
  ]
  for (const step of cases) {
    await page.getByRole('button', { name: step.stage, exact: true }).click()
    for (let index = 0; index < 4; index++) {
      await expect(leg(index)).toHaveCount(step.visible.includes(index) ? 1 : 0)
      if (step.visible.includes(index)) await expect(leg(index)).toHaveAttribute('stroke', green)
    }
    await expect(porto).toHaveAttribute('stroke', green)
    await expect(guidance).toHaveCount(step.guidance)
    if (step.guidance) {
      await expect(guidance).toHaveAttribute('stroke-dasharray', '7 9')
      expect(await guidance.getAttribute('stroke')).not.toBe(green)
    }
    await expect(page.locator('path.trip-map-traveled-route').first()).toBeAttached()
    await expect(page.getByLabel('Observed flight position')).toHaveCount(step.stage === 'AMS-FRA' || step.stage === 'FRA-LIS' ? 1 : 0)
  }
  await page.getByRole('button', { name: 'Toggle Plan', exact: true }).click()
  for (let index = 0; index < 4; index++) await expect(leg(index)).toHaveCount(1)
  await expect(guidance).toHaveCount(0)
})

test('Sevilla stay and tomorrow’s trip keep the complete future journey visible', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/travel-journey.html')
  for (const stage of ['Staying in Sevilla', 'Before trip starts']) {
    await page.getByRole('button', { name: stage, exact: true }).click()
    const future = page.locator('path[data-itinerary-connection-id="to-porto"]')
    const green = (await future.getAttribute('stroke'))!
    const planned = page.locator('path[data-itinerary-connection-id="to-lisbon"]')
    await expect(planned).toHaveCount(4)
    for (const path of await planned.all()) await expect(path).toHaveAttribute('stroke', green)
    await expect(page.locator('path.trip-map-journey-guidance')).toHaveCount(stage === 'Staying in Sevilla' ? 1 : 0)
    await expect(page.getByLabel('Observed flight position')).toHaveCount(0)
  }
})

test('direct fallback and every ground mode replace only the current connection', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/travel-journey.html')
  for (const stage of ['No flight tracking', ...['CAR', 'BIKE', 'WALK', 'BUS', 'TRAIN', 'FERRY', 'MOTORCYCLE', 'OTHER', 'UNKNOWN'].map((mode) => `Ground ${mode}`)]) {
    await page.getByRole('button', { name: stage, exact: true }).click()
    await expect(page.locator('path[data-itinerary-connection-id="to-lisbon"]')).toHaveCount(0)
    await expect(page.locator('path[data-itinerary-connection-id="to-porto"]')).toHaveCount(1)
    await expect(page.locator('path.trip-map-journey-guidance')).toHaveCount(1)
    await expect(page.locator('path.trip-map-traveled-route').first()).toBeAttached()
  }
})

test('unknown positions and missing calculations preserve the known future steps', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/travel-journey.html')
  await page.getByRole('button', { name: 'Unknown position', exact: true }).click()
  await expect(page.locator('path.trip-map-journey-guidance')).toHaveCount(0)
  await expect(page.locator('path[data-itinerary-connection-id="to-lisbon"]')).toHaveCount(3)
  await expect(page.locator('path[data-itinerary-connection-id="to-porto"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Missing future road', exact: true }).click()
  await expect(page.locator('path[data-itinerary-connection-id="to-porto"]')).toHaveCount(0)
  await expect(page.locator('path[data-itinerary-connection-id="to-lisbon"]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Missing flight endpoint', exact: true }).click()
  await expect(page.locator('path[data-itinerary-connection-id="to-lisbon"][data-itinerary-segment-index="2"]')).toHaveCount(0)
  await expect(page.locator('path[data-itinerary-connection-id="to-lisbon"][data-itinerary-segment-index="3"]')).toHaveCount(1)
  await expect(page.locator('path[data-itinerary-connection-id="to-porto"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Unknown departure', exact: true }).click()
  await expect(page.locator('path[data-itinerary-connection-id="to-lisbon"]')).toHaveCount(3)
  await expect(page.locator('path[data-itinerary-connection-id="to-porto"]')).toHaveCount(1)
})
