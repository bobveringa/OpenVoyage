import { describe, expect, it } from 'vitest'

import { STAY_TYPES, stayTypeIconHtml } from './stay-types'

describe('stayTypeIconHtml', () => {
  it('gives every stay type its own icon for the map pins', () => {
    const markups = STAY_TYPES.map((type) => stayTypeIconHtml(type.value))
    for (const markup of markups) {
      expect(markup).toMatch(/^<svg [^>]*viewBox="0 0 24 24"[^>]*>(<(path|circle|rect|line|polyline) [^>]+\/>)+<\/svg>$/)
      expect(markup).not.toContain('key=')
    }
    expect(new Set(markups).size).toBe(STAY_TYPES.length)
  })
})
