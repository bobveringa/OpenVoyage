const MAX_PREVIEW_EDGE = 960

/**
 * Render a lightweight still frame for a locally-selected video.
 *
 * The server thumbnail is authoritative once it is available, but thumbnail
 * generation happens after an upload.  This fills that short gap without
 * asking the media strip to render a full video from a blob URL.
 */
export async function createVideoPreview(file: File): Promise<Blob | null> {
  const sourceUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.src = sourceUrl

  try {
    await waitForVideoFrame(video)

    if (!video.videoWidth || !video.videoHeight) {
      return null
    }

    const scale = Math.min(
      1,
      MAX_PREVIEW_EDGE / Math.max(video.videoWidth, video.videoHeight),
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)

    return await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.82)
    })
  } catch {
    // Some devices cannot decode every camera codec. The caller will retain
    // its video fallback rather than presenting a broken-image placeholder.
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(sourceUrl)
  }
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('Timed out creating video preview')),
      10_000,
    )

    function cleanup() {
      window.clearTimeout(timeout)
      video.removeEventListener('error', onError)
      video.removeEventListener('loadeddata', onLoadedData)
      video.removeEventListener('seeked', onSeeked)
    }

    function onError() {
      cleanup()
      reject(new Error('Unable to decode video preview'))
    }

    function onSeeked() {
      cleanup()
      resolve()
    }

    function onLoadedData() {
      const previewTime = Number.isFinite(video.duration)
        ? Math.min(0.1, Math.max(0, video.duration / 2))
        : 0
      if (previewTime === 0) {
        cleanup()
        resolve()
        return
      }
      video.currentTime = previewTime
    }

    video.addEventListener('error', onError, { once: true })
    video.addEventListener('loadeddata', onLoadedData, { once: true })
    video.addEventListener('seeked', onSeeked, { once: true })
    video.load()
  })
}
