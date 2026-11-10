import { Share } from '@capacitor/share'

import { isNativePlatform } from './platform'

export type ShareLinkContent = {
  text?: string
  title: string
  url: string
}

export type ShareLinkOutcome = 'cancelled' | 'failed' | 'shared' | 'unsupported'

// Android's WebView does not implement the Web Share API, so the native app
// goes through the Capacitor plugin. Browsers only expose navigator.share in
// secure contexts (https or localhost), so a self-hosted server on plain http
// reports no support and callers fall back to copying.
export function canShareLink(content?: ShareLinkContent): boolean {
  if (isNativePlatform()) return true
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false
  }
  if (!content || typeof navigator.canShare !== 'function') return true
  try {
    return navigator.canShare(toShareData(content))
  } catch {
    return false
  }
}

// Browsers require a user gesture for navigator.share, so callers must invoke
// this directly from a click handler and must not await anything first.
export async function shareLink(
  content: ShareLinkContent,
): Promise<ShareLinkOutcome> {
  if (isNativePlatform()) {
    try {
      await Share.share({ ...toShareData(content), dialogTitle: content.title })
      return 'shared'
    } catch (error) {
      return isCancellation(error) ? 'cancelled' : 'failed'
    }
  }

  if (!canShareLink(content)) return 'unsupported'

  try {
    await navigator.share(toShareData(content))
    return 'shared'
  } catch (error) {
    return isCancellation(error) ? 'cancelled' : 'failed'
  }
}

function toShareData({ text, title, url }: ShareLinkContent) {
  return text ? { text, title, url } : { title, url }
}

function isCancellation(error: unknown) {
  if (error instanceof DOMException) return error.name === 'AbortError'
  // The Capacitor plugin rejects with "Share canceled" when the sheet is
  // dismissed.
  return error instanceof Error && /cancel/i.test(error.message)
}
