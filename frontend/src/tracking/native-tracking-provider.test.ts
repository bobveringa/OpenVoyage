import { act, createElement, useContext, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthContextValue } from '@/auth/auth-context'
import { ApiError } from '@/api/client'
import { NativeTrackingProvider } from './native-tracking-provider'
import { TrackingContext, type TrackingContextValue } from './tracking-context'
import type { NativeRecording } from './native-recording'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  recording: vi.fn(),
  provision: vi.fn(),
  state: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  probe: vi.fn(),
  appListener: vi.fn(),
  networkListener: vi.fn(),
  nativeListener: vi.fn(),
}))
vi.mock('@/auth/use-auth', () => ({ useAuth: mocks.auth }))
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  getApiBaseUrl: () => 'https://travel.test',
  provisionTrackingUploadToken: mocks.provision,
}))
vi.mock('@/tracking/native-recording', () => ({
  nativeRecording: mocks.recording,
  NativeTracking: {
    getState: mocks.state,
    addListener: mocks.nativeListener,
    start: mocks.start,
    stop: mocks.stop,
    probe: mocks.probe,
    resume: vi.fn(),
    configure: vi.fn(),
  },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.appListener } }))
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: true }),
    addListener: mocks.networkListener,
  },
}))
vi.mock('@/native/tracking-onboarding', () => ({
  requestNotificationPermission: async () => true,
  requestBackgroundLocation: async () => true,
  requestIgnoreBatteryOptimizations: async () => true,
}))

let root: Root
let container: HTMLDivElement
let value: TrackingContextValue
let rows: NativeRecording[]
let auth: AuthContextValue
function Capture() {
  const context = useContext(TrackingContext)!
  useEffect(() => {
    value = context
  }, [context])
  return null
}
const recording = (): NativeRecording => ({
  sessionId: 'session',
  tripId: 'other-trip',
  tripTitle: 'Other trip',
  userId: 'user',
  apiBaseUrl: 'https://travel.test',
  startedAt: '2026-10-16T10:00:00Z',
  endedAt: null,
  travelMode: 'WALK',
  pending: 3,
  dropped: 0,
  reason: 'Upload authorization expired; open online to resume syncing.',
  expiresAt: '2026-10-16T10:20:00Z',
  renewInMs: 0,
  authPaused: true,
})
const render = () =>
  act(async () =>
    root.render(
      createElement(NativeTrackingProvider, null, createElement(Capture)),
    ),
  )

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  rows = []
  auth = {
    status: 'authenticated',
    accessToken: 'access',
    currentUser: { id: 'user' },
  } as AuthContextValue
  mocks.auth.mockImplementation(() => auth)
  mocks.recording.mockImplementation(async (op, options) => {
    if (op === 'credential')
      rows = rows.map((s) =>
        s.sessionId === options.sessionId
          ? {
              ...s,
              authPaused: false,
              blocked: false,
              renewInMs: 720_000,
              reason: null,
            }
          : s,
      )
    return rows
  })
  mocks.provision.mockResolvedValue({ token: {}, remainingMs: 720_000 })
  mocks.state.mockResolvedValue({ tracking: false, trackingIntent: false })
  mocks.probe.mockResolvedValue({ ok: true })
  mocks.appListener.mockResolvedValue({ remove: vi.fn() })
  mocks.networkListener.mockResolvedValue({ remove: vi.fn() })
  mocks.nativeListener.mockResolvedValue({ remove: vi.fn() })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('renews stopped recordings from other trips without restarting GPS', async () => {
  rows = [{ ...recording(), endedAt: '2026-10-16T10:10:00Z' }]
  await render()
  expect(mocks.provision).toHaveBeenCalledExactlyOnceWith({
    accessToken: 'access',
    tripId: 'other-trip',
    sessionId: 'session',
  })
  expect(mocks.start).not.toHaveBeenCalled()
  expect(value.status).toBe('syncing')
  expect(value.canStartRecording).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(10_000))
  expect(mocks.provision).toHaveBeenCalledTimes(1)
  // Polling snapshots cannot undo an explicit sign-out's native identity clear.
  expect(
    mocks.recording.mock.calls.filter(([op]) => op === 'identity'),
  ).toHaveLength(1)
})

it('manually syncs a Wi-Fi-only recording without changing its settings or restarting GPS', async () => {
  rows = [{ ...recording(), wifiOnlyUpload: true }]
  await render()
  expect(value.wifiOnlyUpload).toBe(true)
  await act(async () => value.syncNow!())
  expect(mocks.recording).toHaveBeenCalledWith('syncNow', { sessionId: 'session' })
  expect(mocks.recording.mock.calls.some(([op]) => op === 'settings')).toBe(false)
  expect(mocks.start).toHaveBeenCalledTimes(1) // Recovery only; manual sync doesn't restart capture.
  expect(value.queueStats?.sampleCount).toBe(3)
})

it('does not restart an upload already in progress', async () => {
  rows = [{ ...recording(), syncing: true }]
  await render()
  await act(async () => value.syncNow!())
  expect(mocks.recording.mock.calls.some(([op]) => op === 'syncNow')).toBe(false)
})

it('does not request a manual upload after the account changes during renewal', async () => {
  rows = [{ ...recording(), authPaused: false, reason: null, renewInMs: 720_000 }]
  await render()
  rows[0] = { ...rows[0], renewInMs: 0 }
  let resolve!: (result: { token: object; remainingMs: number }) => void
  mocks.provision.mockImplementation(() => new Promise((r) => { resolve = r }))
  let sync!: Promise<void>
  await act(async () => { sync = value.syncNow!() })
  auth = { ...auth, currentUser: { id: 'next-user' } as AuthContextValue['currentUser'] }
  await render()
  await act(async () => {
    resolve({ token: {}, remainingMs: 720_000 })
    await sync
  })
  expect(mocks.recording.mock.calls.some(([op]) => op === 'syncNow')).toBe(false)
})

