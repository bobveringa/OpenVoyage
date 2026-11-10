import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canShareLink, shareLink } from './share'

const native = vi.hoisted(() => ({ isNative: false, share: vi.fn() }))
vi.mock('./platform', () => ({ isNativePlatform: () => native.isNative }))
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }))

const content = {
  text: 'Follow Lisbon on OpenVoyage',
  title: 'Lisbon',
  url: 'https://voyage.example/trips/trip?share=token',
}

function stubNavigator(overrides: Partial<Navigator>) {
  vi.stubGlobal('navigator', { ...overrides })
}

beforeEach(() => {
  native.isNative = false
  native.share.mockReset()
})

afterEach(() => vi.unstubAllGlobals())

describe('in a browser', () => {
  it('is unsupported without navigator.share, such as on plain http', async () => {
    stubNavigator({})
    expect(canShareLink(content)).toBe(false)
    expect(await shareLink(content)).toBe('unsupported')
  })

  it('respects navigator.canShare', () => {
    stubNavigator({ canShare: () => false, share: vi.fn() })
    expect(canShareLink(content)).toBe(false)
  })

  it('passes title, text and url to navigator.share', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ canShare: () => true, share })
    expect(canShareLink(content)).toBe(true)
    expect(await shareLink(content)).toBe('shared')
    expect(share).toHaveBeenCalledWith(content)
  })

  it('calls navigator.share synchronously so the tap still counts', () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share })
    void shareLink(content)
    expect(share).toHaveBeenCalledOnce()
  })

  it('treats a dismissed sheet as cancelled', async () => {
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('Share canceled', 'AbortError')),
    })
    expect(await shareLink(content)).toBe('cancelled')
  })

  it('reports other errors as failed', async () => {
    stubNavigator({
      share: vi.fn().mockRejectedValue(new DOMException('No gesture', 'NotAllowedError')),
    })
    expect(await shareLink(content)).toBe('failed')
  })
})

describe('in the native app', () => {
  beforeEach(() => {
    native.isNative = true
    // Android's WebView has no navigator.share.
    stubNavigator({})
  })

  it('uses the Capacitor plugin', async () => {
    native.share.mockResolvedValue({ activityType: 'com.whatsapp' })
    expect(canShareLink(content)).toBe(true)
    expect(await shareLink(content)).toBe('shared')
    expect(native.share).toHaveBeenCalledWith({ ...content, dialogTitle: 'Lisbon' })
  })

  it('treats the plugin cancel rejection as cancelled', async () => {
    native.share.mockRejectedValue(new Error('Share canceled'))
    expect(await shareLink(content)).toBe('cancelled')
  })

  it('reports other plugin errors as failed', async () => {
    native.share.mockRejectedValue(new Error('Unsupported url'))
    expect(await shareLink(content)).toBe('failed')
  })
})
