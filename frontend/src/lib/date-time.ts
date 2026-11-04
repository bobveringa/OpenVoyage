import { createContext, useContext } from 'react'

export type ClockFormatPreference = '12-hour' | '24-hour'

const CLOCK_FORMAT_STORAGE_KEY = 'openvoyage.clock-format.v1'
const DEFAULT_CLOCK_FORMAT_PREFERENCE: ClockFormatPreference = '24-hour'

export type ClockFormatContextValue = {
  preference: ClockFormatPreference
  setPreference: (preference: ClockFormatPreference) => void
}

export const ClockFormatContext = createContext<ClockFormatContextValue | null>(null)

export function useClockFormat() {
  const context = useContext(ClockFormatContext)
  if (!context) {
    throw new Error('useClockFormat must be used within ClockFormatProvider')
  }
  return context
}

export function readClockFormatPreference(): ClockFormatPreference {
  try {
    const value = window.localStorage.getItem(CLOCK_FORMAT_STORAGE_KEY)
    return isClockFormatPreference(value) ? value : DEFAULT_CLOCK_FORMAT_PREFERENCE
  } catch {
    return DEFAULT_CLOCK_FORMAT_PREFERENCE
  }
}

export function writeClockFormatPreference(preference: ClockFormatPreference) {
  try {
    window.localStorage.setItem(CLOCK_FORMAT_STORAGE_KEY, preference)
  } catch {
    // The selected format still applies until this browser session ends.
  }
}

export function formatDateTime(
  value: Date,
  options: Intl.DateTimeFormatOptions,
  preference: ClockFormatPreference = readClockFormatPreference(),
) {
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    hour12: preference === '12-hour',
  }).format(value)
}

export function uses12HourClock(preference: ClockFormatPreference) {
  return preference === '12-hour'
}

function isClockFormatPreference(value: string | null): value is ClockFormatPreference {
  return value === '12-hour' || value === '24-hour'
}

/**
 * Short label for a time zone at a given instant, decided by the browser:
 * the locale's abbreviation where it has one (`CEST` for `nl-NL`), otherwise
 * an offset such as `GMT+9`.
 *
 * Every zone label in the app goes through here. If `JST`-style codes are
 * wanted for every viewer later, generate a zone → offset → code table from
 * Python's tz data (regenerated when `tzdata` is bumped) and look it up here;
 * callers don't need to change.
 */
export function zoneLabel(at: Date, timeZone: string): string {
  return (
    new Intl.DateTimeFormat(undefined, {
      timeZone: supportedTimeZone(timeZone),
      timeZoneName: 'short',
    })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  )
}

const supportedTimeZones = new Map<string, boolean>()

/**
 * `timeZone` if this browser can use it, otherwise `undefined` (the viewer's
 * own zone). Old Android WebViews (the Capacitor app) ship older ICU data and
 * throw a RangeError for zone names they don't know. Format the time and its
 * label with the same result so they always agree.
 */
export function supportedTimeZone(timeZone: string): string | undefined {
  let supported = supportedTimeZones.get(timeZone)
  if (supported === undefined) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone })
      supported = true
    } catch {
      supported = false
    }
    supportedTimeZones.set(timeZone, supported)
  }
  return supported ? timeZone : undefined
}

export type PostTimeLabels = {
  /** The instant, for `<time dateTime>`. */
  dateTime: string
  /**
   * The clock where the post happened. `null` when the post has no zone or
   * this browser can't use it; then only the viewer's time is shown.
   */
  local: {
    /** `14 Mar 2026` */
    date: string
    /** `Sat 14 Mar` */
    weekdayDate: string
    /** `14:05` (or `2:05 PM`) */
    time: string
    /** `GMT+9`, see {@link zoneLabel} */
    zone: string
  } | null
  /**
   * The viewer's own clock. `null` when the viewer's offset equals the
   * post's offset at that instant (the times would be identical).
   */
  viewer: {
    date: string
    weekdayDate: string
    time: string
    /** `Fri`: set only when the viewer's date differs from the local date. */
    weekdayIfOtherDay: string | null
  } | null
}

