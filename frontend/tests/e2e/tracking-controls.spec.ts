import { expect, test } from '@playwright/test'

for (const stopped of [false, true]) {
  test(`manual sync shows queue and Wi-Fi override ${stopped ? 'after stopping' : 'during recording'}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 844 })
    await page.route('**/api/v1/**', (route) => route.fulfill({
      json: route.request().url().endsWith('/sessions')
        ? { sessions: [] } : { share_live_location: false },
    }))
    await page.goto('/tests/e2e/fixtures/tracking-controls.html?active&wifi-only')
    if (stopped) await page.getByRole('button', { name: 'Stop tracking', exact: true }).click()
    await expect(page.getByText('12 points waiting to sync', { exact: true })).toBeVisible()
    await expect(page.getByText('Waiting to reconnect.', { exact: false })).toBeVisible()
    await expect(page.getByText('Manual sync can use mobile data.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sync now', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Syncing…', exact: true })).toBeDisabled()
    await expect(page.getByText('12 points waiting to sync', { exact: true })).toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new Event('test-sync-complete')))
    await expect(page.getByText('0 points waiting to sync', { exact: true })).toBeVisible()
    const sync = page.getByRole('button', { name: 'Sync now', exact: true })
    // A stopped session may still need its final end acknowledgement with an empty queue.
    if (stopped) await expect(sync).toBeEnabled()
    else await expect(sync).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('starting shows GPS acquisition and confirms the first saved fix offline', async ({ page }) => {
  await page.clock.install()
  await page.route('**/api/v1/**', (route) => route.fulfill({
    json: route.request().url().endsWith('/sessions')
      ? { sessions: [] } : { share_live_location: false },
  }))
  await page.goto('/tests/e2e/fixtures/tracking-controls.html')
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click()
  await expect(page.getByText('Getting your location…', { exact: true })).toBeVisible()
  // A slow first fix must not dismiss the acquisition message.
  await page.clock.runFor(10_000)
  await expect(page.getByText('Getting your location…', { exact: true })).toBeVisible()
  await expect(page.getByText('Tracking started · location found', { exact: true })).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('test-gps-fix')))
  const confirmation = page.getByText('Tracking started · location found', { exact: true })
  await expect(confirmation).toBeVisible()
  await expect(page.getByText('Getting your location…', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Waiting to reconnect.', { exact: false })).toBeVisible()
  await page.clock.runFor(6_000)
  await expect(confirmation).toHaveCount(0)
  // Later points must not restart the confirmation.
  await page.evaluate(() => window.dispatchEvent(new Event('test-gps-fix')))
  await expect(confirmation).toHaveCount(0)
  await page.getByRole('button', { name: 'Stop tracking', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
})

test('refreshing an existing recording skips startup feedback', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({
    json: route.request().url().endsWith('/sessions')
      ? { sessions: [] } : { share_live_location: false },
  }))
  await page.goto('/tests/e2e/fixtures/tracking-controls.html?active')
  await page.reload()
  await expect(page.getByText('RECORDING LIVE', { exact: true })).toBeVisible()
  await expect(page.getByText('Getting your location…', { exact: true })).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('test-gps-fix')))
  await expect(page.getByText('Tracking started · location found', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stop tracking', exact: true })).toBeVisible()
})

for (const width of [360, 1280]) {
  test(`recording controls keep stop and offline state clear at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/v1/**', async (route) => {
      await route.fulfill({
        json: route.request().url().endsWith('/sessions')
          ? { sessions: [] }
          : { share_live_location: false },
      })
    })
    await page.goto('/tests/e2e/fixtures/tracking-controls.html')
    await expect(
      page.getByRole('button', { name: 'Start tracking', exact: true }),
    ).toBeInViewport()
    await expect(
      page.getByRole('button', { name: 'Recording settings', exact: true }),
    ).toHaveCount(0)
    await page.evaluate(() =>
      window.history.replaceState(
        null,
        '',
        '/trips/trip?tab=travel&dialog=management&section=gps',
      ),
    )
    await page.getByRole('link', { name: 'GPS settings', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\?returnTo=.*#tracking$/)
    await page.getByRole('button', { name: 'Manual', exact: true }).click()
    await page.getByRole('button', { name: 'Recording interval' }).click()
    await page.getByRole('option', { name: '1 minute', exact: true }).click()
    await page
      .getByRole('button', { name: 'Save settings', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Settings saved' }),
    ).toBeVisible()
    const historyLength = await page.evaluate(() => window.history.length)
    await page
      .getByRole('button', { name: 'Back to tracking', exact: true })
      .click()
    await expect(page).toHaveURL(
      /\/trips\/trip\?tab=travel&dialog=management&section=gps$/,
    )
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength)
    await page
      .getByRole('button', { name: 'Start tracking', exact: true })
      .click()
    await expect(
      page.getByText('RECORDING LIVE', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Waiting to reconnect.', { exact: false }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Travel mode', exact: true }),
    ).toHaveCount(1)
    await page.getByRole('button', { name: 'Travel mode', exact: true }).click()
    await page.getByRole('option', { name: 'Bike', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Travel mode', exact: true }),
    ).toHaveText('Bike')
    await page.getByRole('button', { name: 'Travel mode', exact: true }).click()
    await page.getByRole('option', { name: 'Ferry', exact: true }).click()
    await expect(
      page.getByRole('group', { name: 'Quick travel modes' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'GPS settings', exact: true }),
    ).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Stop tracking' }),
    ).toBeInViewport()
    await page
      .getByRole('button', { name: 'Recordings 0', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'No recordings yet' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Tracking', exact: true }).click()
    await expect(
      page.getByText('RECORDING LIVE', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Travel mode', exact: true }),
    ).toHaveText('Ferry')
    await page.screenshot({
      path: test.info().outputPath('recording.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Stop tracking' }).click()
    await expect(
      page.getByText('RECORDING STOPPED', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Stop tracking' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('group', { name: 'Quick travel modes' }),
    ).toHaveCount(0)
    await expect(
      page.getByText('Your recording has ended.', { exact: false }),
    ).toBeVisible()
    const duration = await page.getByLabel('Recording duration').textContent()
    await page.waitForTimeout(1200)
    await expect(page.getByLabel('Recording duration')).toHaveText(duration!)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(errors).toEqual([])
  })
}

test('active screen stays usable offline and keeps GPS warnings visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(
    '/tests/e2e/fixtures/tracking-controls.html?active&page&warning&dark',
  )
  await page.context().setOffline(true)
  await expect(
    page.getByText('Waiting for a GPS signal.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText('Recording details', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('fell inside one of your privacy zones', { exact: false }),
  ).toBeHidden()
  await page.getByRole('button', { name: 'Stop tracking' }).click()
  await expect(
    page.getByText('RECORDING STOPPED', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'View trip' }).click()
  await expect(page.getByText('Navigated to /trips/trip')).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('stopped-offline-dark.png'),
    fullPage: true,
  })
})

test('the GPS modal keeps the stop control visible on a small phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.route('**/api/v1/**', async (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/sessions')
        ? { sessions: [] }
        : { share_live_location: false },
    }),
  )
  await page.goto('/tests/e2e/fixtures/tracking-controls.html?active&modal')
  await expect(
    page.getByRole('button', { name: 'Stop tracking' }),
  ).toBeInViewport()
  await expect(
    page.getByRole('button', { name: 'All trip settings', exact: true }),
  ).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('gps-modal.png') })
})

test('all trip settings stays reachable when scrolling a long recording list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const sessions = Array.from({ length: 30 }, (_, index) => ({
    id: `session-${index}`,
    started_at: '2026-10-13T10:00:00Z',
    ended_at: '2026-10-13T12:00:00Z',
    recorded_by_user_id: 'owner',
    sample_count: 100,
  }))
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/sessions')
        ? { sessions }
        : { share_live_location: false },
    }),
  )
  await page.goto('/tests/e2e/fixtures/tracking-controls.html?active&modal')
  await page.getByRole('button', { name: 'Recordings 30', exact: true }).click()
  await page
    .getByRole('region', { name: 'Saved recordings' })
    .locator('li')
    .last()
    .scrollIntoViewIfNeeded()
  const back = page.getByRole('button', {
    name: 'All trip settings',
    exact: true,
  })
  await expect(back).toBeInViewport()
  await back.click()
  await expect(
    page.getByRole('heading', { name: 'Manage trip', exact: true }),
  ).toBeVisible()
})

test('GPS settings return to the active recording without reloading it', async ({
  page,
}) => {
  await page.goto('/tests/e2e/fixtures/tracking-controls.html?active&page')
  await page.evaluate(() =>
    window.history.replaceState(null, '', '/tracking/active'),
  )
  const documentId = await page.evaluate(() => {
    const id = crypto.randomUUID()
    Object.assign(window, { trackingPreviewDocumentId: id })
    return id
  })
  await page.getByRole('link', { name: 'GPS settings', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Travel mode', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'GPS tracking', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Back to tracking', exact: true })
    .click()
  await expect(page).toHaveURL(/\/tracking\/active$/)
  await expect(page.getByText('RECORDING LIVE', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Stop tracking' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { trackingPreviewDocumentId: string })
          .trackingPreviewDocumentId,
    ),
  ).toBe(documentId)
})

test('another trip links to the recording instead of allowing a second start', async ({
  page,
}) => {
  await page.route('**/api/v1/**', async (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/sessions')
        ? { sessions: [] }
        : { share_live_location: false },
    }),
  )
  await page.goto('/tests/e2e/fixtures/tracking-controls.html?active&other')
  await expect(
    page.getByRole('button', { name: 'Start tracking' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'View active recording' }),
  ).toHaveAttribute('href', '/tracking/active')
})

test('stopping this device from recordings ends capture locally before sync', async ({
  page,
}) => {
  let remoteStops = 0
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (url.endsWith('/stop')) remoteStops++
    await route.fulfill({
      json: url.endsWith('/sessions')
        ? {
            sessions: [
              {
                id: 'local-session',
                recorded_by_user_id: 'owner',
                started_at: new Date().toISOString(),
                ended_at: null,
                sample_count: 5,
              },
            ],
          }
        : { share_live_location: false },
    })
  })
  await page.goto('/tests/e2e/fixtures/tracking-controls.html?active')
  await page.getByRole('button', { name: 'Recordings 1', exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page
    .getByRole('button', { name: 'Stop recording', exact: true })
    .click()
  await expect(
    page
      .getByRole('region', { name: 'Saved recordings' })
      .getByText('Syncing', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true }),
  ).toHaveCount(0)
  expect(remoteStops).toBe(0)
  await page.getByRole('button', { name: 'Tracking', exact: true }).click()
  await expect(
    page.getByText('RECORDING STOPPED', { exact: true }),
  ).toBeVisible()
})

test('live sharing rolls back a failed update and confirms a successful one', async ({
  page,
}) => {
  let failUpdate = true
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (
      url.endsWith('/live-location-settings') &&
      route.request().method() === 'PUT'
    ) {
      await route.fulfill(
        failUpdate
          ? { status: 500, json: { detail: 'Sharing could not be updated' } }
          : { json: { share_live_location: true } },
      )
      return
    }
    await route.fulfill({
      json: url.endsWith('/sessions')
        ? { sessions: [] }
        : { share_live_location: false },
    })
  })
  await page.goto('/tests/e2e/fixtures/tracking-controls.html')
  const sharing = page.getByRole('switch', { name: 'Share live location' })
  await sharing.focus()
  await sharing.press('Space')
  await expect(sharing).not.toBeChecked()
  await expect(page.getByRole('alert')).toBeVisible()
  failUpdate = false
  await sharing.focus()
  await sharing.press('Space')
  await expect(sharing).toBeChecked()
  await expect(page.getByText('On · Anyone', { exact: false })).toBeVisible()
})
