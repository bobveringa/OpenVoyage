import { afterEach, describe, expect, it, vi } from 'vitest'

import {
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
