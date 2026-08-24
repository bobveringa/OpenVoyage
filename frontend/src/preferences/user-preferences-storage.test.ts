import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_THEME_PALETTE } from '@/theme'

import {
  readCachedUserPreferences,
  writeCachedUserPreferences,
} from './user-preferences-storage'

describe('user preferences storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps each signed-in user cache separate', () => {
    writeCachedUserPreferences('first-user', {
      time_format: '12-hour',
      theme_palette: DEFAULT_THEME_PALETTE,
      updated_at: '2026-08-24T17:42:31.412Z',
    })
    writeCachedUserPreferences('second-user', {
      time_format: '24-hour',
      theme_palette: null,
      updated_at: null,
    })

    expect(readCachedUserPreferences('first-user')).toMatchObject({
      time_format: '12-hour',
      theme_palette: DEFAULT_THEME_PALETTE,
    })
    expect(readCachedUserPreferences('second-user')).toEqual({
      time_format: '24-hour',
      theme_palette: null,
      updated_at: null,
    })
  })

  it('discards a malformed cache rather than applying it', () => {
    const key = 'openvoyage.user-preferences.v1.user'
    window.localStorage.setItem(
      key,
      JSON.stringify({
        cache_version: 1,
        time_format: '12-hour',
        theme_palette: { invalid: true },
        updated_at: null,
      }),
    )

    expect(readCachedUserPreferences('user')).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })
})
