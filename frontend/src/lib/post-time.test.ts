import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatLocalTimeHint, formatPostTime, zoneLabel } from '@/lib/date-time'

// Saturday 14 March 2026, 05:05 UTC = 14:05 in Tokyo.
const TOKYO_POST = '2026-03-14T05:05:00Z'

function expectedLabel(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('zoneLabel', () => {
  it('uses the browser short zone name', () => {
    const at = new Date(TOKYO_POST)
    expect(zoneLabel(at, 'Asia/Tokyo')).toBe(expectedLabel(at, 'Asia/Tokyo'))
    expect(zoneLabel(at, 'Etc/GMT-9')).toBe(expectedLabel(at, 'Etc/GMT-9'))
  })

  it("falls back to the viewer's zone when the browser doesn't know the name", () => {
    const at = new Date(TOKYO_POST)
    expect(zoneLabel(at, 'Not/A_Zone')).toBe(expectedLabel(at, undefined as unknown as string))
  })
})

describe('formatPostTime', () => {
  it('omits "your time" when the viewer has the same offset', () => {
    const labels = formatPostTime(TOKYO_POST, 'Asia/Tokyo', {
      preference: '24-hour',
      viewerTimeZone: 'Asia/Seoul',
    })

    expect(labels.dateTime).toBe('2026-03-14T05:05:00.000Z')
    expect(labels.local).toMatchObject({ time: '14:05', zone: zoneLabel(new Date(TOKYO_POST), 'Asia/Tokyo') })
    expect(labels.local?.weekdayDate).toMatch(/Sat/)
    expect(labels.local?.date).toMatch(/2026/)
    expect(labels.viewer).toBeNull()
  })

  it("adds the viewer's time when the offsets differ", () => {
    const labels = formatPostTime(TOKYO_POST, 'Asia/Tokyo', {
      preference: '24-hour',
      viewerTimeZone: 'Europe/Amsterdam',
    })

    expect(labels.local?.time).toBe('14:05')
    expect(labels.viewer).toMatchObject({ time: '06:05', weekdayIfOtherDay: null })
  })

  it('names the weekday when the viewer is on another date', () => {
    const labels = formatPostTime(TOKYO_POST, 'Asia/Tokyo', {
      preference: '24-hour',
      viewerTimeZone: 'America/Los_Angeles',
    })

    // 13 March 22:05 in Los Angeles (PDT started on 8 March).
    expect(labels.viewer?.time).toBe('22:05')
    expect(labels.viewer?.weekdayIfOtherDay).toMatch(/Fri/)
  })

  it('compares offsets at the instant, across a DST transition', () => {
    // Europe moves to summer time on 29 March 2026, London on the same day.
    // Before: Amsterdam UTC+1 vs London UTC+0. After: UTC+2 vs UTC+1.
    // Lisbon follows London, so it matches London on both sides.
    const before = '2026-03-29T00:30:00Z'
    const after = '2026-03-29T01:30:00Z'

    expect(
      formatPostTime(before, 'Europe/London', { viewerTimeZone: 'Europe/Lisbon' }).viewer,
    ).toBeNull()
    expect(
      formatPostTime(after, 'Europe/London', { viewerTimeZone: 'Europe/Lisbon' }).viewer,
    ).toBeNull()

    const amsterdamBefore = formatPostTime(before, 'Europe/Amsterdam', {
      preference: '24-hour',
      viewerTimeZone: 'Europe/London',
    })
    const amsterdamAfter = formatPostTime(after, 'Europe/Amsterdam', {
      preference: '24-hour',
      viewerTimeZone: 'Europe/London',
    })
    expect(amsterdamBefore.local?.time).toBe('01:30')
    expect(amsterdamBefore.viewer?.time).toBe('00:30')
    // 01:30 UTC: Amsterdam has jumped from 02:00 to 03:00, London to 02:30.
    expect(amsterdamAfter.local?.time).toBe('03:30')
    expect(amsterdamAfter.viewer?.time).toBe('02:30')

    // A zone that only differs during part of the year: New York vs
    // Bogotá (UTC-5 all year) match in winter and differ in summer.
    expect(
      formatPostTime('2026-01-15T12:00:00Z', 'America/New_York', { viewerTimeZone: 'America/Bogota' }).viewer,
    ).toBeNull()
    expect(
      formatPostTime('2026-07-15T12:00:00Z', 'America/New_York', { viewerTimeZone: 'America/Bogota' }).viewer,
    ).not.toBeNull()
  })

  it('respects the 12-hour clock preference', () => {
    const labels = formatPostTime(TOKYO_POST, 'Asia/Tokyo', {
      preference: '12-hour',
      viewerTimeZone: 'Europe/Amsterdam',
    })

    expect(labels.local?.time).toMatch(/02:05\s?PM/i)
    expect(labels.viewer?.time).toMatch(/06:05\s?AM/i)
  })

  it("shows only the viewer's time when the zone is missing or unknown", () => {
    for (const zone of [null, undefined, '', 'Not/A_Zone']) {
      const labels = formatPostTime(TOKYO_POST, zone, {
        preference: '24-hour',
        viewerTimeZone: 'Europe/Amsterdam',
      })
      expect(labels.local).toBeNull()
      expect(labels.viewer).toMatchObject({ time: '06:05', weekdayIfOtherDay: null })
    }
  })

  it("falls back to the viewer's time when Intl throws a RangeError", () => {
    // Simulate an old Android WebView whose ICU data lacks the zone.
    const RealDateTimeFormat = Intl.DateTimeFormat
    // A `function` (not an arrow) so the code under test can call it with `new`.
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (options?.timeZone === 'America/Ciudad_Juarez') {
        throw new RangeError('Invalid time zone specified: America/Ciudad_Juarez')
      }
      return new RealDateTimeFormat(locales, options)
    } as unknown as typeof Intl.DateTimeFormat)

    const labels = formatPostTime(TOKYO_POST, 'America/Ciudad_Juarez', {
      preference: '24-hour',
      viewerTimeZone: 'Europe/Amsterdam',
    })

    expect(labels.local).toBeNull()
    expect(labels.viewer?.time).toBe('06:05')
    expect(zoneLabel(new Date(TOKYO_POST), 'America/Ciudad_Juarez')).toBeTruthy()
  })
})

describe('formatLocalTimeHint', () => {
  it('describes the entered time in the place zone', () => {
    // 14:05 entered in Amsterdam (UTC+1) is 22:05 in Tokyo.
    const at = new Date('2026-03-14T13:05:00Z')
    const hint = formatLocalTimeHint(at, 'Asia/Tokyo', 'Tokyo', {
      preference: '24-hour',
      viewerTimeZone: 'Europe/Amsterdam',
    })

    expect(hint).toBe(`That's 22:05 ${zoneLabel(at, 'Asia/Tokyo')} in Tokyo`)
  })

  it('adds the weekday on another date and says "there" without a name', () => {
    const at = new Date('2026-03-14T20:05:00Z')
    const hint = formatLocalTimeHint(at, 'Asia/Tokyo', undefined, {
      preference: '24-hour',
      viewerTimeZone: 'Europe/Amsterdam',
    })

    expect(hint).toMatch(/^That's Sun 05:05 .+ there$/)
  })

  it('returns null for a zone the browser cannot use', () => {
    expect(formatLocalTimeHint(new Date(TOKYO_POST), 'Not/A_Zone', 'Nowhere')).toBeNull()
  })
})
