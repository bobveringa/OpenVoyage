/** Check-in and check-out times: the usual ones first, then every half hour. */

export const CHECK_IN_PRESETS = ['15:00', '16:00'] as const
export const CHECK_OUT_PRESETS = ['10:00', '11:00'] as const

export type StayTimeOption = { value: string; preset: boolean }

/** ``''`` (not set), the presets, every half hour, and a saved odd time like 14:45. */
export function stayTimeOptions(presets: readonly string[], current: string): StayTimeOption[] {
  const halfHours = Array.from({ length: 48 }, (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)
  const rest = [...new Set([...halfHours, ...(current ? [current] : [])])]
    .filter((time) => !presets.includes(time))
    .sort()
  return [
    { value: '', preset: false },
    ...presets.map((value) => ({ value, preset: true })),
    ...rest.map((value) => ({ value, preset: false })),
  ]
}
