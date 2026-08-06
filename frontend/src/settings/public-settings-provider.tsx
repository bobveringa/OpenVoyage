import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { getPublicSettings } from '@/api/client'
import {
  PublicSettingsContext,
  type PublicSettingValues,
} from '@/settings/public-settings-context'

export function PublicSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettingValues>({})
  const isMountedRef = useRef(false)
  const refreshGenerationRef = useRef(0)

  const refresh = useCallback(async () => {
    const generation = refreshGenerationRef.current + 1
    refreshGenerationRef.current = generation

    try {
      const response = await getPublicSettings()
      if (
        !isMountedRef.current ||
        refreshGenerationRef.current !== generation
      ) {
        return false
      }
      setSettings(response.settings)
      return true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    void refresh()

    return () => {
      isMountedRef.current = false
      refreshGenerationRef.current += 1
    }
  }, [refresh])

  const value = useMemo(
    () => ({ refresh, settings }),
    [refresh, settings],
  )

  return (
    <PublicSettingsContext.Provider value={value}>
      {children}
    </PublicSettingsContext.Provider>
  )
}
