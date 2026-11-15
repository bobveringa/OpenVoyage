import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import { addressResultDetail, addressSearchErrorMessage, addressSearchMode } from './address-search'

describe('addressSearchMode', () => {
  it('searches on Enter for Nominatim and after a pause for the others', () => {
    expect(addressSearchMode('nominatim')).toBe('enter')
    expect(addressSearchMode('photon')).toBe('typing')
    expect(addressSearchMode('graphhopper')).toBe('typing')
  })

  it('is off without a provider', () => {
    expect(addressSearchMode('none')).toBe('off')
    expect(addressSearchMode(undefined)).toBe('off')
    expect(addressSearchMode('something-else')).toBe('off')
  })
})

describe('addressSearchErrorMessage', () => {
  it('asks to try again when public Nominatim was asked too soon', () => {
    const error = new ApiError(503, 'Try again in a moment.', { code: 'ADDRESS_SEARCH_UNAVAILABLE' })
    expect(addressSearchErrorMessage(error)).toBe('Try again in a moment.')
  })

  it('says unavailable for provider failures and anything else', () => {
    expect(addressSearchErrorMessage(new ApiError(503, 'Address search unavailable.', {}))).toBe('Address search unavailable.')
    expect(addressSearchErrorMessage(new Error('offline'))).toBe('Address search unavailable.')
  })
})

describe('addressResultDetail', () => {
  it('hides an address that only repeats the name', () => {
    expect(addressResultDetail({ name: 'Hotel Arts', address: 'Carrer de la Marina 19, Barcelona', latitude: 0, longitude: 0 }))
      .toBe('Carrer de la Marina 19, Barcelona')
    expect(addressResultDetail({ name: 'Marina 19', address: 'Marina 19', latitude: 0, longitude: 0 })).toBeNull()
    expect(addressResultDetail({ name: 'Somewhere', address: null, latitude: 0, longitude: 0 })).toBeNull()
  })
})
