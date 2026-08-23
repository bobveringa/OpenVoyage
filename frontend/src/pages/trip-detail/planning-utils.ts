import type * as L from 'leaflet'
import {
  Bike,
  Bus,
  Car,
  Footprints,
  Motorbike,
  Navigation,
  Plane,
  Ship,
  TrainFront,
  type LucideIcon,
} from 'lucide-react'

import type { Place } from '@/api/client'
import {
  addDays,
  formatDateInputValue,
  parseDateOnly,
  toDateOnlyTime,
} from '@/pages/trip-detail/date-utils'
import type { Stop, TravelLeg, TravelMode } from '@/pages/trip-detail/models'
import type {
  DraftPostLocation,
  MapPointTarget,
  StopEditDraft,
  StopInsertionPoint,
  TravelLegEditDraft,
} from '@/pages/trip-detail/page-types'

export function createDraftMapPointLocation(
  coordinates: L.LatLngTuple,
  target: MapPointTarget,
): DraftPostLocation {
  return {
    coordinates,
    label: target === 'stop' ? 'Selected stop location' : 'Selected post location',
  }
}

export const travelModeOptions = [
  { label: 'Unknown', value: 'UNKNOWN' },
  { label: 'Walk', value: 'WALK' },
  { label: 'Bike', value: 'BIKE' },
  { label: 'Motorcycle', value: 'MOTORCYCLE' },
  { label: 'Car', value: 'CAR' },
  { label: 'Bus', value: 'BUS' },
  { label: 'Train', value: 'TRAIN' },
  { label: 'Ferry', value: 'FERRY' },
  { label: 'Flight', value: 'FLIGHT' },
  { label: 'Other', value: 'OTHER' },
] as const satisfies ReadonlyArray<{ label: string; value: TravelMode }>

const dayInMs = 24 * 60 * 60 * 1000

export function formatNights(nights: number) {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`
}

export function formatStopDateLabel(value: string) {
  const date = parseDateOnly(value)
  return date ? formatMonthDayLabel(date) : value
}

export function createFirstStopInsertionPoint(
  tripStartDate: string,
): StopInsertionPoint {
  return {
    afterStopId: null,
    plannedStartDate: tripStartDate || formatDateInputValue(new Date()),
  }
}

export function createStopInsertionPointAfterStop(
  stop: Stop,
): StopInsertionPoint {
  return {
    afterStopId: stop.id,
    plannedStartDate: getStayLeaveDateValue(
      stop.planned_start_date,
      stop.planned_nights,
    ),
  }
}

export function getStayLeaveDateValue(startDateValue: string, nights: number) {
  const startDate = parseDateOnly(startDateValue)
  if (!startDate) return startDateValue
  return formatDateInputValue(addDays(startDate, Math.max(0, nights)))
}

export function getNightsBetweenDates(
  startDateValue: string,
  endDateValue: string,
) {
  const startDate = parseDateOnly(startDateValue)
  const endDate = parseDateOnly(endDateValue)
  if (!startDate || !endDate) return 0
  return Math.max(
    0,
    Math.round((toDateOnlyTime(endDate) - toDateOnlyTime(startDate)) / dayInMs),
  )
}

export function getTravelModeIcon(travelMode: TravelMode): LucideIcon {
  switch (travelMode) {
    case 'BIKE': return Bike
    case 'BUS': return Bus
    case 'CAR': return Car
    case 'FERRY': return Ship
    case 'FLIGHT': return Plane
    case 'MOTORCYCLE': return Motorbike
    case 'TRAIN': return TrainFront
    case 'WALK': return Footprints
    case 'OTHER':
    case 'UNKNOWN': return Navigation
  }
}

export function nullableTextValue(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

export function getPlaceCoordinates(place: Place): L.LatLngTuple {
  return [place.latitude, place.longitude]
}

export function getStopPlaceName(stop: Stop) {
  return stop.location.name || stop.location.full_name
}

export function getPlaceNameLabel(place: Place) {
  return place.name || place.full_name
}

export function getPlaceSearchInput(place: Place) {
  return getPlaceNameLabel(place)
}

export function formatPlaceDetail(place: Place) {
  const regionLabel = [place.region, place.country_code].filter(Boolean).join(', ')
  const coordinates = formatCoordinates(getPlaceCoordinates(place))
  return regionLabel ? `${regionLabel} · ${coordinates}` : coordinates
}

export function getStopTitleSuggestion(locationLabel: string) {
  return locationLabel.replace(/^(At|Near)\s+/i, '')
}

export function createStopEditDraft(stop: Stop | null): StopEditDraft {
  return {
    notes: stop?.notes ?? '',
    plannedNights: stop?.planned_nights ?? 1,
    plannedStartDate: stop?.planned_start_date ?? formatDateInputValue(new Date()),
    title: stop?.title ?? '',
  }
}

export function createTravelLegEditDraft(
  leg: TravelLeg | null,
): TravelLegEditDraft {
  return {
    notes: leg?.notes ?? '',
    operator: leg?.operator ?? null,
    reference: leg?.reference ?? null,
    travelMode: leg?.travel_mode ?? 'UNKNOWN',
  }
}

export function formatDistance(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${Math.round(distanceMeters / 1000).toLocaleString()} km`
  }
  return `${distanceMeters.toLocaleString()} m`
}

export function formatDuration(durationSeconds: number) {
  const totalMinutes = Math.max(0, Math.floor(durationSeconds / 60))
  const roundedMinutes = Math.floor(totalMinutes / 5) * 5
  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60
  if (hours === 0) return `${minutes} min +`
  if (minutes === 0) return `${hours} hr +`
  return `${hours} hr ${minutes} min +`
}

export function formatCoordinates([lat, lng]: L.LatLngTuple) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
}

function formatMonthDayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

