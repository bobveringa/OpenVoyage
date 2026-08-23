import {
  AlertCircle,
  Check,
  Eye,
  Image,
  KeyRound,
  Map as MapIcon,
  Palette,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Server,
  ShieldCheck,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import {
  getErrorMessage,
  listAdminSettings,
  resetAdminSetting,
  updateAdminSetting,
  type AdminSetting,
  type SettingValidation,
} from '@/api/client'
import type { AdminSectionId } from '@/components/admin/admin-navigation'
import { JobsPanel } from '@/components/admin/jobs-panel'
import { ThemeEditor } from '@/components/admin/theme-editor'
import { UsersPanel } from '@/components/admin/users-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDateTime } from '@/lib/date-time'
import { MAP_TILE_PROVIDER_SETTING_KEY } from '@/lib/map-tile-providers'
import { cn } from '@/lib/utils'
import { usePublicSettings } from '@/settings/public-settings'

type AdminSectionsProps = {
  accessToken: string | null
  activeSection: AdminSectionId
}

type LoadStatus = 'error' | 'loading' | 'ready'
type EditorStatus = {
  message: string
  type: 'error' | 'success'
}

type SettingPresentation = {
  help: string
  inputType?: 'url'
  label: string
  optionLabels?: Record<string, string>
  placeholder?: string
}

const SETTING_KEYS = {
  themePalette: 'theme.palette',
  graphHopperApiKey: 'routing.graphhopper_api_key',
  graphHopperBaseUrl: 'routing.graphhopper_base_url',
  maxUploadSize: 'media.max_upload_size_mb',
  orphanRetentionDays: 'media.orphan_retention_days',
  geonamesDataset: 'places.geonames_dataset',
  mapTileProvider: MAP_TILE_PROVIDER_SETTING_KEY,
  routingProvider: 'routing.provider',
} as const

const settingPresentations: Record<string, SettingPresentation> = {
  [SETTING_KEYS.mapTileProvider]: {
    help: 'Set the tile URL template used as the base layer for every interactive trip map.',
    label: 'Tile URL template',
  },
  [SETTING_KEYS.routingProvider]: {
    help: 'Choose the engine used to generate itinerary travel routes.',
    label: 'Route provider',
    optionLabels: {
      graphhopper: 'GraphHopper',
      none: 'Routing disabled',
    },
  },
  [SETTING_KEYS.graphHopperBaseUrl]: {
    help: 'Requests and the configured API key are sent to this endpoint.',
    inputType: 'url',
    label: 'GraphHopper base URL',
    placeholder: 'https://graphhopper.com/api/1',
  },
  [SETTING_KEYS.graphHopperApiKey]: {
    help: 'Replace the write-only API key used to authenticate route requests.',
    label: 'GraphHopper API key',
    placeholder: 'Enter a new API key',
  },
  [SETTING_KEYS.maxUploadSize]: {
    help: 'Maximum accepted size for a single uploaded media file.',
    label: 'Maximum upload size',
    placeholder: '512',
  },
  [SETTING_KEYS.orphanRetentionDays]: {
    help: 'Media must remain unattached for this many whole days before cleanup.',
    label: 'Orphan retention (days)',
    placeholder: '1',
  },
  [SETTING_KEYS.geonamesDataset]: {
    help: 'The next GeoNames job execution downloads this supported dataset.',
    label: 'GeoNames dataset',
    optionLabels: {
      cities500: 'Cities with 500+ people',
      cities1000: 'Cities with 1,000+ people',
      cities5000: 'Cities with 5,000+ people',
      cities15000: 'Cities with 15,000+ people or capitals',
      allCountries: 'All countries',
    },
  },
}

export function AdminSections({
  accessToken,
  activeSection,
}: AdminSectionsProps) {
  if (activeSection === 'users') {
    return <UsersPanel accessToken={accessToken} />
  }

  return <SettingsAdminSections accessToken={accessToken} activeSection={activeSection} />
}

function SettingsAdminSections({
  accessToken,
  activeSection,
}: AdminSectionsProps) {
  const { refresh: refreshPublicSettings } = usePublicSettings()
  const [settings, setSettings] = useState<AdminSetting[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')

  const loadSettings = useCallback(async () => {
    if (!accessToken) {
      setLoadError('An authenticated admin session is required.')
      setLoadStatus('error')
      return
    }

    setLoadError(null)
    setLoadStatus('loading')

    try {
      const response = await listAdminSettings(accessToken)
      setSettings(response.settings)
      setLoadStatus('ready')
    } catch (error) {
      setLoadError(getErrorMessage(error))
      setLoadStatus('error')
    }
  }, [accessToken])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const settingsByKey = useMemo(
    () => new Map(settings.map((setting) => [setting.key, setting])),
    [settings],
  )

  function replaceSetting(nextSetting: AdminSetting) {
    setSettings((currentSettings) =>
      currentSettings.map((setting) =>
        setting.key === nextSetting.key ? nextSetting : setting,
      ),
    )
  }

  async function handleSave(key: string, value: unknown) {
    if (!accessToken) {
      throw new Error('An authenticated admin session is required.')
    }

    const nextSetting = await updateAdminSetting({ accessToken, key, value })
    replaceSetting(nextSetting)
    if (nextSetting.visibility === 'public') {
      await refreshPublicSettings()
    }
    return nextSetting
  }

  async function handleReset(key: string) {
    if (!accessToken) {
      throw new Error('An authenticated admin session is required.')
    }

    const nextSetting = await resetAdminSetting({ accessToken, key })
    replaceSetting(nextSetting)
    if (nextSetting.visibility === 'public') {
      await refreshPublicSettings()
    }
    return nextSetting
  }

  const panelProps = {
    'aria-labelledby': `admin-tab-${activeSection}`,
    id: `admin-panel-${activeSection}`,
    role: 'tabpanel',
  }

  if (activeSection === 'data') {
    return (
      <section {...panelProps} className="space-y-6">
        <SectionHeading
          description="Maintain shared reference data used throughout OpenVoyage."
          eyebrow="Administration"
          title="Data tools"
        />
        <SettingsGroup
          description="Choose which supported GeoNames dataset the scheduled import replaces."
          icon={MapIcon}
          onReset={handleReset}
          onSave={handleSave}
          settings={pickSettings(settingsByKey, [SETTING_KEYS.geonamesDataset])}
          title="GeoNames import"
        />
      </section>
    )
  }

  if (activeSection === 'jobs') {
    return (
      <section {...panelProps} className="space-y-6">
        <SectionHeading
          description="Configure recurring maintenance and inspect recent attempts."
          eyebrow="Operations"
          title="Scheduled jobs"
        />
        <JobsPanel accessToken={accessToken} />
      </section>
    )
  }

  if (loadStatus === 'loading') {
    return (
      <section {...panelProps}>
        <LoadingState label="Loading configuration" />
      </section>
    )
  }

  if (loadStatus === 'error') {
    return (
      <section {...panelProps}>
        <SettingsErrorState error={loadError} onRetry={loadSettings} />
      </section>
    )
  }

  if (activeSection === 'appearance') {
    return (
      <section {...panelProps} className="space-y-6">
        <SectionHeading
          description="Publish shared light and dark palettes. Visitors choose light or dark mode from the top bar."
          eyebrow="Public experience"
          title="Appearance"
        />
        <ThemeEditor
          accessToken={accessToken}
          onPublished={async (nextSetting) => {
            replaceSetting(nextSetting)
            const refreshed = await refreshPublicSettings()
            if (!refreshed) {
              throw new Error('Theme was saved, but the public theme could not be refreshed.')
            }
          }}
          setting={settingsByKey.get(SETTING_KEYS.themePalette)}
        />
        <SettingsGroup
          description="Configure the public tile URL template used as the base layer. Routes, markers, and map controls remain unchanged."
          icon={MapIcon}
          onReset={handleReset}
          onSave={handleSave}
          settings={pickSettings(settingsByKey, [
            SETTING_KEYS.mapTileProvider,
          ])}
          title="Map tiles"
        />
      </section>
    )
  }

  if (activeSection === 'routing') {
    const routingProvider = settingsByKey.get(SETTING_KEYS.routingProvider)

    return (
      <section {...panelProps} className="space-y-6">
        <SectionHeading
          description="Configure how itinerary travel routes are generated."
          eyebrow="Travel infrastructure"
          title="Routing"
        />
        <SettingsGroup
          description="Select the service OpenVoyage uses to calculate itinerary routes."
          icon={Route}
          onReset={handleReset}
          onSave={handleSave}
          settings={[routingProvider]}
          title="Routing provider"
        />
        {routingProvider?.value === 'graphhopper' ? (
          <SettingsGroup
            description="Configure the endpoint and write-only credentials used for GraphHopper route requests."
            icon={Server}
            onReset={handleReset}
            onSave={handleSave}
            settings={pickSettings(settingsByKey, [
              SETTING_KEYS.graphHopperBaseUrl,
              SETTING_KEYS.graphHopperApiKey,
            ])}
            title="GraphHopper"
          />
        ) : null}
      </section>
    )
  }

  return (
    <section {...panelProps} className="space-y-6">
      <SectionHeading
        description="Control the limits applied when users upload images and other media."
        eyebrow="Content"
        title="Media"
      />
      <SettingsGroup
        description="Upload limits are read at request time and do not require a backend restart."
        icon={Image}
        onReset={handleReset}
        onSave={handleSave}
        settings={pickSettings(settingsByKey, [
          SETTING_KEYS.maxUploadSize,
          SETTING_KEYS.orphanRetentionDays,
        ])}
        title="Upload policy"
      />
    </section>
  )
}

type SettingsGroupProps = {
  description: string
  icon: typeof Palette
  onReset: (key: string) => Promise<AdminSetting>
  onSave: (key: string, value: unknown) => Promise<AdminSetting>
  settings: Array<AdminSetting | undefined>
  title: string
}

function SettingsGroup({
  description,
  icon: Icon,
  onReset,
  onSave,
  settings,
  title,
}: SettingsGroupProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/80">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-primary shadow-sm">
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="space-y-1">
            <h3 className="text-xl font-semibold tracking-normal text-foreground">
              {title}
            </h3>
            <CardDescription className="max-w-2xl leading-6">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        {settings.map((setting, index) =>
          setting ? (
            <SettingEditor
              key={setting.key}
              onReset={onReset}
              onSave={onSave}
              presentation={getSettingPresentation(setting)}
              setting={setting}
            />
          ) : (
            <div className="p-6" key={`missing-${index}`}>
              <p className="text-sm text-muted-foreground">
                This registered setting is not available from the API.
              </p>
            </div>
          ),
        )}
      </CardContent>
    </Card>
  )
}

type SettingEditorProps = {
  onReset: (key: string) => Promise<AdminSetting>
  onSave: (key: string, value: unknown) => Promise<AdminSetting>
  presentation: SettingPresentation
  setting: AdminSetting
}

function SettingEditor({
  onReset,
  onSave,
  presentation,
  setting,
}: SettingEditorProps) {
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [draft, setDraft] = useState(() => settingToDraft(setting))
  const [isBusy, setIsBusy] = useState(false)
  const [status, setStatus] = useState<EditorStatus | null>(null)

  useEffect(() => {
    setDraft(settingToDraft(setting))
    setConfirmingClear(false)
  }, [setting])

  const isSecret = setting.value_type === 'secret'
  const isDirty = isSecret
    ? draft.length > 0
    : draft !== settingToDraft(setting)
  const inputId = `admin-setting-${setting.key.replace(/[^a-z0-9]+/gi, '-')}`

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isBusy || !isDirty) {
      return
    }

    setIsBusy(true)
    setStatus(null)

    try {
      const value = parseDraftValue(setting, draft)
      const updatedSetting = await onSave(setting.key, value)
      setDraft(settingToDraft(updatedSetting))
      setStatus({
        message: isSecret ? 'API key replaced.' : 'Setting saved.',
        type: 'success',
      })
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' })
    } finally {
      setIsBusy(false)
    }
  }

  async function handleReset() {
    if (isBusy) {
      return
    }

    if (isSecret && !confirmingClear) {
      setConfirmingClear(true)
      setStatus(null)
      return
    }

    setIsBusy(true)
    setStatus(null)

    try {
      const resetSetting = await onReset(setting.key)
      setDraft(settingToDraft(resetSetting))
      setConfirmingClear(false)
      setStatus({
        message: isSecret ? 'API key cleared.' : 'Default restored.',
        type: 'success',
      })
    } catch (error) {
      setStatus({ message: getErrorMessage(error), type: 'error' })
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <form className="grid gap-5 p-5 sm:p-6" onSubmit={handleSubmit}>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(18rem,1.1fr)] xl:gap-8">
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <label
                className="text-sm font-semibold text-foreground"
                htmlFor={inputId}
              >
                {presentation.label}
              </label>
              {isSecret ? (
                <Badge variant={setting.is_configured ? 'secondary' : 'outline'}>
                  {setting.is_configured ? 'Configured' : 'Not configured'}
                </Badge>
              ) : setting.is_configured ? (
                <Badge variant="secondary">Custom value</Badge>
              ) : (
                <Badge variant="outline">Using default</Badge>
              )}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {presentation.help || setting.description}
            </p>
            {presentation.help !== setting.description ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {setting.description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              {setting.visibility === 'public' ? (
                <Eye aria-hidden="true" className="size-3.5" />
              ) : (
                <ShieldCheck aria-hidden="true" className="size-3.5" />
              )}
              {setting.visibility === 'public' ? 'Public setting' : 'Admin only'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {setting.runtime_safe ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <Server aria-hidden="true" className="size-3.5" />
              )}
              {setting.runtime_safe ? 'Updates immediately' : 'Restart required'}
            </span>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <SettingControl
            disabled={isBusy}
            draft={draft}
            id={inputId}
            onChange={(nextDraft) => {
              setDraft(nextDraft)
              setConfirmingClear(false)
              setStatus(null)
            }}
            presentation={presentation}
            setting={setting}
          />
          <SettingHints setting={setting} />
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 pt-1">
            <div className="min-w-0 text-xs text-muted-foreground">
              {status ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 font-medium',
                    status.type === 'error' ? 'text-destructive' : 'text-primary',
                  )}
                  role={status.type === 'error' ? 'alert' : 'status'}
                >
                  {status.type === 'error' ? (
                    <AlertCircle aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Check aria-hidden="true" className="size-3.5" />
                  )}
                  {status.message}
                </span>
              ) : (
                <SettingTimestamp setting={setting} />
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {confirmingClear ? (
                <Button
                  disabled={isBusy}
                  onClick={() => setConfirmingClear(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                className={cn(
                  isSecret && confirmingClear
                    ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
                    : '',
                )}
                disabled={isBusy || (isSecret && !setting.is_configured)}
                onClick={() => void handleReset()}
                size="sm"
                type="button"
                variant="outline"
              >
                {isSecret ? (
                  <KeyRound aria-hidden="true" className="size-3.5" />
                ) : (
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                )}
                {isSecret
                  ? confirmingClear
                    ? 'Confirm clear'
                    : 'Clear key'
                  : 'Reset'}
              </Button>
              <Button disabled={isBusy || !isDirty} size="sm" type="submit">
                <Save aria-hidden="true" className="size-3.5" />
                {isBusy ? 'Saving…' : isSecret ? 'Replace key' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}

type SettingControlProps = {
  disabled: boolean
  draft: string
  id: string
  onChange: (draft: string) => void
  presentation: SettingPresentation
  setting: AdminSetting
}

function SettingControl({
  disabled,
  draft,
  id,
  onChange,
  presentation,
  setting,
}: SettingControlProps) {
  if (setting.value_type === 'enum') {
    const allowedValues = readAllowedValues(setting.validation)
    return (
      <Select
        disabled={disabled}
        id={id}
        onValueChange={onChange}
        options={allowedValues.map((value) => ({
          label: presentation.optionLabels?.[value] ?? humanizeValue(value),
          value,
        }))}
        value={draft}
      />
    )
  }

  if (setting.value_type === 'boolean') {
    return (
      <Select
        disabled={disabled}
        id={id}
        onValueChange={onChange}
        options={[
          { label: 'Enabled', value: 'true' },
          { label: 'Disabled', value: 'false' },
        ]}
        value={draft}
      />
    )
  }

  if (setting.value_type === 'object') {
    return (
      <textarea
        className="min-h-32 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 font-mono text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={draft}
      />
    )
  }

  const unit = readString(setting.validation?.unit)

  return (
    <div className="relative">
      <Input
        autoComplete={setting.value_type === 'secret' ? 'new-password' : undefined}
        className={unit ? 'pr-14' : undefined}
        disabled={disabled}
        id={id}
        max={readNumber(setting.validation?.max)}
        maxLength={readNumber(setting.validation?.max_length)}
        min={readNumber(setting.validation?.min)}
        minLength={readNumber(setting.validation?.min_length)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={presentation.placeholder}
        step={setting.value_type === 'integer' ? 1 : undefined}
        type={
          setting.value_type === 'secret'
            ? 'password'
            : setting.value_type === 'integer'
              ? 'number'
            : presentation.inputType === 'url'
              ? 'url'
                : 'text'
        }
        value={draft}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  )
}

function SettingHints({ setting }: { setting: AdminSetting }) {
  const hints = getValidationHints(setting.validation)
  const defaultValue = setting.default_value

  if (hints.length === 0 && defaultValue === null) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {defaultValue !== null && setting.value_type !== 'secret' ? (
        <span>Default: {displayValue(defaultValue, setting)}</span>
      ) : null}
      {hints.map((hint) => (
        <span key={hint}>{hint}</span>
      ))}
    </div>
  )
}

function SettingTimestamp({ setting }: { setting: AdminSetting }) {
  if (!setting.updated_at) {
    return <span>No stored override</span>
  }

  return <span>Updated {formatDate(setting.updated_at)}</span>
}

function SettingsErrorState({
  error,
  onRetry,
}: {
  error: string | null
  onRetry: () => Promise<void>
}) {
  return (
    <EmptyState
      action={
        <Button onClick={() => void onRetry()} size="sm" variant="outline">
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
      }
      description={error ?? 'The settings service did not return a response.'}
      icon={AlertCircle}
      title="Configuration could not be loaded"
    />
  )
}

function SectionHeading({
  description,
  eyebrow,
  title,
}: {
  description: string
  eyebrow: string
  title: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
        {eyebrow}
      </p>
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

function pickSettings(
  settingsByKey: Map<string, AdminSetting>,
  keys: readonly string[],
) {
  return keys.map((key) => settingsByKey.get(key))
}

function getSettingPresentation(setting: AdminSetting): SettingPresentation {
  const keyParts = setting.key.split('.')
  return (
    settingPresentations[setting.key] ?? {
      help: setting.description,
      label: humanizeValue(keyParts[keyParts.length - 1] ?? setting.key),
    }
  )
}

function settingToDraft(setting: AdminSetting) {
  if (setting.value_type === 'secret') {
    return ''
  }
  if (setting.value_type === 'object') {
    return JSON.stringify(setting.value, null, 2)
  }
  return String(setting.value ?? '')
}

function parseDraftValue(setting: AdminSetting, draft: string): unknown {
  if (setting.value_type === 'integer') {
    const value = Number(draft)
    if (!Number.isInteger(value)) {
      throw new Error('Enter a whole number.')
    }
    return value
  }
  if (setting.value_type === 'boolean') {
    return draft === 'true'
  }
  if (setting.value_type === 'object') {
    try {
      return JSON.parse(draft) as unknown
    } catch {
      throw new Error('Enter valid JSON.')
    }
  }
  if (setting.value_type === 'secret' && draft.length === 0) {
    throw new Error('Enter a replacement secret.')
  }
  return draft
}

function getValidationHints(validation: SettingValidation | null) {
  if (!validation) {
    return []
  }

  const hints: string[] = []
  const min = readNumber(validation.min)
  const max = readNumber(validation.max)
  const unit = readString(validation.unit)
  const minLength = readNumber(validation.min_length)
  const maxLength = readNumber(validation.max_length)

  if (min !== undefined || max !== undefined) {
    const range = [min ?? 'any', max ?? 'any'].join('–')
    hints.push(`Allowed: ${range}${unit ? ` ${unit}` : ''}`)
  }
  if (minLength !== undefined || maxLength !== undefined) {
    const range = [minLength ?? 'any', maxLength ?? 'any'].join('–')
    hints.push(`Length: ${range} characters`)
  }

  return hints
}

function readAllowedValues(validation: SettingValidation | null) {
  return Array.isArray(validation?.allowed_values)
    ? validation.allowed_values.filter(
        (value): value is string => typeof value === 'string',
      )
    : []
}

function displayValue(value: unknown, setting: AdminSetting) {
  if (setting.value_type === 'enum' && typeof value === 'string') {
    const presentation = getSettingPresentation(setting)
    return presentation.optionLabels?.[value] ?? humanizeValue(value)
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function humanizeValue(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : formatDateTime(date, { dateStyle: 'medium', timeStyle: 'short' })
}

function readNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}
