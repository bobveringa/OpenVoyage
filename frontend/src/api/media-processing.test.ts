import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MediaProcessingFailedError, waitForMediaReady, type Media } from './client'

function media(status: Media['status']): Media {
  return {
    id: 'media-id', media_type: 'IMAGE', status,
    metadata: { caption: '', created_at: '', updated_at: '' },
    technical_info: status === 'READY' ? { width: 80, height: 40 } : null,
    urls: { content: status === 'READY' ? '/clean.jpg' : null, thumbnail: null },
  }
}

describe('waiting for media cleaning', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('polls every two seconds through waiting and active processing, then stops', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(media('PROCESSING'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(media('READY'))))
    vi.stubGlobal('fetch', fetch)
    const onStatus = vi.fn()
    const result = waitForMediaReady({ media: media('UPLOADED'), accessToken: 'token', onStatus })
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect((await result).status).toBe('READY')
    await vi.advanceTimersByTimeAsync(6000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(onStatus.mock.calls.map(([item]) => item.status)).toEqual(['UPLOADED', 'PROCESSING', 'READY'])
  })

  it('resumes after temporary network and server errors', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Network disconnected'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(media('READY'))))
    vi.stubGlobal('fetch', fetch)
    const result = waitForMediaReady({ media: media('PROCESSING'), accessToken: 'token' })
    await vi.advanceTimersByTimeAsync(6000)
    expect((await result).status).toBe('READY')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('reports terminal failure and does not retry processing', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(media('FAILED'))))
    vi.stubGlobal('fetch', fetch)
    const result = waitForMediaReady({ media: media('UPLOADED'), accessToken: 'token' })
    const assertion = expect(result).rejects.toThrow(MediaProcessingFailedError)
    await vi.advanceTimersByTimeAsync(2000)
    await assertion
    await vi.advanceTimersByTimeAsync(6000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops polling immediately when the item is removed or its form closes', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const result = waitForMediaReady({ media: media('UPLOADED'), accessToken: 'token', signal: controller.signal })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    await vi.advanceTimersByTimeAsync(6000)
    expect(fetch).not.toHaveBeenCalled()
  })
})
