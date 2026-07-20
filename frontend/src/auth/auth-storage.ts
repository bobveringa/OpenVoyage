import type { AuthTokens } from '@/api/client'

const AUTH_STORAGE_KEY = 'openvoyage.auth'

export function readStoredAuthTokens(): AuthTokens | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AuthTokens>
    if (
      typeof parsed.access_token === 'string' &&
      typeof parsed.refresh_token === 'string' &&
      typeof parsed.id_token === 'string' &&
      typeof parsed.token_type === 'string'
    ) {
      return parsed as AuthTokens
    }
  } catch {
    clearStoredAuthTokens()
  }

  return null
}

export function writeStoredAuthTokens(tokens: AuthTokens) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokens))
}

export function clearStoredAuthTokens() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY)
}
