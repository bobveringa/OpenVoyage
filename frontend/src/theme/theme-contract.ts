export const THEME_PALETTE_KEY = 'theme.palette'
export const THEME_SCHEMA_VERSION = 1

export const THEME_ROLES = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'border',
  'input',
  'ring',
] as const

export type ThemeRole = (typeof THEME_ROLES)[number]
export type ThemeMode = 'dark' | 'light'
export type ThemeModePreference = ThemeMode
export type ThemeColors = Record<ThemeRole, string>
export type ThemePalette = {
  schema_version: typeof THEME_SCHEMA_VERSION
  light: ThemeColors
  dark: ThemeColors
}

export const DEFAULT_THEME_PALETTE: ThemePalette = {
  schema_version: THEME_SCHEMA_VERSION,
  light: {
    background: '#F7FBF7',
    foreground: '#183026',
    card: '#FFFFFF',
    cardForeground: '#183026',
    popover: '#FFFFFF',
    popoverForeground: '#183026',
    primary: '#246B49',
    primaryForeground: '#FFFFFF',
    secondary: '#EAF3EB',
    secondaryForeground: '#264B37',
    muted: '#EDF3ED',
    mutedForeground: '#587064',
    accent: '#D99A2B',
    accentForeground: '#332711',
    border: '#D4E1D6',
    input: '#7C9483',
    ring: '#2C7652',
  },
  dark: {
    background: '#121A27',
    foreground: '#E8EEF1',
    card: '#182231',
    cardForeground: '#E8EEF1',
    popover: '#182231',
    popoverForeground: '#E8EEF1',
    primary: '#65AFC8',
    primaryForeground: '#101923',
    secondary: '#263444',
    secondaryForeground: '#DFE9ED',
    muted: '#293746',
    mutedForeground: '#AABAC2',
    accent: '#E17D62',
    accentForeground: '#111923',
    border: '#35475A',
    input: '#71869B',
    ring: '#65AFC8',
  },
}

export type ThemePreset = {
  description: string
  id: string
  name: string
  palette: ThemePalette
}

function createPreset(
  id: string,
  name: string,
  description: string,
  colors: Partial<Record<ThemeMode, Partial<ThemeColors>>>,
): ThemePreset {
  return {
    id,
    name,
    description,
    palette: {
      schema_version: THEME_SCHEMA_VERSION,
      light: { ...DEFAULT_THEME_PALETTE.light, ...colors.light },
      dark: { ...DEFAULT_THEME_PALETTE.dark, ...colors.dark },
    },
  }
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  createPreset('openvoyage', 'OpenVoyage', 'The calm green and amber default.', {}),
  createPreset('ocean', 'Ocean', 'Clear blue surfaces with a coral highlight.', {
    light: {
      background: '#F5FAFE', foreground: '#132B3A', cardForeground: '#132B3A',
      popoverForeground: '#132B3A', primary: '#176B91', secondary: '#E2F1F8',
      secondaryForeground: '#163B50', muted: '#E9F3F8', mutedForeground: '#4D6978',
      accent: '#D9855E', accentForeground: '#321C14', border: '#C9DFE9', input: '#708B99', ring: '#176B91',
    },
    dark: {
      background: '#101B26', foreground: '#E2F0F6', card: '#152635', cardForeground: '#E2F0F6',
      popover: '#152635', popoverForeground: '#E2F0F6', primary: '#69B9DA', primaryForeground: '#0F1D27',
      secondary: '#213A4B', secondaryForeground: '#DCECF2', muted: '#273E4E', mutedForeground: '#AAC2CE',
      accent: '#E39A76', accentForeground: '#21140E', border: '#385466', input: '#7498AA', ring: '#69B9DA',
    },
  }),
  createPreset('violet', 'Violet', 'Warm violet with a bright citrus accent.', {
    light: {
      background: '#FAF8FE', foreground: '#2A203C', cardForeground: '#2A203C',
      popoverForeground: '#2A203C', primary: '#6543A8', secondary: '#EEE9FA',
      secondaryForeground: '#403066', muted: '#F1EDF8', mutedForeground: '#665D78',
      accent: '#C47A20', accentForeground: '#2B1B08', border: '#DDD4EE', input: '#887D9B', ring: '#6543A8',
    },
    dark: {
      background: '#191426', foreground: '#EEE9F7', card: '#231C34', cardForeground: '#EEE9F7',
      popover: '#231C34', popoverForeground: '#EEE9F7', primary: '#B79AE8', primaryForeground: '#221934',
      secondary: '#35294E', secondaryForeground: '#E9E1F6', muted: '#3A304F', mutedForeground: '#C1B6D0',
      accent: '#E5AA52', accentForeground: '#271B09', border: '#514267', input: '#9C8CB4', ring: '#B79AE8',
    },
  }),
  createPreset('forest', 'Forest', 'Earthy forest green and warm clay.', {
    light: {
      background: '#F7FAF4', foreground: '#1E3021', cardForeground: '#1E3021',
      popoverForeground: '#1E3021', primary: '#35683B', secondary: '#E8F0E3',
      secondaryForeground: '#2D4A30', muted: '#EDF2E9', mutedForeground: '#5E725D',
      accent: '#B9653D', accentForeground: '#1B0C06', border: '#D2DFCE', input: '#7E927D', ring: '#35683B',
    },
    dark: {
      background: '#141D15', foreground: '#E8F0E5', card: '#1C291D', cardForeground: '#E8F0E5',
      popover: '#1C291D', popoverForeground: '#E8F0E5', primary: '#91C48A', primaryForeground: '#152215',
      secondary: '#2D412D', secondaryForeground: '#E0EDDC', muted: '#344734', mutedForeground: '#B5C7B2',
      accent: '#DF8C65', accentForeground: '#28130C', border: '#485B47', input: '#8EA88B', ring: '#91C48A',
    },
  }),
  createPreset('rose', 'Rose', 'A soft rose palette with a berry action color.', {
    light: {
      background: '#FFF8FA', foreground: '#3A202B', cardForeground: '#3A202B',
      popoverForeground: '#3A202B', primary: '#9A3E62', secondary: '#FBE8EF',
      secondaryForeground: '#5F2940', muted: '#F9EEF2', mutedForeground: '#7B5A66',
      accent: '#B57622', accentForeground: '#201305', border: '#EFD2DC', input: '#9A7A85', ring: '#9A3E62',
    },
    dark: {
      background: '#25151C', foreground: '#F7E9EE', card: '#321D27', cardForeground: '#F7E9EE',
      popover: '#321D27', popoverForeground: '#F7E9EE', primary: '#E690AF', primaryForeground: '#2A1420',
      secondary: '#4A2A37', secondaryForeground: '#F4DFE6', muted: '#51323E', mutedForeground: '#D3B4BF',
      accent: '#E3AE58', accentForeground: '#291B08', border: '#6C4352', input: '#B78999', ring: '#E690AF',
    },
  }),
  createPreset('slate', 'Slate', 'A quiet neutral option with blue emphasis.', {
    light: {
      background: '#F8FAFC', foreground: '#1E293B', cardForeground: '#1E293B',
      popoverForeground: '#1E293B', primary: '#2563A8', secondary: '#E8EEF5',
      secondaryForeground: '#31445A', muted: '#EEF2F6', mutedForeground: '#5D6D7E',
      accent: '#BD7B26', accentForeground: '#2C1C08', border: '#D8E0E8', input: '#8191A1', ring: '#2563A8',
    },
    dark: {
      background: '#141A22', foreground: '#E8EDF3', card: '#1D2631', cardForeground: '#E8EDF3',
      popover: '#1D2631', popoverForeground: '#E8EDF3', primary: '#89B9F0', primaryForeground: '#132238',
      secondary: '#2B3948', secondaryForeground: '#E1E9F1', muted: '#344252', mutedForeground: '#BBC7D3',
      accent: '#E1AE58', accentForeground: '#281B08', border: '#4A5B6D', input: '#8FA5B9', ring: '#89B9F0',
    },
  }),
]

