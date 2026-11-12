import { ArrowLeft, CalendarDays, Minus, Plus, X } from 'lucide-react'
import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { saveStopNotes, type StayCreatePayload, type StayUpdatePayload, type StopNotes } from '@/api/client'
import { DatePicker } from '@/components/ui/date-time-picker'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme/use-theme'
import { CountryFlag } from './country-flag'
import { parseDateOnly } from './date-utils'
import type { Stop } from './models'
import { formatNights, getCountryName, getNightsBetweenDates, getStayLeaveDateValue } from './planning-utils'
import { PlanningSessionContext } from './planning-session'
import {
  createContourPattern,
  darkenForWhiteText,
  STOP_HEADER_HEIGHT,
  STOP_HEADER_WIDTH,
} from './stop-header-pattern'
import { formatPhotoCredit, useStopPhoto } from './stop-photo'
import { StopMarker } from './stop-marker'
import {
  createNotesAutosave,
  splitNoteLinks,
  type NotesAutosave,
  type NotesAutosaveState,
} from './stop-notes'

export type StopUpdate = {
  planned_nights?: number
  planned_start_date?: string
  title?: string
  /** Moves the stop in the list: right after this stop, or first for null. */
  placement?: { after_stop_id: string | null }
  /** Moves the marker within the stop's place; null puts it back. */
  marker?: { latitude: number; longitude: number } | null
}

/** What the planning list needs from the page to open and edit stop cards. */
export type StopCardControls = {
  openStopId: string | null
  onOpenStop: (stopId: string) => void
  onCloseStop: () => void
  onStopUpdate: (stopId: string, update: StopUpdate) => void
  onStopNotesSaved: (stopId: string, notes: StopNotes) => void
  tripEndDate: string | null
  onMoveTripEnd: (endDate: string) => void
  onStayCreate: (payload: StayCreatePayload) => void
  onStayUpdate: (stayId: string, payload: StayUpdatePayload) => void
  onStayDelete: (stayId: string) => void
  onStayHover: (stayId: string | null) => void
  /** The stop whose row and pin are highlighted, from either side. */
  highlightedStopId: string | null
  onStopHover: (stopId: string | null) => void
}

const cardDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  weekday: 'short',
})

function formatCardDate(value: string) {
  const date = parseDateOnly(value)
  // "Fri 2 Oct" style, without the comma some locales add.
  return date ? cardDateFormatter.format(date).replace(/,/g, '') : value
}

/**
 * Everything about one stop. On a computer it sits over the left of the map
 * and leaves the list and map usable; on a phone it is a full-screen page.
 */
export function StopDetailCard({
  children,
  desktop,
  disabled,
  host,
  onClose,
  onNotesSaved,
  onUpdate,
  stop,
}: {
  children?: ReactNode
  desktop: boolean
  disabled: boolean
  host: HTMLElement | null
  onClose: () => void
  onNotesSaved: (stopId: string, notes: StopNotes) => void
  onUpdate: (stopId: string, update: StopUpdate) => void
  stop: Stop
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Events from portals (the stay modal, pickers) bubble here too; only
    // Escape pressed inside the card itself closes it.
    const inside = event.currentTarget.contains(event.target as Node)
    const dialogOpen = document.querySelector('[role="dialog"][aria-modal="true"]') !== null
    if (event.key === 'Escape' && inside && !dialogOpen && !event.defaultPrevented) {
      event.preventDefault()
      onClose()
    }
  }

  const card = (
    <section
      aria-label={`${stop.title}, stop details`}
      className={cn(
        'flex min-h-0 flex-col overflow-y-auto overscroll-contain bg-card text-card-foreground',
        desktop
          ? 'max-h-full w-full rounded-[24px] border border-border shadow-soft'
          : 'fixed inset-0 z-50 h-dvh w-full',
      )}
      data-stop-card={stop.id}
      onKeyDown={handleKeyDown}
    >
      <StopCardHeader
        desktop={desktop}
        disabled={disabled}
        onClose={onClose}
        onRename={(title) => onUpdate(stop.id, { title })}
        stop={stop}
      />
      <div className="space-y-[18px] p-5">
        <StopDatesBar disabled={disabled} onUpdate={(update) => onUpdate(stop.id, update)} stop={stop} />
        <StopNotesEditor disabled={disabled} key={stop.id} onSaved={onNotesSaved} stop={stop} />
        {children}
        <StopMarker disabled={disabled} key={stop.id} onUpdate={(update) => onUpdate(stop.id, update)} stop={stop} />
      </div>
    </section>
  )

  if (desktop) return host ? createPortal(card, host) : null
  return createPortal(card, document.body)
}

