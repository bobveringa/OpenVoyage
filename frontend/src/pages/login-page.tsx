import { useState } from 'react'

import type { CurrentUser } from '@/api/client'
import { getErrorMessage } from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import { LoginForm, type LoginFormValues } from '@/components/auth/login-form'
import { AppLogo } from '@/components/branding/app-logo'
import { AppBackground } from '@/components/layout/app-background'
import { useNativeServerGate } from '@/native/native-server-gate-context'
import { isNativePlatform } from '@/native/platform'
import { getCurrentServerUrl } from '@/native/server-config'

type LoginPageProps = {
  onAuthenticated: (user: CurrentUser) => void
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nativeServerGate = useNativeServerGate()
  const showServerSwitch = isNativePlatform() && nativeServerGate !== null

  async function handleSubmit(values: LoginFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const user = await signIn(values)
      onAuthenticated(user)
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setIsSubmitting(false)
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
            <h1 className="text-2xl font-semibold tracking-normal">Sign in</h1>
            <p className="text-sm text-muted-foreground">OpenVoyage</p>
          </div>
        </div>

        <LoginForm
          error={error}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
        />

        {showServerSwitch ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Connected to {getCurrentServerUrl()}.{' '}
            <button
              className="font-medium text-foreground underline-offset-2 hover:underline"
              onClick={() => nativeServerGate?.requestChangeServer()}
              type="button"
            >
              Wrong server?
            </button>
          </p>
        ) : null}
      </section>
    </main>
  )
}
