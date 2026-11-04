import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { formatPostTime } from '@/lib/date-time'
import { PostTime } from '@/pages/trip-detail/post-time'

// 14:05 in Tokyo; 06:05 in Amsterdam, on the same date.
const POST = '2026-03-14T05:05:00Z'

function render(variant: 'compact' | 'detail' | 'preview', viewerTimeZone: string, zone: string | null = 'Asia/Tokyo') {
  const labels = formatPostTime(POST, zone, { preference: '24-hour', viewerTimeZone })
  const html = renderToStaticMarkup(createElement(PostTime, { labels, locationName: 'Kyoto', variant }))
  return { html, text: html.replace(/<[^>]+>/g, ''), zone: labels.local?.zone ?? '' }
}

describe('PostTime', () => {
  it('gives "your time" its own clock item on cards when offsets differ', () => {
    const { html, zone } = render('compact', 'Europe/Amsterdam')

    const times = [...html.matchAll(/<time[^>]*>([^<]*)<\/time>/g)].map((match) => match[1])
    expect(times).toHaveLength(2)
    expect(times[0].endsWith(`2026, 14:05 ${zone}`)).toBe(true)
    expect(times[1]).toBe('06:05 your time')
    expect(html.match(/<svg/g)).toHaveLength(2)
    expect(html).toContain('dateTime="2026-03-14T05:05:00.000Z"')
    expect(html).not.toContain('local')
  })

  it('shows one clock item on cards for the same offset', () => {
    const { html, text, zone } = render('compact', 'Asia/Tokyo')

    expect(html.match(/<svg/g)).toHaveLength(1)
    expect(text.endsWith(`2026, 14:05 ${zone}`)).toBe(true)
  })

  it('names the place in the detail view and omits "your time" for the same offset', () => {
    const { text, zone } = render('detail', 'Asia/Tokyo')

    expect(text).toContain(`14:05 ${zone} · local time in Kyoto`)
    expect(text).not.toContain('your time')
  })

  it('keeps the mobile preview to one line without a date', () => {
    const { text, zone } = render('preview', 'Europe/Amsterdam')

    expect(text).toBe(`14:05 ${zone}`)
  })

  it('labels the viewer time when the post has no usable zone', () => {
    expect(render('preview', 'Europe/Amsterdam', null).text).toBe('06:05 your time')
    expect(render('compact', 'Europe/Amsterdam', null).text).toMatch(/2026, 06:05 your time$/)
  })
})
