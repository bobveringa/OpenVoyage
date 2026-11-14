import { AlertTriangle, ChevronRight, MapPin, Plus } from 'lucide-react'
import { useContext, useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'

import { reverseGeocodeAddress, type AddressResult, type Stay, type StayCreatePayload, type StayUpdatePayload } from '@/api/client'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { formatDateTime, useClockFormat } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { usePublicSetting } from '@/settings/public-settings'
import { addressSearchMode, type AddressSearchMode } from './address-search'
import type { Stop } from './models'
import type { DraftPostLocation } from './page-types'
import { PlanningSessionContext } from './planning-session'
import { formatCoordinates } from './planning-utils'
import { StayAddressSearch } from './stay-address-search'
import { CHECK_IN_PRESETS, CHECK_OUT_PRESETS, stayTimeOptions } from './stay-times'
import { STAY_TYPES, stayTypeInfo, type StayType } from './stay-types'
import {
  formatShortDate,
  leaveDateOf,
  stayNightCount,
  suggestStayDates,
  type StopStayStatus,
  type StayWarning,
} from './stay-warnings'

const needsNoBooking = (type: StayType) => type === 'FRIENDS' || type === 'OVERNIGHT_TRAVEL'

export type StayActions = {
  onCreate: (payload: StayCreatePayload) => void
  onUpdate: (stayId: string, payload: StayUpdatePayload) => void
  onDelete: (stayId: string) => void
  onHover: (stayId: string | null) => void
}

type StayDraft = {
  stay_type: StayType
  status: 'IDEA' | 'BOOKED'
  name: string
  check_in_date: string
  check_out_date: string
  check_in_time: string
  check_out_time: string
  address: string
  booking_reference: string
  booking_url: string
  contact_phone: string
  contact_email: string
  pin: { latitude: number; longitude: number } | null
}

type Editor = { stay: Stay | null; draft: StayDraft }

/** The stays part of the stop card: nights booked and a calm list of stays.
 * Adding and editing happen in a modal. */
export function StaysSection({
  actions,
  disabled,
  status,
  stop,
}: {
  actions: StayActions
  disabled: boolean
  status: StopStayStatus
  stop: Stop
}) {
  const headingId = useId()
  const { accessToken, saveError, stayMap } = useContext(PlanningSessionContext)
  const addressMode = addressSearchMode(usePublicSetting('address_search.provider'))
  // The address last filled in from a pin, so a moved pin may replace it
  // but never an address someone typed.
  const autoAddress = useRef<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pinning, setPinning] = useState(false)
  const [closeAfterSave, setCloseAfterSave] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const pinStart = useRef<DraftPostLocation | null>(null)

  // Close the modal once its save has finished; keep it open on an error.
  useEffect(() => {
    if (!closeAfterSave || disabled) return
    setCloseAfterSave(false)
    if (saveError) setFormError(saveError)
    else setEditor(null)
  }, [closeAfterSave, disabled, saveError])

  // While placing, the modal steps aside. A map click (or the phone's map
  // picker) sets the pin and brings the modal back.
  const picked = stayMap?.location ?? null
  const mapActive = Boolean(stayMap?.active)
  useEffect(() => {
    if (!pinning) return
    if (picked && picked !== pinStart.current) {
      const [latitude, longitude] = picked.coordinates
      setEditor((current) => current ? { ...current, draft: { ...current.draft, pin: { latitude, longitude } } } : current)
      setPinning(false)
      stayMap?.stop()
      if (addressMode !== 'off') {
        // Dropping a pin fills in the address.
        reverseGeocodeAddress({ accessToken, latitude, longitude, tripId: stop.trip_id })
          .then((result) => {
            if (!result?.address) return
            setEditor((current) => {
              if (!current || current.draft.pin?.latitude !== latitude || current.draft.pin?.longitude !== longitude) return current
              const typed = current.draft.address.trim() && current.draft.address !== autoAddress.current
              if (typed) return current
              autoAddress.current = result.address
              return { ...current, draft: { ...current.draft, address: result.address ?? '' } }
            })
          })
          .catch(() => {})
      }
    } else if (!mapActive) {
      setPinning(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the pick changes
  }, [picked, pinning, mapActive, stayMap])

  function open(stay: Stay | null) {
    setFormError(null)
    autoAddress.current = null
    setEditor({ stay, draft: createDraft(stay, stop) })
  }

  function close() {
    if (pinning) stayMap?.stop()
    setPinning(false)
    setEditor(null)
  }

  function startPinning() {
    if (!editor || !stayMap) return
    const pin = editor.draft.pin
    pinStart.current = pin ? { coordinates: [pin.latitude, pin.longitude], label: 'Selected stay location' } : null
    stayMap.start(pinStart.current, editor.draft.name.trim())
    setPinning(true)
  }

  function save(payload: StayUpdatePayload) {
    if (!editor) return
    setFormError(null)
    setCloseAfterSave(true)
    if (editor.stay) actions.onUpdate(editor.stay.id, payload)
    else actions.onCreate({ ...payload, stop_id: stop.id } as StayCreatePayload)
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-foreground" id={headingId}>Stays</h3>
        <Button className="-mr-2 h-8 rounded-full px-3 text-primary" disabled={disabled || status.nights === 0}
          onClick={() => open(null)} size="sm" type="button" variant="ghost">
          <Plus className="size-4" aria-hidden="true" />
          Add a stay
        </Button>
      </div>
      {status.nights > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {status.coveredNights}/{status.nights} {status.nights === 1 ? 'night' : 'nights'} booked
          </p>
          <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(status.coveredNights / status.nights) * 100}%` }} />
          </div>
        </div>
      ) : null}
      {stop.stays.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {stop.stays.map((stay) => (
            <li key={stay.id}>
              <StayRow
                disabled={disabled}
                onEdit={() => open(stay)}
                onHover={actions.onHover}
                stay={stay}
                warnings={status.stayWarnings[stay.id] ?? []}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <StayModal
        addressMode={addressMode}
        disabled={disabled}
        editor={editor}
        error={formError}
        onChange={(draft) => setEditor((current) => current ? { ...current, draft } : current)}
        onClose={close}
        onDelete={() => {
          if (!editor?.stay) return
          setFormError(null)
          setCloseAfterSave(true)
          actions.onDelete(editor.stay.id)
        }}
        onPin={stayMap ? startPinning : null}
        onSave={save}
        open={Boolean(editor) && !pinning}
        stop={stop}
      />
    </section>
  )
}

function StayRow({
  disabled,
  onEdit,
  onHover,
  stay,
  warnings,
}: {
  disabled: boolean
  onEdit: () => void
  onHover: (stayId: string | null) => void
  stay: Stay
  warnings: readonly StayWarning[]
}) {
  const type = stayTypeInfo(stay.stay_type)
  const Icon = type.icon
  const nights = stayNightCount(stay)
  const details = [
    `${formatShortDate(stay.check_in_date)} – ${formatShortDate(stay.check_out_date)}`,
    `${nights} ${nights === 1 ? 'night' : 'nights'}`,
    stay.status === 'BOOKED' ? 'Booked' : stay.status === 'IDEA' ? 'Idea' : type.label,
  ].join(' · ')
  return (
    <button
      aria-label={`${stay.name}, ${details}`}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
      data-stay-id={stay.id}
      disabled={disabled}
      onBlur={() => onHover(null)}
      onClick={onEdit}
      onFocus={() => onHover(stay.id)}
      onMouseEnter={() => onHover(stay.id)}
      onMouseLeave={() => onHover(null)}
      type="button"
    >
      {/* Filled for booked, outlined for ideas: the same as the bed pins. */}
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full',
        stay.status === 'IDEA' ? 'border border-primary/50 text-primary' : 'bg-primary text-primary-foreground')}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{stay.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{details}</span>
        {warnings.map((warning) => (
          <span className="mt-0.5 flex items-start gap-1 text-xs text-foreground" key={warning.kind + warning.message}>
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden="true" />
            {warning.message}
          </span>
        ))}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

export function WarningLine({ message }: { message: string }) {
  return (
    <span className="flex items-start gap-1.5 text-xs text-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
      <span>{message}</span>
    </span>
  )
}

function createDraft(stay: Stay | null, stop: Stop): StayDraft {
  return {
    stay_type: stay?.stay_type ?? 'HOTEL',
    status: stay?.status ?? 'IDEA',
    name: stay?.name ?? '',
    ...(stay ? { check_in_date: stay.check_in_date, check_out_date: stay.check_out_date } : suggestStayDates(stop)),
    check_in_time: stay?.check_in_time ?? '',
    check_out_time: stay?.check_out_time ?? '',
    address: stay?.address ?? '',
    booking_reference: stay?.booking_reference ?? '',
    booking_url: stay?.booking_url ?? '',
    contact_phone: stay?.contact_phone ?? '',
    contact_email: stay?.contact_email ?? '',
    pin: stay?.location ? { latitude: stay.location.latitude, longitude: stay.location.longitude } : null,
  }
}

const orNull = (value: string) => value.trim() || null

function hasDetails(stay: Stay | null) {
  return Boolean(stay && (stay.booking_reference || stay.booking_url || stay.contact_phone
    || stay.contact_email || stay.check_in_time || stay.check_out_time))
}

function StayModal({
  addressMode,
  disabled,
  editor,
  error,
  onChange,
  onClose,
  onDelete,
  onPin,
  onSave,
  open,
  stop,
}: {
  disabled: boolean
  editor: Editor | null
  error: string | null
  onChange: (draft: StayDraft) => void
  onClose: () => void
  onDelete: () => void
  onPin: (() => void) | null
  onSave: (payload: StayUpdatePayload) => void
  open: boolean
  stop: Stop
  addressMode: AddressSearchMode
}) {
  if (!editor) return null
  return (
    <StayModalContent addressMode={addressMode} disabled={disabled} editor={editor} error={error} key={editor.stay?.id ?? 'new'}
      onChange={onChange} onClose={onClose} onDelete={onDelete} onPin={onPin} onSave={onSave} open={open} stop={stop} />
  )
}

function StayModalContent({
  addressMode,
  disabled,
  editor,
  error,
  onChange,
  onClose,
  onDelete,
  onPin,
  onSave,
  open,
  stop,
}: {
  disabled: boolean
  editor: Editor
  error: string | null
  onChange: (draft: StayDraft) => void
  onClose: () => void
  onDelete: () => void
  onPin: (() => void) | null
  onSave: (payload: StayUpdatePayload) => void
  open: boolean
  stop: Stop
  addressMode: AddressSearchMode
}) {
  const formId = useId()
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Optional details stay folded until needed, so the form stays short.
  const [showDetails, setShowDetails] = useState(() => hasDetails(editor.stay))
  const { draft, stay } = editor
  const set = <K extends keyof StayDraft>(key: K, value: StayDraft[K]) => onChange({ ...draft, [key]: value })
  function pickAddress(result: AddressResult) {
    // A result is sent as its coordinates, plus its text in the address.
    onChange({
      ...draft,
      name: draft.name.trim() ? draft.name : result.name,
      address: result.address ?? draft.address,
      pin: { latitude: result.latitude, longitude: result.longitude },
    })
  }
  const leave = leaveDateOf(stop)
  const noBooking = needsNoBooking(draft.stay_type)
  const datesValid = draft.check_out_date > draft.check_in_date
  const canSave = draft.name.trim().length > 0 && datesValid && !disabled

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    const payload: StayUpdatePayload = {
      stay_type: draft.stay_type,
      status: noBooking ? null : draft.status,
      name: draft.name.trim(),
      check_in_date: draft.check_in_date,
      check_out_date: draft.check_out_date,
      check_in_time: orNull(draft.check_in_time),
      check_out_time: orNull(draft.check_out_time),
      address: orNull(draft.address),
      booking_reference: orNull(draft.booking_reference),
      booking_url: orNull(draft.booking_url),
      contact_phone: orNull(draft.contact_phone),
      contact_email: orNull(draft.contact_email),
    }
    const before = stay?.location
    if (!stay || draft.pin?.latitude !== before?.latitude || draft.pin?.longitude !== before?.longitude) {
      payload.location = draft.pin
    }
    onSave(payload)
  }

  const label = 'grid gap-1.5 text-sm font-medium text-foreground'
  const footer = (
    <div className="flex items-center gap-2">
      {stay ? (
        confirmDelete ? (
          <span className="mr-auto flex items-center gap-1 text-sm">
            Delete this stay?
            <Button className="text-destructive" disabled={disabled} onClick={onDelete} size="sm" type="button" variant="ghost">Delete</Button>
            <Button disabled={disabled} onClick={() => setConfirmDelete(false)} size="sm" type="button" variant="ghost">Keep</Button>
          </span>
        ) : (
          <Button className="mr-auto text-destructive hover:bg-destructive/10" disabled={disabled} onClick={() => setConfirmDelete(true)} type="button" variant="ghost">
            Delete
          </Button>
        )
      ) : <span className="mr-auto" />}
      <Button disabled={disabled} onClick={onClose} type="button" variant="outline">Cancel</Button>
      <Button disabled={!canSave} form={formId} type="submit">{stay ? 'Save' : 'Add stay'}</Button>
    </div>
  )

  return (
    <Modal
      className="sm:h-auto sm:max-h-[min(44rem,calc(100dvh-2rem))] sm:max-w-xl"
      footer={footer}
      fullscreenOnMobile
      onClose={onClose}
      open={open}
      title={stay ? stay.name : 'New stay'}
    >
      <form aria-label={stay ? `Edit ${stay.name}` : 'New stay'} className="space-y-5 px-1" id={formId} onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={label}>
            Type
            <Select ariaLabel="Type" disabled={disabled} onValueChange={(value) => set('stay_type', value)}
              options={STAY_TYPES} value={draft.stay_type} />
          </div>
          <label className={label}>
            Name
            <Input autoFocus disabled={disabled} maxLength={255} onChange={(event) => set('name', event.target.value)}
              placeholder={draft.stay_type === 'FRIENDS' ? 'For example Marta' : 'For example Hotel Arts'} value={draft.name} />
          </label>
        </div>

        {!noBooking ? (
          <div aria-label="Status" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup">
            {(['IDEA', 'BOOKED'] as const).map((value) => (
              <button aria-checked={draft.status === value} className={cn('h-8 rounded-lg text-sm font-semibold transition-colors',
                draft.status === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              disabled={disabled} key={value} onClick={() => set('status', value)} role="radio" type="button">
                {value === 'IDEA' ? 'Idea' : 'Booked'}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <div className={label}>
            Check-in
            <DatePicker ariaLabel="Check-in date" disabled={disabled} max={leave} min={stop.planned_start_date}
              onValueChange={(value) => set('check_in_date', value)} value={draft.check_in_date} />
          </div>
          <div className={label}>
            Check-out
            <DatePicker ariaLabel="Check-out date" disabled={disabled} max={leave} min={stop.planned_start_date}
              onValueChange={(value) => set('check_out_date', value)} popoverAlign="end" value={draft.check_out_date} />
          </div>
        </div>
        {!datesValid ? <p className="-mt-3 text-xs text-destructive">Check-out must be after check-in.</p> : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">Location</span>
            {draft.pin ? (
              <Button className="-mr-2 h-7 px-2 text-muted-foreground" disabled={disabled} onClick={() => set('pin', null)} size="sm" type="button" variant="ghost">
                Remove pin
              </Button>
            ) : null}
          </div>
          {addressMode !== 'off' ? (
            <StayAddressSearch
              disabled={disabled}
              mode={addressMode}
              near={{ latitude: stop.location.latitude, longitude: stop.location.longitude }}
              onPick={pickAddress}
              tripId={stop.trip_id}
            />
          ) : null}
          <button className="flex w-full items-center gap-2 rounded-xl border border-dashed border-input px-3 py-2.5 text-left text-sm text-foreground hover:border-primary/60 hover:bg-muted/50 disabled:opacity-50"
            disabled={disabled || !onPin} onClick={() => onPin?.()} type="button">
            <MapPin className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {draft.pin ? `Pin at ${formatCoordinates([draft.pin.latitude, draft.pin.longitude])}` : 'Drop a pin on the map'}
            </span>
            <span className="text-xs font-semibold text-primary">{draft.pin ? 'Move' : 'Choose'}</span>
          </button>
          <Input aria-label="Address" disabled={disabled} onChange={(event) => set('address', event.target.value)} placeholder="Address (optional)" value={draft.address} />
        </div>

        <div className="border-t border-border pt-3">
          <button aria-expanded={showDetails} className="flex w-full items-center justify-between py-1 text-sm font-medium text-foreground"
            onClick={() => setShowDetails((value) => !value)} type="button">
            Times, booking and contact
            <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', showDetails && 'rotate-90')} aria-hidden="true" />
          </button>
          {showDetails ? (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className={label}>
                Check-in from
                <StayTimeSelect ariaLabel="Check-in time" disabled={disabled} onChange={(value) => set('check_in_time', value)}
                  presets={CHECK_IN_PRESETS} value={draft.check_in_time} />
              </div>
              <div className={label}>
                Check-out before
                <StayTimeSelect ariaLabel="Check-out time" disabled={disabled} onChange={(value) => set('check_out_time', value)}
                  presets={CHECK_OUT_PRESETS} value={draft.check_out_time} />
              </div>
              {!noBooking ? (
                <>
                  <label className={label}>
                    Booking reference
                    <Input disabled={disabled} maxLength={255} onChange={(event) => set('booking_reference', event.target.value)} value={draft.booking_reference} />
                  </label>
                  <label className={label}>
                    Booking link
                    <Input disabled={disabled} inputMode="url" onChange={(event) => set('booking_url', event.target.value)} placeholder="https://" type="url" value={draft.booking_url} />
                  </label>
                </>
              ) : null}
              <label className={label}>
                Phone
                <Input disabled={disabled} maxLength={64} onChange={(event) => set('contact_phone', event.target.value)} type="tel" value={draft.contact_phone} />
              </label>
              <label className={label}>
                Email
                <Input disabled={disabled} maxLength={255} onChange={(event) => set('contact_email', event.target.value)} type="email" value={draft.contact_email} />
              </label>
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </form>
    </Modal>
  )
}

/** A time in the app's own menu style: the usual times first, then every half hour. */
function StayTimeSelect({
  ariaLabel,
  disabled,
  onChange,
  presets,
  value,
}: {
  ariaLabel: string
  disabled: boolean
  onChange: (value: string) => void
  presets: readonly string[]
  value: string
}) {
  const { preference } = useClockFormat()
  const format = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    return formatDateTime(new Date(2000, 0, 1, hour, minute), { hour: 'numeric', minute: '2-digit' }, preference)
  }
  const options = stayTimeOptions(presets, value).map((option) => ({
    value: option.value,
    label: option.value ? format(option.value) : 'Not set',
    description: option.preset ? 'Usual time' : undefined,
    selectedDescription: '',
  }))
  return <Select ariaLabel={ariaLabel} disabled={disabled} onValueChange={onChange} options={options}
    searchable searchPlaceholder="Type a time" value={value} />
}
