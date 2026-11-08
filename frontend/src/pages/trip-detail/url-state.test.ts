import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getDefaultTripMode,
  hasTripModeInUrl,
  readTripDetailUrlState,
  writeTripDetailUrlState,
} from './url-state'

const permissions = {
  canEditTravelPosts: true,
  canOpenManagementDialogs: true,
  canSwitchModes: true,
  travelPosts: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getDefaultTripMode', () => {
  const today = new Date(2026, 7, 22)

  const cases: [string, string, string | null, string][] = [
    ['has not started', '2026-08-23', '2026-08-30', 'planning'],
    ['starts today', '2026-08-22', '2026-08-30', 'traveling'],
    ['is underway', '2026-08-20', '2026-08-30', 'traveling'],
    ['ends today', '2026-08-10', '2026-08-22', 'traveling'],
    ['has ended', '2026-08-10', '2026-08-21', 'traveling'],
    ['is open-ended and underway', '2026-08-20', null, 'traveling'],
    ['is open-ended and not started', '2026-08-23', null, 'planning'],
  ]

  it.each(cases)('when a trip %s', (_label, start_date, end_date, expected) => {
    expect(getDefaultTripMode({ end_date, start_date }, today)).toBe(expected)
  })
})

describe('trip detail tab URL state', () => {
  it('uses the default mode when the URL names no tab', () => {
    vi.stubGlobal('window', {
      location: new URL('https://example.test/trips/1'),
    })

    expect(hasTripModeInUrl()).toBe(false)
    expect(readTripDetailUrlState(permissions, 'traveling').mode).toBe('traveling')
  })

  it('treats an unknown tab as no tab', () => {
    vi.stubGlobal('window', {
      location: new URL('https://example.test/trips/1?tab=other'),
    })

    expect(hasTripModeInUrl()).toBe(false)
    expect(readTripDetailUrlState(permissions, 'traveling').mode).toBe('traveling')
  })

  it('lets an explicit tab override the default mode', () => {
    vi.stubGlobal('window', {
      location: new URL('https://example.test/trips/1?tab=plan'),
    })

    expect(hasTripModeInUrl()).toBe(true)
    expect(readTripDetailUrlState(permissions, 'traveling').mode).toBe('planning')
  })

  it('never defaults non-members to planning', () => {
    vi.stubGlobal('window', {
      location: new URL('https://example.test/trips/1'),
    })

    expect(
      readTripDetailUrlState(
        {
          ...permissions,
          canEditTravelPosts: false,
          canOpenManagementDialogs: false,
          canSwitchModes: false,
        },
        'planning',
      ).mode,
    ).toBe('traveling')
  })
})

describe('trip detail dialog URL state', () => {
  it('reads the management dialog and section', () => {
    vi.stubGlobal('window', {
      location: new URL('https://example.test/trips/1?tab=travel&dialog=management&section=gps'),
    })

    expect(readTripDetailUrlState(permissions)).toMatchObject({
      activeDialog: 'management',
      managementSection: 'gps',
      mode: 'traveling',
    })
  })

  it('accepts the Immich albums management section', () => {
    vi.stubGlobal('window', {
      location: new URL('https://example.test/trips/1?dialog=management&section=albums'),
    })

    expect(readTripDetailUrlState(permissions)).toMatchObject({
      activeDialog: 'management',
      managementSection: 'albums',
    })
  })

  it('writes a distinct history entry for the management dialog', () => {
    const location = new URL('https://example.test/trips/1?tab=travel')
    const pushState = vi.fn()
    vi.stubGlobal('window', {
      history: { pushState },
      location,
    })

    writeTripDetailUrlState(
      {
        activeDialog: 'management',
        editingPostId: null,
        managementSection: 'gps',
        mode: 'traveling',
        planningView: 'stops',
        travelingView: 'posts',
      },
      'push',
    )

    expect(pushState).toHaveBeenCalledWith(
      null,
      '',
      '/trips/1?tab=travel&dialog=management&section=gps',
    )
  })
})
