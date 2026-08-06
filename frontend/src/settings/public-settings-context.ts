import { createContext } from 'react'

export type PublicSettingValues = Readonly<Record<string, unknown>>

export type PublicSettingsContextValue = {
  refresh: () => Promise<boolean>
  settings: PublicSettingValues
}

export const PublicSettingsContext =
  createContext<PublicSettingsContextValue | null>(null)
