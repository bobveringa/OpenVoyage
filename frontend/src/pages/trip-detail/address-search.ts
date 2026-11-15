import { ApiError, type AddressResult } from '@/api/client'

export type AddressSearchMode = 'off' | 'typing' | 'enter'

/** How the stay form searches. Nominatim's rules forbid search-as-you-type,
 * so it searches on Enter, self-hosted too. Photon and GraphHopper search
 * after a short pause in typing. */
export function addressSearchMode(provider: unknown): AddressSearchMode {
  if (provider === 'nominatim') return 'enter'
  if (provider === 'photon' || provider === 'graphhopper') return 'typing'
  return 'off'
}

export const ADDRESS_SEARCH_PAUSE_MS = 400
export const ADDRESS_SEARCH_MIN_LENGTH = 3

/** The message under the box when a search fails. Never an empty list. */
export function addressSearchErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 503) {
    const retryAfter = error.message.toLowerCase().includes('try again')
    return retryAfter ? 'Try again in a moment.' : 'Address search unavailable.'
  }
  return 'Address search unavailable.'
}

/** One line for a result: the address, unless it only repeats the name. */
export function addressResultDetail(result: AddressResult) {
  return result.address && result.address !== result.name ? result.address : null
}
