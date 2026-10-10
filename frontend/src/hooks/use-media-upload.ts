import { useCallback, useEffect, useRef, useState } from 'react'

import { MediaProcessingFailedError, uploadMedia as upload } from '@/api/client'

/** Upload on submission and wait for cleaning; abort the wait when its form closes. */
export function useMediaUpload(scope?: string | boolean | null) {
  const controllers = useRef(new Set<AbortController>())
  const failedFiles = useRef(new WeakSet<File>())
  const [mediaStatus, setMediaStatus] = useState<string | null>(null)

  const cancelUpload = useCallback(() => {
    for (const controller of controllers.current) controller.abort()
    controllers.current.clear()
  }, [])

  useEffect(() => {
    const active = controllers.current
    return () => {
      for (const controller of active) controller.abort()
      active.clear()
    }
  }, [scope])

  const uploadMedia = useCallback(async (file: File, accessToken: string) => {
    if (failedFiles.current.has(file)) throw new MediaProcessingFailedError()
    const controller = new AbortController()
    controllers.current.add(controller)
    setMediaStatus('Uploading…')
    try {
      return await upload(file, accessToken, {
        signal: controller.signal,
        onStatus: (media) => setMediaStatus(media.status === 'UPLOADED' ? 'Waiting to process…' : 'Processing…'),
      })
    } catch (error) {
      if (error instanceof MediaProcessingFailedError) failedFiles.current.add(file)
      throw error
    } finally {
      controllers.current.delete(controller)
      setMediaStatus(null)
    }
  }, [])

  return { uploadMedia, mediaStatus, cancelUpload }
}
