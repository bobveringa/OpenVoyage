import { AlertCircle, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import type { CurrentUser } from '@/api/client'
import { getErrorMessage } from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { useAuth } from '@/auth/use-auth'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { getUserUsername } from '@/lib/users'

type AccountSecurityPageProps = {
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  onNavigate: (to: string) => void
}

export function AccountSecurityPage({
  authStatus,
  currentUser,
  onNavigate,
}: AccountSecurityPageProps) {
  const { changePassword, signOutAll } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showSignOutAll, setShowSignOutAll] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  if (authStatus === 'loading') {
    return <LoadingState label="Loading account security" />
  }

  if (!currentUser) {
    return (
      <div className="py-8 sm:py-10">
        <EmptyState
          action={
            <Button onClick={() => onNavigate('/login')} type="button">
              Sign in
            </Button>
          }
          description="You need to be signed in before you can manage account security."
          icon={KeyRound}
          title="Sign in required"
        />
      </div>
    )
  }

  const changeRequired = currentUser.password_change_required

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) {
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      setSuccess(null)
      return
    }

    setIsSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      if (changeRequired) {
        const username = getUserUsername(currentUser)
        onNavigate(username ? `/users/${encodeURIComponent(username)}` : '/setup')
      } else {
        setSuccess('Password updated. Other devices have been signed out.')
      }
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setIsSaving(false)
    }
  }

  async function confirmSignOutAll() {
    if (isSigningOut) {
      return
    }
    setIsSigningOut(true)
    setError(null)
    try {
      await signOutAll()
      onNavigate('/login')
    } catch (signOutError) {
      setShowSignOutAll(false)
      setError(getErrorMessage(signOutError))
      setIsSigningOut(false)
    }
  }

  return (
    <div className="space-y-6 py-6 sm:py-8 lg:py-10">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          Account
        </p>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">
            Account security
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {changeRequired
              ? 'Choose a private password before continuing to OpenVoyage.'
              : 'Update your password or sign out every device using your account.'}
          </p>
        </div>
      </div>

      {changeRequired ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <p>
            Your current password was assigned by an administrator and must be
            replaced before you can use other features.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Changing your password signs out every other browser and keeps this
            one signed in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid max-w-xl gap-5" onSubmit={submitPassword}>
            <PasswordField
              autoComplete="current-password"
              label="Current password"
              onChange={setCurrentPassword}
              value={currentPassword}
            />
            <PasswordField
              autoComplete="new-password"
              label="New password"
              onChange={setNewPassword}
              value={newPassword}
            />
            <PasswordField
              autoComplete="new-password"
              label="Confirm new password"
              onChange={setConfirmPassword}
              value={confirmPassword}
            />

            {error ? (
              <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="text-sm font-medium text-emerald-700" role="status">
                {success}
              </p>
            ) : null}

            <div>
              <Button disabled={isSaving} type="submit">
                <KeyRound className="size-4" aria-hidden="true" />
                {isSaving ? 'Updating…' : 'Update password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {!changeRequired ? (
        <Card>
          <CardHeader>
            <CardTitle>Sign out all devices</CardTitle>
            <CardDescription>
              Invalidates every current login, including this browser. Your
              password does not change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => setShowSignOutAll(true)}
              type="button"
              variant="outline"
            >
              <LogOut className="size-4 text-destructive" aria-hidden="true" />
              Sign out all devices
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Modal
        description="Every current login will stop working. You will need to sign in again on this device."
        onClose={() => setShowSignOutAll(false)}
        open={showSignOutAll}
        title="Sign out all devices?"
      >
        <div className="flex justify-end gap-2 p-1">
          <Button
            disabled={isSigningOut}
            onClick={() => setShowSignOutAll(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={isSigningOut}
            onClick={() => void confirmSignOutAll()}
            type="button"
            variant="destructive"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out all devices'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function PasswordField({
  autoComplete,
  label,
  onChange,
  value,
}: {
  autoComplete: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-foreground">
      <span>{label}</span>
      <Input
        autoComplete={autoComplete}
        maxLength={128}
        minLength={8}
        onChange={(event) => onChange(event.target.value)}
        required
        type="password"
        value={value}
      />
    </label>
  )
}
