import { useEffect, useState } from 'react'

import { isNativePlatform } from '@/native/platform'

// Chromium's Private Network Access policy blocks a plain
// <img src="http://192.168.x.x/..."> subresource load from the app's
// https://localhost origin (self-hosted servers on a home LAN are exactly
// this shape) even though fetch() to that same URL succeeds — <img> never
// completes the private-network preflight the way fetch() does. Worked
// around by fetching the bytes ourselves (which does work) and handing the
// <img> a same-origin blob: URL instead. Web is unaffected (same-origin
// already) and skips the extra fetch.
export function useNativeSafeImageSrc(url: string | null | undefined): string | null {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(
    isNativePlatform() ? null : (url ?? null),
  )

  useEffect(() => {
    if (!isNativePlatform()) {
      setResolvedSrc(url ?? null)
      return
    }
    if (!url) {
      setResolvedSrc(null)
      return
    }

    let objectUrl: string | null = null
    let isCurrent = true

    void fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load image: ${response.status}`)
        }
        return response.blob()
      })
      .then((blob) => {
        if (!isCurrent) {
          return
        }
        objectUrl = URL.createObjectURL(blob)
        setResolvedSrc(objectUrl)
      })
      .catch(() => {
        if (isCurrent) {
          setResolvedSrc(null)
        }
      })

    return () => {
      isCurrent = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [url])

  return resolvedSrc
}
