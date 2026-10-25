import { expect, test } from '@playwright/test'

test('observed card shows observation age while progress stays estimated', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/flight-cards.html')
  await page.getByRole('button', { name: 'Toggle observed position' }).click()
  await expect(page.getByText(/Observed \d+ min ago · Position at/)).toBeVisible()
  await expect(page.getByText('Estimated position at', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
})

for (const width of [390, 1280]) {
  test(`in-flight cards retain departure and arrival delays at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tests/e2e/fixtures/flight-cards.html')
    const card = page.getByRole('article', { name: 'FR5682 · In flight', exact: true })
    await expect(card.getByText('In flight · Delayed', { exact: true })).toBeVisible()
    await expect(card.getByText('Departed 45 min late', { exact: true })).toBeVisible()
    await expect(card.getByText('Arrival estimated 30 min late', { exact: true })).toBeVisible()
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    await expect(card.locator('del')).toHaveCount(2)
    await expect(card.getByText('Awaiting departure', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle on-time arrival' }).click()
    await expect(card.getByText('In flight · On time', { exact: true })).toBeVisible()
    await expect(card.getByText('In flight · Delayed', { exact: true })).toHaveCount(0)
    await expect(card.getByText('Departed 45 min late', { exact: true })).toBeVisible()
    await expect(card.getByText('Arrival estimated on time', { exact: true })).toBeVisible()
    await expect(card.getByText(/Arrival estimated .* min late/)).toHaveCount(0)
    await expect(card.locator('del')).toHaveCount(1)
  })

  for (const compact of [false, true]) {
    test(`early estimated arrival recovers a late departure at ${width}px, compact=${compact}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/tests/e2e/fixtures/flight-cards.html')
      if (compact) await page.getByRole('button', { name: 'Toggle compact card' }).click()
      await page.getByRole('button', { name: 'early', exact: true }).click()
      const card = page.getByRole('article', { name: 'FR5682 · In flight', exact: true })
      await expect(card.getByText('In flight · Early', { exact: true })).toBeVisible()
      await expect(card.getByText('Arrival estimated 10 min early', { exact: true })).toBeVisible()
      await expect(card.getByText('Departed 45 min late', { exact: true })).toBeVisible()
      await expect(card).not.toHaveClass(/border-amber/)
      await expect(card.getByLabel('Scheduled arrival 20:00', { exact: true })).toHaveText('20:00')
      await expect(card.locator('time').filter({ hasText: /^19:50$/ })).toBeVisible()
      await expect(card.locator('del')).toHaveCount(2)
    })
  }

  test(`actual early arrival takes priority over a stale late estimate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/tests/e2e/fixtures/flight-cards.html')
    await page.getByRole('button', { name: 'arrived-early', exact: true }).click()
    const card = page.getByRole('article', { name: 'FR5682 · Arrived', exact: true })
    await expect(card.getByText('Arrived · Early', { exact: true })).toBeVisible()
    await expect(card.getByText('Arrived 10 min early', { exact: true })).toBeVisible()
    await expect(card.getByLabel('Scheduled arrival 20:00', { exact: true })).toHaveText('20:00')
    await expect(card.getByRole('progressbar')).toHaveCount(0)
    await expect(card).not.toHaveClass(/border-amber/)
  })
}

for (const scenario of ['unknown-estimate', 'unknown-schedule']) {
  test(`does not infer arrival timing from departure delay with ${scenario}`, async ({ page }) => {
    await page.goto('/tests/e2e/fixtures/flight-cards.html')
    await page.getByRole('button', { name: scenario, exact: true }).click()
    const card = page.getByRole('article', { name: 'FR5682 · In flight', exact: true })
    await expect(card.getByText('In flight', { exact: true }).first()).toBeVisible()
    await expect(card.getByText('Departed 45 min late', { exact: true })).toBeVisible()
    await expect(card.getByText(/Arrival estimated .*min (late|early)|Arrival estimated on time/)).toHaveCount(0)
    await expect(card.getByLabel('Scheduled arrival 20:00', { exact: true })).toHaveCount(0)
    await expect(card).not.toHaveClass(/border-amber/)
  })
}

test('still highlights a departure delay before takeoff, including status-only delays', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/flight-cards.html')
  await page.getByRole('button', { name: 'awaiting-departure', exact: true }).click()
  const card = page.getByRole('article', { name: 'FR5682 · Delayed', exact: true })
  await expect(card).toHaveClass(/border-amber/)
  await expect(card.getByText('Departure delayed 45 min behind schedule', { exact: true })).toBeVisible()
  await expect(card.getByText('Awaiting departure', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'status-delay', exact: true }).click()
  await expect(card).toHaveClass(/border-amber/)
  await expect(card.getByText('Flight delayed', { exact: true })).toBeVisible()
})

test('a stale delayed status cannot override confirmed departure and an early arrival estimate', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/flight-cards.html')
  await page.getByRole('button', { name: 'stale-delay', exact: true }).click()
  const card = page.getByRole('article', { name: 'FR5682 · In flight', exact: true })
  await expect(card.getByText('In flight · Early', { exact: true })).toBeVisible()
  await expect(card).not.toHaveClass(/border-amber/)
})

for (const [scenario, status] of [['cancelled', 'Cancelled'], ['diverted', 'Diverted']]) {
  test(`preserves ${status} status instead of showing an early arrival badge`, async ({ page }) => {
    await page.goto('/tests/e2e/fixtures/flight-cards.html')
    await page.getByRole('button', { name: scenario, exact: true }).click()
    const card = page.getByRole('article', { name: `FR5682 · ${status}`, exact: true })
    await expect(card.getByText(status, { exact: true }).first()).toBeVisible()
    await expect(card.getByText(/ · Early|Arrival estimated 10 min early/)).toHaveCount(0)
  })
}

test('also retains the scheduled departure when the plane leaves early', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/flight-cards.html')
  await page.getByRole('button', { name: 'early-departure', exact: true }).click()
  const card = page.getByRole('article', { name: 'FR5682 · In flight', exact: true })
  await expect(card.getByText('Departed 10 min early', { exact: true })).toBeVisible()
  await expect(card.getByLabel('Scheduled departure 20:00', { exact: true })).toHaveText('20:00')
  await expect(card.locator('del')).toHaveCount(2)
})
