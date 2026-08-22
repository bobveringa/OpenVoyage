import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  ApiError,
  changeOwnPassword,
  configureAuthTokenRefresh,
  configurePasswordChangeRequired,
  getErrorMessage,
  login as loginRequest,
  readCurrentUser,
  refreshAuthTokens,
  signOutAllDevices,
  type AuthTokens,
  type CurrentUser,
} from '@/api/client'
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/auth/auth-context'
import {
  clearCachedCurrentUser,
  clearStoredAuthTokens,
  readCachedCurrentUser,
  readStoredAuthTokens,
  writeCachedCurrentUser,
  writeStoredAuthTokens,
} from '@/auth/auth-storage'

type AuthProviderProps = {
  children: ReactNode
}

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000
const FALLBACK_ACCESS_TOKEN_REFRESH_MS = 10 * 60 * 1000
const SESSION_RESTORE_RETRY_MS = 5 * 1000

export function AuthProvider({ children }: AuthProviderProps) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null)
  // The token handed to the rest of the app. It is pinned for the lifetime of
  // a session instead of tracking every rotation: consumers pass it to the API
  // client, which resolves it to the live token on each request (see
  // configureAuthTokenRefresh below). A value that changed every ~13 minutes
  // ended up in effect dependency arrays, so a silent background refresh
  // re-ran every page's data load and flashed the whole screen back to its
  // loading state.
  const [sessionAccessToken, setSessionAccessToken] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const refreshPromiseRef = useRef<Promise<AuthTokens | null> | null>(null)
  const tokensRef = useRef<AuthTokens | null>(null)

  const storeSession = useCallback((nextTokens: AuthTokens) => {
    // Persistence is best-effort and asynchronous; in-memory state (below)
    // is the source of truth for the running session either way.
    void writeStoredAuthTokens(nextTokens)
    tokensRef.current = nextTokens
    setTokens(nextTokens)
    setSessionAccessToken((current) => current ?? nextTokens.access_token)
  }, [])

  const clearSession = useCallback(() => {
    void clearStoredAuthTokens()
    void clearCachedCurrentUser()
    tokensRef.current = null
    refreshPromiseRef.current = null
    setTokens(null)
    setSessionAccessToken(null)
    setCurrentUser(null)
    setStatus('unauthenticated')
    setError(null)
  }, [])

  const updateCurrentUser = useCallback((user: CurrentUser) => {
    setCurrentUser(user)
    void writeCachedCurrentUser(user)
  }, [])

  const refreshSession = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const currentTokens = tokensRef.current
      if (!currentTokens) {
        return null
      }

      if (!force && !shouldRefreshAccessToken(currentTokens.access_token)) {
        return currentTokens
      }

      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current
      }

      const refreshToken = currentTokens.refresh_token
      const refreshPromise = refreshAuthTokens(refreshToken)
        .then((nextTokens) => {
          if (tokensRef.current?.refresh_token !== refreshToken) {
            return tokensRef.current
          }

          storeSession(nextTokens)
          setError(null)
          return nextTokens
        })
        .catch((refreshError: unknown) => {
          if (tokensRef.current?.refresh_token === refreshToken) {
            // A refresh token is only known to be invalid when the API says so.
            // Network and server failures must not erase the locally persisted
            // session: doing that turned a temporary outage into a logout.
            if (isInvalidSessionError(refreshError)) {
              clearSession()
              return null
            }
          }
          throw refreshError
        })
        .finally(() => {
          if (refreshPromiseRef.current === refreshPromise) {
            refreshPromiseRef.current = null
          }
        })

      refreshPromiseRef.current = refreshPromise
      return refreshPromise
    },
    [clearSession, storeSession],
  )

  useEffect(() => {
    configureAuthTokenRefresh(async ({ accessToken, forceRefresh }) => {
      const currentTokens = tokensRef.current
      if (!currentTokens) {
        return null
      }
      if (currentTokens.access_token !== accessToken) {
        // The caller holds the session's pinned token rather than the newest
        // one. A rotation that already happened satisfies a forced refresh;
        // otherwise still top up the live token when it is close to expiring,
        // so requests keep being sent with a valid one.
        if (forceRefresh) {
          return currentTokens.access_token
        }
        const nextTokens = await refreshSession()
        return nextTokens?.access_token ?? currentTokens.access_token
      }

      const nextTokens = await refreshSession({ force: forceRefresh })
      return nextTokens?.access_token ?? null
    })

    return () => configureAuthTokenRefresh(null)
  }, [refreshSession])

  useEffect(() => {
    configurePasswordChangeRequired(() => {
      setCurrentUser((user) =>
        user ? { ...user, password_change_required: true } : user,
      )
    })

    return () => configurePasswordChangeRequired(null)
  }, [])

  useEffect(() => {
    let isCurrent = true
    let retryTimeout: number | undefined

    async function restoreSession() {
      const storedTokens = await readStoredAuthTokens()
      if (!isCurrent) {
        return
      }
      if (!storedTokens) {
        setStatus('unauthenticated')
        return
      }

      tokensRef.current = storedTokens
      setTokens(storedTokens)
      setSessionAccessToken((current) => current ?? storedTokens.access_token)

      try {
        const sessionTokens = shouldRefreshAccessToken(storedTokens.access_token)
          ? await refreshSession({ force: true })
          : storedTokens
        if (!sessionTokens) {
          return
        }

        const user = await readCurrentUser(sessionTokens.access_token)
        if (!isCurrent) {
          return
        }
        setCurrentUser(user)
        setStatus('authenticated')
        setError(null)
        void writeCachedCurrentUser(user)
      } catch (restoreError) {
        if (!isCurrent) {
          return
        }

        if (isInvalidSessionError(restoreError)) {
          clearSession()
          return
        }

        // The API is unreachable (offline launch, server down). Rather than
        // blocking the whole app on that — which would also strand anything
        // that only needs local state, like stopping an in-progress GPS
        // recording — fall back to the last-known profile so the app is
        // still usable, and keep retrying in the background for fresh data.
        const cachedUser = await readCachedCurrentUser()
        if (!isCurrent) {
          return
        }
        if (cachedUser) {
          setCurrentUser(cachedUser)
          setStatus('authenticated')
          setError(null)
        } else {
          // No cached profile to fall back to (e.g. first-ever launch was
          // offline) — nothing meaningful to render yet.
          setError(getErrorMessage(restoreError))
          setStatus('unavailable')
        }

        // Keep the saved tokens while the API is unreachable and wait for it
        // to return. The retry also covers native clients, where a server
        // restart does not necessarily trigger the browser's online event.
        retryTimeout = window.setTimeout(() => {
          void restoreSession()
        }, SESSION_RESTORE_RETRY_MS)
      }
    }

    void restoreSession()

    function retryWhenOnline() {
      if (retryTimeout !== undefined) {
        window.clearTimeout(retryTimeout)
      }
      void restoreSession()
    }

    window.addEventListener('online', retryWhenOnline)

    return () => {
      isCurrent = false
      if (retryTimeout !== undefined) {
        window.clearTimeout(retryTimeout)
      }
      window.removeEventListener('online', retryWhenOnline)
    }
  }, [clearSession, refreshSession])

  useEffect(() => {
    if (!tokens) {
      return
    }

    const timer = window.setTimeout(() => {
      void refreshSession({ force: true }).catch(() => {
        // The restore effect retains the session and retries after transient
        // failures. Avoid an unhandled rejection from this background refresh.
      })
    }, getAccessTokenRefreshDelay(tokens.access_token))

    return () => window.clearTimeout(timer)
  }, [refreshSession, tokens])

  useEffect(() => {
    if (!tokens) {
      return
    }

    function refreshAfterBrowserWake() {
      void refreshSession().catch(() => {
        // See the scheduled refresh above.
      })
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshAfterBrowserWake()
      }
    }

    window.addEventListener('focus', refreshAfterBrowserWake)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', refreshAfterBrowserWake)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshSession, tokens])

  const signIn = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      const nextTokens = await loginRequest(email, password)
      storeSession(nextTokens)

      try {
        const user = await readCurrentUser(nextTokens.access_token)
        setCurrentUser(user)
        setStatus('authenticated')
        setError(null)
        void writeCachedCurrentUser(user)
        return user
      } catch (signInError) {
        clearSession()
        throw signInError
      }
    },
    [clearSession, storeSession],
  )

  const changePassword = useCallback(
    async ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string
      newPassword: string
    }) => {
      const currentTokens = tokensRef.current
      if (!currentTokens) {
        throw new Error('An authenticated session is required.')
      }

      const nextTokens = await changeOwnPassword(
        {
          current_password: currentPassword,
          new_password: newPassword,
        },
        currentTokens.access_token,
      )
      storeSession(nextTokens)
      setCurrentUser((user) =>
        user ? { ...user, password_change_required: false } : user,
      )
      setError(null)
    },
    [storeSession],
  )

  const signOutAll = useCallback(async () => {
    const currentTokens = tokensRef.current
    if (!currentTokens) {
      clearSession()
      return
    }

    await signOutAllDevices(currentTokens.access_token)
    clearSession()
  }, [clearSession])

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: sessionAccessToken,
      changePassword,
      currentUser,
      error,
      signIn,
      signOut: clearSession,
      signOutAll,
      status,
      tokens,
      updateCurrentUser,
    }),
    [
      changePassword,
      clearSession,
      currentUser,
      error,
      signIn,
      sessionAccessToken,
      signOutAll,
      status,
      tokens,
      updateCurrentUser,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function shouldRefreshAccessToken(accessToken: string) {
  const expiresAt = readJwtExpiresAt(accessToken)
  if (expiresAt === null) {
    return true
  }

  return expiresAt - Date.now() <= ACCESS_TOKEN_REFRESH_BUFFER_MS
}

function getAccessTokenRefreshDelay(accessToken: string) {
  const expiresAt = readJwtExpiresAt(accessToken)
  if (expiresAt === null) {
    return FALLBACK_ACCESS_TOKEN_REFRESH_MS
  }

  return Math.max(0, expiresAt - Date.now() - ACCESS_TOKEN_REFRESH_BUFFER_MS)
}

function readJwtExpiresAt(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload || typeof window === 'undefined') {
    return null
  }

  try {
    const paddedPayload = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')
    const parsed = JSON.parse(window.atob(paddedPayload)) as { exp?: unknown }
    return typeof parsed.exp === 'number' ? parsed.exp * 1000 : null
  } catch {
    return null
  }
}

function isInvalidSessionError(error: unknown) {
  return error instanceof ApiError && error.status === 401
}
