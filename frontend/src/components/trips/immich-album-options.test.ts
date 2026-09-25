import { describe, expect, it } from 'vitest'

import type { ImmichAlbumLink } from '@/api/client'

import {
  createImmichAlbumOptions,
  getImmichAlbumOwnerName,
} from './immich-album-options'

function createLink(
  connectedBy: Partial<ImmichAlbumLink['connected_by']>,
): ImmichAlbumLink {
  return {
    can_remove: false,
    connected_by: {
      first_name: null,
      id: '10000000-0000-4000-8000-000000000001',
      last_name: null,
      profile_picture: null,
      username: null,
      ...connectedBy,
    },
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Summer trip',
  }
}

describe('Immich album options', () => {
  it('uses the contributor full name in menu and compact labels', () => {
    const link = createLink({
      first_name: 'Alice',
      last_name: 'Traveler',
      username: 'alice',
    })

    expect(getImmichAlbumOwnerName(link)).toBe('Alice Traveler')
    expect(createImmichAlbumOptions([link])).toEqual([
      {
        description: 'Connected by Alice Traveler',
        label: 'Summer trip',
        selectedDescription: 'Alice Traveler',
        value: link.id,
      },
    ])
  })

  it('falls back to username and then a neutral contributor label', () => {
    expect(getImmichAlbumOwnerName(createLink({ username: 'alice' }))).toBe('alice')
    expect(getImmichAlbumOwnerName(createLink({}))).toBe('Trip contributor')
  })
})
