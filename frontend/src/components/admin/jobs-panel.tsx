import { AlertCircle, CheckCircle2, Clock3, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  getErrorMessage,
  getJobExecution,
  listJobs,
  resetJob,
  runJob,
  updateJob,
  type ScheduledJob,
} from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'

export function JobsPanel({ accessToken }: { accessToken: string | null }) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accessToken) return
    setError(null)
    try { setJobs(await listJobs(accessToken)) } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setLoading(false) }
  }, [accessToken])

  useEffect(() => { void load() }, [load])

  if (loading) return <LoadingState label="Loading scheduled jobs" />
  if (error) return <EmptyState action={<Button onClick={() => void load()}>Try again</Button>} description={error} icon={AlertCircle} title="Could not load jobs" />

  return <div className="space-y-5">{jobs.map((job) => <JobCard accessToken={accessToken!} job={job} key={job.key} onChange={(next) => setJobs((current) => current.map((item) => item.key === next.key ? next : item))} />)}</div>
}

function JobCard({ accessToken, job, onChange }: { accessToken: string; job: ScheduledJob; onChange: (job: ScheduledJob) => void }) {
  const [enabled, setEnabled] = useState(job.enabled)
  const [cron, setCron] = useState(job.cron)
  const [timezone, setTimezone] = useState(job.timezone)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const pollingTimer = useRef<number | null>(null)
  useEffect(() => { setEnabled(job.enabled); setCron(job.cron); setTimezone(job.timezone) }, [job])
  useEffect(() => () => {
    if (pollingTimer.current !== null) window.clearInterval(pollingTimer.current)
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null)
    try { onChange(await updateJob({ accessToken, key: job.key, enabled, cron, timezone })); setMessage('Schedule saved.') }
    catch (cause) { setMessage(getErrorMessage(cause)) } finally { setBusy(false) }
  }
  async function restore() {
    setBusy(true); setMessage(null)
    try { onChange(await resetJob({ accessToken, key: job.key })); setMessage('Defaults restored.') }
    catch (cause) { setMessage(getErrorMessage(cause)) } finally { setBusy(false) }
  }
  async function run() {
    setBusy(true); setMessage(null)
    try {
      const execution = await runJob({ accessToken, key: job.key })
      onChange({ ...job, active_execution: execution, latest_execution: execution })
      poll(execution.id)
    } catch (cause) { setMessage(getErrorMessage(cause)) } finally { setBusy(false) }
  }
  function poll(executionId: string) {
    if (pollingTimer.current !== null) window.clearInterval(pollingTimer.current)
    const timer = window.setInterval(async () => {
      try {
        const execution = await getJobExecution({ accessToken, executionId })
        if (execution.status === 'QUEUED' || execution.status === 'RUNNING') return
        window.clearInterval(timer); pollingTimer.current = null
        onChange({ ...job, active_execution: null, latest_execution: execution })
      } catch { window.clearInterval(timer); pollingTimer.current = null }
    }, 2000)
    pollingTimer.current = timer
  }
  const active = job.active_execution
  return <Card>
    <CardHeader className="gap-3 border-b border-emerald-100/80">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">{job.name}</h3><CardDescription>{job.description}</CardDescription></div><Badge variant={job.enabled ? 'secondary' : 'outline'}>{job.enabled ? 'Scheduled' : 'Schedule disabled'}</Badge></div>
      <p className="text-sm text-muted-foreground">Next run: {job.next_run_at ? new Date(job.next_run_at).toLocaleString() : 'Not scheduled'} · Defaults: {job.default_cron} ({job.default_timezone})</p>
    </CardHeader>
    <CardContent className="space-y-4 pt-5">
      <form className="grid gap-4 md:grid-cols-3" onSubmit={save}>
        <div className="flex items-center gap-3 self-end pb-1">
          <button
            aria-checked={enabled}
            aria-label={`Enable ${job.name} schedule`}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${enabled ? 'border-primary bg-primary' : 'border-emerald-200 bg-emerald-50'}`}
            onClick={() => setEnabled((current) => !current)}
            role="switch"
            type="button"
          >
            <span className={`size-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm font-medium text-foreground">Enable schedule</span>
        </div>
        <label className="grid gap-1 text-sm font-medium">Cron<Input aria-label={`${job.name} cron`} onChange={(event) => setCron(event.target.value)} value={cron} /></label>
        <label className="grid gap-1 text-sm font-medium">Timezone<Input aria-label={`${job.name} timezone`} onChange={(event) => setTimezone(event.target.value)} value={timezone} /></label>
        <div className="flex flex-wrap gap-2 md:col-span-3"><Button disabled={busy} type="submit"><RefreshCw className="size-4" /> Save schedule</Button><Button disabled={busy} onClick={() => void restore()} type="button" variant="outline"><RotateCcw className="size-4" /> Restore defaults</Button><Button disabled={busy || !!active} onClick={() => void run()} type="button" variant="secondary"><Play className="size-4" /> Run now</Button></div>
      </form>
      <p className="text-xs text-muted-foreground">Use five cron fields. Weekdays use names such as mon–sun; schedules run in the selected IANA timezone.</p>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {job.schedule_error ? <p className="text-sm text-destructive">{job.schedule_error}</p> : null}
      {job.latest_execution ? <div className="rounded-lg bg-muted/45 p-3 text-sm"><div className="flex items-center gap-2 font-medium">{job.latest_execution.status === 'SUCCEEDED' ? <CheckCircle2 className="size-4 text-emerald-700" /> : <Clock3 className="size-4" />} Latest: {job.latest_execution.status} ({job.latest_execution.trigger})</div>{job.latest_execution.error_message ? <p className="mt-1 text-destructive">{job.latest_execution.error_message}</p> : null}{job.latest_execution.summary ? <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(job.latest_execution.summary, null, 2)}</pre> : null}</div> : null}
    </CardContent>
  </Card>
}