function StopCardHeader({
  desktop,
  disabled,
  onClose,
  onRename,
  stop,
}: {
  desktop: boolean
  disabled: boolean
  onClose: () => void
  onRename: (title: string) => void
  stop: Stop
}) {
  const nameRef = useRef<HTMLButtonElement>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(stop.title)
  const countryName = getCountryName(stop.location.country_code)

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true })
  }, [stop.id])

  function finishRename(save: boolean) {
    const title = draftTitle.trim()
    setRenaming(false)
    if (save && title && title !== stop.title) onRename(title)
    requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }))
  }

  const photo = useStopPhoto(stop)
  const roundButton = 'grid size-11 shrink-0 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'

  return (
    <header className="relative shrink-0 overflow-hidden text-white" style={{ height: STOP_HEADER_HEIGHT }}>
      <ContourBackground countryCode={stop.location.country_code} name={stop.location.name || stop.title} />
      {photo ? <HeaderPhoto key={photo.url} url={photo.url} /> : null}
      <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {!desktop ? (
            <button aria-label="Back to stops" className={roundButton} onClick={onClose} type="button">
              <ArrowLeft className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          {countryName ? (
            <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-sm font-medium backdrop-blur-sm">
              <CountryFlag countryCode={stop.location.country_code} />
              <span className="truncate">{countryName}</span>
            </span>
          ) : null}
        </div>
        {desktop ? (
          <button aria-label="Close stop details" className={roundButton} onClick={onClose} type="button">
            <X className="size-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="absolute inset-x-5 bottom-4 min-w-0">
        {renaming ? (
          <input
            aria-label="Stop name"
            autoFocus
            className="w-full rounded-lg border border-white/60 bg-black/35 px-2 py-0.5 text-[32px] font-bold leading-tight text-white outline-none focus-visible:ring-2 focus-visible:ring-white"
            maxLength={255}
            onBlur={() => finishRename(true)}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); finishRename(true) }
              if (event.key === 'Escape') { event.preventDefault(); setDraftTitle(stop.title); finishRename(false) }
            }}
            value={draftTitle}
          />
        ) : (
          <button
            aria-label={`${stop.title}, rename stop`}
            className="block max-w-full truncate rounded-md text-left text-[32px] font-bold leading-tight drop-shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
            disabled={disabled}
            onClick={() => { setDraftTitle(stop.title); setRenaming(true) }}
            ref={nameRef}
            title="Rename stop"
            type="button"
          >
            {stop.title}
          </button>
        )}
        {/* The region, with the photo credit on the same line, bottom right. */}
        <div className="flex min-w-0 items-end justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-white/85">{stop.location.region}</p>
          {photo ? (
            <a
              className="mb-px max-w-[65%] shrink-0 truncate rounded text-[11px] leading-4 text-white/85 drop-shadow-sm hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white/80"
              href={photo.source_url}
              rel="noopener noreferrer"
              target="_blank"
              title={formatPhotoCredit(photo)}
            >
              {formatPhotoCredit(photo)}
            </a>
          ) : null}
        </div>
      </div>
    </header>
  )
}

/** The Wikipedia photo fades in over the designed header, in the same spot.
 * Dark gradients at the top and bottom keep the white text readable. */
