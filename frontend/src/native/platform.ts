import { Capacitor } from '@capacitor/core'

// Centralizes the native/web check so call sites depend on this module
// rather than importing @capacitor/core directly, which keeps the native
// surface area easy to find and to stub in tests.
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}
