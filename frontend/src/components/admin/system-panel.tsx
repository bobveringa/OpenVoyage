import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError, getErrorMessage, runJob } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { VersionDetails } from '@/software/version-details'
import { useSoftwareInfo } from '@/software/software-info-context'
import { formatDateTime } from '@/lib/date-time'

const comparisonLabels = {
  update_available: 'Software updates', up_to_date: 'OpenVoyage is up to date',
  ahead: 'This server is ahead of the latest stable release', unknown: 'Latest version unknown',
}

export function SystemPanel({ accessToken }: { accessToken: string | null }) {
  const { updates, updatesError, refreshUpdates } = useSoftwareInfo()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const cooldownUntil = updates?.next_allowed_check_at ? Date.parse(updates.next_allowed_check_at) : 0
  const checking = updates?.check_status === 'checking'

  useEffect(() => {
    void refreshUpdates()
  }, [refreshUpdates])
  useEffect(() => {
    if (!checking) return
    const timer = window.setInterval(() => { if (!document.hidden) void refreshUpdates() }, 3000)
    return () => window.clearInterval(timer)
  }, [checking, refreshUpdates])
  useEffect(() => {
    if (cooldownUntil <= Date.now()) { setNow(Date.now()); return }
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(cooldownUntil - Date.now() + 50, 86_400_000))
    return () => window.clearTimeout(timer)
  }, [cooldownUntil])

  async function checkNow() {
    if (!accessToken) return
    setBusy(true); setMessage(null)
    try { await runJob({ accessToken, key: 'software_update_check' }) }
    catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 409)) setMessage(getErrorMessage(cause))
    } finally { await refreshUpdates(); setBusy(false) }
  }

  return <section aria-labelledby="admin-tab-system" id="admin-panel-system" role="tabpanel" className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Operations</p><h2 className="mt-2 text-2xl font-semibold">System</h2><p className="mt-1 text-sm text-muted-foreground">Installed versions and stable software releases.</p></div>
    <Card><CardHeader><h3 className="text-lg font-semibold">Installed software</h3></CardHeader><CardContent><VersionDetails /></CardContent></Card>
    <Card>
      <CardHeader>
        <div>
          <h3 className="text-lg font-semibold">{updates ? comparisonLabels[updates.comparison] : updatesError ? 'Update information unavailable' : 'Loading update information…'}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{checking ? 'An update check is queued or running.' : updates?.check_status === 'disabled' ? 'Automatic checks are disabled. You can still check manually.' : 'The server checks GitHub for stable releases.'}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {updates?.latest_release ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-4"><div><p className="text-sm text-muted-foreground">Latest stable release</p><p className="mt-1 text-xl font-semibold">v{updates.latest_release.version}</p></div><a className="text-sm font-semibold text-primary underline underline-offset-4" href={updates.latest_release.url} target="_blank" rel="noopener noreferrer">View release notes</a></div> : null}
        {updates?.check_status === 'never_checked' ? <p className="text-sm text-muted-foreground">No update check has completed yet.</p> : null}
        {updates?.check_status === 'ok' && !updates.latest_release ? <p className="text-sm text-muted-foreground">No published stable release was found.</p> : null}
        {updates?.error_code ? <p role="status" className="text-sm text-amber-700 dark:text-amber-400">The last check failed{updates.error_code === 'rate_limited' ? ' because GitHub is limiting requests' : ''}. {updates.last_success_at ? 'Showing the last successfully verified result.' : 'The latest version could not be verified.'}</p> : null}
        {updates?.is_stale && updates.last_success_at && !updates.error_code ? <p className="text-sm text-muted-foreground">This cached result is more than 12 hours old.</p> : null}
        {updatesError || message ? <p role="alert" className="text-sm text-destructive">{message ?? updatesError}</p> : null}
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Last attempted</dt><dd>{formatTimestamp(updates?.last_attempt_at)}</dd></div><div><dt className="text-muted-foreground">Last verified</dt><dd>{formatTimestamp(updates?.last_success_at)}</dd></div></dl>
        <div className="flex flex-wrap gap-3"><Button disabled={!accessToken || busy || checking || cooldownUntil > now} onClick={() => void checkNow()}><RefreshCw aria-hidden="true" className={`size-4 ${busy || checking ? 'animate-spin' : ''}`} />{checking ? 'Checking…' : 'Check now'}</Button><Button variant="outline" onClick={() => { window.location.hash = 'jobs' }}>Configure automatic checks</Button></div>
        {cooldownUntil > now ? <p className="text-xs text-muted-foreground">You can check again after {formatTimestamp(updates?.next_allowed_check_at)}.</p> : null}
      </CardContent>
    </Card>
  </section>
}

function formatTimestamp(value: string | null | undefined) {
  return value ? formatDateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'
}
