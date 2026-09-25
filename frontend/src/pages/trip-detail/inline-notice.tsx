import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function InlineNotice({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'error'
}) {
  return (
    <p
      className={cn(
        'rounded-[1.2rem] border px-3 py-2 text-sm font-medium',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/70 text-primary',
      )}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  )
}
