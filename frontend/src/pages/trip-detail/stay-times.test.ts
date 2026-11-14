import { describe, expect, it } from 'vitest'

import { CHECK_IN_PRESETS, CHECK_OUT_PRESETS, stayTimeOptions } from './stay-times'

describe('stayTimeOptions', () => {
  it('puts "not set" and the usual times first, then every half hour', () => {
    const options = stayTimeOptions(CHECK_IN_PRESETS, '')
    expect(options.slice(0, 3)).toEqual([
      { value: '', preset: false },
      { value: '15:00', preset: true },
      { value: '16:00', preset: true },
    ])
    expect(options.slice(3, 6).map((option) => option.value)).toEqual(['00:00', '00:30', '01:00'])
    // 48 half hours, minus the two presets already listed, plus "not set" and the presets.
    expect(options).toHaveLength(49)
  })

  it('keeps a saved time that is not on the half hour', () => {
    const values = stayTimeOptions(CHECK_OUT_PRESETS, '10:45').map((option) => option.value)
    expect(values.slice(0, 3)).toEqual(['', '10:00', '11:00'])
    expect(values).toContain('10:45')
    expect(values.indexOf('10:45')).toBe(values.indexOf('10:30') + 1)
  })
})