it('serializes foreground/network wake events while provisioning is in flight', async () => {
  rows = [recording()]
  let resolve!: (result: { token: object; remainingMs: number }) => void
  mocks.provision.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  await render()
  const wake = mocks.appListener.mock.calls[0][1] as (event: {
    isActive: boolean
  }) => void
  await act(async () => {
    wake({ isActive: true })
    wake({ isActive: true })
  })
  expect(mocks.provision).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ token: {}, remainingMs: 720_000 }))
  expect(value.activeSession?.sessionId).toBe('session')
})

it('does not install a token if the signed-in account changes during provisioning', async () => {
  rows = [recording()]
  let resolve!: (result: { token: object; remainingMs: number }) => void
  mocks.provision.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  await render()
  auth = {
    ...auth,
    currentUser: { id: 'next-user' } as AuthContextValue['currentUser'],
  }
  await render()
  await act(async () => resolve({ token: {}, remainingMs: 720_000 }))
  expect(mocks.recording.mock.calls.some(([op]) => op === 'credential')).toBe(
    false,
  )
  expect(value.activeSession).toBeNull()
})

it('renews near expiry across several foreground leases without creating a recording', async () => {
  rows = [
    { ...recording(), authPaused: false, reason: null, renewInMs: 1_200_000 },
  ]
  let deadline = Date.now() + 1_200_000
  mocks.provision.mockResolvedValue({ token: {}, remainingMs: 1_200_000 })
  mocks.recording.mockImplementation(async (op) => {
    if (op === 'credential') deadline = Date.now() + 1_200_000
    rows[0] = { ...rows[0], renewInMs: Math.max(0, deadline - Date.now()) }
    return rows
  })
  await render()
  expect(mocks.provision).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(18 * 60_000))
  expect(mocks.provision).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(mocks.provision).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(19 * 60_000))
  expect(mocks.provision).toHaveBeenCalledTimes(2)
  expect(mocks.recording.mock.calls.some(([op]) => op === 'begin')).toBe(false)
})

it('does not renew terminal, blocked, other-account, or other-server recordings', async () => {
  rows = [
    { ...recording(), terminal: true },
    { ...recording(), blocked: true },
    { ...recording(), userId: 'other-user' },
    { ...recording(), apiBaseUrl: 'https://old-server.test' },
  ]
  await render()
  await act(async () => vi.advanceTimersByTimeAsync(15_000))
  expect(mocks.provision).not.toHaveBeenCalled()
})

it('does not loop on a denied provision request and retains the queue', async () => {
  rows = [recording()]
  mocks.provision.mockRejectedValue(
    new ApiError(403, 'Trip membership required', 'Trip membership required'),
  )
  await render()
  await act(async () => vi.advanceTimersByTimeAsync(20_000))
  expect(mocks.provision).toHaveBeenCalledTimes(1)
  expect(value.queueStats?.sampleCount).toBe(3)
  expect(value.error).toBe('Trip membership required')
})

it('waits for authentication restoration without clearing native identity', async () => {
  auth = { ...auth, status: 'loading', currentUser: null }
  await render()
  expect(mocks.recording).not.toHaveBeenCalled()
  auth = { ...auth, status: 'unavailable' }
  await render()
  expect(mocks.recording).not.toHaveBeenCalled()
  auth = { ...auth, status: 'unauthenticated' }
  await render()
  expect(mocks.recording).not.toHaveBeenCalled()
})

it('rechecks a permission pause once per foreground visit without a renewal loop', async () => {
  rows = [
    {
      ...recording(),
      blocked: true,
      renewOnForeground: true,
      authPaused: false,
      renewInMs: 3_600_000,
    },
  ]
  await render()
  expect(mocks.provision).toHaveBeenCalledTimes(1)
  rows[0] = { ...rows[0], blocked: true, renewOnForeground: true }
  await act(async () => vi.advanceTimersByTimeAsync(20_000))
  expect(mocks.provision).toHaveBeenCalledTimes(1)
  const wake = mocks.appListener.mock.calls[0][1] as (event: {
    isActive: boolean
  }) => void
  await act(async () => wake({ isActive: true }))
  expect(mocks.provision).toHaveBeenCalledTimes(2)
})

it('confirms the first saved fix on its event and skips confirmation after a WebView reload', async () => {
  const recordingCommand = mocks.recording.getMockImplementation()!
  mocks.recording.mockImplementation(async (op, options) => {
    if (op === 'begin')
      rows = [{ ...recording(), sessionId: options.sessionId }]
    return recordingCommand(op, options)
  })
  await render()
  await act(async () =>
    value.startTracking({
      tripId: 'other-trip',
      tripTitle: 'Other trip',
      currentUserId: 'user',
      accessToken: 'access',
    }),
  )
  expect(value.startupFeedback).toEqual({ locationFoundAt: null })
  rows[0] = { ...rows[0], firstFixAt: Date.now() - 20_000 }
  const onFix = mocks.nativeListener.mock.calls.find(
    ([event]) => event === 'fixAvailable',
  )![1] as () => void
  await act(async () => onFix())
  expect(value.startupFeedback?.locationFoundAt).toBe(Date.now())
  await act(async () => root.unmount())
  root = createRoot(container)
  await render()
  expect(value.startupFeedback).toBeNull()
})
