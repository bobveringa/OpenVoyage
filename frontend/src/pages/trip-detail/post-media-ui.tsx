import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Maximize,
  Minimize,
  Eye,
  Play,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PostMedia } from '@/pages/trip-detail/models'
import type { DraftPostMedia } from '@/pages/trip-detail/page-types'
import {
  getMediaThumbnailSrc,
  getMediaType,
} from '@/pages/trip-detail/shared-utils'

import { LightboxPhoto } from './lightbox-photo'
import { photoWindow } from './photo-gestures'

const mediaLightboxHistoryStateKey = 'openVoyageMediaLightboxId'

export function MediaStripCard({
  badge,
  children,
  media,
  onOpen,
}: {
  badge?: ReactNode | null
  children?: ReactNode
  media: PostMedia
  onOpen: () => void
}) {
  const isVideo = getMediaType(media) === 'video'

  return (
    <article
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-[1.5rem] bg-secondary',
        mediaStripHeightClassName,
      )}
    >
      <button
        className="block h-full w-fit text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onOpen}
        type="button"
      >
        <MediaThumbnailPreview
          className="h-full w-auto transition-transform duration-300 group-hover:scale-[1.025]"
          media={media}
        />
        <span className="sr-only">Open {media.alt}</span>
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        {isVideo ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-12 place-items-center rounded-full bg-card/90 text-primary shadow-lg shadow-black/15">
              <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
            </span>
          </span>
        ) : null}
      </button>

      {badge ? (
        <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-1 text-[0.68rem] font-semibold text-primary shadow-sm">
          {badge}
        </span>
      ) : null}

      {children}
    </article>
  )
}

