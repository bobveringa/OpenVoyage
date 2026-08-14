import { expect, test, type Page, type Route } from '@playwright/test'

type MockSetting = {
  default_value: unknown | null
  description: string
  is_configured: boolean
  key: string
  runtime_safe: boolean
  updated_at: string | null
  validation: Record<string, unknown> | null
  value: unknown | null
  value_type: 'enum' | 'integer' | 'object' | 'secret' | 'string'
  visibility: 'admin' | 'public'
}

const defaultTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const customTileUrl = 'https://tiles.example.test/{z}/{x}/{y}.png'
const defaultThemePalette = {
  schema_version: 1,
  light: {
    background: '#F7FBF7', foreground: '#183026', card: '#FFFFFF', cardForeground: '#183026', popover: '#FFFFFF', popoverForeground: '#183026', primary: '#246B49', primaryForeground: '#FFFFFF', secondary: '#EAF3EB', secondaryForeground: '#264B37', muted: '#EDF3ED', mutedForeground: '#587064', accent: '#D99A2B', accentForeground: '#332711', border: '#D4E1D6', input: '#7C9483', ring: '#2C7652',
  },
  dark: {
    background: '#121A27', foreground: '#E8EEF1', card: '#182231', cardForeground: '#E8EEF1', popover: '#182231', popoverForeground: '#E8EEF1', primary: '#65AFC8', primaryForeground: '#101923', secondary: '#263444', secondaryForeground: '#DFE9ED', muted: '#293746', mutedForeground: '#AABAC2', accent: '#E17D62', accentForeground: '#111923', border: '#35475A', input: '#71869B', ring: '#65AFC8',
  },
}

const initialSettings: MockSetting[] = [
  {
    default_value: defaultThemePalette,
    description: 'Shared light and dark application color palettes.',
    is_configured: false,
    key: 'theme.palette',
    runtime_safe: true,
    updated_at: null,
    validation: { format: 'theme-palette-v1' },
    value: defaultThemePalette,
    value_type: 'object',
    visibility: 'public',
  },
  {
    default_value: 'system',
    description: 'Controls the public theme mode.',
    is_configured: false,
    key: 'theme.darkmode',
    runtime_safe: true,
    updated_at: null,
    validation: { allowed_values: ['enabled', 'disabled', 'system'] },
    value: 'system',
    value_type: 'enum',
    visibility: 'public',
  },
  {
    default_value: 'none',
    description: 'Route provider used for itinerary travel routes.',
    is_configured: true,
    key: 'routing.provider',
    runtime_safe: false,
    updated_at: '2026-08-05T09:00:00Z',
    validation: { allowed_values: ['none', 'graphhopper'] },
    value: 'graphhopper',
    value_type: 'enum',
    visibility: 'admin',
  },
  {
    default_value: defaultTileUrl,
    description: 'Tile URL template used by interactive maps.',
    is_configured: false,
    key: 'map.tile_provider',
    runtime_safe: true,
    updated_at: null,
    validation: { format: 'http-url-template', max_length: 2048, min_length: 1 },
    value: defaultTileUrl,
    value_type: 'string',
    visibility: 'public',
  },
  {
    default_value: 'https://graphhopper.com/api/1',
    description: 'GraphHopper route API base URL.',
    is_configured: false,
    key: 'routing.graphhopper_base_url',
    runtime_safe: false,
    updated_at: null,
    validation: { format: 'http-url' },
    value: 'https://graphhopper.com/api/1',
    value_type: 'string',
    visibility: 'admin',
  },
  {
    default_value: null,
    description: 'GraphHopper API key used by route generation.',
    is_configured: true,
    key: 'routing.graphhopper_api_key',
    runtime_safe: false,
    updated_at: '2026-08-05T09:00:00Z',
    validation: { max_length: 2048, min_length: 1 },
    value: null,
    value_type: 'secret',
    visibility: 'admin',
  },
  {
    default_value: 512,
    description: 'Maximum accepted upload size in megabytes.',
    is_configured: false,
    key: 'media.max_upload_size_mb',
    runtime_safe: true,
    updated_at: null,
    validation: { max: 5120, min: 1, unit: 'MB' },
    value: 512,
    value_type: 'integer',
    visibility: 'admin',
  },
]

