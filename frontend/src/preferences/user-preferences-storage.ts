import type { UserPreferences } from '@/api/client'
import { parseThemePalette } from '@/theme'

const CACHE_VERSION = 1

type CachedUserPreferences = UserPreferences & {
  cache_version: typeof CACHE_VERSION
}

function cacheKey(userId: string) {
  return `openvoyage.user-preferences.v1.${userId}`
}

export function readCachedUserPreferences(userId: string): UserPreferences | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(userId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const cached = value as Partial<CachedUserPreferences>
    const timeFormat = cached.time_format
    const themePalette =
      cached.theme_palette === null ? null : parseThemePalette(cached.theme_palette)
    if (
      cached.cache_version !== CACHE_VERSION ||
      (timeFormat !== '12-hour' && timeFormat !== '24-hour') ||
      (cached.theme_palette !== null && !themePalette) ||
      (cached.updated_at !== null && typeof cached.updated_at !== 'string')
    ) {
      window.localStorage.removeItem(cacheKey(userId))
      return null
    }
    return {
      time_format: timeFormat,
      theme_palette: themePalette,
      updated_at: cached.updated_at ?? null,
    }
  } catch {
    return null
  }
}

export function writeCachedUserPreferences(
  userId: string,
  preferences: UserPreferences,
) {
  try {
    window.localStorage.setItem(
      cacheKey(userId),
      JSON.stringify({ cache_version: CACHE_VERSION, ...preferences }),
    )
  } catch {
    // An unavailable cache must not prevent using the confirmed value in memory.
  }
}