export function DraftMediaUploadStatusBadge({
  media,
  onRetry,
  retryDisabled,
}: {
  media: DraftPostMedia
  onRetry: () => void
  retryDisabled: boolean
}) {
  const status = media.upload.status
  const progressPercent =
    media.upload.progress === null
      ? null
      : Math.max(0, Math.min(100, Math.round(media.upload.progress * 100)))

  if (status === 'failed') {
    return (
      <div className="absolute inset-x-2 top-2 space-y-2 rounded-[1rem] border border-destructive/30 bg-card/95 p-2 text-destructive shadow-sm">
        <div className="flex items-start gap-1.5">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 text-xs font-medium">
            {media.upload.error ?? 'Upload failed'}
          </p>
        </div>
        <Button
          className="h-8 w-full rounded-xl"
          disabled={retryDisabled}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <>
      <span
        className={cn(
          'absolute right-2 top-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full px-2 py-1 text-[0.68rem] font-semibold shadow-sm',
          status === 'uploaded' || status === 'existing'
            ? 'bg-card/90 text-primary'
            : 'bg-slate-950/70 text-white',
        )}
      >
        {status === 'uploaded' || status === 'existing' ? (
          <Check className="size-3" aria-hidden="true" />
        ) : (
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        )}
        {getDraftMediaUploadStatusText(media)}
      </span>
      {status === 'uploading' && progressPercent !== null ? (
        <span className="absolute inset-x-3 bottom-14 h-1.5 overflow-hidden rounded-full bg-card/70">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${progressPercent}%` }}
          />
        </span>
      ) : null}
    </>
  )
}

export function MediaLightbox({
  activeIndex,
  media,
  onClose,
  onIndexChange,
  title,
}: {
  activeIndex: number
  media: readonly PostMedia[]
  onClose: () => void
  onIndexChange: (index: number) => void
  title: string
}) {
  const activeMedia = media[activeIndex]
  const hasMultipleMedia = media.length > 1
  const dialogRef = useRef<HTMLDivElement>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [visited, setVisited] = useState<number[]>([])
  const mountedIndices = photoWindow(visited, activeIndex, media.length)

  useEffect(() => {
    setVisited(previous => photoWindow(previous, activeIndex, media.length))
  }, [activeIndex, media.length])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    function syncFullscreen() { setFullscreen(document.fullscreenElement === dialogRef.current) }
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      previousFocus?.focus()
    }
  }, [])

  async function toggleFullscreen() {
    try {
      setFullscreenError('')
      if (document.fullscreenElement === dialogRef.current) await document.exitFullscreen()
      else await dialogRef.current?.requestFullscreen()
    } catch {
      setFullscreenError('Fullscreen is unavailable in this browser. Tap the photo to hide controls.')
    }
  }
  const onCloseRef = useRef(onClose)
  const historyEntryId = useId()
  const historyCleanupTimerRef = useRef<number | null>(null)

  onCloseRef.current = onClose

  const closeLightbox = useCallback(() => {
    if (
      window.history.state?.[mediaLightboxHistoryStateKey] ===
      historyEntryId
    ) {
      window.history.back()
      return
    }

    onCloseRef.current()
  }, [historyEntryId])

  useEffect(() => {
    if (historyCleanupTimerRef.current !== null) {
      window.clearTimeout(historyCleanupTimerRef.current)
      historyCleanupTimerRef.current = null
    }

    if (
      window.history.state?.[mediaLightboxHistoryStateKey] !== historyEntryId
    ) {
      window.history.pushState(
        {
          ...window.history.state,
          [mediaLightboxHistoryStateKey]: historyEntryId,
        },
        '',
      )
    }

    function handlePopState() {
      onCloseRef.current()
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)

      historyCleanupTimerRef.current = window.setTimeout(() => {
        historyCleanupTimerRef.current = null
        if (
          window.history.state?.[mediaLightboxHistoryStateKey] ===
          historyEntryId
        ) {
          window.history.back()
        }
      }, 0)
    }
  }, [historyEntryId])

  function showRelativeMedia(offset: number) {
    if (media.length === 0) {
      return
    }

    onIndexChange((activeIndex + offset + media.length) % media.length)
  }

  useEffect(() => {
    if (!activeMedia) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), video[controls]') ?? []).filter(element => !element.closest('[inert]') && element.getClientRects().length > 0)
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus() }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeLightbox()
        return
      }

      if (event.key === 'ArrowLeft' && hasMultipleMedia) {
        event.preventDefault()
        onIndexChange((activeIndex - 1 + media.length) % media.length)
        return
      }

      if (event.key === 'ArrowRight' && hasMultipleMedia) {
        event.preventDefault()
        onIndexChange((activeIndex + 1) % media.length)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    activeIndex,
    activeMedia,
    closeLightbox,
    hasMultipleMedia,
    media.length,
    onIndexChange,
  ])

  if (!activeMedia || typeof document === 'undefined') {
    return null
  }

  const chromeButton = 'grid size-11 shrink-0 place-items-center rounded-full border border-white/15 bg-black/55 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35'

  return createPortal(
    <div ref={dialogRef} aria-label={`${title} media viewer`} aria-modal="true" role="dialog" tabIndex={-1}
      className="fixed inset-0 z-[1000] overflow-hidden bg-black text-white outline-none" style={{ height: '100dvh', overscrollBehavior: 'none' }}>
      {mountedIndices.map(index => {
        const item = media[index]
        const active = index === activeIndex
        return <div key={`${index}:${item.src}`} aria-hidden={!active} inert={!active}
          className="absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none"
          style={{ opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none', zIndex: active ? 1 : 0 }}>
          {getMediaType(item) === 'video' ? active && <LightboxVideo media={item} onNavigate={showRelativeMedia} /> :
            <LightboxPhoto media={item} active={active} controlsVisible={controlsVisible} onNavigate={showRelativeMedia} onToggleControls={() => setControlsVisible(value => !value)} />}
        </div>
      })}

      {controlsVisible ? <>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/75 to-transparent px-4 pb-10 pt-[max(1rem,var(--app-safe-area-inset-top))] sm:px-6">
          <div className="min-w-0 pt-1">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p aria-live="polite" className="truncate text-xs text-white/75">{activeMedia.alt} · {activeIndex + 1} of {media.length}</p>
            {getMediaType(activeMedia) !== 'video' && <p className="mt-1 text-xs text-white/60">Pinch or double-tap to zoom · Tap to hide controls</p>}
          </div>
          <div className="pointer-events-auto flex gap-2">
            {typeof document !== 'undefined' && document.fullscreenEnabled && <button type="button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} className={chromeButton} onClick={toggleFullscreen}>{fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}</button>}
            <button type="button" aria-label="Close media viewer" className={chromeButton} onClick={closeLightbox}><X className="size-5" /></button>
          </div>
        </div>
        {fullscreenError && <p role="status" className="absolute inset-x-4 top-20 z-30 rounded-xl bg-black/80 p-3 text-center text-sm">{fullscreenError}</p>}
        <div className="absolute inset-x-4 bottom-[max(1rem,var(--app-safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 sm:justify-center sm:gap-6">
          <button type="button" aria-label="Previous media" className={chromeButton} disabled={!hasMultipleMedia} onClick={() => showRelativeMedia(-1)}><ArrowLeft className="size-5" /></button>
          <span className="rounded-full bg-black/55 px-3 py-2 text-xs tabular-nums">{activeIndex + 1} / {media.length}</span>
          <button type="button" aria-label="Next media" className={chromeButton} disabled={!hasMultipleMedia} onClick={() => showRelativeMedia(1)}><ArrowRight className="size-5" /></button>
        </div>
      </> : <button type="button" aria-label="Show gallery controls" className={`${chromeButton} absolute right-4 top-[max(1rem,var(--app-safe-area-inset-top))] z-20 opacity-50`} onClick={() => setControlsVisible(true)}><Eye className="size-5" /></button>}
    </div>, document.body,
  )
}

function LightboxVideo({ media, onNavigate }: { media: PostMedia; onNavigate: (offset: number) => void }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  return <div className="absolute inset-0 flex items-center justify-center px-2 pb-20 pt-20"
    onTouchStart={event => {
      const touch = event.touches[0]
      const target = event.target
      // Leave the video's native playback controls and scrubber alone.
      const onControls = target instanceof HTMLVideoElement && touch && touch.clientY > target.getBoundingClientRect().bottom - 56
      touchStart.current = event.touches.length === 1 && touch && !onControls ? { x: touch.clientX, y: touch.clientY } : null
    }}
    onTouchMove={event => { if (event.touches.length !== 1) touchStart.current = null }}
    onTouchCancel={() => { touchStart.current = null }}
    onTouchEnd={event => {
      const start = touchStart.current
      const touch = event.changedTouches[0]
      touchStart.current = null
      if (!start || !touch) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) onNavigate(dx > 0 ? -1 : 1)
    }}>
    <video key={attempt} aria-label={media.alt} className="max-h-full max-w-full" controls playsInline poster={media.poster ?? media.thumbnail} preload="metadata" src={media.src} onError={() => setFailed(true)} />
    {failed && <button type="button" className="absolute rounded-xl bg-slate-900 p-4" onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>Unable to load video. Retry</button>}
  </div>
}

export function MediaPreview({
  className,
  controls = false,
  media,
  source = 'content',
}: {
  className?: string
  controls?: boolean
  media: PostMedia
  source?: 'content' | 'thumbnail'
}) {
  const previewSrc =
    source === 'thumbnail' ? getMediaThumbnailSrc(media) : media.src

  if (getMediaType(media) === 'video') {
    if (source === 'thumbnail' && previewSrc !== media.src) {
      return (
        <img
          alt={media.alt}
          className={cn('object-cover', className)}
          loading="lazy"
          src={previewSrc}
        />
      )
    }

    return (
      <video
        aria-label={media.alt}
        className={cn('bg-black object-contain', className)}
        controls={controls}
        muted={!controls}
        playsInline
        poster={media.poster ?? media.thumbnail}
        preload="metadata"
        src={media.src}
      />
    )
  }

  return (
    <img
      alt={media.alt}
      className={cn('object-cover', className)}
      loading="lazy"
      src={previewSrc}
    />
  )
}

export function MediaThumbnailPreview({
  className,
  media,
}: {
  className?: string
  media: PostMedia
}) {
  return (
    <MediaPreview
      className={className}
      media={media}
      source="thumbnail"
    />
  )
}

export const mediaStripHeightClassName = 'h-56 sm:h-64 lg:h-72 xl:h-80'

function getDraftMediaUploadStatusText(media: DraftPostMedia) {
  if (media.upload.status === 'existing' || media.upload.status === 'uploaded') {
    return 'Uploaded'
  }
  if (media.upload.status === 'queued') return 'Queued'
  if (media.upload.status === 'uploading') {
    return media.upload.progress === null
      ? 'Uploading'
      : `Uploading ${Math.round(media.upload.progress * 100)}%`
  }
  return 'Failed'
}
