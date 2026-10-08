import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MediaProcessingFailedError, type Media } from '@/api/client'
import { ClockFormatContext } from '@/lib/date-time'
import type { TravelPost } from './models'
import { PostFormPanel } from './post-form-panel'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), wait: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  uploadMediaWithProgress: mocks.upload,
  waitForMediaReady: mocks.wait,
}))

const waiting: Media = {
  id: 'new-media', media_type: 'IMAGE', status: 'UPLOADED',
  urls: { content: null, thumbnail: null }, technical_info: null,
  metadata: { caption: '', created_at: '', updated_at: '' },
}
const ready: Media = { ...waiting, status: 'READY', urls: { content: '/clean.jpg', thumbnail: '/thumb.webp' } }
const post = {
  id: 'post', title: 'Original title', excerpt: 'Original story', occurredAt: '2026-10-07T12:00:00Z',
  location: 'Amsterdam', coordinates: [52.37, 4.90], media: [], bubbleMediaId: null,
} as unknown as TravelPost

describe('post submission while media is processing', () => {
  let root: Root
  let container: HTMLDivElement
  let complete: (media: Media) => void
  let fail: (error: Error) => void
  const submit = vi.fn()

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    URL.createObjectURL = vi.fn(() => 'blob:local-preview')
    URL.revokeObjectURL = vi.fn()
    submit.mockClear()
    mocks.upload.mockResolvedValue(waiting)
    mocks.wait.mockImplementation(() => new Promise<Media>((resolve, reject) => { complete = resolve; fail = reject }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(createElement(ClockFormatContext.Provider, {
      value: { preference: '24-hour', setPreference: vi.fn() },
    }, createElement(PostFormPanel, {
      accessToken: 'token', draftLocation: null, gpsPostCandidate: null, isSubmitting: false,
      immichEnabled: false, mapPointActive: false, mode: 'edit', tripId: 'trip', post,
      onCancel: vi.fn(), onMapPointTargetChange: vi.fn(), onSubmit: submit,
    }))))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  function button(text: string) {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text)!
  }

  it('keeps a local preview, waits, and submits exactly once when cleaning completes', async () => {
    expect(container.textContent).toContain('Waiting to process')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:local-preview')
    await act(async () => button('Save post').click())
    expect(submit).not.toHaveBeenCalled()
    await act(async () => complete(ready))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0].media[0].src).toBe('/clean.jpg')
  })

  it('cancels the pending save on failure, retains input, and saves after removal', async () => {
    await act(async () => button('Save post').click())
    await act(async () => fail(new MediaProcessingFailedError()))
    expect(submit).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Processing failed. Remove this file and upload it again.')
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Post title"]')?.value).toBe('Original title')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove photo.jpg"]')!.click())
    await act(async () => button('Save post').click())
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0].media).toEqual([])
  })
})
