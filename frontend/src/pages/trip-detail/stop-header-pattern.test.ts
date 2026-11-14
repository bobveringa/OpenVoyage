import { describe, expect, it } from 'vitest'

import { contrastRatio } from '@/theme/theme-contract'
import {
  createContourPattern,
  darkenForWhiteText,
  DOT_AREA,
  STOP_HEADER_HEIGHT,
  STOP_HEADER_WIDTH,
} from './stop-header-pattern'

describe('createContourPattern', () => {
  it('is the same for the same place and differs between places', () => {
    expect(createContourPattern('Barcelona', 'ES')).toEqual(createContourPattern(' barcelona', 'es'))
    expect(createContourPattern('Barcelona', 'ES')).not.toEqual(createContourPattern('Barcelona', 'VE'))
    expect(createContourPattern('Liempde', 'NL').dot).not.toEqual(createContourPattern('Boxtel', 'NL').dot)
  })

  it('keeps the dot clear of the close button and the name', () => {
    for (const name of ['Barcelona', 'Liempde', 'Eindhoven', 'Kyoto', 'Ushuaia', 'A', '']) {
      const { dot, rings, faintRings } = createContourPattern(name, 'NL')
      expect(dot.x).toBeGreaterThanOrEqual(STOP_HEADER_WIDTH * DOT_AREA.minX)
      expect(dot.x).toBeLessThanOrEqual(STOP_HEADER_WIDTH * DOT_AREA.maxX)
      expect(dot.y).toBeGreaterThanOrEqual(STOP_HEADER_HEIGHT * DOT_AREA.minY)
      expect(dot.y).toBeLessThanOrEqual(STOP_HEADER_HEIGHT * DOT_AREA.maxY)
      expect(rings.length).toBeGreaterThan(8)
      expect(faintRings.length).toBeGreaterThan(2)
    }
  })
})

describe('darkenForWhiteText', () => {
  it('darkens light theme colours until white text reads clearly', () => {
    for (const color of ['#d99a2b', '#ffffff', '#8fd3a9', '#3ea1ff', '#fc0']) {
      const background = darkenForWhiteText(color)
      expect(contrastRatio('#ffffff', background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('leaves colours that are dark enough alone', () => {
    expect(darkenForWhiteText('#246b49')).toBe('#246b49')
  })
})
