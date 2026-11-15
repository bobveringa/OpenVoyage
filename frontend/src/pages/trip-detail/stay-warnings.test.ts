import { describe, expect, it } from 'vitest'

import { getStopStayStatus, suggestStayDates, type Stay } from './stay-warnings'

const format = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(value + 'T00:00:00Z'))

function stay(id: string, status: Stay['status'], check_in_date: string, check_out_date: string, name = id): Stay {
  return {
    id, name, status, check_in_date, check_out_date, stop_id: 'b',
    stay_type: status === null ? 'FRIENDS' : 'HOTEL', address: null, location: null,
    check_in_time: null, check_out_time: null, booking_reference: null, booking_url: null,
    contact_phone: null, contact_email: null,
  }
}

const eindhoven = { id: 'a', title: 'Eindhoven', planned_start_date: '2026-10-01', planned_nights: 2, stays: [] }
function barcelona(stays: Stay[], start = '2026-10-03', nights = 4) {
  return { id: 'b', title: 'Barcelona', planned_start_date: start, planned_nights: nights, stays }
}

describe('getStopStayStatus', () => {
  it('counts nights covered by booked stays and stays that need no booking', () => {
    const status = getStopStayStatus([eindhoven, barcelona([
      stay('booked', 'BOOKED', '2026-10-03', '2026-10-05'),
      stay('friends', null, '2026-10-05', '2026-10-06'),
      stay('idea', 'IDEA', '2026-10-06', '2026-10-07'),
    ])], 1, null, format)
    expect(status).toMatchObject({ nights: 4, coveredNights: 3, showStays: true })
    expect(status.stopWarnings).toEqual([{ kind: 'NOT_BOOKED', message: '1 night not booked' }])
    expect(status.stayWarnings).toEqual({})
  })

  it('warns about two booked stays on one night, but not about overlapping ideas', () => {
    const status = getStopStayStatus([barcelona([
      stay('arts', 'BOOKED', '2026-10-03', '2026-10-05'),
      stay('casa', 'BOOKED', '2026-10-04', '2026-10-07'),
      stay('idea1', 'IDEA', '2026-10-03', '2026-10-07'),
      stay('idea2', 'IDEA', '2026-10-03', '2026-10-07'),
    ])], 0, null, format)
    expect(status.stopWarnings).toEqual([{ kind: 'DOUBLE_BOOKED', message: '2 booked stays on 4 Oct' }])
    expect(Object.keys(status.stayWarnings).sort()).toEqual(['arts', 'casa'])
  })

  it('flags booked stays that no longer fit, and ideas outside the stop', () => {
    const status = getStopStayStatus([barcelona([
      stay('arts', 'BOOKED', '2026-10-03', '2026-10-05', 'Hotel Arts'),
      stay('idea', 'IDEA', '2026-10-06', '2026-10-08'),
    ], '2026-10-04', 2)], 0, null, format)
    const fit = 'Hotel Arts is booked for 3 Oct to 5 Oct, but Barcelona is now 4 Oct to 6 Oct.'
    expect(status.stayWarnings).toEqual({
      arts: [{ kind: 'NO_LONGER_FITS', message: fit }],
      idea: [{ kind: 'OUTSIDE_STOP', message: "Outside the stop's dates" }],
    })
    expect(status.stopWarnings).toContainEqual({ kind: 'NO_LONGER_FITS', message: fit })
  })

  it('shows the stays section on a day stop only while it still has stays', () => {
    expect(getStopStayStatus([barcelona([], '2026-10-03', 0)], 0, null).showStays).toBe(false)
    const kept = getStopStayStatus([barcelona([stay('arts', 'BOOKED', '2026-10-03', '2026-10-05')], '2026-10-03', 0)], 0, null)
    expect(kept.showStays).toBe(true)
    expect(kept.stopWarnings.map((warning) => warning.kind)).toEqual(['NO_LONGER_FITS'])
  })

  it('warns when a stop arrives before the previous one ends', () => {
    const status = getStopStayStatus([eindhoven, barcelona([], '2026-10-02', 1)], 1, null)
    expect(status.stopWarnings).toContainEqual({ kind: 'OVERLAP', message: 'Arrives before Eindhoven ends' })
  })

  it('offers to move the trip end when the last stop ends after it', () => {
    const stops = [eindhoven, barcelona([], '2026-10-03', 2)]
    expect(getStopStayStatus(stops, 1, '2026-10-04', format).stopWarnings).toContainEqual({
      kind: 'ENDS_AFTER_TRIP', message: 'Ends after the trip (4 Oct)', moveTripEndTo: '2026-10-05',
    })
    expect(getStopStayStatus(stops, 0, '2026-10-02', format).stopWarnings).toEqual([{ kind: 'NOT_BOOKED', message: '2 nights not booked' }])
    expect(getStopStayStatus(stops, 1, null).stopWarnings.map((warning) => warning.kind)).toEqual(['NOT_BOOKED'])
  })
})

describe('suggestStayDates', () => {
  it('picks the first run of open nights, or the whole stop', () => {
    expect(suggestStayDates(barcelona([stay('arts', 'BOOKED', '2026-10-03', '2026-10-04')])))
      .toEqual({ check_in_date: '2026-10-04', check_out_date: '2026-10-07' })
    expect(suggestStayDates(barcelona([stay('arts', 'BOOKED', '2026-10-03', '2026-10-07')])))
      .toEqual({ check_in_date: '2026-10-03', check_out_date: '2026-10-07' })
  })
})
