import { Loader2, MapPinned, Save, Server } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { getCurrentServerUrl, setStoredServerUrl } from '@/native/server-config'
import {
  BATTERY_SAVER_INTERVAL_FLOOR_SECONDS,
  TRACKING_INTERVAL_OPTIONS_SECONDS,
  readTrackingSettings,
  writeTrackingSettings,
  type NotificationDetail,
  type TrackingSettings,
} from '@/tracking/tracking-settings'
import { TRAVEL_MODE_OPTIONS } from '@/tracking/travel-mode-options'
import { useTracking } from '@/tracking/use-tracking'

const INTERVAL_OPTIONS = TRACKING_INTERVAL_OPTIONS_SECONDS.map((seconds) => ({
  label: seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute${seconds === 60 ? '' : 's'}`,
  value: String(seconds),
}))

const NOTIFICATION_DETAIL_OPTIONS: ReadonlyArray<{
  label: string
  value: NotificationDetail
}> = [
  { label: 'Detailed (show queue depth)', value: 'detailed' },
  { label: 'Minimal', value: 'minimal' },
]

export function TrackingSettingsPage() {
  const { activeSession, queueStats } = useTracking()
  const [settings, setSettings] = useState<TrackingSettings | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingServer, setIsSavingServer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    void readTrackingSettings().then(setSettings)
    setServerUrl(getCurrentServerUrl())
  }, [])

  if (!settings) {
    return <LoadingState label="Loading tracking settings" />
  }

  const queueNonEmpty = (queueStats?.sampleCount ?? 0) > 0
  const domainSwitchBlocked = Boolean(activeSession) || queueNonEmpty

  function updateSettings(patch: Partial<TrackingSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current))
  }

  async function handleSave() {
    if (!settings || isSaving) {
      return
    }
    setIsSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await writeTrackingSettings(settings)
      setSuccess('Tracking settings saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveServer() {
    if (isSavingServer || domainSwitchBlocked) {
      return
    }
    setIsSavingServer(true)
    setError(null)
    setSuccess(null)
    try {
      await setStoredServerUrl(serverUrl)
      setSuccess('Server updated.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update server')
    } finally {
      setIsSavingServer(false)
    }
  }

  const effectiveInterval = settings.batterySaver
    ? Math.max(settings.intervalSeconds, BATTERY_SAVER_INTERVAL_FLOOR_SECONDS)
    : settings.intervalSeconds

  return (
    <div className="space-y-6 py-6 sm:py-8 lg:py-10">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          Native app
        </p>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">
            GPS tracking
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            These settings apply to every recording you start from a trip's GPS
            panel on this device.
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm font-medium text-emerald-700" role="status">
          {success}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MapPinned className="size-5" aria-hidden="true" />
            Recording
          </CardTitle>
          <CardDescription>
            A fixed interval keeps battery use predictable. Smart, speed-based
            intervals are planned for a later release.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">Interval</span>
              <Select
                ariaLabel="Recording interval"
                onValueChange={(value) =>
                  updateSettings({ intervalSeconds: Number(value) })
                }
                options={INTERVAL_OPTIONS}
                value={String(settings.intervalSeconds)}
              />
              {settings.batterySaver && effectiveInterval !== settings.intervalSeconds ? (
                <span className="block text-xs text-muted-foreground">
                  Battery saver raises this to {effectiveInterval} seconds while
                  it's on.
                </span>
              ) : null}
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">Default travel mode</span>
              <Select
                ariaLabel="Default travel mode"
                onValueChange={(value) =>
                  updateSettings({ defaultTravelMode: value as TrackingSettings['defaultTravelMode'] })
                }
                options={TRAVEL_MODE_OPTIONS}
                value={settings.defaultTravelMode}
              />
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">
                Distance filter (meters)
              </span>
              <Input
                min={0}
                onChange={(event) =>
                  updateSettings({
                    distanceFilterMeters: Number(event.target.value),
                  })
                }
                type="number"
                value={settings.distanceFilterMeters}
              />
              <span className="block text-xs text-muted-foreground">
                0 disables distance-based filtering.
              </span>
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">
                Accuracy cutoff (meters)
              </span>
              <Input
                min={1}
                onChange={(event) =>
                  updateSettings({
                    accuracyThresholdMeters: Number(event.target.value),
                  })
                }
                type="number"
                value={settings.accuracyThresholdMeters}
              />
              <span className="block text-xs text-muted-foreground">
                Fixes less accurate than this are dropped before they're queued.
              </span>
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-foreground">Notification</span>
              <Select
                ariaLabel="Notification detail"
                onValueChange={(value) =>
                  updateSettings({ notificationDetail: value as NotificationDetail })
                }
                options={NOTIFICATION_DETAIL_OPTIONS}
                value={settings.notificationDetail}
              />
            </label>
          </div>

          <BatterySaverToggle
            enabled={settings.batterySaver}
            onToggle={() => updateSettings({ batterySaver: !settings.batterySaver })}
          />

          <div>
            <Button disabled={isSaving} onClick={() => void handleSave()} type="button">
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {isSaving ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Server className="size-5" aria-hidden="true" />
            Server
          </CardTitle>
          <CardDescription>
            Overrides which OpenVoyage server this device talks to. Only the
            current value is kept; it survives signing out.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="grid max-w-xl gap-1.5 text-sm">
            <span className="font-medium text-foreground">Server URL</span>
            <Input
              disabled={domainSwitchBlocked}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://travel.example.com"
              type="url"
              value={serverUrl}
            />
          </label>

          {domainSwitchBlocked ? (
            <p className="text-xs text-amber-700">
              Stop the active recording and let the queue finish syncing before
              changing servers — queued points only make sense against the
              server that owns them.
            </p>
          ) : null}

          <div>
            <Button
              disabled={isSavingServer || domainSwitchBlocked}
              onClick={() => void handleSaveServer()}
              type="button"
              variant="outline"
            >
              {isSavingServer ? 'Saving…' : 'Save server'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function BatterySaverToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Battery saver</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Uses balanced-power location and raises the interval floor to{' '}
          {BATTERY_SAVER_INTERVAL_FLOOR_SECONDS} seconds.
        </p>
      </div>
      <input
        aria-label="Battery saver"
        checked={enabled}
        className="peer sr-only"
        id="tracking-battery-saver"
        onChange={onToggle}
        role="switch"
        type="checkbox"
      />
      <label
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border p-0.5 transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background ${
          enabled ? 'border-primary bg-primary' : 'border-input bg-muted'
        }`}
        htmlFor="tracking-battery-saver"
      >
        <span
          className={`size-5 rounded-full bg-card shadow-sm transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
        <span className="sr-only">
          {enabled ? 'Battery saver is on' : 'Battery saver is off'}
        </span>
      </label>
    </div>
  )
}

