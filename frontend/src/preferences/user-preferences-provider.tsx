import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  getUserPreferences,
  patchUserPreferences,
  type UserPreferences,
} from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import { useClockFormat, type ClockFormatPreference } from '@/lib/date-time'
import { parseThemePalette, useTheme, type ThemePalette } from '@/theme'

import { UserPreferencesContext, type UserPreferencesStatus } from './user-preferences-context'
import {
  readCachedUserPreferences,
  writeCachedUserPreferences,
} from './user-preferences-storage'

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { accessToken, currentUser, status: authStatus } = useAuth()
  const { preference: localTimeFormat, setPreference: setLocalTimeFormat } =
    useClockFormat()
  const { setUserPalette } = useTheme()
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [status, setStatus] = useState<UserPreferencesStatus>('idle')
  const requestRef = useRef<{
    request: Promise<void>
    userId: string
  } | null>(null)

  const userId = authStatus === 'authenticated' ? currentUser?.id ?? null : null
  const activeUserIdRef = useRef<string | null>(userId)
  activeUserIdRef.current = userId

  const applyPreferences = useCallback(
    (next: UserPreferences, nextUserId: string) => {
      const palette =
        next.theme_palette === null ? null : parseThemePalette(next.theme_palette)
      if (next.theme_palette !== null && !palette) {
        throw new Error('The server returned an invalid theme palette.')
      }
      const normalized: UserPreferences = {
        ...next,
        theme_palette: palette,
      }
      setLocalTimeFormat(normalized.time_format)
      setUserPalette(palette)
      setPreferences(normalized)
      writeCachedUserPreferences(nextUserId, normalized)
    },
    [setLocalTimeFormat, setUserPalette],
  )

  const refresh = useCallback(async () => {
    if (!userId || !accessToken) return
    if (requestRef.current?.userId === userId) return requestRef.current.request

    const request = (async () => {
      try {
        let next = await getUserPreferences(accessToken)
        if (next.updated_at === null) {
          next = await patchUserPreferences(
            { time_format: localTimeFormat },
            accessToken,
          )
        }
        if (activeUserIdRef.current !== userId) return
        applyPreferences(next, userId)
        setStatus('ready')
      } catch {
        // The cache was already applied. Keep it usable while offline and let
        // the next foreground/online revalidation try again.
        setStatus('ready')
      } finally {
        if (requestRef.current?.userId === userId) requestRef.current = null
      }
    })()
    requestRef.current = { request, userId }
    return request
  }, [accessToken, applyPreferences, localTimeFormat, userId])

  useLayoutEffect(() => {
    if (!userId) {
      requestRef.current = null
      setPreferences(null)
      setUserPalette(null)
      setStatus('idle')
      return
    }

    const cached = readCachedUserPreferences(userId)
    if (cached) {
      try {
        applyPreferences(cached, userId)
      } catch {
        // A malformed cache is ignored; the server fetch below remains authoritative.
      }
    }
    setStatus('loading')
    void refresh()
  }, [applyPreferences, refresh, setUserPalette, userId])

  useEffect(() => {
    if (!userId) return
    function refreshWhenOnline() {
      void refresh()
    }
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('online', refreshWhenOnline)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('online', refreshWhenOnline)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refresh, userId])

  const setTimeFormat = useCallback(
    async (timeFormat: ClockFormatPreference) => {
      if (!userId || !accessToken) {
        throw new Error('You must be signed in to save preferences.')
      }
      const next = await patchUserPreferences({ time_format: timeFormat }, accessToken)
      applyPreferences(next, userId)
      setStatus('ready')
    },
    [accessToken, applyPreferences, userId],
  )

  const setThemePalette = useCallback(
    async (themePalette: ThemePalette | null) => {
      if (!userId || !accessToken) {
        throw new Error('You must be signed in to save preferences.')
      }
      const next = await patchUserPreferences(
        { theme_palette: themePalette },
        accessToken,
      )
      applyPreferences(next, userId)
      setStatus('ready')
    },
    [accessToken, applyPreferences, userId],
  )

  const value = useMemo(
    () => ({ preferences, refresh, setThemePalette, setTimeFormat, status }),
    [preferences, refresh, setThemePalette, setTimeFormat, status],
  )

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  )
}
