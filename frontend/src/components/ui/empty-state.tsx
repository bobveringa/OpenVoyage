import type { LucideIcon } from 'lucide-react'
import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type EmptyStateProps = {
  action?: ReactNode
  className?: string
  description?: string
  icon?: LucideIcon
  title: string
}

export function EmptyState({
  action,
  className,
  description,
  icon: Icon = AlertCircle,
  title,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'grid place-items-center rounded-2xl border border-emerald-100 bg-white px-6 py-12 text-center shadow-sm',
        className,
      )}
    >
      <div className="grid max-w-md justify-items-center gap-4">
        <span className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-primary shadow-sm">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
    </div>
  )
}

type LoadingStateProps = {
  label?: string
}

export function LoadingState({ label = 'Loading' }: LoadingStateProps) {
  return (
    <div className="grid min-h-[18rem] place-items-center">
      <div className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-primary border-r-transparent" />
        {label}
      </div>
    </div>
  )
}
