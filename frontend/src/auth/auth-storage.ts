import type { AuthTokens, CurrentUser } from '@/api/client'
import { getItem, removeItem, setItem } from '@/native/kv-storage'

const AUTH_STORAGE_KEY = 'openvoyage.auth'
const CACHED_USER_STORAGE_KEY = 'openvoyage.auth.cached-user'

export async function readStoredAuthTokens(): Promise<AuthTokens | null> {
  const rawValue = await getItem(AUTH_STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AuthTokens>
    if (isAuthTokens(parsed)) {
      return parsed
    }
  } catch {
    // Corrupt value below falls through to the same cleanup as a value that
    // parsed but didn't match the expected shape.
  }

  await clearStoredAuthTokens()
  return null
}

export async function writeStoredAuthTokens(tokens: AuthTokens): Promise<void> {
  await setItem(AUTH_STORAGE_KEY, JSON.stringify(tokens))
}

export async function clearStoredAuthTokens(): Promise<void> {
  await removeItem(AUTH_STORAGE_KEY)
}

function isAuthTokens(value: Partial<AuthTokens>): value is AuthTokens {
  return (
    typeof value.access_token === 'string' &&
    typeof value.refresh_token === 'string' &&
    typeof value.id_token === 'string' &&
    typeof value.token_type === 'string'
  )
}

// A cached copy of the last-known profile, used only so the app has
// *something* to render (nav, tracking indicator, "who am I") when a cold
// launch can't reach the server at all — never treated as authoritative once
// a real response comes back.
export async function readCachedCurrentUser(): Promise<CurrentUser | null> {
  const rawValue = await getItem(CACHED_USER_STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<CurrentUser>
    if (typeof parsed.id === 'string') {
      return parsed as CurrentUser
    }
  } catch {
    // Corrupt value falls through to cleanup below.
  }

  await removeItem(CACHED_USER_STORAGE_KEY)
  return null
}

export async function writeCachedCurrentUser(user: CurrentUser): Promise<void> {
  await setItem(CACHED_USER_STORAGE_KEY, JSON.stringify(user))
}

export async function clearCachedCurrentUser(): Promise<void> {
  await removeItem(CACHED_USER_STORAGE_KEY)
}
