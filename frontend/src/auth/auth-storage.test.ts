import { beforeEach, expect, it } from 'vitest'

import { setApiBaseUrl, type AuthTokens, type CurrentUser } from '@/api/client'
import {
  readCachedCurrentUser,
  readStoredAuthTokens,
  writeCachedCurrentUser,
  writeStoredAuthTokens,
} from './auth-storage'

const tokens: AuthTokens = {
  access_token: 'access-a', refresh_token: 'refresh-a', id_token: 'id-a', token_type: 'bearer',
}
const user = { id: 'user-a' } as CurrentUser

beforeEach(() => {
  window.localStorage.clear()
  setApiBaseUrl('https://server-a.test')
})

it('restores credentials and the offline profile for the same server', async () => {
  await writeStoredAuthTokens(tokens)
  await writeCachedCurrentUser(user)
  expect(await readStoredAuthTokens()).toEqual(tokens)
  expect(await readCachedCurrentUser()).toEqual(user)
})

it.each(['https://server-b.test', 'http://server-a.test', 'https://server-a.test:8443'])(
  'rejects credentials and the offline profile after switching to %s', async server => {
    await writeStoredAuthTokens(tokens)
    await writeCachedCurrentUser(user)
    setApiBaseUrl(server)
    expect(await readStoredAuthTokens()).toBeNull()
    expect(await readCachedCurrentUser()).toBeNull()
  },
)

it('requires login for legacy credentials whose server is unknown', async () => {
  window.localStorage.setItem('openvoyage.auth', JSON.stringify(tokens))
  window.localStorage.setItem('openvoyage.auth.cached-user', JSON.stringify(user))
  expect(await readStoredAuthTokens()).toBeNull()
  expect(await readCachedCurrentUser()).toBeNull()
})

it.each(['null', '[]', '{}', 'invalid json'])('discards malformed stored state: %s', async value => {
  window.localStorage.setItem('openvoyage.auth', value)
  window.localStorage.setItem('openvoyage.auth.cached-user', value)
  expect(await readStoredAuthTokens()).toBeNull()
  expect(await readCachedCurrentUser()).toBeNull()
})
