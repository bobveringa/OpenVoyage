import { ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import {
  createSetupAdmin,
  getErrorMessage,
  type CurrentUser,
} from '@/api/client'
import { useAuth } from '@/auth/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppBackground } from '@/components/layout/app-background'

type SetupPageProps = {
  onAuthenticated: (user: CurrentUser) => void
  onSetupCompleted: () => void
}

type SetupFormState = {
  email: string
  firstName: string
  lastName: string
  password: string
  username: string
}

const INITIAL_FORM_STATE: SetupFormState = {
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  username: '',
}

export function SetupPage({
  onAuthenticated,
  onSetupCompleted,
}: SetupPageProps) {
  const { signIn } = useAuth()
  const [formState, setFormState] = useState(INITIAL_FORM_STATE)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const canSubmit =
    formState.email.trim().length > 0 &&
    formState.firstName.trim().length > 0 &&
    formState.lastName.trim().length > 0 &&
    formState.username.trim().length >= 3 &&
    formState.password.length >= 8 &&
    !isSubmitting

  function updateField(field: keyof SetupFormState, value: string) {
    setFormState((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    const email = formState.email.trim()
    const password = formState.password
    setIsSubmitting(true)
    setError(null)

    try {
      await createSetupAdmin({
        email,
        first_name: formState.firstName.trim(),
        last_name: formState.lastName.trim(),
        password,
        username: formState.username.trim(),
      })
      onSetupCompleted()
      const user = await signIn({ email, password })
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
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8">
        <div className="mb-8 grid justify-items-center gap-4 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              Set up OpenVoyage
            </h1>
            <p className="text-sm text-muted-foreground">
              Create the first administrator account for this instance.
            </p>
          </div>
        </div>

        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="setup-first-name">
                First name
              </label>
              <Input
                autoComplete="given-name"
                autoFocus
                id="setup-first-name"
                onChange={(event) => updateField('firstName', event.target.value)}
                required
                value={formState.firstName}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="setup-last-name">
                Last name
              </label>
              <Input
                autoComplete="family-name"
                id="setup-last-name"
                onChange={(event) => updateField('lastName', event.target.value)}
                required
                value={formState.lastName}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="setup-email">
              Email
            </label>
            <Input
              autoComplete="email"
              id="setup-email"
              inputMode="email"
              onChange={(event) => updateField('email', event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={formState.email}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="setup-username">
              Username
            </label>
            <Input
              autoComplete="username"
              id="setup-username"
              maxLength={32}
              minLength={3}
              onChange={(event) => updateField('username', event.target.value)}
              pattern="[A-Za-z0-9._-]+"
              required
              value={formState.username}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              3–32 letters, numbers, hyphens, underscores, or periods.
            </p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="setup-password">
              Password
            </label>
            <Input
              autoComplete="new-password"
              id="setup-password"
              minLength={8}
              onChange={(event) => updateField('password', event.target.value)}
              required
              type="password"
              value={formState.password}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Use at least 8 characters.
            </p>
          </div>

          {error ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <Button
            className="w-full"
            disabled={!canSubmit}
            size="lg"
            type="submit"
          >
            {isSubmitting ? 'Creating administrator' : 'Create administrator'}
          </Button>
        </form>
      </section>
    </main>
  )
}
