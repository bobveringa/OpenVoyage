import { CalendarPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import {
  createTrip,
  getErrorMessage,
  uploadMedia,
  type Trip,
  type TripVisibility,
} from '@/api/client'
import { createDefaultTripCoverFile } from '@/components/trips/default-trip-cover'
import { TripCoverField } from '@/components/trips/trip-cover-field'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type CreateTripModalProps = {
  accessToken: string
  onClose: () => void
  onCreated: (trip: Trip) => void
  open: boolean
}

type CreateTripFormState = {
  description: string
  endDate: string
  name: string
  startDate: string
  visibility: TripVisibility
}

const initialFormState: CreateTripFormState = {
  description: '',
  endDate: '',
  name: '',
  startDate: '',
  visibility: 'PRIVATE',
}

const visibilityOptions = [
  { label: 'Private', value: 'PRIVATE' },
  { label: 'Platform public', value: 'PLATFORM_PUBLIC' },
  { label: 'Public', value: 'PUBLIC' },
] satisfies Array<{ label: string; value: TripVisibility }>

export function CreateTripModal({
  accessToken,
  onClose,
  onCreated,
  open,
}: CreateTripModalProps) {
  const [formState, setFormState] = useState<CreateTripFormState>(initialFormState)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const canSubmit =
    formState.name.trim().length > 0 &&
    formState.startDate.length > 0 &&
    !isSubmitting

  function resetAndClose() {
    if (isSubmitting) {
      return
    }

    setFormState(initialFormState)
    setCoverFile(null)
    setError(null)
    onClose()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const tripCoverFile = coverFile ?? (await createDefaultTripCoverFile())
      const mediaId = await uploadMedia(tripCoverFile, accessToken)
      const trip = await createTrip(
        {
          description: formState.description.trim(),
          end_date: formState.endDate || null,
          media_id: mediaId,
          name: formState.name.trim(),
          start_date: formState.startDate,
          visibility: formState.visibility,
        },
        accessToken,
      )

      onCreated(trip)
      setFormState(initialFormState)
      setCoverFile(null)
      onClose()
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleStartDateChange(startDate: string) {
    setFormState((current) => ({
      ...current,
      endDate:
        current.endDate && current.endDate < startDate ? '' : current.endDate,
      startDate,
    }))
  }

  function handleEndDateChange(endDate: string) {
    setFormState((current) => ({
      ...current,
      endDate,
    }))
  }

  return (
    <Modal
      description="Add the basics now. Details can be expanded later."
      onClose={resetAndClose}
      open={open}
      title="Create trip"
    >
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <TripCoverField
          disabled={isSubmitting}
          file={coverFile}
          onFileChange={setCoverFile}
        />

        <div className="grid gap-2">
          <label className="text-sm font-medium text-foreground" htmlFor="name">
            Trip name
          </label>
          <Input
            disabled={isSubmitting}
            id="name"
            maxLength={255}
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            placeholder="Japan spring route"
            value={formState.name}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="start-date"
            >
              Start date
            </label>
            <DatePicker
              disabled={isSubmitting}
              id="start-date"
              onValueChange={handleStartDateChange}
              value={formState.startDate}
            />
          </div>

          <div className="grid gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="end-date"
            >
              End date
            </label>
            <DatePicker
              disabled={isSubmitting}
              id="end-date"
              min={formState.startDate || undefined}
              onValueChange={handleEndDateChange}
              value={formState.endDate}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="visibility"
          >
            Visibility
          </label>
          <Select
            disabled={isSubmitting}
            id="visibility"
            onValueChange={(visibility) =>
              setFormState((current) => ({
                ...current,
                visibility,
              }))
            }
            options={visibilityOptions}
            value={formState.visibility}
          />
        </div>

        <div className="grid gap-2">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="description"
          >
            Description
          </label>
          <Textarea
            disabled={isSubmitting}
            id="description"
            onChange={(event) =>
              setFormState((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder="A short note about this trip."
            value={formState.description}
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

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            disabled={isSubmitting}
            onClick={resetAndClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit} type="submit">
            <CalendarPlus className="size-4" aria-hidden="true" />
            {isSubmitting ? 'Creating' : 'Create trip'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
