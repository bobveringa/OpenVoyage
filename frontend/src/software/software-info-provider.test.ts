import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SoftwareInfoProvider } from './software-info-provider'
import { useSoftwareInfo } from './software-info-context'
import type { SoftwareUpdate } from '@/api/client'

const api = vi.hoisted(() => ({ getSoftwareUpdates: vi.fn(), getServerVersion: vi.fn() }))
vi.mock('@/api/client', () => ({
  ...api, getApiBaseUrl: () => 'https://voyage.test', getErrorMessage: (error: Error) => error.message,
}))
let auth: { currentUser: { id: string; role: 'ADMIN' | 'USER'; password_change_required: boolean } | null; accessToken: string | null }
vi.mock('@/auth/use-auth', () => ({ useAuth: () => auth }))
const available: SoftwareUpdate = {
  installed_version: '0.5.0', comparison: 'update_available', check_status: 'ok', checks_enabled: true,
  latest_release: { version: '99.0.0', url: 'https://github.com/bobveringa/OpenVoyage/releases/tag/v99.0.0', published_at: '2026-10-29T12:00:00Z' },
  last_attempt_at: null, last_success_at: null, next_allowed_check_at: null, error_code: null, is_stale: false,
}
let root: Root
let container: HTMLDivElement
function Probe() {
  const info = useSoftwareInfo()
  return createElement('div', null,
    createElement('output', null, JSON.stringify({ version: info.serverVersion, comparison: info.updates?.comparison, error: info.updatesError })),
    createElement('button', { onClick: () => void info.refreshUpdates() }, 'Refresh'))
}
async function render() {
  await act(async () => root.render(createElement(SoftwareInfoProvider, { children: createElement(Probe) })))
}
function read() { return JSON.parse(container.querySelector('output')!.textContent!) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  auth = { currentUser: { id: 'admin-a', role: 'ADMIN', password_change_required: false }, accessToken: 'token-a' }
  api.getServerVersion.mockResolvedValue({ version: '0.5.0' })
  api.getSoftwareUpdates.mockResolvedValue(available)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

it('regular users get the public version without requesting admin information', async () => {
  auth.currentUser!.role = 'USER'
  await render()
  expect(read().version).toBe('0.5.0')
  expect(api.getSoftwareUpdates).not.toHaveBeenCalled()
})

it('clears visible admin results on account changes and ignores responses after logout', async () => {
  await render()
  expect(read().comparison).toBe('update_available')
  let resolve!: (value: SoftwareUpdate) => void
  api.getSoftwareUpdates.mockImplementationOnce(() => new Promise<SoftwareUpdate>((done) => { resolve = done }))
  auth = { currentUser: { id: 'admin-b', role: 'ADMIN', password_change_required: false }, accessToken: 'token-b' }
  await render()
  expect(read().comparison).toBeUndefined()
  auth = { currentUser: null, accessToken: null }
  await render()
  await act(async () => resolve(available))
  expect(read().comparison).toBeUndefined()
})

it('retains cached update information when refreshing fails', async () => {
  await render()
  api.getSoftwareUpdates.mockRejectedValueOnce(new Error('Offline'))
  await act(async () => container.querySelector('button')!.click())
  expect(read()).toMatchObject({ comparison: 'update_available', error: 'Offline' })
})
