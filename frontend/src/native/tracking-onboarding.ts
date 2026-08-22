import { registerPlugin } from '@capacitor/core'

import { isNativePlatform } from '@/native/platform'

interface TrackingOnboardingPlugin {
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>
  isNotificationPermissionGranted(): Promise<{ granted: boolean }>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  isBackgroundLocationGranted(): Promise<{ granted: boolean }>
  requestBackgroundLocation(): Promise<{ granted: boolean }>
}

// Android-only custom plugin (android/app/.../TrackingOnboardingPlugin.java).
// Every export below is a no-op success on web, where neither concept
// applies, so callers don't need their own platform branch.
const TrackingOnboarding = registerPlugin<TrackingOnboardingPlugin>(
  'TrackingOnboarding',
)

export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (!isNativePlatform()) {
    return true
  }
  return (await TrackingOnboarding.isIgnoringBatteryOptimizations()).ignoring
}

export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (!isNativePlatform()) {
    return true
  }
  return (await TrackingOnboarding.requestIgnoreBatteryOptimizations()).ignoring
}

export async function isNotificationPermissionGranted(): Promise<boolean> {
  if (!isNativePlatform()) {
    return true
  }
  return (await TrackingOnboarding.isNotificationPermissionGranted()).granted
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNativePlatform()) {
    return true
  }
  return (await TrackingOnboarding.requestNotificationPermission()).granted
}

// Belt-and-suspenders on top of the foreground service (§11): only
// meaningful once foreground location is already granted, so call this
// after starting the position watcher, not before.
export async function requestBackgroundLocation(): Promise<boolean> {
  if (!isNativePlatform()) {
    return true
  }
  return (await TrackingOnboarding.requestBackgroundLocation()).granted
}
