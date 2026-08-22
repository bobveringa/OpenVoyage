import { Preferences } from '@capacitor/preferences'

import { isNativePlatform } from '@/native/platform'

// @capacitor/preferences on native (survives webview restarts, matches the
// Android "long-lived, no repeated logins" requirement); localStorage on web
// (unchanged behavior for the existing browser app).
export async function getItem(key: string): Promise<string | null> {
  if (isNativePlatform()) {
    const { value } = await Preferences.get({ key })
    return value
  }
  return window.localStorage.getItem(key)
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isNativePlatform()) {
    await Preferences.set({ key, value })
    return
  }
  window.localStorage.setItem(key, value)
}

export async function removeItem(key: string): Promise<void> {
  if (isNativePlatform()) {
    await Preferences.remove({ key })
    return
  }
  window.localStorage.removeItem(key)
}
