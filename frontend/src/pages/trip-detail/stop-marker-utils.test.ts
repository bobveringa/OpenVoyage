import { describe, expect, it } from 'vitest'

import type { Stop } from './models'
import { markerStaySuggestion } from './stop-marker-utils'

const utrecht = { id: 'utrecht', latitude: 52.09, longitude: 5.12, name: 'Utrecht', full_name: 'Utrecht', region: '', country_code: 'NL', timezone: 'Europe/Amsterdam' }
const stay = (latitude: number, longitude: number) =>
  ({ id: `stay-${latitude}`, name: 'Hotel Dom', location: { ...utrecht, id: `loc-${latitude}`, latitude, longitude } }) as Stop['stays'][number]
const stopWith = (stays: Stop['stays'], location = utrecht) =>
  ({ location, original_location: utrecht, stays }) as Stop

describe('markerStaySuggestion', () => {
  it('suggests the only stay near the place', () => {
    expect(markerStaySuggestion(stopWith([stay(52.1, 5.14)]))).toEqual({ latitude: 52.1, longitude: 5.14 })
  })

  it('stays quiet with several stays, a far stay or a marker already there', () => {
    expect(markerStaySuggestion(stopWith([stay(52.1, 5.14), stay(52.08, 5.1)]))).toBeNull()
    expect(markerStaySuggestion(stopWith([stay(52.37, 4.9)]))).toBeNull()
    expect(markerStaySuggestion(stopWith([stay(52.1, 5.14)], { ...utrecht, id: 'moved', latitude: 52.1, longitude: 5.14 }))).toBeNull()
  })

  it('needs a stay with a location', () => {
    expect(markerStaySuggestion(stopWith([{ ...stay(52.1, 5.14), location: null }]))).toBeNull()
  })
})
