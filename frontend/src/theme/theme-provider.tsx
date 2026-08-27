import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import { usePublicSettings } from '@/settings/public-settings'
import { ThemeContext } from '@/theme/theme-context'
import {
  DEFAULT_THEME_PALETTE,
  parseThemePalette,
  THEME_PALETTE_KEY,
  type ThemeModePreference,
  type ThemePalette,
} from '@/theme/theme-contract'
import { applyThemeToDocument } from '@/theme/theme-dom'
import {
  readCachedTheme,
  readThemeModePreference,
  writeCachedTheme,
  writeThemeModePreference,
} from '@/theme/theme-storage'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = usePublicSettings()
  const [instancePalette, setInstancePalette] = useState<ThemePalette>(
    () => readCachedTheme() ?? DEFAULT_THEME_PALETTE,
  )
  const [userPalette, setUserPalette] = useState<ThemePalette | null>(null)
  const [preference, setPreferenceState] = useState<ThemeModePreference>(readThemeModePreference)
  const mode = preference
  const palette = userPalette ?? instancePalette

  useEffect(() => {
    const nextPalette = parseThemePalette(settings[THEME_PALETTE_KEY])
    if (!nextPalette) return
    setInstancePalette(nextPalette)
    writeCachedTheme(nextPalette)
  }, [settings])

  // Leaflet reads these CSS values when it creates its route layers. Apply the
  // selected theme during the layout phase so child effects never see the
  // previous mode's colors after a theme switch.
  useLayoutEffect(() => {
    applyThemeToDocument(palette, mode)
  }, [mode, palette])

  const value = useMemo(
    () => ({
      mode,
      palette,
      preference,
      setUserPalette,
      setPreference(nextPreference: ThemeModePreference) {
        setPreferenceState(nextPreference)
        writeThemeModePreference(nextPreference)
      },
    }),
    [mode, palette, preference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
