import { createContext } from 'react'

import type {
  ThemeMode,
  ThemeModePreference,
  ThemePalette,
} from '@/theme/theme-contract'

export type ThemeContextValue = {
  mode: ThemeMode
  palette: ThemePalette
  preference: ThemeModePreference
  setUserPalette: (palette: ThemePalette | null) => void
  setPreference: (preference: ThemeModePreference) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)
