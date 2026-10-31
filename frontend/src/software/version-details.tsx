import { CircleAlert } from 'lucide-react'
import { CLIENT_VERSION, useSoftwareInfo } from '@/software/software-info-context'
import { cn } from '@/lib/utils'

export function VersionDetails() {
  const { serverVersion, serverLoading, updates } = useSoftwareInfo()
  const updateAvailable = updates?.comparison === 'update_available'
  return <dl className="grid gap-5 sm:grid-cols-2">
    <div><dt className="text-sm text-muted-foreground">Client version</dt><dd className="mt-1 font-semibold">{CLIENT_VERSION}</dd></div>
    <div>
      <dt className="text-sm text-muted-foreground">Server version</dt>
      <dd className={cn('mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold', updateAvailable && 'text-amber-700 dark:text-amber-400')}>
        <span>{serverVersion ?? (serverLoading ? 'Loading…' : 'Unavailable')}</span>
        {updateAvailable ? <span className="inline-flex items-center gap-1.5 text-xs font-medium"><CircleAlert aria-hidden="true" className="size-3.5" />Update available</span> : null}
      </dd>
    </div>
  </dl>
}

