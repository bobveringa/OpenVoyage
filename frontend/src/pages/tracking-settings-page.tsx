import { ChevronDown, Loader2, MapPinned, Save, Server, SlidersHorizontal } from 'lucide-react'
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
  MANUAL_INTERVAL_OPTIONS_SECONDS,
  PRECISION_PRESETS,
  precisionPreset,
  readTrackingSettings,
  writeTrackingSettings,
  type LocationSource,
  type NotificationDetail,
  type PowerLevel,
  type PrecisionLevel,
  type TrackingMode,
  type TrackingSettings,
} from '@/tracking/tracking-settings'
import { TRAVEL_MODE_OPTIONS } from '@/tracking/travel-mode-options'
import { useTracking } from '@/tracking/use-tracking'

const INTERVAL_OPTIONS = MANUAL_INTERVAL_OPTIONS_SECONDS.map((seconds) => ({
  label:
    seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute${seconds === 60 ? '' : 's'}`,
  value: String(seconds),
}))

const POWER_OPTIONS: ReadonlyArray<{ label: string; value: PowerLevel }> = [
  { label: 'Battery saving', value: 'low' },
  { label: 'Balanced', value: 'balanced' },
  { label: 'High precision', value: 'high' },
]

const LOCATION_SOURCE_OPTIONS: ReadonlyArray<{ label: string; value: LocationSource }> = [
  { label: 'Automatic (recommended)', value: 'auto' },
  { label: 'Google Play Services', value: 'gms' },
  { label: "This device's own GPS", value: 'platform' },
]

const NOTIFICATION_DETAIL_OPTIONS: ReadonlyArray<{
  label: string
  value: NotificationDetail
}> = [
  { label: 'Detailed (show queue depth)', value: 'detailed' },
  { label: 'Minimal', value: 'minimal' },
]

function describePrecision(level: PrecisionLevel): string {
  const preset = precisionPreset(level)
  const spacing =
    preset.baselineSeconds < 60
      ? `${preset.baselineSeconds} seconds`
      : `${preset.baselineSeconds / 60} minute${preset.baselineSeconds === 60 ? '' : 's'}`
  return `About a point every ${spacing} while walking — closer together as you speed up, further apart while you're parked.`
}

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
            How your route is recorded
          </CardTitle>
          <CardDescription>
            Smart tracking adjusts itself as you move. Manual keeps one fixed
            interval, whatever you're doing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ModeTabs mode={settings.mode} onChange={(mode) => updateSettings({ mode })} />

          {settings.mode === 'smart' ? (
            <PrecisionSlider
              level={settings.smartPrecision}
              onChange={(smartPrecision) => updateSettings({ smartPrecision })}
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-foreground">Record a point every</span>
                <Select
                  ariaLabel="Recording interval"
                  onValueChange={(value) =>
                    updateSettings({ manualIntervalSeconds: Number(value) })
                  }
                  options={INTERVAL_OPTIONS}
                  value={String(settings.manualIntervalSeconds)}
                />
                <span className="block text-xs text-muted-foreground">
                  Kept exactly, whether you're walking, driving, or standing
                  still.
                </span>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium text-foreground">Power use</span>
                <Select
                  ariaLabel="Power use"
                  onValueChange={(value) =>
                    updateSettings({ manualPowerLevel: value as PowerLevel })
                  }
                  options={POWER_OPTIONS}
                  value={settings.manualPowerLevel}
                />
                <span className="block text-xs text-muted-foreground">
                  How hard the phone works for each point. Lower settings can be
                  less accurate indoors and away from towns.
                </span>
              </label>
            </div>
          )}

          <label className="block max-w-sm space-y-1.5 text-sm">
            <span className="font-medium text-foreground">Default travel mode</span>
            <Select
              ariaLabel="Default travel mode"
              onValueChange={(value) =>
                updateSettings({
                  defaultTravelMode: value as TrackingSettings['defaultTravelMode'],
                })
              }
              options={TRAVEL_MODE_OPTIONS}
              value={settings.defaultTravelMode}
            />
          </label>

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

          <AdvancedSection
            activeSession={Boolean(activeSession)}
            onChange={updateSettings}
            settings={settings}
          />
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

function ModeTabs({
  mode,
  onChange,
}: {
  mode: TrackingMode
  onChange: (mode: TrackingMode) => void
}) {
  const options: ReadonlyArray<{ label: string; value: TrackingMode }> = [
    { label: 'Smart', value: 'smart' },
    { label: 'Manual', value: 'manual' },
  ]

  return (
    <div
      aria-label="Tracking mode"
      className="inline-grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted p-1"
      role="tablist"
    >
      {options.map((option) => (
        <button
          aria-selected={mode === option.value}
          className={`rounded-xl px-6 py-2 text-sm font-medium transition-colors ${
            mode === option.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function PrecisionSlider({
  level,
  onChange,
}: {
  level: PrecisionLevel
  onChange: (level: PrecisionLevel) => void
}) {
  const preset = precisionPreset(level)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">Precision</span>
        <span className="text-sm font-semibold text-primary">{preset.label}</span>
      </div>

      <input
        aria-label="Precision"
        aria-valuetext={preset.label}
        className="w-full accent-primary"
        list="precision-marks"
        max={PRECISION_PRESETS.length}
        min={1}
        onChange={(event) => onChange(Number(event.target.value) as PrecisionLevel)}
        step={1}
        type="range"
        value={level}
      />
      <datalist id="precision-marks">
        {PRECISION_PRESETS.map((mark) => (
          <option key={mark.level} value={mark.level} />
        ))}
      </datalist>

      <div className="flex justify-between text-[11px] leading-4 text-muted-foreground">
        <span>Save battery</span>
        <span>More detail</span>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">{describePrecision(level)}</p>
    </div>
  )
}

function AdvancedSection({
  activeSession,
  settings,
  onChange,
}: {
  activeSession: boolean
  settings: TrackingSettings
  onChange: (patch: Partial<TrackingSettings>) => void
}) {
  return (
    <details className="group rounded-xl border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground">
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Advanced
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="grid gap-5 border-t border-border px-4 py-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-foreground">
            Ignore points less accurate than
          </span>
          <Input
            min={1}
            onChange={(event) =>
              onChange({ accuracyThresholdMeters: Number(event.target.value) })
            }
            type="number"
            value={settings.accuracyThresholdMeters}
          />
          <span className="block text-xs text-muted-foreground">
            In metres. Applies to both smart and manual recording.
          </span>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-foreground">
            Minimum distance between points
          </span>
          <Input
            min={0}
            onChange={(event) =>
              onChange({ distanceFilterMeters: Number(event.target.value) })
            }
            type="number"
            value={settings.distanceFilterMeters}
          />
          <span className="block text-xs text-muted-foreground">
            {settings.mode === 'smart'
              ? 'Not used in smart mode — the speed-based interval already spaces points out.'
              : 'In metres. 0 records on the interval alone.'}
          </span>
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Location source</span>
          <Select
            ariaLabel="Location source"
            disabled={activeSession}
            onValueChange={(value) => onChange({ locationSource: value as LocationSource })}
            options={LOCATION_SOURCE_OPTIONS}
            value={settings.locationSource}
          />
          <span className="block text-xs text-muted-foreground">
            {settings.locationSource === 'platform'
              ? "Android's own provider. Works without Google Play Services."
              : settings.locationSource === 'gms'
                ? 'Requires Google Play Services; recording refuses to start without it.'
                : 'Google Play Services where available, the device’s own provider where not.'}
          </span>
          {activeSession ? (
            <span className="block text-xs text-amber-700">
              Stop the active recording to change this.
            </span>
          ) : null}
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Notification</span>
          <Select
            ariaLabel="Notification detail"
            onValueChange={(value) =>
              onChange({ notificationDetail: value as NotificationDetail })
            }
            options={NOTIFICATION_DETAIL_OPTIONS}
            value={settings.notificationDetail}
          />
        </label>
      </div>
    </details>
  )
}