function HeaderPhoto({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div aria-hidden="true" className={cn('absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none', loaded ? 'opacity-100' : 'opacity-0')}>
      <img
        alt=""
        className="size-full object-cover"
        data-testid="stop-header-photo"
        decoding="async"
        onError={() => setLoaded(false)}
        onLoad={() => setLoaded(true)}
        src={url}
      />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  )
}

/** The designed header: contour rings around the place, in the theme's colours. */
function ContourBackground({ countryCode, name }: { countryCode: string; name: string }) {
  const { mode, palette } = useTheme()
  const colors = palette[mode]
  const background = darkenForWhiteText(colors.primary)
  const pattern = useMemo(() => createContourPattern(name, countryCode), [countryCode, name])
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full"
      data-testid="stop-header-pattern"
      preserveAspectRatio="xMidYMid slice"
      viewBox={`0 0 ${STOP_HEADER_WIDTH} ${STOP_HEADER_HEIGHT}`}
    >
      <rect fill={background} height={STOP_HEADER_HEIGHT} width={STOP_HEADER_WIDTH} />
      <g fill="none" stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1.25}>
        {pattern.faintRings.map((ring, index) => <path d={ring} key={index} />)}
      </g>
      <g fill="none" stroke="#ffffff" strokeOpacity={0.2} strokeWidth={1.25}>
        {pattern.rings.map((ring, index) => <path d={ring} key={index} />)}
      </g>
      <circle cx={pattern.dot.x} cy={pattern.dot.y} fill={colors.accent} r={7} stroke="#ffffff" strokeWidth={3} />
    </svg>
  )
}

function StopDatesBar({
  disabled,
  onUpdate,
  stop,
}: {
  disabled: boolean
  onUpdate: (update: StopUpdate) => void
  stop: Stop
}) {
  const leaveDate = getStayLeaveDateValue(stop.planned_start_date, stop.planned_nights)
  const dateTrigger = 'h-auto min-h-0 gap-0 rounded-md border-0 bg-transparent p-0 text-sm font-semibold text-foreground shadow-none hover:border-transparent hover:bg-transparent hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [&>svg]:hidden'
  const nightButton = 'grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-muted/45 py-2 pl-3 pr-2">
      <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 whitespace-nowrap">
        <DatePicker
          ariaLabel={`Arrival date, ${formatCardDate(stop.planned_start_date)}`}
          disabled={disabled}
          displayValue={formatCardDate(stop.planned_start_date)}
          onValueChange={(value) => { if (value && value !== stop.planned_start_date) onUpdate({ planned_start_date: value }) }}
          triggerClassName={dateTrigger}
          value={stop.planned_start_date}
        />
        <span aria-hidden="true" className="text-sm text-muted-foreground">–</span>
        <DatePicker
          ariaLabel={`Leave date, ${formatCardDate(leaveDate)}`}
          disabled={disabled}
          displayValue={formatCardDate(leaveDate)}
          min={stop.planned_start_date}
          onValueChange={(value) => {
            const nights = getNightsBetweenDates(stop.planned_start_date, value)
            if (value && nights !== stop.planned_nights) onUpdate({ planned_nights: nights })
          }}
          popoverAlign="end"
          triggerClassName={dateTrigger}
          value={leaveDate}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button aria-label="One night fewer" className={nightButton} disabled={disabled || stop.planned_nights === 0}
          onClick={() => onUpdate({ planned_nights: stop.planned_nights - 1 })} type="button">
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <span className="min-w-[3.5rem] text-center text-sm font-semibold">{formatNights(stop.planned_nights)}</span>
        <button aria-label="One night more" className={nightButton} disabled={disabled}
          onClick={() => onUpdate({ planned_nights: stop.planned_nights + 1 })} type="button">
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function displayName(user: NonNullable<StopNotes['replaced_change_by']>) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'another member'
}

