import { describe, expect, it } from 'vitest'

import { parseDateTime } from './date-utils'

describe('parseDateTime', () => {
  it('preserves a UTC API timestamp as an instant', () => {
    expect(parseDateTime('2026-08-22T18:55:00Z')?.toISOString()).toBe(
      '2026-08-22T18:55:00.000Z',
    )
  })

  it('keeps an offset-bearing API timestamp as the same instant', () => {
    expect(parseDateTime('2026-08-22T20:55:00+02:00')?.toISOString()).toBe(
      '2026-08-22T18:55:00.000Z',
    )
  })
})
