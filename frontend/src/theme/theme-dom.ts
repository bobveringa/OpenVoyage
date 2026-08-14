import type { CSSProperties } from 'react'

import {
  THEME_ROLES,
  type ThemeColors,
  type ThemeMode,
  type ThemePalette,
  type ThemeRole,
} from '@/theme/theme-contract'

const roleToCssName: Record<ThemeRole, string> = {
  background: 'background', foreground: 'foreground', card: 'card', cardForeground: 'card-foreground',
  popover: 'popover', popoverForeground: 'popover-foreground', primary: 'primary', primaryForeground: 'primary-foreground',
  secondary: 'secondary', secondaryForeground: 'secondary-foreground', muted: 'muted', mutedForeground: 'muted-foreground',
  accent: 'accent', accentForeground: 'accent-foreground', border: 'border', input: 'input', ring: 'ring',
}

export function applyThemeToDocument(palette: ThemePalette, mode: ThemeMode) {
  const root = document.documentElement
  applyThemeSources(root.style, palette)
  root.classList.toggle('dark', mode === 'dark')
  root.dataset.theme = mode
  root.style.colorScheme = mode
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = palette[mode].background
}

export function applyThemeSources(style: CSSStyleDeclaration, palette: ThemePalette) {
  for (const mode of ['light', 'dark'] as const) {
    for (const role of THEME_ROLES) {
      style.setProperty(`--theme-${mode}-${roleToCssName[role]}`, palette[mode][role])
    }
  }
}

export function previewStyle(colors: ThemeColors): CSSProperties {
  const style: Record<string, string> = { colorScheme: 'light' }
  for (const role of THEME_ROLES) style[`--${roleToCssName[role]}`] = colors[role]
  return style as CSSProperties
}
