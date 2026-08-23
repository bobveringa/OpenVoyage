import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Play,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
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

export function MediaStripCard({
  badge,
  children,
  media,
  onOpen,
}: {
  badge?: string | null
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
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

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
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
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
    hasMultipleMedia,
    media.length,
    onClose,
    onIndexChange,
  ])

  if (!activeMedia || typeof document === 'undefined') {
    return null
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    if (!touch) {
      return
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null

    if (!start || !touch || !hasMultipleMedia) {
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return
    }

    showRelativeMedia(deltaX > 0 ? -1 : 1)
  }

  return createPortal(
    <div
      aria-label={`${title} media viewer`}
      aria-modal="true"
      className="fixed inset-0 z-[1000] bg-slate-950/95 text-white"
      onClick={onClose}
      role="dialog"
    >
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          <p className="truncate text-xs text-white/65">
            {activeMedia.alt} · {activeIndex + 1} of {media.length}
          </p>
        </div>
        <Button
          aria-label="Close media viewer"
          className="size-10 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={onClose}
          size="icon"
          title="Close"
          type="button"
          variant="ghost"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <button
        aria-label="Previous media"
        className="absolute left-3 top-1/2 z-20 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-white/10 text-white shadow-xl transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35 sm:grid"
        disabled={!hasMultipleMedia}
        onClick={(event) => {
          event.stopPropagation()
          showRelativeMedia(-1)
        }}
        type="button"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </button>

      <button
        aria-label="Next media"
        className="absolute right-3 top-1/2 z-20 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-white/10 text-white shadow-xl transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35 sm:grid"
        disabled={!hasMultipleMedia}
        onClick={(event) => {
          event.stopPropagation()
          showRelativeMedia(1)
        }}
        type="button"
      >
        <ArrowRight className="size-5" aria-hidden="true" />
      </button>

      <div
        className="flex h-full items-center justify-center px-4 py-20 sm:px-20"
        onClick={(event) => event.stopPropagation()}
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
      >
        <LightboxMediaPreview media={activeMedia} />
      </div>

      <div className="absolute inset-x-4 bottom-4 z-20 flex items-center justify-between gap-3 sm:justify-center">
        <Button
          aria-label="Previous media"
          className="size-11 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-35 sm:hidden"
          disabled={!hasMultipleMedia}
          onClick={(event) => {
            event.stopPropagation()
            showRelativeMedia(-1)
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Button>
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
          {activeIndex + 1} / {media.length}
        </span>
        <Button
          aria-label="Next media"
          className="size-11 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-35 sm:hidden"
          disabled={!hasMultipleMedia}
          onClick={(event) => {
            event.stopPropagation()
            showRelativeMedia(1)
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </div>,
    document.body,
  )
}

function LightboxMediaPreview({ media }: { media: PostMedia }) {
  const [loadState, setLoadState] = useState<'error' | 'loading' | 'ready'>(
    'loading',
  )
  const mediaKey = `${getMediaType(media)}:${media.src}:${media.poster ?? ''}`
  const mediaClassName =
    'max-h-[calc(100dvh-10rem)] max-w-[calc(100dvw-2rem)] rounded-[1.35rem] object-contain shadow-2xl shadow-black/35 sm:max-w-[calc(100dvw-10rem)]'

  useEffect(() => {
    setLoadState('loading')
  }, [mediaKey])

  return (
    <div className="relative grid min-h-48 min-w-48 place-items-center">
      {getMediaType(media) === 'video' ? (
        <video
          aria-label={media.alt}
          className={cn('bg-black', mediaClassName)}
          controls
          onError={() => setLoadState('error')}
          onLoadedData={() => setLoadState('ready')}
          playsInline
          poster={media.poster ?? media.thumbnail}
          preload="metadata"
          src={media.src}
        />
      ) : (
        <img
          alt={media.alt}
          className={mediaClassName}
          onError={() => setLoadState('error')}
          onLoad={() => setLoadState('ready')}
          src={media.src}
        />
      )}

      {loadState !== 'ready' ? (
        <div className="absolute inset-0 grid place-items-center rounded-[1.35rem] bg-slate-950/45 text-white backdrop-blur-sm">
          <div className="grid justify-items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold shadow-xl shadow-black/25">
            {loadState === 'loading' ? (
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <AlertCircle className="size-5" aria-hidden="true" />
            )}
            {loadState === 'loading'
              ? 'Loading full resolution'
              : 'Unable to load media'}
          </div>
        </div>
      ) : null}
    </div>
  )
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
