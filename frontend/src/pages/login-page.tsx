import { Compass } from 'lucide-react'
import { useState } from 'react'

import type { CurrentUser } from '@/api/client'
import { getErrorMessage } from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import { LoginForm, type LoginFormValues } from '@/components/auth/login-form'
import { AppBackground } from '@/components/layout/app-background'

type LoginPageProps = {
  onAuthenticated: (user: CurrentUser) => void
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Compass className="size-6" aria-hidden="true" />
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
      </section>
    </main>
  )
}
