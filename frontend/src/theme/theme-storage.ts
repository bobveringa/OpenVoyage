import {
  parseThemePalette,
  type ThemeModePreference,
  type ThemePalette,
} from '@/theme/theme-contract'

const THEME_CACHE_KEY = 'openvoyage.theme.v1'
const THEME_MODE_KEY = 'openvoyage.theme-mode.v1'
const CACHE_VERSION = 1

type CachedTheme = {
  cache_version: typeof CACHE_VERSION
  palette: ThemePalette
}

export function readCachedTheme(): ThemePalette | null {
  try {
    const raw = window.localStorage.getItem(THEME_CACHE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const cache = value as Partial<CachedTheme>
    const palette = parseThemePalette(cache.palette)
    if (cache.cache_version !== CACHE_VERSION || !palette) {
      window.localStorage.removeItem(THEME_CACHE_KEY)
      return null
    }
    return palette
  } catch {
    return null
  }
}

export function writeCachedTheme(palette: ThemePalette) {
  try {
    window.localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({ cache_version: CACHE_VERSION, palette }),
    )
  } catch {
    // Private browsing and quota errors must not prevent visual fallback.
  }
}

export function readThemeModePreference(): ThemeModePreference {
  try {
    const value = window.localStorage.getItem(THEME_MODE_KEY)
    return value === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function writeThemeModePreference(preference: ThemeModePreference) {
  try {
    window.localStorage.setItem(THEME_MODE_KEY, preference)
  } catch {
    // The mode still applies for this browser session.
  }
}

export const themeStorageKeys = { cache: THEME_CACHE_KEY, mode: THEME_MODE_KEY }
