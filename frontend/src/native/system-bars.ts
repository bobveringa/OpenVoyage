import { SystemBars, SystemBarsStyle } from '@capacitor/core'

import type { ThemeMode } from '@/theme/theme-contract'

import { isNativePlatform } from './platform'

export function syncSystemBarsStyle(mode: ThemeMode) {
  if (!isNativePlatform()) return

  void SystemBars.setStyle({
    style: mode === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  }).catch(() => undefined)
}
