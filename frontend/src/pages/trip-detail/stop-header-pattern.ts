import { contrastRatio } from '@/theme/theme-contract'

/** Header size the pattern is drawn for; it scales to fill wider headers. */
export const STOP_HEADER_WIDTH = 400
export const STOP_HEADER_HEIGHT = 216

export type ContourPattern = {
  dot: { x: number; y: number }
  rings: string[]
  faintRings: string[]
}

/** FNV-1a: a small, stable string hash. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32: a seeded random number generator with values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// The dot stays in this area, clear of the × button (top right) and the
// name (bottom left), as fractions of the header size.
export const DOT_AREA = { minX: 0.58, maxX: 0.8, minY: 0.36, maxY: 0.56 } as const

function ringPath(
  centerX: number,
  centerY: number,
  radius: number,
  rotation: number,
  wobble: readonly [number, number, number, number],
) {
  const steps = 72
  const points: string[] = []
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2
    const scale = 1
      + wobble[0] * Math.sin(2 * angle + wobble[1])
      + wobble[2] * Math.sin(3 * angle + wobble[3])
    const x = centerX + Math.cos(angle + rotation) * radius * scale * 1.18
    const y = centerY + Math.sin(angle + rotation) * radius * scale
    points.push(`${step === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return points.join('') + 'Z'
}

/**
 * Contour rings for a place, worked out from its name and country code so the
 * same place always looks the same and two stops rarely look alike.
 */
export function createContourPattern(name: string, countryCode: string): ContourPattern {
  const random = seededRandom(hashSeed(`${name.trim().toLowerCase()}|${countryCode.toUpperCase()}`))
  const width = STOP_HEADER_WIDTH
  const height = STOP_HEADER_HEIGHT
  const dot = {
    x: width * (DOT_AREA.minX + random() * (DOT_AREA.maxX - DOT_AREA.minX)),
    y: height * (DOT_AREA.minY + random() * (DOT_AREA.maxY - DOT_AREA.minY)),
  }
  const rotation = random() * Math.PI
  const gap = 15 + random() * 9
  const firstRadius = 14 + random() * 8
  const wobble = [0.06 + random() * 0.1, random() * 6.28, 0.03 + random() * 0.06, random() * 6.28] as const
  const rings: string[] = []
  for (let ring = 0; ring < 14; ring += 1) {
    // Outer rings drift a little, like real terrain.
    const drift = ring * (random() - 0.5) * 1.6
    rings.push(ringPath(dot.x + drift, dot.y + drift * 0.4, firstRadius + ring * gap, rotation + ring * 0.05, wobble))
  }
  const corner = random() < 0.5
    ? { x: width * (0.05 + random() * 0.12), y: height * (0.85 + random() * 0.1) }
    : { x: width * (0.05 + random() * 0.12), y: height * (0.05 + random() * 0.1) }
  const faintWobble = [0.08 + random() * 0.1, random() * 6.28, 0.04 + random() * 0.05, random() * 6.28] as const
  const faintRings: string[] = []
  for (let ring = 0; ring < 6; ring += 1) {
    faintRings.push(ringPath(corner.x, corner.y, 12 + ring * (gap - 3), rotation * 2, faintWobble))
  }
  return { dot, rings, faintRings }
}

function parseHex(color: string): [number, number, number] | null {
  const value = color.trim().replace(/^#/, '')
  const full = value.length === 3 ? [...value].map((part) => part + part).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16)) as [number, number, number]
}

function toHex(channels: readonly number[]) {
  return '#' + channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')
}

/** Darken a colour until white text on it reaches a contrast of 4.5:1. */
export function darkenForWhiteText(color: string, minimumContrast = 4.5): string {
  const channels = parseHex(color)
  if (!channels) return '#1f3a2c'
  for (let step = 0; step <= 20; step += 1) {
    const candidate = toHex(channels.map((channel) => channel * (1 - step * 0.05)))
    if (contrastRatio('#ffffff', candidate) >= minimumContrast) return candidate
  }
  return '#000000'
}