/**
 * Labels for a post's time: the local time where it was posted, plus the
 * viewer's time when their UTC offset differs at that moment.
 *
 * Offline posting isn't supported yet. When it is, posts that haven't synced
 * won't have `occurred_timezone`: pass `null` and the result carries only the
 * viewer's time ("your time") until the server responds.
 */
export function formatPostTime(
  occurredAt: string,
  occurredTimezone: string | null | undefined,
  options: {
    preference?: ClockFormatPreference
    /** For tests; defaults to the browser's zone. */
    viewerTimeZone?: string
  } = {},
): PostTimeLabels {
  const at = new Date(occurredAt)
  const { preference = readClockFormatPreference(), viewerTimeZone } = options
  const viewerClock = formatClock(at, viewerTimeZone, preference)
  const viewerParts = zonedParts(at, viewerTimeZone)

  let local: PostTimeLabels['local'] = null
  let localParts: ZonedParts | null = null
  if (occurredTimezone) {
    try {
      localParts = zonedParts(at, occurredTimezone)
      local = {
        ...formatClock(at, occurredTimezone, preference),
        zone: zoneLabel(at, occurredTimezone),
      }
    } catch {
      // RangeError: this WebView doesn't know the zone. Fall back to the
      // viewer's time, labelled as such.
      local = null
      localParts = null
    }
  }

  if (!local || !localParts) {
    return {
      dateTime: at.toISOString(),
      local: null,
      viewer: { ...viewerClock, weekdayIfOtherDay: null },
    }
  }

  const sameOffset = localParts.offsetMinutes === viewerParts.offsetMinutes
  const otherDay = localParts.day !== viewerParts.day
  return {
    dateTime: at.toISOString(),
    local,
    viewer: sameOffset
      ? null
      : {
          ...viewerClock,
          weekdayIfOtherDay: otherDay
            ? formatDateTime(at, { weekday: 'short', timeZone: viewerTimeZone }, preference)
            : null,
        },
  }
}

function formatClock(
  at: Date,
  timeZone: string | undefined,
  preference: ClockFormatPreference,
) {
  return {
    date: formatDateTime(
      at,
      { day: 'numeric', month: 'short', year: 'numeric', timeZone },
      preference,
    ),
    weekdayDate: formatDateTime(
      at,
      { weekday: 'short', day: 'numeric', month: 'short', timeZone },
      preference,
    ),
    time: formatDateTime(
      at,
      { hour: '2-digit', minute: '2-digit', timeZone },
      preference,
    ),
  }
}

type ZonedParts = { day: string; offsetMinutes: number }

/** Calendar day and UTC offset of `at` in `timeZone` (throws RangeError). */
function zonedParts(at: Date, timeZone: string | undefined): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  )
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  const instant = Math.floor(at.getTime() / 1000) * 1000
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    offsetMinutes: Math.round((wallClockAsUtc - instant) / 60_000),
  }
}

/**
 * The post form's hint: `That's 21:05 GMT+9 in Tokyo` for a time entered in
 * the author's device zone. Adds the weekday when the local date differs
 * (`That's Sat 05:05 GMT+9 in Tokyo`). `null` when the zone can't be used.
 */
export function formatLocalTimeHint(
  at: Date,
  timeZone: string,
  placeName: string | null | undefined,
  options: { preference?: ClockFormatPreference; viewerTimeZone?: string } = {},
): string | null {
  const { preference = readClockFormatPreference(), viewerTimeZone } = options
  try {
    const time = formatDateTime(at, { hour: '2-digit', minute: '2-digit', timeZone }, preference)
    const otherDay = zonedParts(at, timeZone).day !== zonedParts(at, viewerTimeZone).day
    const weekday = otherDay
      ? `${formatDateTime(at, { weekday: 'short', timeZone }, preference)} `
      : ''
    const where = placeName ? ` in ${placeName}` : ' there'
    return `That's ${weekday}${time} ${zoneLabel(at, timeZone)}${where}`
  } catch {
    return null
  }
}
