import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  formatDateTime,
  type ClockFormatPreference,
  useClockFormat,
  uses12HourClock,
} from '@/lib/date-time'
import { cn } from '@/lib/utils'

type DatePickerProps = {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  displayValue?: string
  id?: string
  max?: string
  min?: string
  onValueChange: (value: string) => void
  placeholder?: string
  popoverAlign?: 'start' | 'end'
  triggerClassName?: string
  value: string
}

type DateTimePickerProps = DatePickerProps

type PickerMode = 'date' | 'datetime'

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
})
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
export function DatePicker(props: DatePickerProps) {
  return <DateTimePickerBase mode="date" {...props} />
}

export function DateTimePicker(props: DateTimePickerProps) {
  return <DateTimePickerBase mode="datetime" {...props} />
}

function DateTimePickerBase({
  ariaLabel,
  className,
  disabled = false,
  displayValue,
  id,
  max,
  min,
  mode,
  onValueChange,
  placeholder,
  popoverAlign = 'start',
  triggerClassName,
  value,
}: DatePickerProps & { mode: PickerMode }) {
  const { preference } = useClockFormat()
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedDate = parseDateValue(value)
  const selectedDateIso = selectedDate ? formatDateValue(selectedDate) : null
  const minDate = parseDateValue(min ?? '')
  const maxDate = parseDateValue(max ?? '')
  const selectedTime = parseTimeValue(value) ?? '09:00'
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selectedDate ?? minDate ?? new Date()),
  )
  const formattedDisplayValue =
    displayValue ?? formatDisplayValue(value, mode, placeholder, preference)

  const calendarDays = useMemo(
    () => getCalendarDays(visibleMonth),
    [visibleMonth],
  )

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
    }
  }

  function openPicker() {
    if (disabled) {
      return
    }

    setVisibleMonth(startOfMonth(selectedDate ?? minDate ?? new Date()))
    setOpen((current) => !current)
  }

  function selectDate(date: Date) {
    if (isDateOutsideRange(date, minDate, maxDate)) {
      return
    }

    const nextDateValue = formatDateValue(date)

    if (mode === 'datetime') {
      onValueChange(`${nextDateValue}T${selectedTime}`)
      return
    }

    onValueChange(nextDateValue)
    setOpen(false)
  }

  function selectTime(time: string) {
    const nextDateValue = selectedDateIso ?? formatDateValue(new Date())
    onValueChange(`${nextDateValue}T${time}`)
  }

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-2 text-left text-base text-foreground shadow-sm transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          triggerClassName,
        )}
        disabled={disabled}
        id={id}
        onClick={openPicker}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <span
          className={cn(
            'min-w-0 truncate',
            selectedDate ? '' : 'text-muted-foreground',
          )}
        >
          {formattedDisplayValue}
        </span>
        {mode === 'datetime' ? (
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div
          className={cn(
            'absolute z-40 mt-2 w-[17rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[1.35rem] border border-border bg-card p-2.5 shadow-xl shadow-foreground/10',
            popoverAlign === 'end' ? 'right-0' : 'left-0',
          )}
          role="dialog"
        >
          <div className="flex items-center justify-between gap-3">
            <Button
              aria-label="Previous month"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
              size="icon"
              title="Previous month"
              type="button"
              variant="ghost"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <p className="text-sm font-semibold text-foreground">
              {monthFormatter.format(visibleMonth)}
            </p>
            <Button
              aria-label="Next month"
              onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
              size="icon"
              title="Next month"
              type="button"
              variant="ghost"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[0.68rem] font-semibold uppercase text-muted-foreground">
            {weekDays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarDays.map((date) => {
              const dateValue = formatDateValue(date)
              const selected = selectedDateIso === dateValue
              const outsideMonth = date.getMonth() !== visibleMonth.getMonth()
              const outsideRange = isDateOutsideRange(date, minDate, maxDate)

              return (
                <button
                  className={cn(
                    'grid h-8 place-items-center rounded-lg text-xs font-medium transition-colors hover:bg-muted',
                    outsideMonth && 'text-muted-foreground/50',
                    outsideRange &&
                      'cursor-not-allowed text-muted-foreground/30 hover:bg-transparent',
                    selected && 'bg-primary text-primary-foreground hover:bg-primary',
                  )}
                  disabled={outsideRange}
                  key={dateValue}
                  onClick={() => selectDate(date)}
                  type="button"
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>

          {mode === 'datetime' ? (
            <TimeControls
              is12HourClock={uses12HourClock(preference)}
              onValueChange={selectTime}
              preference={preference}
              value={selectedTime}
            />
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3 rounded-[1.1rem] bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              {formattedDisplayValue}
            </span>
            {selectedDate ? (
              <Check className="size-4 text-primary" aria-hidden="true" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TimeControls({
  is12HourClock,
  onValueChange,
  preference,
  value,
}: {
  is12HourClock: boolean
  onValueChange: (value: string) => void
  preference: ClockFormatPreference
  value: string
}) {
  const [hour, minute] = value.split(':').map(Number)
  const isPm = hour >= 12
  const displayedHour = is12HourClock ? hour % 12 || 12 : hour

  function updateTime(nextHour: number, nextMinute: number) {
    const normalizedHour = is12HourClock
      ? clamp(nextHour, 1, 12) % 12 + (isPm ? 12 : 0)
      : clamp(nextHour, 0, 23)
    onValueChange(`${padTime(normalizedHour)}:${padTime(clamp(nextMinute, 0, 59))}`)
  }

  function setMeridiem(nextIsPm: boolean) {
    onValueChange(`${padTime(hour % 12 + (nextIsPm ? 12 : 0))}:${padTime(minute)}`)
  }

  return (
    <div className="mt-2.5 space-y-2.5 rounded-[1.1rem] border border-border bg-muted/60 p-2.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Clock className="size-4 text-primary" aria-hidden="true" />
        Time
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Hour
          <input
            className="h-9 rounded-xl border border-border bg-card px-2 text-center text-sm font-semibold text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            max={is12HourClock ? 12 : 23}
            min={is12HourClock ? 1 : 0}
            onChange={(event) => updateTime(Number(event.target.value), minute)}
            type="number"
            value={padTime(displayedHour)}
          />
        </label>
        <span className="pb-2 text-lg font-semibold text-muted-foreground">:</span>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Minute
          <input
            className="h-9 rounded-xl border border-border bg-card px-2 text-center text-sm font-semibold text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            max={59}
            min={0}
            onChange={(event) => updateTime(hour, Number(event.target.value))}
            type="number"
            value={padTime(minute)}
          />
        </label>
      </div>
      {is12HourClock ? (
        <div aria-label="AM or PM" className="grid grid-cols-2 gap-2" role="group">
          {(['AM', 'PM'] as const).map((meridiem) => {
            const selected = (meridiem === 'PM') === isPm
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  'rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                )}
                key={meridiem}
                onClick={() => setMeridiem(meridiem === 'PM')}
                type="button"
              >
                {meridiem}
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {['08:00', '12:00', '18:00', '20:00'].map((time) => (
          <button
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
              value === time
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted',
            )}
            key={time}
            onClick={() => onValueChange(time)}
            type="button"
          >
            {formatTimeValue(time, preference)}
          </button>
        ))}
      </div>
    </div>
  )
}

function getCalendarDays(visibleMonth: Date) {
  const firstDay = startOfMonth(visibleMonth)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const firstCalendarDate = addDays(firstDay, -mondayOffset)

  return Array.from({ length: 42 }, (_, index) =>
    addDays(firstCalendarDate, index),
  )
}

function formatDisplayValue(
  value: string,
  mode: PickerMode,
  placeholder = mode === 'datetime' ? 'Select date and time' : 'Select date',
  preference: ClockFormatPreference,
) {
  const date = parseDateValue(value)
  if (!date) {
    return placeholder
  }

  if (mode === 'datetime') {
    const time = parseTimeValue(value) ?? '00:00'
    const [hour, minute] = time.split(':').map(Number)
    return formatDateTime(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute),
      {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        year: 'numeric',
      },
      preference,
    )
  }

  return dateFormatter.format(date)
}

function formatTimeValue(value: string, preference: ClockFormatPreference) {
  const [hour, minute] = value.split(':').map(Number)
  return formatDateTime(
    new Date(2000, 0, 1, hour, minute),
    { hour: 'numeric', minute: '2-digit' },
    preference,
  )
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }

  return date
}

function parseTimeValue(value: string) {
  const match = /T(\d{2}):(\d{2})/.exec(value)
  if (!match) {
    return null
  }

  const hour = clamp(Number(match[1]), 0, 23)
  const minute = clamp(Number(match[2]), 0, 59)
  return `${padTime(hour)}:${padTime(minute)}`
}

function formatDateValue(date: Date) {
  return [
    date.getFullYear(),
    padTime(date.getMonth() + 1),
    padTime(date.getDate()),
  ].join('-')
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function isDateOutsideRange(date: Date, minDate: Date | null, maxDate: Date | null) {
  return (
    (minDate ? compareDateOnly(date, minDate) < 0 : false) ||
    (maxDate ? compareDateOnly(date, maxDate) > 0 : false)
  )
}

function compareDateOnly(left: Date, right: Date) {
  const leftValue = new Date(
    left.getFullYear(),
    left.getMonth(),
    left.getDate(),
  ).getTime()
  const rightValue = new Date(
    right.getFullYear(),
    right.getMonth(),
    right.getDate(),
  ).getTime()

  return leftValue - rightValue
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

function padTime(value: number) {
  return String(value).padStart(2, '0')
}
