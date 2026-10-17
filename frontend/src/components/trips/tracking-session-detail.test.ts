import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import type { TrackSample, TrackingSession } from '@/api/client'
import { ClockFormatContext, type ClockFormatPreference } from '@/lib/date-time'
import { TrackingSessionDetail } from './tracking-session-detail'

vi.mock('./tracking-session-map', () => ({ TrackingSessionMap: () => null }))

it('updates recording timestamps and accessible range labels with the clock preference', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // Local afternoon times exercise AM/PM regardless of the machine timezone.
  const start = new Date(2026, 9, 10, 15, 4, 5)
  const end = new Date(2026, 9, 10, 16, 6, 7)
  const session = { id: 'session', started_at: start.toISOString() } as TrackingSession
  const other = { id: 'other', started_at: end.toISOString() } as TrackingSession
  const initial = [start, end].map((date, index) => ({
    id: `point-${index}`, recorded_at: date.toISOString(),
    latitude: 52, longitude: 5, travel_mode: 'WALK',
  })) as TrackSample[]
  const render = async (preference: ClockFormatPreference) => {
    await act(async () => root.render(createElement(ClockFormatContext.Provider, {
      value: { preference, setPreference: vi.fn() },
    }, createElement(TrackingSessionDetail, {
      accessToken: 'token', tripId: 'trip', session, initial, sessions: [session, other],
      onBack: vi.fn(), onSaved: vi.fn(),
    }))))
  }
  const formatted = (date: Date, hour12: boolean, includeDate = false) =>
    new Intl.DateTimeFormat(undefined, {
      ...(includeDate ? { dateStyle: 'short' as const } : {}),
      timeStyle: 'medium', hour12,
    }).format(date)

  try {
    for (const preference of ['24-hour', '12-hour', '24-hour'] as const) {
      await render(preference)
      const hour12 = preference === '12-hour'
      expect(document.querySelector('header p')?.textContent).toBe(formatted(start, hour12, true))
      expect(document.querySelector('aside input[type="checkbox"]')?.closest('label')?.textContent)
        .toContain(formatted(end, hour12, true))
      for (const [index, date] of [start, end].entries()) {
        expect(document.querySelectorAll('[role="group"] span')[index]?.textContent)
          .toBe(formatted(date, hour12, true))
        expect(document.querySelectorAll('input[type="range"]')[index]?.getAttribute('aria-valuetext'))
          .toBe(formatted(date, hour12, true))
        expect(document.querySelectorAll('details li button')[index]?.textContent)
          .toContain(formatted(date, hour12))
      }
      const transport = [...document.querySelectorAll('section')].find(section =>
        section.querySelector('h3')?.textContent === 'Transport type')
      expect(transport?.textContent).toContain(formatted(start, hour12))
    }
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})

