import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
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

export function AuthProvider({ children }: AuthProviderProps) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  const storeSession = useCallback((nextTokens: AuthTokens) => {
    writeStoredAuthTokens(nextTokens)
    setTokens(nextTokens)
  }, [])

  const clearSession = useCallback(() => {
    clearStoredAuthTokens()
    setTokens(null)
    setCurrentUser(null)
    setStatus('unauthenticated')
  }, [])

  const updateCurrentUser = useCallback((user: CurrentUser) => {
    setCurrentUser(user)
  }, [])

  useEffect(() => {
    let isCurrent = true

    async function restoreSession() {
      const storedTokens = readStoredAuthTokens()
      if (!storedTokens) {
        setStatus('unauthenticated')
        return
      }

      setTokens(storedTokens)

      try {
        const user = await readCurrentUser(storedTokens.access_token)
        if (!isCurrent) {
          return
        }
        setCurrentUser(user)
        setStatus('authenticated')
        setError(null)
      } catch {
        try {
          const refreshedTokens = await refreshAuthTokens(
            storedTokens.refresh_token,
          )
          const user = await readCurrentUser(refreshedTokens.access_token)
          if (!isCurrent) {
            return
          }
          writeStoredAuthTokens(refreshedTokens)
          setTokens(refreshedTokens)
          setCurrentUser(user)
          setStatus('authenticated')
          setError(null)
        } catch (refreshError) {
          if (!isCurrent) {
            return
          }
          clearStoredAuthTokens()
          setTokens(null)
          setCurrentUser(null)
          setStatus('unauthenticated')
          setError(getErrorMessage(refreshError))
        }
      }
    }

    void restoreSession()

    return () => {
      isCurrent = false
    }
  }, [])

  const signIn = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      const nextTokens = await loginRequest(email, password)
      const user = await readCurrentUser(nextTokens.access_token)
      storeSession(nextTokens)
      setCurrentUser(user)
      setStatus('authenticated')
      setError(null)
      return user
    },
    [storeSession],
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
