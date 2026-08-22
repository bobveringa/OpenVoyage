import type { Trip } from '@/api/client'

const DAY_IN_MS = 24 * 60 * 60 * 1000

export type TripTimingStatus = 'upcoming' | 'active' | 'completed'

export type TripTiming = {
  daysUntilStart: number | null
  status: TripTimingStatus
}

export function isTripOngoing(
  trip: Pick<Trip, 'start_date' | 'end_date'>,
  today: Date = new Date(),
): boolean {
  const startDate = parseDateOnly(trip.start_date)
  const endDate = trip.end_date ? parseDateOnly(trip.end_date) : null
  const currentDate = startOfLocalDay(today)

  return (
    startDate.getTime() <= currentDate.getTime() &&
    (endDate === null || endDate.getTime() >= currentDate.getTime())
  )
}

export function getTripTiming(
  trip: Pick<Trip, 'start_date' | 'end_date'>,
  today: Date = new Date(),
): TripTiming {
  const startDate = parseDateOnly(trip.start_date)
  const endDate = parseDateOnly(trip.end_date ?? trip.start_date)
  const currentDate = startOfLocalDay(today)

  if (startDate.getTime() > currentDate.getTime()) {
    return {
      daysUntilStart: Math.ceil(
        (startDate.getTime() - currentDate.getTime()) / DAY_IN_MS,
      ),
      status: 'upcoming',
    }
  }

  if (endDate.getTime() < currentDate.getTime()) {
    return {
      daysUntilStart: null,
      status: 'completed',
    }
  }

  return {
    daysUntilStart: null,
    status: 'active',
  }
}

export function formatDateRange(
  startDate: string,
  endDate: string | null,
): string {
  if (!endDate || endDate === startDate) {
    return formatDate(startDate)
  }

  return `${formatDate(startDate)} - ${formatDate(endDate)}`
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parseDateOnly(value))
}
