import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, Play, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import {
  getErrorMessage,
  getJobExecution,
  listJobs,
  resetJob,
  runJob,
  updateJob,
  type JobExecution,
  type ScheduledJob,
} from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'

const ianaTimezoneOptions = createIanaTimezoneOptions()

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
  const [enabled, setEnabled] = useState(job.schedule.enabled)
  const [cron, setCron] = useState(job.schedule.cron)
  const [timezone, setTimezone] = useState(job.schedule.timezone)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null)
  const pollingTimer = useRef<number | null>(null)
  useEffect(() => { setEnabled(job.schedule.enabled); setCron(job.schedule.cron); setTimezone(job.schedule.timezone) }, [job])
  useEffect(() => () => {
    if (pollingTimer.current !== null) window.clearInterval(pollingTimer.current)
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setMessage(null)
    try {
      onChange(await updateJob({ accessToken, key: job.key, enabled, cron, timezone }))
      setMessage({ text: 'Schedule saved.', type: 'success' })
    } catch (cause) {
      setMessage({ text: `Schedule was not saved: ${getErrorMessage(cause)}`, type: 'error' })
    } finally { setBusy(false) }
  }
  async function restore() {
    setBusy(true); setMessage(null)
    try { onChange(await resetJob({ accessToken, key: job.key })); setMessage({ text: 'Defaults restored.', type: 'success' }) }
    catch (cause) { setMessage({ text: getErrorMessage(cause), type: 'error' }) } finally { setBusy(false) }
  }
  async function run() {
    setBusy(true); setMessage(null)
    try {
      const execution = await runJob({ accessToken, key: job.key })
      onChange({ ...job, executions: { active: execution, latest: execution } })
      poll(execution.id)
    } catch (cause) { setMessage({ text: getErrorMessage(cause), type: 'error' }) } finally { setBusy(false) }
  }
  function poll(executionId: string) {
    if (pollingTimer.current !== null) window.clearInterval(pollingTimer.current)
    const timer = window.setInterval(async () => {
      try {
        const execution = await getJobExecution({ accessToken, executionId })
        if (execution.status === 'QUEUED' || execution.status === 'RUNNING') return
        window.clearInterval(timer); pollingTimer.current = null
        onChange({ ...job, executions: { active: null, latest: execution } })
      } catch { window.clearInterval(timer); pollingTimer.current = null }
    }, 2000)
    pollingTimer.current = timer
  }
  const active = job.executions.active
  const latest = active ?? job.executions.latest
  const status = getExecutionStatus(latest?.status)
  return <Card>
    <CardHeader className="gap-4 border-b border-border/80 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-semibold">{job.name}</h3><Badge variant={job.schedule.enabled ? 'secondary' : 'outline'}>{job.schedule.enabled ? 'Scheduled' : 'Schedule disabled'}</Badge></div>
          <CardDescription className="mt-1">{job.description}</CardDescription>
        </div>
        <Button disabled={busy || !!active} onClick={() => void run()} type="button" variant="secondary"><Play className="size-4" /> {active ? 'Run in progress' : 'Run now'}</Button>
      </div>
      <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${status.className}`}>
        <status.Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${status.iconClassName}`} />
        <div className="min-w-0 text-sm"><p className="font-semibold">{status.label}</p><p className="mt-0.5 text-muted-foreground">{latest ? `${formatExecutionTime(latest)} · ${formatTrigger(latest.trigger)}` : 'No execution has been recorded yet.'}</p></div>
      </div>
    </CardHeader>
    <CardContent className="space-y-6 p-5 pt-5 sm:p-6 sm:pt-6">
      <section aria-labelledby={`${job.key}-schedule`} className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="font-semibold" id={`${job.key}-schedule`}>Schedule</h4><p className="mt-0.5 text-sm text-muted-foreground">Next run: {job.schedule.next_run_at ? formatDateTime(job.schedule.next_run_at) : 'Not scheduled'}</p><p className="mt-1 text-xs text-muted-foreground">Default: {job.defaults.cron} · {job.defaults.timezone}</p></div>
          <div className="flex items-center gap-3 sm:pt-1">
            <span className="text-sm font-medium text-foreground">Enable schedule</span>
            <button
              aria-checked={enabled}
              aria-label={`Enable ${job.name} schedule`}
              className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${enabled ? 'border-primary bg-primary' : 'border-input bg-muted'}`}
              onClick={() => setEnabled((current) => !current)}
              role="switch"
              type="button"
            >
              <span className={`size-5 rounded-full bg-card shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        <form className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.55fr)]" onSubmit={save}>
          <label className="grid gap-1.5 text-sm font-medium">Cron<Input aria-label={`${job.name} cron`} onChange={(event) => setCron(event.target.value)} value={cron} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Timezone<Select ariaLabel={`${job.name} timezone`} onValueChange={setTimezone} options={ianaTimezoneOptions} searchable searchPlaceholder="Search IANA timezones" value={timezone} /></label>
          <div className="flex flex-wrap gap-2 md:col-span-2"><Button disabled={busy} type="submit"><RefreshCw className="size-4" /> Save schedule</Button><Button disabled={busy} onClick={() => void restore()} type="button" variant="outline"><RotateCcw className="size-4" /> Restore defaults</Button></div>
        </form>
        <p className="text-xs text-muted-foreground">Use five cron fields. Weekdays use names such as mon–sun; schedules run in the selected IANA timezone.</p>
      </section>
      {message ? <p className={message.type === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
      {job.schedule.error ? <p className="text-sm text-destructive">{job.schedule.error}</p> : null}
      {latest?.error_message || latest?.summary ? <details className="group rounded-xl border border-border bg-muted/30 px-3.5 py-3"><summary className="cursor-pointer text-sm font-medium marker:text-muted-foreground">Execution details</summary><div className="mt-3 border-t border-border pt-3 text-sm">{latest.error_message ? <p className="text-destructive">{latest.error_message}</p> : null}{latest.summary ? <pre className="mt-3 overflow-x-auto rounded-lg bg-card p-3 text-xs leading-5 text-foreground">{JSON.stringify(latest.summary, null, 2)}</pre> : null}</div></details> : null}
    </CardContent>
  </Card>
}

function getExecutionStatus(status: JobExecution['status'] | undefined) {
  if (status === 'SUCCEEDED') return { label: 'Latest run succeeded', Icon: CheckCircle2, className: 'border-input bg-muted/70', iconClassName: 'text-emerald-700' }
  if (status === 'FAILED') return { label: 'Latest run failed', Icon: XCircle, className: 'border-red-200 bg-red-50/70', iconClassName: 'text-destructive' }
  if (status === 'RUNNING') return { label: 'Run in progress', Icon: LoaderCircle, className: 'border-amber-200 bg-amber-50/70', iconClassName: 'animate-spin text-amber-700' }
  if (status === 'QUEUED') return { label: 'Run queued', Icon: Clock3, className: 'border-amber-200 bg-amber-50/70', iconClassName: 'text-amber-700' }
  if (status === 'SKIPPED') return { label: 'Latest run skipped', Icon: Clock3, className: 'border-border bg-muted/40', iconClassName: 'text-muted-foreground' }
  return { label: 'No runs yet', Icon: Clock3, className: 'border-border bg-muted/40', iconClassName: 'text-muted-foreground' }
}

function formatExecutionTime(execution: JobExecution) {
  const timestamp = execution.finished_at ?? execution.started_at ?? execution.created_at
  if (execution.status === 'QUEUED') return `Queued ${formatDateTime(timestamp)}`
  return execution.status === 'RUNNING' ? `Started ${formatDateTime(timestamp)}` : `Finished ${formatDateTime(timestamp)}`
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { hour12: false })
}

function formatTrigger(trigger: JobExecution['trigger']) {
  return trigger.charAt(0) + trigger.slice(1).toLowerCase()
}

function createIanaTimezoneOptions(): readonly SelectOption[] {
  const intlWithTimezoneValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[]
  }
  const timezones = intlWithTimezoneValues.supportedValuesOf?.('timeZone') ?? []

  return [...new Set(['UTC', 'Etc/UTC', ...timezones])]
    .sort((left, right) => left.localeCompare(right))
    .map((timezone) => ({ label: timezone, value: timezone }))
}
