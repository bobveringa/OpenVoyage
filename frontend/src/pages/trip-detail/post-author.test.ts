import { describe, expect, it } from 'vitest'
import { DELETED_USER_NAME, toPostAuthorViewModel } from './post-author'

describe('toPostAuthorViewModel', () => {
  it('shows a deleted user when the author account is gone', () => {
    expect(toPostAuthorViewModel(null)).toEqual({
      displayName: DELETED_USER_NAME,
      id: null,
      initials: '?',
      profilePicture: null,
    })
  })

  it('uses the author name and initials', () => {
    expect(toPostAuthorViewModel({
      first_name: 'Maya',
      id: 'maya',
      last_name: 'Chen',
      profile_picture: null,
      username: 'maya-travels',
    })).toEqual({
      displayName: 'Maya Chen',
      id: 'maya',
      initials: 'MC',
      profilePicture: null,
    })
  })

  it('falls back to the username', () => {
    expect(toPostAuthorViewModel({
      first_name: null,
      id: 'maya',
      last_name: null,
      profile_picture: null,
      username: 'maya',
    })).toMatchObject({ displayName: 'maya', initials: 'MA' })
  })
})
