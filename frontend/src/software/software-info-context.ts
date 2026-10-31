import { createContext, useContext } from 'react'
import type { SoftwareUpdate } from '@/api/client'

export const CLIENT_VERSION = import.meta.env.VITE_APP_VERSION ?? 'development'

export type SoftwareInfo = {
  serverVersion: string | null
  serverLoading: boolean
  updates: SoftwareUpdate | null
  updatesError: string | null
  refreshUpdates: () => Promise<void>
  refreshServer: () => Promise<void>
}

export const SoftwareInfoContext = createContext<SoftwareInfo>({
  serverVersion: null, serverLoading: false, updates: null, updatesError: null,
  refreshUpdates: async () => {}, refreshServer: async () => {},
})

export function useSoftwareInfo() { return useContext(SoftwareInfoContext) }