export function cloneThemePalette(palette: ThemePalette): ThemePalette {
  return { schema_version: THEME_SCHEMA_VERSION, light: { ...palette.light }, dark: { ...palette.dark } }
}

export function parseThemePalette(value: unknown): ThemePalette | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.schema_version !== THEME_SCHEMA_VERSION || !isExactKeys(candidate, ['schema_version', 'light', 'dark'])) return null
  const light = parseThemeColors(candidate.light)
  const dark = parseThemeColors(candidate.dark)
  return light && dark ? { schema_version: THEME_SCHEMA_VERSION, light, dark } : null
}

export function getThemePaletteIssues(palette: ThemePalette): string[] {
  const issues: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const colors = palette[mode]
    for (const [foreground, background] of [
      ['foreground', 'background'], ['cardForeground', 'card'], ['popoverForeground', 'popover'],
      ['primaryForeground', 'primary'], ['secondaryForeground', 'secondary'], ['mutedForeground', 'muted'], ['accentForeground', 'accent'],
    ] as const) {
      if (contrastRatio(colors[foreground], colors[background]) < 4.5) issues.push(`${mode}: ${foreground} needs 4.5:1 contrast against ${background}.`)
    }
    for (const role of ['primary', 'mutedForeground'] as const) {
      for (const surface of ['background', 'card'] as const) {
        if (contrastRatio(colors[role], colors[surface]) < 4.5) issues.push(`${mode}: ${role} needs 4.5:1 contrast against ${surface}.`)
      }
    }
    for (const role of ['ring', 'input'] as const) {
      for (const surface of ['background', 'card'] as const) {
        if (contrastRatio(colors[role], colors[surface]) < 3) issues.push(`${mode}: ${role} needs 3:1 contrast against ${surface}.`)
      }
    }
  }
  return issues
}

function parseThemeColors(value: unknown): ThemeColors | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isExactKeys(value as Record<string, unknown>, THEME_ROLES)) return null
  const colors = {} as ThemeColors
  for (const role of THEME_ROLES) {
    const color = (value as Record<string, unknown>)[role]
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return null
    colors[role] = color.toUpperCase()
  }
  return colors
}

function isExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

export function contrastRatio(first: string, second: string): number {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  }
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}
