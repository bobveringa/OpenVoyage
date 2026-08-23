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
