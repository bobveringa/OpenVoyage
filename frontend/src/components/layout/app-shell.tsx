import type { ReactNode } from 'react'
import { Compass } from 'lucide-react'

type AppShellProps = {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_32rem),linear-gradient(135deg,color-mix(in_oklch,var(--accent)_10%,transparent),transparent_36rem)]" />
      <header className="border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="inline-flex items-center gap-3 font-semibold">
            <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Compass className="size-5" aria-hidden="true" />
            </span>
            <span>OpenVoyage</span>
          </a>
          <span className="rounded-md border bg-card px-3 py-1 text-sm font-medium text-muted-foreground">
            Frontend
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
