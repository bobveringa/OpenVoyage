import { Save } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import {
  checkUsernameAvailability,
  getErrorMessage,
  updateUserProfile,
  uploadMedia,
  type CurrentUser,
  type UserProfileUpdatePayload,
} from '@/api/client'
import { ProfilePictureField } from '@/components/users/profile-picture-field'
import {
  UsernameAvailabilityIndicator,
  type UsernameAvailabilityState,
} from '@/components/users/username-availability-indicator'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type ProfileDetailsFormProps = {
  accessToken: string
  currentUser: CurrentUser
  onSaved: (user: CurrentUser) => void
}

type ProfileFormState = {
  biography: string
  firstName: string
  lastName: string
  username: string
}

type UsernameAvailabilityResult = {
  message: string
  state: UsernameAvailabilityState
}

export function ProfileDetailsForm({
  accessToken,
  currentUser,
  onSaved,
}: ProfileDetailsFormProps) {
  const [formState, setFormState] = useState(() => getInitialFormState(currentUser))
  const [pictureFile, setPictureFile] = useState<File | null>(null)
  const [removePicture, setRemovePicture] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [usernameAvailability, setUsernameAvailability] =
    useState<UsernameAvailabilityResult>({
      message: 'Enter a username',
      state: 'idle',
    })

  useEffect(() => {
    setFormState(getInitialFormState(currentUser))
    setPictureFile(null)
    setRemovePicture(false)
  }, [currentUser])

  const usernameValidation = validateUsernameInput(formState.username)

  useEffect(() => {
    const username = formState.username.trim()
    const validation = validateUsernameInput(username)

    if (!validation.valid) {
      setUsernameAvailability({
        message: validation.message,
        state: username ? 'invalid' : 'idle',
      })
      return undefined
    }

    setUsernameAvailability({
      message: 'Checking username',
      state: 'checking',
    })

    let isCurrent = true
    const timeoutId = window.setTimeout(() => {
      void checkUsernameAvailability({
        accessToken,
        username,
      })
        .then((result) => {
          if (!isCurrent) {
            return
          }

          setUsernameAvailability(
            result.available
              ? {
                  message: 'Username is available',
                  state: 'available',
                }
              : {
                  message: 'Username is taken',
                  state: 'unavailable',
                },
          )
        })
        .catch((availabilityError) => {
          if (!isCurrent) {
            return
          }

          setUsernameAvailability({
            message: getErrorMessage(availabilityError),
            state: 'error',
          })
        })
    }, 350)

    return () => {
      isCurrent = false
      window.clearTimeout(timeoutId)
    }
  }, [accessToken, formState.username])

  const canSubmit =
    usernameValidation.valid &&
    usernameAvailability.state === 'available' &&
    !isSubmitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSavedMessage(null)

    try {
      const payload: UserProfileUpdatePayload = {
        biography: formState.biography.trim(),
        first_name: formState.firstName.trim(),
        last_name: formState.lastName.trim(),
        username: formState.username.trim(),
      }

      if (pictureFile) {
        payload.profile_picture_media_id = await uploadMedia(pictureFile, accessToken)
      } else if (removePicture) {
        payload.profile_picture_media_id = null
      }

      const updatedUser = await updateUserProfile(payload, accessToken)
      onSaved(updatedUser)
      setPictureFile(null)
      setRemovePicture(false)
      setSavedMessage('Profile details saved')
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile details</CardTitle>
        <CardDescription>
          These details are shown on your public trip overview.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-6" onSubmit={handleSubmit}>
          <ProfilePictureField
            currentUser={currentUser}
            disabled={isSubmitting}
            file={pictureFile}
            onFileChange={setPictureFile}
            onRemoveChange={setRemovePicture}
            removePicture={removePicture}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="profile-username"
                >
                  Username
                </label>
                <UsernameAvailabilityIndicator
                  message={usernameAvailability.message}
                  state={usernameAvailability.state}
                />
              </div>
              <Input
                disabled={isSubmitting}
                id="profile-username"
                maxLength={32}
                minLength={3}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                pattern="[A-Za-z0-9._-]+"
                required
                value={formState.username}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Letters, numbers, hyphens, underscores, and periods. No spaces.
              </p>
            </div>

            <div className="grid gap-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="profile-first-name"
              >
                First name
              </label>
              <Input
                disabled={isSubmitting}
                id="profile-first-name"
                maxLength={255}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    firstName: event.target.value,
                  }))
                }
                value={formState.firstName}
              />
            </div>

            <div className="grid gap-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="profile-last-name"
              >
                Last name
              </label>
              <Input
                disabled={isSubmitting}
                id="profile-last-name"
                maxLength={255}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    lastName: event.target.value,
                  }))
                }
                value={formState.lastName}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="profile-biography"
            >
              Biography
            </label>
            <Textarea
              disabled={isSubmitting}
              id="profile-biography"
              maxLength={2048}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  biography: event.target.value,
                }))
              }
              placeholder="A short note about how you travel."
              value={formState.biography}
            />
          </div>

          {error ? (
            <p
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          {savedMessage ? (
            <p
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-primary"
              role="status"
            >
              {savedMessage}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button disabled={!canSubmit} type="submit">
              <Save className="size-4" aria-hidden="true" />
              {isSubmitting ? 'Saving' : 'Save profile'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function getInitialFormState(currentUser: CurrentUser): ProfileFormState {
  const profile = currentUser.profile
  return {
    biography: profile?.biography ?? '',
    firstName: profile?.first_name ?? '',
    lastName: profile?.last_name ?? '',
    username: profile?.username ?? '',
  }
}

function validateUsernameInput(username: string) {
  const trimmedUsername = username.trim()

  if (!trimmedUsername) {
    return {
      message: 'Enter a username',
      valid: false,
    }
  }

  if (trimmedUsername.length < 3 || trimmedUsername.length > 32) {
    return {
      message: 'Use 3 to 32 characters',
      valid: false,
    }
  }

  if (!/^[A-Za-z0-9._-]+$/.test(trimmedUsername)) {
    return {
      message: 'Only letters, numbers, . _ -',
      valid: false,
    }
  }

  if (/^[-._]|[-._]$/.test(trimmedUsername)) {
    return {
      message: 'No separator at the start or end',
      valid: false,
    }
  }

  if (/[-._]{2,}/.test(trimmedUsername)) {
    return {
      message: 'No consecutive separators',
      valid: false,
    }
  }

  if (trimmedUsername.replace(/[-._]/g, '').length < 3) {
    return {
      message: 'Use at least 3 letters or numbers',
      valid: false,
    }
  }

  return {
    message: '',
    valid: true,
  }
}
