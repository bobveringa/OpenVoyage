import { Contrast, Eye } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  cloneThemePalette,
  getThemePaletteIssues,
  previewStyle,
  THEME_PRESETS,
  type ThemeMode,
  type ThemePalette,
  type ThemeRole,
} from '@/theme'

const roleGroups: Array<{ roles: readonly ThemeRole[]; title: string }> = [
  {
    title: 'Surfaces',
    roles: ['background', 'card', 'popover', 'secondary', 'muted', 'border', 'input'],
  },
  {
    title: 'Text',
    roles: ['foreground', 'cardForeground', 'popoverForeground', 'secondaryForeground', 'mutedForeground'],
  },
  {
    title: 'Actions',
    roles: ['primary', 'primaryForeground', 'accent', 'accentForeground', 'ring'],
  },
]

export function ThemePaletteEditor({
  draft,
  disabled = false,
  onChange,
}: {
  draft: ThemePalette
  disabled?: boolean
  onChange: (palette: ThemePalette) => void
}) {
  const [selectedMode, setSelectedMode] = useState<ThemeMode>('light')
  const issues = useMemo(() => getThemePaletteIssues(draft), [draft])

  function updateColor(role: ThemeRole, color: string) {
    onChange({
      ...draft,
      [selectedMode]: {
        ...draft[selectedMode],
        [role]: color.toUpperCase(),
      },
    })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
      <div className="space-y-6">
        <PresetPicker disabled={disabled} onSelect={(palette) => onChange(cloneThemePalette(palette))} />
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Palette mode">
          {(['light', 'dark'] as const).map((mode) => (
            <Button
              aria-selected={selectedMode === mode}
              disabled={disabled}
              key={mode}
              onClick={() => setSelectedMode(mode)}
              role="tab"
              size="sm"
              type="button"
              variant={selectedMode === mode ? 'default' : 'outline'}
            >
              {mode === 'light' ? 'Light palette' : 'Dark palette'}
            </Button>
          ))}
        </div>
        {roleGroups.map((group) => (
          <fieldset className="space-y-3" key={group.title}>
            <legend className="text-sm font-semibold text-foreground">{group.title}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.roles.map((role) => (
                <ColorField
                  color={draft[selectedMode][role]}
                  disabled={disabled}
                  key={role}
                  label={humanize(role)}
                  onColorChange={(color) => updateColor(role, color)}
                />
              ))}
            </div>
          </fieldset>
        ))}
        {issues.length > 0 ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="flex items-center gap-2 font-semibold">
              <Contrast className="size-4" />Fix contrast before saving.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
      <ThemePreview mode={selectedMode} palette={draft} />
    </div>
  )
}

function PresetPicker({
  disabled,
  onSelect,
}: {
  disabled: boolean
  onSelect: (palette: ThemePalette) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Presets</p>
        <p className="text-xs text-muted-foreground">Start from a complete accessible palette, then fine-tune it.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {THEME_PRESETS.map((preset) => (
          <button
            aria-label={`Apply ${preset.name} preset`}
            className="group rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            key={preset.id}
            onClick={() => onSelect(preset.palette)}
            type="button"
          >
            <span className="mb-2 flex overflow-hidden rounded-lg border border-border" aria-hidden="true">
              <span className="h-5 flex-1" style={{ background: preset.palette.light.primary }} />
              <span className="h-5 flex-1" style={{ background: preset.palette.light.accent }} />
              <span className="h-5 flex-1" style={{ background: preset.palette.dark.primary }} />
              <span className="h-5 flex-1" style={{ background: preset.palette.dark.accent }} />
            </span>
            <span className="block text-sm font-semibold">{preset.name}</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{preset.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ColorField({
  color,
  disabled,
  label,
  onColorChange,
}: {
  color: string
  disabled: boolean
  label: string
  onColorChange: (color: string) => void
}) {
  const [draft, setDraft] = useState(color)
  useEffect(() => setDraft(color), [color])
  const valid = /^#[0-9a-f]{6}$/i.test(draft)
  return (
    <label className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border bg-card p-2.5">
      <span className="theme-color-swatch" style={{ backgroundColor: color }}>
        <input
          aria-label={`${label} color`}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value)
            onColorChange(event.target.value)
          }}
          type="color"
          value={color}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-foreground">{label}</span>
        <Input
          className={cn('mt-1 h-8 font-mono text-xs', !valid && 'border-destructive')}
          disabled={disabled}
          onChange={(event) => {
            const value = event.target.value
            setDraft(value)
            if (/^#[0-9a-f]{6}$/i.test(value)) onColorChange(value)
          }}
          value={draft}
        />
      </span>
    </label>
  )
}

function ThemePreview({ mode, palette }: { mode: ThemeMode; palette: ThemePalette }) {
  return (
    <aside className="xl:sticky xl:top-24 xl:self-start">
      <div
        className={cn('overflow-hidden rounded-2xl border border-border bg-background p-4 shadow-soft', mode === 'dark' && 'dark')}
        style={{ ...previewStyle(palette[mode]), colorScheme: mode }}
      >
        <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          <Eye className="size-3.5" />{mode} preview
        </p>
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
          <div className="flex items-center justify-between gap-3">
            <div><p className="font-semibold">A traveller’s day</p><p className="text-sm text-muted-foreground">Cards, text, and actions stay legible.</p></div>
            <span className="rounded-lg bg-accent px-2 py-1 text-xs font-bold text-accent-foreground">New</span>
          </div>
          <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">A muted surface for helpful supporting information.</div>
          <div className="flex gap-2"><button className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" type="button">Primary action</button><button className="rounded-lg border border-input bg-card px-3 py-2 text-sm font-semibold text-foreground" type="button">Secondary</button></div>
          <input className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none ring-ring focus:ring-2" defaultValue="An accessible input" readOnly />
        </div>
      </div>
    </aside>
  )
}

function humanize(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase())
}
