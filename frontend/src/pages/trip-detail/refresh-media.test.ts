import { describe, expect, it } from 'vitest'
import type { TravelPost } from './models'
import { retainMediaUrl, retainTravelMedia } from './refresh-media'

const now = Date.parse('2026-10-31T12:00:00Z')
function url(id: string, expiry = now / 1000 + 3600, nonce = 'first', extra = '') {
  const payload = btoa(JSON.stringify({ exp: expiry, jti: nonce }))
  return `https://example.test/media/${id}?media_token=header.${payload}.signature&thumbnail=true${extra}`
}
function post(nonce: string): TravelPost {
  return {
    id: 'post', title: 'Before', excerpt: 'Story', location: 'Lisbon', coordinates: [38.72, -9.14],
    bubbleMediaId: 'photo', isDraft: false, revision: 1, routeAfter: null,
    occurredAt: '2026-10-31T10:00:00Z', publishedAt: '2026-10-31T10:00:00Z', time: '10:00',
    social: { canInteract: true, canLike: true, commentCount: 0, likeCount: 0, viewerHasLiked: false },
    author: {
      id: 'author', displayName: 'Author', initials: 'A',
      profilePicture: {
        id: 'avatar', media_type: 'IMAGE', status: 'READY', technical_info: null,
        metadata: { caption: '', created_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:00:00Z' },
        urls: { content: url('avatar', undefined, nonce), thumbnail: null },
      },
    },
    media: [{ media_id: 'photo', src: url('photo', undefined, nonce), thumbnail: url('thumb', undefined, nonce), alt: 'Before' }],
  }
}

describe('refreshing signed media', () => {
  it('retains valid URLs while applying updated text, metadata, social and routes', () => {
    const before = post('first')
    const incoming = { ...post('second'), title: 'Edited', media: [{ ...post('second').media[0], alt: 'New caption' }], social: { ...before.social, likeCount: 5 }, routeAfter: { durationSeconds: 30, segments: [] } }
    const [result] = retainTravelMedia([before], [incoming], now)
    expect(result.title).toBe('Edited')
    expect(result.media[0].alt).toBe('New caption')
    expect(result.media[0].src).toBe(before.media[0].src)
    expect(result.media[0].thumbnail).toBe(before.media[0].thumbnail)
    expect(result.author.profilePicture?.urls.content).toBe(before.author.profilePicture?.urls.content)
    expect(result.social.likeCount).toBe(5)
    expect(result.routeAfter).toBe(incoming.routeAfter)
  })

  it.each([now / 1000 - 1, now / 1000 + 120])('renews expired or nearly expired URLs (%s)', expiry => {
    const incoming = url('photo', undefined, 'new')
    expect(retainMediaUrl(url('photo', expiry), incoming, now)).toBe(incoming)
  })

  it('accepts replacements, version changes, URL removals and malformed tokens', () => {
    const incoming = url('photo', undefined, 'new')
    expect(retainMediaUrl(url('other'), incoming, now)).toBe(incoming)
    expect(retainMediaUrl(url('photo', undefined, 'old', '&version=2'), incoming, now)).toBe(incoming)
    expect(retainMediaUrl(url('photo'), null, now)).toBeNull()
    expect(retainMediaUrl('https://example.test/media/photo?media_token=bad&thumbnail=true', incoming, now)).toBe(incoming)
    expect(retainMediaUrl(url('photo'), '/public/photo.jpg', now)).toBe('/public/photo.jpg')
  })

  it('does not resurrect removed posts, attachments or author pictures', () => {
    const before = post('first')
    expect(retainTravelMedia([before], [], now)).toEqual([])
    const incoming = { ...post('second'), media: [], author: { ...before.author, profilePicture: null } }
    const [result] = retainTravelMedia([before], [incoming], now)
    expect(result.media).toEqual([])
    expect(result.author.profilePicture).toBeNull()
  })

  it('uses fresh URLs without a previous response in the current access scope', () => {
    const incoming = post('second')
    expect(retainTravelMedia([], [incoming], now)[0]).toBe(incoming)
  })
})
