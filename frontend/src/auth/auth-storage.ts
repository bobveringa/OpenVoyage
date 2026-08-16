import type { AuthTokens } from '@/api/client'
import { getItem, removeItem, setItem } from '@/native/kv-storage'

const AUTH_STORAGE_KEY = 'openvoyage.auth'

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
