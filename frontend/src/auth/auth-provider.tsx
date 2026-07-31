import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  configureAuthTokenRefresh,
  getErrorMessage,
  login as loginRequest,
  readCurrentUser,
  refreshAuthTokens,
  type AuthTokens,
  type CurrentUser,
} from '@/api/client'
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/auth/auth-context'
import {
  clearStoredAuthTokens,
  readStoredAuthTokens,
  writeStoredAuthTokens,
} from '@/auth/auth-storage'

type AuthProviderProps = {
  children: ReactNode
}

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000
const FALLBACK_ACCESS_TOKEN_REFRESH_MS = 10 * 60 * 1000

export function AuthProvider({ children }: AuthProviderProps) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const refreshPromiseRef = useRef<Promise<AuthTokens | null> | null>(null)
  const tokensRef = useRef<AuthTokens | null>(null)

  const storeSession = useCallback((nextTokens: AuthTokens) => {
    writeStoredAuthTokens(nextTokens)
    tokensRef.current = nextTokens
    setTokens(nextTokens)
  }, [])

  const clearSession = useCallback(() => {
    clearStoredAuthTokens()
    tokensRef.current = null
    refreshPromiseRef.current = null
    setTokens(null)
    setCurrentUser(null)
    setStatus('unauthenticated')
    setError(null)
  }, [])

  const updateCurrentUser = useCallback((user: CurrentUser) => {
    setCurrentUser(user)
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
            clearStoredAuthTokens()
            tokensRef.current = null
            setTokens(null)
            setCurrentUser(null)
            setStatus('unauthenticated')
            setError(getErrorMessage(refreshError))
          }
          return null
        })
        .finally(() => {
          if (refreshPromiseRef.current === refreshPromise) {
            refreshPromiseRef.current = null
          }
        })

      refreshPromiseRef.current = refreshPromise
      return refreshPromise
    },
    [storeSession],
  )

  useEffect(() => {
    configureAuthTokenRefresh(async ({ accessToken, forceRefresh }) => {
      const currentTokens = tokensRef.current
      if (!currentTokens) {
        return null
      }
      if (currentTokens.access_token !== accessToken) {
        return currentTokens.access_token
      }

      const nextTokens = await refreshSession({ force: forceRefresh })
      return nextTokens?.access_token ?? null
    })

    return () => configureAuthTokenRefresh(null)
  }, [refreshSession])

  useEffect(() => {
    let isCurrent = true

    async function restoreSession() {
      const storedTokens = readStoredAuthTokens()
      if (!storedTokens) {
        setStatus('unauthenticated')
        return
      }

      tokensRef.current = storedTokens
      setTokens(storedTokens)

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
      } catch (restoreError) {
        if (!isCurrent) {
          return
        }
        clearStoredAuthTokens()
        tokensRef.current = null
        setTokens(null)
        setCurrentUser(null)
        setStatus('unauthenticated')
        setError(getErrorMessage(restoreError))
      }
    }

    void restoreSession()

    return () => {
      isCurrent = false
    }
  }, [refreshSession])

  useEffect(() => {
    if (!tokens) {
      return
    }

    const timer = window.setTimeout(() => {
      void refreshSession({ force: true })
    }, getAccessTokenRefreshDelay(tokens.access_token))

    return () => window.clearTimeout(timer)
  }, [refreshSession, tokens])

  useEffect(() => {
    if (!tokens) {
      return
    }

    function refreshAfterBrowserWake() {
      void refreshSession()
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
        return user
      } catch (signInError) {
        clearSession()
        throw signInError
      }
    },
    [clearSession, storeSession],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: tokens?.access_token ?? null,
      currentUser,
      error,
      signIn,
      signOut: clearSession,
      status,
      tokens,
      updateCurrentUser,
    }),
    [clearSession, currentUser, error, signIn, status, tokens, updateCurrentUser],
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
