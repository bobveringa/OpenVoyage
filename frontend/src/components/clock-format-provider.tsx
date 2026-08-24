import { useCallback, useMemo, useState, type ReactNode } from 'react'

import {
  ClockFormatContext,
  readClockFormatPreference,
  writeClockFormatPreference,
  type ClockFormatPreference,
} from '@/lib/date-time'

export function ClockFormatProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ClockFormatPreference>(
    readClockFormatPreference,
  )
  const setPreference = useCallback((nextPreference: ClockFormatPreference) => {
    setPreferenceState(nextPreference)
    writeClockFormatPreference(nextPreference)
  }, [])
  const value = useMemo(
    () => ({
      preference,
      setPreference,
    }),
    [preference, setPreference],
  )

  return (
    <ClockFormatContext.Provider value={value}>
      {children}
    </ClockFormatContext.Provider>
  )
}
