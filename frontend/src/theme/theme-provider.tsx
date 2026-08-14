import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { usePublicSettings } from '@/settings/public-settings'
import { ThemeContext } from '@/theme/theme-context'
import {
  DEFAULT_THEME_PALETTE,
  parseThemePalette,
  resolveThemeMode,
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
  const [palette, setPalette] = useState<ThemePalette>(() => readCachedTheme() ?? DEFAULT_THEME_PALETTE)
  const [preference, setPreferenceState] = useState<ThemeModePreference>(readThemeModePreference)
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const mode = resolveThemeMode(preference, prefersDark)

  useEffect(() => {
    const nextPalette = parseThemePalette(settings[THEME_PALETTE_KEY])
    if (!nextPalette) return
    setPalette(nextPalette)
    writeCachedTheme(nextPalette)
  }, [settings])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setPrefersDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    applyThemeToDocument(palette, mode)
  }, [mode, palette])

  const value = useMemo(
    () => ({
      mode,
      palette,
      preference,
      setPreference(nextPreference: ThemeModePreference) {
        setPreferenceState(nextPreference)
        writeThemeModePreference(nextPreference)
      },
    }),
    [mode, palette, preference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
