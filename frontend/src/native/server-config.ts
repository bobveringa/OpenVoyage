import { getApiBaseUrl, setApiBaseUrl } from '@/api/client'
import { getItem, setItem } from '@/native/kv-storage'
import { isNativePlatform } from '@/native/platform'

const SERVER_URL_STORAGE_KEY = 'openvoyage.native.serverUrl'

// Only the current domain is stored; it survives logout but no history list
// is kept (per the design doc's domain-handling decision).
export async function getStoredServerUrl(): Promise<string | null> {
  return getItem(SERVER_URL_STORAGE_KEY)
}

export async function setStoredServerUrl(url: string): Promise<void> {
  const normalized = url.replace(/\/+$/, '')
  await setItem(SERVER_URL_STORAGE_KEY, normalized)
  setApiBaseUrl(normalized)
}

export function getCurrentServerUrl(): string {
  return getApiBaseUrl()
}

// True when a native build has no way to know its API server: no override
// saved on this device yet, and no VITE_API_BASE_URL was baked in at build
// time (the normal path for a build published with a fixed server). In that
// state the webview's own origin is the only fallback, which is never a
// real API — first run must block on NativeServerGate until this resolves.
export async function needsNativeServerSetup(): Promise<boolean> {
  if (!isNativePlatform()) {
    return false
  }
  if (import.meta.env.VITE_API_BASE_URL) {
    return false
  }
  const storedUrl = await getStoredServerUrl()
  return !storedUrl
}

// Applies a previously-stored native server override before the app renders
// its first authenticated request. Web builds are a no-op: same-origin (or
// VITE_API_BASE_URL) is already correct there. Must run before AuthProvider
// mounts, since restoring a session makes an authenticated request as soon
// as it does.
export async function bootstrapNativeApiBaseUrl(): Promise<void> {
  if (!isNativePlatform()) {
    return
  }

  const storedUrl = await getStoredServerUrl()
  if (storedUrl) {
    setApiBaseUrl(storedUrl)
  }
}
