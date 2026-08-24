import { Palette, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  getErrorMessage,
  resetAdminSetting,
  updateAdminSetting,
  type AdminSetting,
} from '@/api/client'
import { ThemePaletteEditor } from '@/components/theme/theme-palette-editor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  cloneThemePalette,
  DEFAULT_THEME_PALETTE,
  getThemePaletteIssues,
  parseThemePalette,
  type ThemePalette,
} from '@/theme'

type ThemeEditorProps = {
  accessToken: string | null
  onPublished: (setting: AdminSetting) => Promise<void>
  setting: AdminSetting | undefined
}

export function ThemeEditor({ accessToken, onPublished, setting }: ThemeEditorProps) {
  const published = useMemo(
    () => parseThemePalette(setting?.value) ?? DEFAULT_THEME_PALETTE,
    [setting?.value],
  )
  const [draft, setDraft] = useState<ThemePalette>(() => cloneThemePalette(published))
  const [status, setStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setDraft(cloneThemePalette(published))
    setStatus(null)
  }, [published])

  const issues = useMemo(() => getThemePaletteIssues(draft), [draft])
  const isDirty = JSON.stringify(draft) !== JSON.stringify(published)

  async function publish() {
    if (!accessToken || issues.length > 0 || !isDirty) return
    setIsSaving(true)
    setStatus(null)
    try {
      const next = await updateAdminSetting({ accessToken, key: 'theme.palette', value: draft })
      await onPublished(next)
      setStatus('Theme published. Visitors receive it on their next refresh.')
    } catch (error) {
      setStatus(getErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  async function resetPublished() {
    if (!accessToken || isSaving) return
    setIsSaving(true)
    setStatus(null)
    try {
      const next = await resetAdminSetting({ accessToken, key: 'theme.palette' })
      await onPublished(next)
      setDraft(cloneThemePalette(DEFAULT_THEME_PALETTE))
      setStatus('The bundled OpenVoyage palette was restored.')
    } catch (error) {
      setStatus(getErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-muted text-primary"><Palette className="size-5" /></span>
              Theme palette
            </CardTitle>
            <CardDescription>Customize the shared light and dark colors. Changes stay in this preview until you publish them.</CardDescription>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{setting?.is_configured ? 'Custom palette' : 'OpenVoyage default'}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-5 sm:p-6">
        <ThemePaletteEditor disabled={isSaving} draft={draft} onChange={setDraft} />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
          <Button disabled={isSaving || !isDirty || issues.length > 0} onClick={() => void publish()} type="button"><Save className="size-4" />{isSaving ? 'Publishing…' : 'Publish theme'}</Button>
          <Button disabled={isSaving || !isDirty} onClick={() => { setDraft(cloneThemePalette(published)); setStatus(null) }} type="button" variant="outline"><RefreshCw className="size-4" />Discard draft</Button>
          <Button disabled={isSaving} onClick={() => void resetPublished()} type="button" variant="ghost"><RotateCcw className="size-4" />Reset published theme</Button>
          {status ? <p className={cn('text-sm', status.includes('published') || status.includes('restored') ? 'text-primary' : 'text-destructive')} role="status">{status}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}
