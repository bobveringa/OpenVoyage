import { beforeEach, expect, it } from 'vitest'
import {
  readTrackingSettingsReturnPath,
  trackingSettingsHref,
  tripTrackingReturnPath,
} from './settings-navigation'

beforeEach(() => window.history.replaceState(null, '', '/'))

it('preserves the trip mode and reopens its GPS menu', () => {
  window.history.replaceState(
    null,
    '',
    '/trips/trip-id?tab=plan&dialog=management&section=gps',
  )
  const returnTo = tripTrackingReturnPath('trip-id')
  const url = new URL(trackingSettingsHref(returnTo), window.location.origin)
  expect(url.hash).toBe('#tracking')
  expect(readTrackingSettingsReturnPath(url.search)).toBe(
    '/trips/trip-id?tab=plan&dialog=management&section=gps',
  )
})

it('supports returning to the global offline recording screen', () => {
  const url = new URL(
    trackingSettingsHref('/tracking/active'),
    window.location.origin,
  )
  expect(readTrackingSettingsReturnPath(url.search)).toBe('/tracking/active')
})

it.each([
  'https://example.com/trips/trip-id',
  '//example.com/trips/trip-id',
  '/\\example.com/trips/trip-id',
  '/settings',
  '/trips',
])('ignores unrelated or external return paths: %s', (value) => {
  expect(
    readTrackingSettingsReturnPath(
      new URLSearchParams({ returnTo: value }).toString(),
    ),
  ).toBeNull()
})