test('manages grouped runtime settings without revealing secrets', async ({
  page,
}) => {
  const api = await mockAdminApi(page)
  await page.setViewportSize({ height: 760, width: 390 })

  await page.goto('/admin#routing')

  await expect(
    page.getByRole('heading', { name: 'Application control centre' }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/admin#routing$/)
  await expect(
    page.getByRole('heading', { exact: true, name: 'Routing' }),
  ).toBeVisible()
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveCount(0)
  await expect(
    page.getByText('Restart required after changes'),
  ).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'GraphHopper' })).toBeVisible()

  await page.getByLabel('Route provider').click()
  const providerListbox = page.getByRole('listbox')
  await expect(providerListbox).toBeVisible()
  expect(
    await providerListbox.evaluate(
      (listbox) => listbox.parentElement?.parentElement === document.body,
    ),
  ).toBe(true)
  const menuBounds = await providerListbox.locator('..').boundingBox()
  const visualViewportBounds = await page.evaluate(() => ({
    bottom:
      (window.visualViewport?.offsetTop ?? 0) +
      (window.visualViewport?.height ?? window.innerHeight),
    top: window.visualViewport?.offsetTop ?? 0,
  }))
  expect(menuBounds).not.toBeNull()
  expect(menuBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(
    390,
  )
  expect(menuBounds?.y ?? -1).toBeGreaterThanOrEqual(
    visualViewportBounds.top,
  )
  expect(
    (menuBounds?.y ?? 0) + (menuBounds?.height ?? 0),
  ).toBeLessThanOrEqual(visualViewportBounds.bottom)
  await expect(providerListbox.getByRole('option').first()).toHaveAttribute(
    'tabindex',
    '-1',
  )
  await page.keyboard.press('Tab')
  await expect(providerListbox).toBeHidden()

  const baseUrlForm = page
    .locator('form')
    .filter({ has: page.getByLabel('GraphHopper base URL') })
  await page.getByLabel('GraphHopper base URL').fill('ftp://routes.example.test')
  await baseUrlForm.getByRole('button', { exact: true, name: 'Save' }).click()
  await expect(baseUrlForm.getByRole('alert')).toContainText(
    'URL scheme must be HTTP or HTTPS',
  )

  const apiKeyForm = page
    .locator('form')
    .filter({ has: page.getByLabel('GraphHopper API key') })
  await expect(page.getByLabel('GraphHopper API key')).toHaveValue('')
  await expect(apiKeyForm.getByText('Configured', { exact: true })).toBeVisible()
  await apiKeyForm.getByRole('button', { name: 'Clear key' }).click()
  await apiKeyForm.getByRole('button', { name: 'Confirm clear' }).click()
  await expect(
    apiKeyForm.getByText('Not configured', { exact: true }),
  ).toBeVisible()
  expect(api.resets).toContain('routing.graphhopper_api_key')

  const providerForm = page
    .locator('form')
    .filter({ has: page.getByLabel('Route provider') })
  await page.getByLabel('Route provider').click()
  await page.getByRole('option', { name: 'Routing disabled' }).click()
  await providerForm.getByRole('button', { exact: true, name: 'Save' }).click()
  await expect(providerForm.getByText('Setting saved.')).toBeVisible()
  expect(api.updates).toContainEqual({
    key: 'routing.provider',
    value: 'none',
  })
  await expect(page.getByRole('heading', { name: 'GraphHopper' })).toHaveCount(0)
  await expect(page.getByLabel('GraphHopper base URL')).toHaveCount(0)

  await page.getByRole('tab', { name: /Media/ }).click()
  await expect(page).toHaveURL(/\/admin#media$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/admin#routing$/)
  await expect(
    page.getByRole('heading', { exact: true, name: 'Routing' }),
  ).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(/\/admin#media$/)

  const mediaForm = page
    .locator('form')
    .filter({ has: page.getByLabel('Maximum upload size') })
  await page.getByLabel('Maximum upload size').fill('768')
  await mediaForm.getByRole('button', { exact: true, name: 'Save' }).click()
  await expect(mediaForm.getByText('Setting saved.')).toBeVisible()
  expect(api.updates).toContainEqual({
    key: 'media.max_upload_size_mb',
    value: 768,
  })

  await mediaForm.getByRole('button', { name: 'Reset' }).click()
  await expect(mediaForm.getByText('Default restored.')).toBeVisible()
  await expect(page.getByLabel('Maximum upload size')).toHaveValue('512')
  expect(api.resets).toContain('media.max_upload_size_mb')
})

test('normalizes missing or invalid admin section hashes', async ({ page }) => {
  await mockAdminApi(page)

  await page.goto('/admin')

  await expect(page).toHaveURL(/\/admin#appearance$/)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()

  const appearanceTab = page.getByRole('tab', { name: /Appearance/ })
  const routingTab = page.getByRole('tab', { name: /Routing/ })
  await expect(appearanceTab).toHaveAttribute('tabindex', '0')
  await appearanceTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/\/admin#routing$/)
  await expect(routingTab).toBeFocused()
  await expect(routingTab).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('Home')
  await expect(page).toHaveURL(/\/admin#appearance$/)
  await expect(appearanceTab).toBeFocused()

  await page.goto('/admin#unknown-section')

  await expect(page).toHaveURL(/\/admin#appearance$/)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()

  await page.getByRole('tab', { name: /Data tools/ }).click()
  await expect(page).toHaveURL(/\/admin#data$/)
  await expect(page.getByRole('heading', { name: 'Data tools' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/admin#appearance$/)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
})

test('moves the admin navigation outside the content column when space allows', async ({
  page,
}) => {
  await mockAdminApi(page)
  await page.setViewportSize({ height: 1000, width: 1920 })

  await page.goto('/admin#routing')

  const navigation = page.getByRole('tablist', { name: 'Admin sections' })
  const header = page.getByRole('heading', {
    name: 'Application control centre',
  })
  const contentHeading = page.getByRole('heading', {
    exact: true,
    name: 'Routing',
  })
  const navigationBounds = await navigation.boundingBox()
  const headerBounds = await header.boundingBox()
  const contentBounds = await contentHeading.boundingBox()

  expect(navigationBounds).not.toBeNull()
  expect(headerBounds).not.toBeNull()
  expect(contentBounds).not.toBeNull()
  expect(navigationBounds?.x ?? Infinity).toBeLessThan(headerBounds?.x ?? 0)
  expect((navigationBounds?.x ?? 0) + (navigationBounds?.width ?? 0)).toBeLessThan(
    contentBounds?.x ?? 0,
  )
})

test('updates and resets the public map tile provider URL', async ({ page }) => {
  const api = await mockAdminApi(page)

  await page.goto('/admin#appearance')

  const tileProviderForm = page
    .locator('form')
    .filter({ has: page.getByLabel('Tile URL template') })
  await page.getByLabel('Tile URL template').fill(customTileUrl)
  await tileProviderForm
    .getByRole('button', { exact: true, name: 'Save' })
    .click()

  await expect(tileProviderForm.getByText('Setting saved.')).toBeVisible()
  expect(api.updates).toContainEqual({
    key: 'map.tile_provider',
    value: customTileUrl,
  })

  await tileProviderForm.getByRole('button', { name: 'Reset' }).click()
  await expect(tileProviderForm.getByText('Default restored.')).toBeVisible()
  await expect(page.getByLabel('Tile URL template')).toHaveValue(defaultTileUrl)
  expect(api.resets).toContain('map.tile_provider')
})

test('lets an admin preview and publish a complete theme preset', async ({ page }) => {
  const api = await mockAdminApi(page)

  await page.goto('/admin#appearance')
  await page.getByRole('button', { name: 'Apply OpenVoyage preset' }).click()
  await expect(page.getByRole('button', { name: 'Publish theme' })).toBeDisabled()
  for (const preset of ['Ocean', 'Violet', 'Forest', 'Rose', 'Slate']) {
    await page.getByRole('button', { name: `Apply ${preset} preset` }).click()
    await expect(page.getByRole('button', { name: 'Publish theme' })).toBeEnabled()
  }
  await page.getByRole('button', { name: 'Apply Ocean preset' }).click()
  await expect(page.getByText('light preview', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publish theme' }).click()

  await expect(page.getByText(/Theme published/)).toBeVisible()
  expect(api.updates).toContainEqual({
    key: 'theme.palette',
    value: expect.objectContaining({ schema_version: 1 }),
  })
})

test('stores a visitor color mode choice from the top bar', async ({ page }) => {
  await mockAdminApi(page)

  await page.goto('/admin#appearance')
  await page.getByRole('button', { name: 'Use dark appearance' }).click()

  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('openvoyage.theme-mode.v1')))
    .toBe('dark')
})

async function mockAdminApi(page: Page) {
  const settings = initialSettings.map((setting) => ({ ...setting }))
  const updates: Array<{ key: string; value: unknown }> = []
  const resets: string[] = []
  const tokenPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60 }),
  ).toString('base64url')

  await page.addInitScript((accessToken) => {
    window.localStorage.setItem(
      'openvoyage.auth',
      JSON.stringify({
        access_token: accessToken,
        id_token: 'test-id-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
      }),
    )
  }, `test.${tokenPayload}.signature`)

  await page.route('**/api/v1/users/me', async (route) => {
    await fulfillJson(route, {
      id: '10000000-0000-4000-8000-000000000001',
      profile: null,
      role: 'ADMIN',
    })
  })

  await page.route('**/api/v1/admin/settings', async (route) => {
    await fulfillJson(route, {
      settings,
      updated_at: '2026-08-05T09:00:00Z',
    })
  })

  await page.route('**/api/v1/settings/public', async (route) => {
    await fulfillJson(route, {
      settings: Object.fromEntries(
        settings
          .filter((setting) => setting.visibility === 'public')
          .map((setting) => [setting.key, setting.value]),
      ),
      updated_at: null,
    })
  })

  await page.route('**/api/v1/admin/settings/**', async (route) => {
    const request = route.request()
    const segments = new URL(request.url()).pathname.split('/')
    const key = decodeURIComponent(segments[5] ?? '')
    const settingIndex = settings.findIndex((setting) => setting.key === key)
    const setting = settings[settingIndex]

    if (!setting) {
      await fulfillJson(route, { detail: 'Setting not found' }, 404)
      return
    }

    if (request.method() === 'POST') {
      resets.push(key)
      const resetSetting: MockSetting = {
        ...setting,
        is_configured: false,
        updated_at: null,
        value: setting.value_type === 'secret' ? null : setting.default_value,
      }
      settings[settingIndex] = resetSetting
      await fulfillJson(route, resetSetting)
      return
    }

    const payload = request.postDataJSON() as { value: unknown }
    if (
      key === 'routing.graphhopper_base_url' &&
      typeof payload.value === 'string' &&
      payload.value.startsWith('ftp:')
    ) {
      await fulfillJson(
        route,
        {
          detail: [
            {
              loc: ['body', 'value'],
              msg: 'URL scheme must be HTTP or HTTPS',
              type: 'value_error',
            },
          ],
        },
        422,
      )
      return
    }

    updates.push({ key, value: payload.value })
    const nextSetting: MockSetting = {
      ...setting,
      is_configured: true,
      updated_at: '2026-08-05T10:00:00Z',
      value: setting.value_type === 'secret' ? null : payload.value,
    }
    settings[settingIndex] = nextSetting
    await fulfillJson(route, nextSetting)
  })

  return { resets, updates }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}
