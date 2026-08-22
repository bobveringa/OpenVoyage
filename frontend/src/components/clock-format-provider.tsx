import { useMemo, useState, type ReactNode } from 'react'

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
  const value = useMemo(
    () => ({
      preference,
      setPreference(nextPreference: ClockFormatPreference) {
        setPreferenceState(nextPreference)
        writeClockFormatPreference(nextPreference)
      },
    }),
    [preference],
  )

  return (
    <ClockFormatContext.Provider value={value}>
      {children}
    </ClockFormatContext.Provider>
  )
}
