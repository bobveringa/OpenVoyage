import type { ReactNode } from 'react'

export function InlineNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-[1.2rem] border border-border bg-muted/70 px-3 py-2 text-sm font-medium text-primary"
      role="status"
    >
      {children}
    </p>
  )
}
