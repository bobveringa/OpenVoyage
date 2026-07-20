import { LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type LoginFormValues = {
  email: string
  password: string
}

type LoginFormProps = {
  error?: string | null
  isSubmitting?: boolean
  onSubmit: (values: LoginFormValues) => void
}

export function LoginForm({
  error,
  isSubmitting = false,
  onSubmit,
}: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    onSubmit({
      email: email.trim(),
      password,
    })
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="email">
          Email
        </label>
        <Input
          autoComplete="email"
          autoFocus
          id="email"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="password">
          Password
        </label>
        <Input
          autoComplete="current-password"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          value={password}
        />
      </div>

      {error ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button className="w-full" disabled={!canSubmit} size="lg" type="submit">
        {isSubmitting ? 'Signing in' : 'Sign in'}
        <LogIn className="size-4" aria-hidden="true" />
      </Button>
    </form>
  )
}
