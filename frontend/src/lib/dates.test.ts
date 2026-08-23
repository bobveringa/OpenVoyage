import { describe, expect, it } from 'vitest'

import { isTripOngoing } from '@/lib/dates'

describe('isTripOngoing', () => {
  const today = new Date(2026, 7, 22)

  it('returns true for an open-ended trip that has started', () => {
    expect(
      isTripOngoing(
        { end_date: null, start_date: '2026-08-20' },
        today,
      ),
    ).toBe(true)
  })

  it('returns false after a trip has ended', () => {
    expect(
      isTripOngoing(
        { end_date: '2026-08-21', start_date: '2026-08-10' },
        today,
      ),
    ).toBe(false)
  })

  it('returns false before a trip starts', () => {
    expect(
      isTripOngoing(
        { end_date: '2026-08-30', start_date: '2026-08-23' },
        today,
      ),
    ).toBe(false)
  })
})
