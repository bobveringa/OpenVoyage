import { createContext } from 'react'

import type { UserPreferences } from '@/api/client'
import type { ClockFormatPreference } from '@/lib/date-time'
import type { ThemePalette } from '@/theme'

export type UserPreferencesStatus = 'idle' | 'loading' | 'ready'

export type UserPreferencesContextValue = {
  preferences: UserPreferences | null
  refresh: () => Promise<void>
  setThemePalette: (palette: ThemePalette | null) => Promise<void>
  setTimeFormat: (timeFormat: ClockFormatPreference) => Promise<void>
  status: UserPreferencesStatus
}

export const UserPreferencesContext =
  createContext<UserPreferencesContextValue | null>(null)
