import { listTrackSamples, type TrackSample } from '@/api/client'

export const SESSION_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--accent)',
]
export const coordinates = (p: TrackSample): [number, number] => [
  p.latitude,
  p.longitude,
]

export async function loadSessionPoints(options: {
  accessToken: string
  tripId: string
  sessionId: string
}) {
  const collected: TrackSample[] = []
  let cursor: string | null = null
  do {
    const page = await listTrackSamples({ ...options, cursor, limit: 5000 })
    collected.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return collected
}
