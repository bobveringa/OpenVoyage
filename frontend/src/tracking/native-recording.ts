import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type NativeRecording = {
  sessionId: string
  tripId: string
  tripTitle: string | null
  userId: string
  apiBaseUrl: string
  startedAt: string
  endedAt: string | null
  travelMode: import('@/api/client').TravelMode
  pending: number
  dropped: number
  simulated?: number
  filtered?: number
  discarded?: number
  reason: string | null
  terminal?: boolean
  authPaused?: boolean
  expiresAt: string | null
  renewInMs: number
  lastSyncAt?: string
  ageUncertain?: boolean
  blocked?: boolean
  renewOnForeground?: boolean
  syncing?: boolean
  firstFixAt?: number
  totalPending?: number
  wifiOnlyUpload?: boolean
}

const plugin = registerPlugin<{
  recording(
    options: Record<string, unknown>,
  ): Promise<{ sessions: NativeRecording[] }>
  probe(options: {
    locationSource: string
  }): Promise<import('@/tracking/position-source').ProbeResult>
  start(options: Record<string, unknown>): Promise<unknown>
  configure(options: Record<string, unknown>): Promise<unknown>
  resume(): Promise<unknown>
  stop(): Promise<void>
  getState(): Promise<import('@/tracking/position-source').NativeTrackingState>
  addListener(
    event:
      | 'fixAvailable'
      | 'stopRequested'
      | 'engineWarning'
      | 'engineFailed'
      | 'adaptiveStateChanged',
    listener: () => void,
  ): Promise<PluginListenerHandle>
}>('Tracking')

export const NativeTracking = plugin
export async function nativeRecording(
  op: string,
  options: Record<string, unknown> = {},
) {
  return (await plugin.recording({ ...options, op })).sessions
}
