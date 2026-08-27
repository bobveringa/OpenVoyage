import { Clock3, Palette } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { CurrentUser } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { ThemePaletteEditor } from '@/components/theme/theme-palette-editor'
import { AccountSettingsLayout } from '@/components/users/account-settings-layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { getErrorMessage } from '@/api/client'
import { useClockFormat, type ClockFormatPreference } from '@/lib/date-time'
import { useUserPreferences } from '@/preferences'
import {
  cloneThemePalette,
  getThemePaletteIssues,
  parseThemePalette,
  useTheme,
  type ThemePalette,
} from '@/theme'

type AccountPreferencesPageProps = {
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  embedded?: boolean
  onNavigate: (to: string) => void
}

export function AccountPreferencesPage({
  authStatus,
  currentUser,
  embedded = false,
  onNavigate,
}: AccountPreferencesPageProps) {
  const { preference: clockFormat } = useClockFormat()
  const { mode, palette } = useTheme()
  const { preferences, setThemePalette, setTimeFormat, status } = useUserPreferences()
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [timeFormatDraft, setTimeFormatDraft] =
    useState<ClockFormatPreference>(clockFormat)
  const [draft, setDraft] = useState<ThemePalette | null>(null)
  const [isInstanceThemeDraft, setIsInstanceThemeDraft] = useState(false)
  const savedCustomPalette = useMemo(
    () => parseThemePalette(preferences?.theme_palette),
    [preferences?.theme_palette],
  )
  const themeIssues = useMemo(
    () => (draft ? getThemePaletteIssues(draft) : []),
    [draft],
  )
  const isUsingCustomTheme = savedCustomPalette !== null
  const isInstanceThemeSelected =
    isInstanceThemeDraft || (!isUsingCustomTheme && draft === null)
  const isCustomThemeSelected = !isInstanceThemeSelected

  useEffect(() => {
    setTimeFormatDraft(clockFormat)
  }, [clockFormat])

  useEffect(() => {
    if (savedCustomPalette && !draft) {
      setDraft(cloneThemePalette(savedCustomPalette))
    }
  }, [draft, savedCustomPalette])

  if (authStatus === 'loading' || status === 'loading') {
    return <LoadingState label="Loading preferences" />
  }

  if (!currentUser) {
    return (
      <div className="py-8 sm:py-10">
        <EmptyState
          action={
            <Button onClick={() => onNavigate('/login')} type="button">
              Sign in
            </Button>
          }
          description="You need to be signed in before you can update your preferences."
          icon={Clock3}
          title="Sign in required"
        />
      </div>
    )
  }

  async function saveTimeFormat() {
    if (timeFormatDraft === clockFormat || isSaving) return
    setError(null)
    setIsSaving(true)
    try {
      await setTimeFormat(timeFormatDraft)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  function openCustomThemeEditor() {
    setError(null)
    setIsInstanceThemeDraft(false)
    setDraft(
      cloneThemePalette(savedCustomPalette ?? palette),
    )
  }

  async function selectInstanceTheme() {
    if (isSaving) return
    setError(null)
    if (isInstanceThemeSelected) return
    setIsInstanceThemeDraft(true)
  }

  async function saveInstanceTheme() {
    if (isSaving || !isInstanceThemeDraft) return
    if (!isUsingCustomTheme) {
      setIsInstanceThemeDraft(false)
      setDraft(null)
      return
    }
    setIsSaving(true)
    try {
      await setThemePalette(null)
      setDraft(null)
      setIsInstanceThemeDraft(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function saveCustomTheme() {
    if (!draft || isSaving || themeIssues.length > 0) return
    setError(null)
    setIsSaving(true)
    try {
      await setThemePalette(draft)
      setIsInstanceThemeDraft(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const content = (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Time format</CardTitle>
          <CardDescription>Choose how times appear across your signed-in devices.</CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-md items-end gap-3">
          <Select<ClockFormatPreference>
            ariaLabel="Time format"
            className="min-w-0 flex-1"
            disabled={isSaving}
            onValueChange={setTimeFormatDraft}
            options={[
              { label: '12-hour clock', value: '12-hour' },
              { label: '24-hour clock', value: '24-hour' },
            ]}
            value={timeFormatDraft}
          />
          <Button
            className="shrink-0"
            disabled={isSaving || timeFormatDraft === clockFormat}
            onClick={() => void saveTimeFormat()}
            type="button"
          >
            {isSaving ? (
              'Saving…'
            ) : (
              <><span className="sm:hidden">Save</span><span className="hidden sm:inline">Save time format</span></>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2"><Palette className="size-5 text-primary" />Theme</CardTitle>
          <CardDescription>Choose colors that follow your account across signed-in devices.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              aria-pressed={isInstanceThemeSelected}
              className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isInstanceThemeSelected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
              disabled={isSaving}
              onClick={() => void selectInstanceTheme()}
              type="button"
            >
              <span className="block font-semibold">Use this site’s theme</span>
              <span className="mt-1 block text-sm text-muted-foreground">Follow the colors chosen by this OpenVoyage instance. Future instance changes apply automatically.</span>
            </button>
            <button
              aria-pressed={isCustomThemeSelected}
              className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isCustomThemeSelected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
              disabled={isSaving}
              onClick={openCustomThemeEditor}
              type="button"
            >
              <span className="block font-semibold">Use a custom theme</span>
              <span className="mt-1 block text-sm text-muted-foreground">Choose a private palette for your account.</span>
            </button>
          </div>

          {isInstanceThemeDraft ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
              <Button disabled={isSaving} onClick={() => void saveInstanceTheme()} type="button">
                {isSaving ? 'Saving…' : 'Use this site’s theme'}
              </Button>
              <Button disabled={isSaving} onClick={() => setIsInstanceThemeDraft(false)} type="button" variant="outline">
                Cancel
              </Button>
            </div>
          ) : draft ? (
            <div className="space-y-5 border-t border-border pt-5">
              <ThemePaletteEditor disabled={isSaving} draft={draft} onChange={setDraft} />
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
                <Button disabled={isSaving || themeIssues.length > 0} onClick={() => void saveCustomTheme()} type="button">
                  {isSaving ? 'Saving…' : 'Save custom theme'}
                </Button>
                <Button
                  disabled={isSaving}
                  onClick={() => setDraft(
                    savedCustomPalette
                      ? cloneThemePalette(savedCustomPalette)
                      : null,
                  )}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <p className="text-xs text-muted-foreground">The active preview is {mode}; appearance mode stays on this device.</p>
        </CardContent>
      </Card>
    </div>
  )

  return embedded ? (
    content
  ) : (
    <AccountSettingsLayout activeSection="preferences" onSectionChange={() => undefined}>
      {content}
    </AccountSettingsLayout>
  )
}
