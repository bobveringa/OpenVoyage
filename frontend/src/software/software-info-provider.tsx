import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { getApiBaseUrl, getErrorMessage, getServerVersion, getSoftwareUpdates, type SoftwareUpdate } from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import { SoftwareInfoContext } from './software-info-context'

export function SoftwareInfoProvider({ children }: { children: ReactNode }) {
  const { currentUser, accessToken } = useAuth()
  const baseUrl = getApiBaseUrl()
  const isAdmin = currentUser?.role === 'ADMIN' && !currentUser.password_change_required
  const scope = `${baseUrl}:${currentUser?.id ?? ''}:${isAdmin}`
  const [server, setServer] = useState<{ baseUrl: string; version: string | null } | null>(null)
  const [cache, setCache] = useState<{ scope: string; data: SoftwareUpdate } | null>(null)
  const [error, setError] = useState<{ scope: string; message: string } | null>(null)
  const updateRequest = useRef<AbortController | null>(null)
  const serverRequest = useRef<AbortController | null>(null)

  const refreshServer = useCallback(async () => {
    serverRequest.current?.abort()
    const controller = new AbortController()
    serverRequest.current = controller
    try {
      const data = await getServerVersion(controller.signal)
      if (!controller.signal.aborted) setServer({ baseUrl, version: data.version })
    } catch {
      if (!controller.signal.aborted) setServer({ baseUrl, version: null })
    }
  }, [baseUrl])

  const refreshUpdates = useCallback(async () => {
    if (!isAdmin || !accessToken) return
    updateRequest.current?.abort()
    const controller = new AbortController()
    updateRequest.current = controller
    try {
      const data = await getSoftwareUpdates(accessToken, controller.signal)
      if (!controller.signal.aborted) {
        setCache({ scope, data }); setError(null)
        setServer({ baseUrl, version: data.installed_version })
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError({ scope, message: getErrorMessage(cause) })
    }
  }, [accessToken, isAdmin, scope, baseUrl])

  useEffect(() => {
    void refreshServer()
    const timer = window.setInterval(() => { if (!document.hidden) void refreshServer() }, 15 * 60_000)
    const focus = () => { if (!document.hidden) void refreshServer() }
    document.addEventListener('visibilitychange', focus)
    return () => {
      serverRequest.current?.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [refreshServer])

  useEffect(() => {
    void refreshUpdates()
    const timer = window.setInterval(() => { if (!document.hidden) void refreshUpdates() }, 15 * 60_000)
    const focus = () => { if (!document.hidden) void refreshUpdates() }
    document.addEventListener('visibilitychange', focus)
    return () => {
      updateRequest.current?.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [refreshUpdates])

  return <SoftwareInfoContext.Provider value={{
    serverVersion: server?.baseUrl === baseUrl ? server.version : null,
    serverLoading: server?.baseUrl !== baseUrl,
    updates: isAdmin && cache?.scope === scope ? cache.data : null,
    updatesError: isAdmin && error?.scope === scope ? error.message : null,
    refreshServer, refreshUpdates,
  }}>{children}</SoftwareInfoContext.Provider>
}