/** Plain-text notes that save while you type. Links are clickable when not editing. */
function StopNotesEditor({
  disabled,
  onSaved,
  stop,
}: {
  disabled: boolean
  onSaved: (stopId: string, notes: StopNotes) => void
  stop: Stop
}) {
  const { accessToken } = useContext(PlanningSessionContext)
  const headingId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autosaveRef = useRef<NotesAutosave | null>(null)
  const accessTokenRef = useRef(accessToken)
  const onSavedRef = useRef(onSaved)
  const [text, setText] = useState(stop.notes)
  const [editing, setEditing] = useState(false)
  const [state, setState] = useState<NotesAutosaveState>({ status: 'idle', replacedBy: null })
  useEffect(() => {
    accessTokenRef.current = accessToken
    onSavedRef.current = onSaved
  })

  // One autosave per stop (the editor is keyed by stop id). It saves what is
  // left when the card closes, and with keepalive when the tab goes away.
  useEffect(() => {
    const autosave = createNotesAutosave({
      basedOn: stop.notes_updated_at,
      notes: stop.notes,
      onSaved: (result) => onSavedRef.current(stop.id, result),
      onState: setState,
      save: (notes, basedOn, keepalive) => {
        const token = accessTokenRef.current
        if (!token) return Promise.reject(new Error('Sign in to save notes.'))
        return saveStopNotes({ accessToken: token, basedOn, keepalive, notes, stopId: stop.id, tripId: stop.trip_id })
      },
    })
    autosaveRef.current = autosave
    const flushNow = () => autosave.flush(true)
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden') autosave.flush(true) }
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', flushWhenHidden)
      autosave.flush(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once per stop
  }, [])

  // Take in notes from a reload, unless they're being edited right now.
  useEffect(() => {
    if (autosaveRef.current?.sync(stop.notes, stop.notes_updated_at)) setText(stop.notes)
  }, [stop.notes, stop.notes_updated_at])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.max(84, textarea.scrollHeight)}px`
  }, [text, editing])

  function change(value: string) {
    setText(value)
    autosaveRef.current?.change(value)
  }

  const showTextarea = editing || !text
  const status = state.status === 'saving'
    ? 'Saving…'
    : state.status === 'saved'
      ? 'Saved'
      : null

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-foreground" id={headingId}>Notes</h3>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {state.status === 'failed' ? (
            <span className="text-destructive">
              Not saved,{' '}
              <button className="font-semibold underline underline-offset-2" onClick={() => autosaveRef.current?.retry()} type="button">
                Retry
              </button>
            </span>
          ) : status}
        </span>
      </div>
      {showTextarea ? (
        <textarea
          aria-labelledby={headingId}
          autoFocus={editing}
          className="block min-h-[84px] w-full resize-none overflow-hidden rounded-2xl border border-input bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={20_000}
          onBlur={() => { setEditing(false); autosaveRef.current?.flush() }}
          onChange={(event) => change(event.target.value)}
          onFocus={(event) => {
            setEditing(true)
            const end = event.currentTarget.value.length
            event.currentTarget.setSelectionRange(end, end)
          }}
          placeholder="Add your notes"
          readOnly={disabled}
          ref={textareaRef}
          value={text}
        />
      ) : (
        <div
          aria-label="Notes, press Enter to edit"
          className="min-h-[84px] cursor-text whitespace-pre-wrap break-words rounded-2xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="stop-notes-view"
          onClick={(event) => {
            if (!disabled && !(event.target as HTMLElement).closest('a')) setEditing(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target === event.currentTarget && !disabled) {
              event.preventDefault()
              setEditing(true)
            }
          }}
          role="group"
          tabIndex={0}
        >
          {splitNoteLinks(text).map((part, index) => part.type === 'link' ? (
            <a className="font-medium text-primary underline underline-offset-2" href={part.value} key={index} rel="noopener noreferrer" target="_blank">
              {part.value}
            </a>
          ) : <span key={index}>{part.value}</span>)}
        </div>
      )}
      {state.replacedBy ? (
        <p className="text-xs text-muted-foreground" role="status">
          This replaced a change by {displayName(state.replacedBy)}.
        </p>
      ) : null}
    </section>
  )
}
