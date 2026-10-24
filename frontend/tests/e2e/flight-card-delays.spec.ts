import { expect, test } from '@playwright/test'

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
    await expect(card.getByText('Departed 45 min late', { exact: true })).toBeVisible()
    await expect(card.getByText(/Arrival estimated .* min late/)).toHaveCount(0)
    await expect(card.locator('del')).toHaveCount(1)
  })
}
