import {
  ArrowRight,
  CheckCircle2,
  Code2,
  Compass,
  Palette,
  RefreshCw,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { API_BASE_URL } from '@/api/client'
import { AppShell } from '@/components/layout/app-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type ReadinessItem = {
  icon: LucideIcon
  label: string
  value: string
}

const readinessItems: ReadinessItem[] = [
  {
    icon: Code2,
    label: 'TypeScript',
    value: 'Strict React app shell',
  },
  {
    icon: Palette,
    label: 'Theme',
    value: 'Single token source',
  },
  {
    icon: RefreshCw,
    label: 'API',
    value: 'Generated OpenAPI types',
  },
]

function App() {
  return (
    <AppShell>
      <section className="grid min-h-[calc(100vh-4.5rem)] content-center gap-10 py-12 md:grid-cols-[1.05fr_0.95fr] md:items-center md:py-16">
        <div className="max-w-2xl space-y-8">
          <Badge variant="secondary" className="gap-2">
            <Compass className="size-3.5" aria-hidden="true" />
            OpenVoyage frontend
          </Badge>

          <div className="space-y-5">
            <h1 className="text-balance text-5xl font-semibold tracking-normal text-foreground sm:text-6xl">
              Hello from OpenVoyage.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">
              The React foundation is ready for the travel planning and blogging
              pages that come next.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" size="lg">
              Start building
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">
              API base:{' '}
              <span className="font-medium text-foreground">{API_BASE_URL}</span>
            </div>
          </div>
        </div>

        <Card className="shadow-soft">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <Badge className="gap-2">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Ready
              </Badge>
              <Compass
                className="size-10 text-primary"
                strokeWidth={1.6}
                aria-hidden="true"
              />
            </div>
            <CardTitle>Frontend baseline</CardTitle>
            <CardDescription>
              Shared structure, typed API access, and standardized visual tokens
              are in place.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {readinessItems.map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-[2.5rem_1fr] items-center gap-3 rounded-md border bg-background/70 p-3"
              >
                <div className="grid size-10 place-items-center rounded-md bg-secondary text-secondary-foreground">
                  <item.icon className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.value}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  )
}

export default App
