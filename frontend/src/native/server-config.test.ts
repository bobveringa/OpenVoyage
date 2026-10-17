import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getApiBaseUrl, setApiBaseUrl, type AuthTokens, type CurrentUser } from '@/api/client'
import { readStoredAuthTokens, writeCachedCurrentUser, writeStoredAuthTokens } from '@/auth/auth-storage'
import { bootstrapNativeApiBaseUrl, getStoredServerUrl, setStoredServerUrl } from './server-config'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@/native/kv-storage', () => ({
  getItem: async (key: string) => storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { storage.set(key, value) },
  removeItem: async (key: string) => { storage.delete(key) },
}))
vi.mock('@/native/platform', () => ({ isNativePlatform: () => true }))

const reload = vi.fn()
const tokens: AuthTokens = {
  access_token: 'access-a', refresh_token: 'refresh-a', id_token: 'id-a', token_type: 'bearer',
}

beforeEach(async () => {
  storage.clear()
  reload.mockReset()
  setApiBaseUrl('https://server-a.test')
  await writeStoredAuthTokens(tokens)
  await writeCachedCurrentUser({ id: 'user-a' } as CurrentUser)
  vi.stubGlobal('window', { location: { reload } })
})

afterEach(() => vi.unstubAllGlobals())

it('clears credentials, saves the server and reloads without retargeting the running session', async () => {
  await setStoredServerUrl('https://server-b.test/')
  expect(await getStoredServerUrl()).toBe('https://server-b.test')
  expect(storage.has('openvoyage.auth')).toBe(false)
  expect(storage.has('openvoyage.auth.cached-user')).toBe(false)
  expect(reload).toHaveBeenCalledOnce()
  expect(getApiBaseUrl()).toBe('https://server-a.test')

  await bootstrapNativeApiBaseUrl()
  expect(getApiBaseUrl()).toBe('https://server-b.test')
  expect(await readStoredAuthTokens()).toBeNull()
})

it('rejects a late credential write from the old document after the new server boots', async () => {
  await setStoredServerUrl('https://server-b.test')
  // Work completing before the reload still belongs to the old server.
  await writeStoredAuthTokens(tokens)
  await bootstrapNativeApiBaseUrl()
  expect(await readStoredAuthTokens()).toBeNull()
})

it('keeps the session when saving an equivalent server address', async () => {
  await setStoredServerUrl('https://SERVER-A.test:443/')
  expect(await readStoredAuthTokens()).toEqual(tokens)
  expect(storage.has('openvoyage.auth.cached-user')).toBe(true)
  expect(reload).not.toHaveBeenCalled()
})

it('supports first-run setup by applying the saved address on reload', async () => {
  storage.clear()
  await setStoredServerUrl('http://home-server.test:8000')
  expect(reload).toHaveBeenCalledOnce()
  await bootstrapNativeApiBaseUrl()
  expect(getApiBaseUrl()).toBe('http://home-server.test:8000')
})

it('leaves the session intact when the server address is invalid', async () => {
  await expect(setStoredServerUrl('invalid')).rejects.toThrow()
  expect(await readStoredAuthTokens()).toEqual(tokens)
  expect(reload).not.toHaveBeenCalled()
})
