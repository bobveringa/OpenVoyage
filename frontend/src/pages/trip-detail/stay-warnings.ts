import type { ItineraryStop } from '@/api/client'
import { addDays, formatDateInputValue, parseDateOnly } from './date-utils'

export type Stay = ItineraryStop['stays'][number]
type StopForStays = Pick<ItineraryStop, 'id' | 'title' | 'planned_start_date' | 'planned_nights'> & { stays: readonly Stay[] }

export type StayWarning = {
  kind: 'NO_LONGER_FITS' | 'OUTSIDE_STOP' | 'DOUBLE_BOOKED'
  message: string
}

export type StopWarning = {
  kind: 'NOT_BOOKED' | 'NO_LONGER_FITS' | 'DOUBLE_BOOKED' | 'OVERLAP' | 'ENDS_AFTER_TRIP'
  message: string
  /** For ENDS_AFTER_TRIP: the trip end that would fit the stop. */
  moveTripEndTo?: string
}

export type StopStayStatus = {
  nights: number
  coveredNights: number
  /** Day stops show the stays section only while they still have stays. */
  showStays: boolean
  stayWarnings: Record<string, StayWarning[]>
  stopWarnings: StopWarning[]
}

type DateFormatter = (value: string) => string

const defaultFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

export function formatShortDate(value: string) {
  const date = parseDateOnly(value)
  return date ? defaultFormatter.format(date) : value
}

export function shiftDate(value: string, days: number) {
  const date = parseDateOnly(value)
  return date ? formatDateInputValue(addDays(date, days)) : value
}

export function leaveDateOf(stop: Pick<ItineraryStop, 'planned_start_date' | 'planned_nights'>) {
  return shiftDate(stop.planned_start_date, stop.planned_nights)
}

export function stopNights(stop: Pick<ItineraryStop, 'planned_start_date' | 'planned_nights'>) {
  return Array.from({ length: stop.planned_nights }, (_, index) => shiftDate(stop.planned_start_date, index))
}

/** Booked stays and stays that need no booking cover their nights. */
export function coversNights(stay: Stay) {
  return stay.status !== 'IDEA'
}

export function stayCoversNight(stay: Stay, night: string) {
  return stay.check_in_date <= night && night < stay.check_out_date
}

export function stayNightCount(stay: Pick<Stay, 'check_in_date' | 'check_out_date'>) {
  const start = parseDateOnly(stay.check_in_date)
  const end = parseDateOnly(stay.check_out_date)
  if (!start || !end) return 0
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Everything the planning list and stop card warn about, worked out from the
 * dates alone: nights booked, double bookings, stays that no longer fit their
 * stop, overlapping stops and a last stop that ends after the trip.
 */
export function getStopStayStatus(
  stops: readonly StopForStays[],
  index: number,
  tripEndDate: string | null,
  formatDate: DateFormatter = formatShortDate,
): StopStayStatus {
  const stop = stops[index]!
  const start = stop.planned_start_date
  const leave = leaveDateOf(stop)
  const nights = stopNights(stop)
  const stayWarnings: Record<string, StayWarning[]> = {}
  const stopWarnings: StopWarning[] = []
  const warn = (stay: Stay, warning: StayWarning) => {
    stayWarnings[stay.id] = [...(stayWarnings[stay.id] ?? []), warning]
  }

  const coveredNights = nights.filter((night) =>
    stop.stays.some((stay) => coversNights(stay) && stayCoversNight(stay, night))).length
  if (nights.length > coveredNights) {
    stopWarnings.push({ kind: 'NOT_BOOKED', message: `${plural(nights.length - coveredNights, 'night')} not booked` })
  }

  for (const night of nights) {
    const booked = stop.stays.filter((stay) => stay.status === 'BOOKED' && stayCoversNight(stay, night))
    if (booked.length > 1) {
      const message = `${booked.length} booked stays on ${formatDate(night)}`
      stopWarnings.push({ kind: 'DOUBLE_BOOKED', message })
      for (const stay of booked) warn(stay, { kind: 'DOUBLE_BOOKED', message })
    }
  }

  for (const stay of stop.stays) {
    if (stay.check_in_date >= start && stay.check_out_date <= leave) continue
    if (stay.status === 'IDEA') {
      warn(stay, { kind: 'OUTSIDE_STOP', message: "Outside the stop's dates" })
      continue
    }
    const verb = stay.status === 'BOOKED' ? 'is booked for' : 'is planned for'
    const message = `${stay.name} ${verb} ${formatDate(stay.check_in_date)} to ${formatDate(stay.check_out_date)}, `
      + `but ${stop.title} is now ${formatDate(start)} to ${formatDate(leave)}.`
    warn(stay, { kind: 'NO_LONGER_FITS', message })
    stopWarnings.push({ kind: 'NO_LONGER_FITS', message })
  }

  const previous = index > 0 ? stops[index - 1] : null
  if (previous && start < leaveDateOf(previous)) {
    stopWarnings.push({ kind: 'OVERLAP', message: `Arrives before ${previous.title} ends` })
  }

  if (tripEndDate && index === stops.length - 1 && leave > tripEndDate) {
    stopWarnings.push({
      kind: 'ENDS_AFTER_TRIP',
      message: `Ends after the trip (${formatDate(tripEndDate)})`,
      moveTripEndTo: leave,
    })
  }

  return {
    nights: nights.length,
    coveredNights,
    showStays: nights.length > 0 || stop.stays.length > 0,
    stayWarnings,
    stopWarnings,
  }
}

/** Default dates for a new stay: the first run of open nights, else the whole stop. */
export function suggestStayDates(stop: StopForStays) {
  const nights = stopNights(stop)
  const open = nights.filter((night) => !stop.stays.some((stay) => coversNights(stay) && stayCoversNight(stay, night)))
  if (open.length === 0) return { check_in_date: stop.planned_start_date, check_out_date: leaveDateOf(stop) }
  const first = nights.indexOf(open[0]!)
  let last = first
  while (last + 1 < nights.length && open.includes(nights[last + 1]!)) last += 1
  return { check_in_date: nights[first]!, check_out_date: shiftDate(nights[last]!, 1) }
}
