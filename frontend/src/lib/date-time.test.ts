import { beforeEach, describe, expect, it } from 'vitest'

import {
  readClockFormatPreference,
  writeClockFormatPreference,
} from '@/lib/date-time'

describe('clock format preference', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to a 24-hour clock', () => {
    expect(readClockFormatPreference()).toBe('24-hour')
  })

  it('persists explicit 12-hour and 24-hour choices', () => {
    writeClockFormatPreference('12-hour')
    expect(readClockFormatPreference()).toBe('12-hour')

    writeClockFormatPreference('24-hour')
    expect(readClockFormatPreference()).toBe('24-hour')
  })

  it('treats former device settings as the 24-hour default', () => {
    window.localStorage.setItem('openvoyage.clock-format.v1', 'system')

    expect(readClockFormatPreference()).toBe('24-hour')
  })
})
