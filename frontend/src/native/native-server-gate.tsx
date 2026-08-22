import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { AppBackground } from '@/components/layout/app-background'
import { AppLogo } from '@/components/branding/app-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { NativeServerGateContext } from '@/native/native-server-gate-context'
import {
  getStoredServerUrl,
  needsNativeServerSetup,
  setStoredServerUrl,
} from '@/native/server-config'
import { usePublicSettings } from '@/settings/use-public-settings'

type GateStatus = 'checking' | 'needs-setup' | 'ready'

export function NativeServerGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GateStatus>('checking')
  // Distinguishes "first run, nothing to go back to" from "user asked to
  // change an already-working server" so the setup screen can offer Cancel
  // only in the latter case.
  const [isChangeFlow, setIsChangeFlow] = useState(false)
  const publicSettings = usePublicSettings()

  useEffect(() => {
    let isCurrent = true
    void needsNativeServerSetup().then((needsSetup) => {
      if (isCurrent) {
        setStatus(needsSetup ? 'needs-setup' : 'ready')
      }
    })
    return () => {
      isCurrent = false
    }
  }, [])

  const requestChangeServer = useCallback(() => {
    setIsChangeFlow(true)
    setStatus('needs-setup')
  }, [])

  if (status === 'checking') {
    return null
  }

  if (status === 'needs-setup') {
    return (
      <ServerSetupPage
        allowCancel={isChangeFlow}
        onCancel={() => {
          setIsChangeFlow(false)
          setStatus('ready')
        }}
        onSaved={() => {
          setIsChangeFlow(false)
          // The very first fetch (before any server was known) had nothing
          // reachable to hit; re-fetch now that the real server is set so
          // branding/theme settings reflect that server, not the default.
          void publicSettings.refresh()
          setStatus('ready')
        }}
      />
    )
  }

  return (
    <NativeServerGateContext.Provider value={{ requestChangeServer }}>
      {children}
    </NativeServerGateContext.Provider>
  )
}

type Protocol = 'https' | 'http'

const CONNECT_TIMEOUT_MS = 8_000

function splitServerUrl(url: string): { protocol: Protocol; hostAndPort: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null
    }
    return {
      hostAndPort: parsed.host,
      protocol: parsed.protocol === 'https:' ? 'https' : 'http',
    }
  } catch {
    return null
  }
}

function ServerSetupPage({
  allowCancel,
  onCancel,
  onSaved,
}: {
  allowCancel: boolean
  onCancel: () => void
  onSaved: () => void
}) {
  const [protocol, setProtocol] = useState<Protocol>('https')
  const [hostAndPort, setHostAndPort] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  // Prefill with whatever server is already configured — most visits to
  // this screen via "Wrong server?" are a typo fix, not a fresh entry.
  useEffect(() => {
    void getStoredServerUrl().then((stored) => {
      if (!stored) {
        return
      }
      const parsed = splitServerUrl(stored)
      if (parsed) {
        setProtocol(parsed.protocol)
        setHostAndPort(parsed.hostAndPort)
      }
    })
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isChecking) {
      return
    }

    // Users tend to paste/type a full address out of habit — accept that
    // rather than doubling the protocol onto itself.
    const host = hostAndPort.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    if (!host) {
      setError('Enter your OpenVoyage server address.')
      return
    }

    const candidateUrl = `${protocol}://${host}`
    let parsed: URL
    try {
      parsed = new URL(candidateUrl)
    } catch {
      setError('That doesn’t look like a valid address.')
      return
    }

    setIsChecking(true)
    setError(null)
    try {
      await checkServerReachable(parsed.origin)
      await setStoredServerUrl(parsed.origin)
      onSaved()
    } catch (checkError) {
      setError(describeConnectError(checkError))
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10 text-foreground">
      <AppBackground />
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
        <div className="mb-8 grid justify-items-center gap-4 text-center">
          <span className="size-12 overflow-hidden rounded-xl shadow-sm">
            <AppLogo className="size-full" />
          </span>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              {allowCancel ? 'Change server' : 'Connect to your server'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {allowCancel
                ? "Enter the address of the OpenVoyage server you'd like to switch to."
                : "OpenVoyage is self-hosted. Enter the address you'd normally open in a browser to reach your instance."}
            </p>
          </div>
        </div>

        <form className="grid gap-5" onSubmit={(event) => void handleSubmit(event)}>
          <label className="grid gap-2 text-sm font-medium text-foreground">
            <span>Server address</span>
            <div className="flex gap-2">
              <ProtocolToggle
                disabled={isChecking}
                onChange={setProtocol}
                value={protocol}
              />
              <Input
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                className="flex-1"
                disabled={isChecking}
                inputMode="url"
                onChange={(event) => setHostAndPort(event.target.value)}
                placeholder="travel.example.com:8000"
                type="text"
                value={hostAndPort}
              />
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              Port is optional — only add one if your server needs it.
            </span>
          </label>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            {allowCancel ? (
              <Button
                disabled={isChecking}
                onClick={onCancel}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            ) : null}
            <Button className="flex-1" disabled={isChecking} type="submit">
              {isChecking ? 'Checking…' : 'Continue'}
            </Button>
          </div>
        </form>
      </section>
    </main>
  )
}

function ProtocolToggle({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean
  onChange: (protocol: Protocol) => void
  value: Protocol
}) {
  return (
    <div
      aria-label="Protocol"
      className="flex h-11 shrink-0 overflow-hidden rounded-xl border border-input bg-muted p-0.5"
      role="group"
    >
      {(['https', 'http'] as const).map((option) => (
        <button
          aria-pressed={value === option}
          className={cn(
            'rounded-[0.6rem] px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === option
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          disabled={disabled}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  )
}

// A raw, timeout-bounded fetch rather than the shared API client: this runs
// before a server is configured at all, so it deliberately doesn't go
// through the app's normal request pipeline (token refresh, retry, etc).
async function checkServerReachable(origin: string): Promise<void> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)

  try {
    const response = await fetch(`${origin}/api/v1/admin/setup`, {
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }

    const body: unknown = await response.json()
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { setup_required?: unknown }).setup_required !== 'boolean'
    ) {
      throw new Error('That address didn’t look like an OpenVoyage server')
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('timed out')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

function describeConnectError(error: unknown): string {
  const detail = error instanceof Error ? error.message : 'unknown error'
  if (detail === 'timed out') {
    return `Timed out after ${CONNECT_TIMEOUT_MS / 1000}s waiting for a response. Check the address and that this device can reach it.`
  }
  return `Could not reach an OpenVoyage server there (${detail}). Double-check the address and that this device can reach it.`
}
