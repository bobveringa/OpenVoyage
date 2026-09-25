import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Loader2,
  Maximize,
  Minimize,
  RefreshCw,
  RotateCcw,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  fetchImmichAssetBlob,
  getErrorMessage,
  importTripImmichAsset,
  listTripImmichAlbums,
  listTripImmichAssets,
  type ImmichAlbumLink,
  type ImmichAsset,
  type MediaUploadResponse,
} from '@/api/client'
import { ImmichLogo } from '@/components/branding/immich-logo'
import { createImmichAlbumOptions } from '@/components/trips/immich-album-options'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { InlineNotice } from '@/pages/trip-detail/inline-notice'
import { LightboxPhoto } from '@/pages/trip-detail/lightbox-photo'
import type { PostMedia } from '@/pages/trip-detail/models'
import { photoWindow } from '@/pages/trip-detail/photo-gestures'

const ASSET_PAGE_SIZE = 20
const PAGE_PREFETCH_MARGIN = '600px 0px'
const IMAGE_PREFETCH_MARGIN = '400px 0px'
const immichPickerHistoryStateKey = 'openVoyageImmichPicker'
const immichLightboxHistoryStateKey = 'openVoyageImmichLightbox'

type ImportState = { error: string | null; status: 'failed' | 'importing' | 'success' }
type ImportStage = 'complete' | 'importing' | 'selecting'

export function ImmichMediaPicker({
  accessToken,
  onClose,
  onImported,
  open,
  tripId,
}: {
  accessToken: string
  onClose: () => void
  onImported: (media: MediaUploadResponse) => void
  open: boolean
  tripId: string
}) {
  const [links, setLinks] = useState<ImmichAlbumLink[]>([])
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [pendingLinkId, setPendingLinkId] = useState<string | null>(null)
  const [assets, setAssets] = useState<ImmichAsset[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [imports, setImports] = useState<Record<string, ImportState>>({})
  const [importStage, setImportStage] = useState<ImportStage>('selecting')
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [displayAssetId, setDisplayAssetId] = useState<string | null>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreKeyRef = useRef<string | null>(null)
  const requestVersionRef = useRef(0)
  const selectedLinkIdRef = useRef(selectedLinkId)
  const onCloseRef = useRef(onClose)
  const closeTimerRef = useRef<number | null>(null)
  const historyEntryIdRef = useRef(createPickerHistoryEntryId())
  selectedLinkIdRef.current = selectedLinkId
  onCloseRef.current = onClose

  const isImporting = importStage === 'importing'
  const importedCount = selection.filter((id) => imports[id]?.status === 'success').length
  const failedIds = selection.filter((id) => imports[id]?.status === 'failed')
  const pendingIds = selection.filter((id) => imports[id]?.status !== 'success')
  const importProgress = selection.length
    ? Math.round(((importedCount + failedIds.length) / selection.length) * 100)
    : 0

  const closePicker = useCallback(() => {
    if (window.history.state?.[immichPickerHistoryStateKey] === historyEntryIdRef.current) {
      window.history.back()
      return
    }
    onCloseRef.current()
  }, [])

  useEffect(() => {
    if (!open) return
    setError(null)
    setIsLoadingAlbums(true)
    void listTripImmichAlbums({ accessToken, tripId })
      .then((result) => {
        setLinks(result)
        setSelectedLinkId((current) =>
          current && result.some((link) => link.id === current)
            ? current
            : result[0]?.id ?? '',
        )
      })
      .catch((loadError) => setError(getErrorMessage(loadError)))
      .finally(() => setIsLoadingAlbums(false))
  }, [accessToken, open, tripId])

  useEffect(() => {
    if (open) return
    setSelection([])
    setImports({})
    setImportStage('selecting')
    setDisplayAssetId(null)
    setPendingLinkId(null)
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    const historyEntryId = historyEntryIdRef.current

    if (window.history.state?.[immichPickerHistoryStateKey] !== historyEntryId) {
      window.history.pushState(
        {
          ...window.history.state,
          [immichPickerHistoryStateKey]: historyEntryId,
        },
        '',
      )
    }

    function handlePopState(event: PopStateEvent) {
      if (event.state?.[immichPickerHistoryStateKey] !== historyEntryId) {
        onCloseRef.current()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      window.setTimeout(() => {
        if (window.history.state?.[immichPickerHistoryStateKey] === historyEntryId) {
          window.history.back()
        }
      }, 0)
    }
  }, [open])

  useEffect(() => {
    if (!open || !selectedLinkId) {
      setAssets([])
      setNextCursor(null)
      return undefined
    }

    const requestVersion = ++requestVersionRef.current
    let cancelled = false
    loadingMoreKeyRef.current = null
    setAssets([])
    setNextCursor(null)
    setIsInitialLoading(true)
    setIsLoadingMore(false)
    setError(null)

    void listTripImmichAssets({
      accessToken,
      linkId: selectedLinkId,
      pageSize: ASSET_PAGE_SIZE,
      tripId,
    })
      .then((result) => {
        if (cancelled || requestVersion !== requestVersionRef.current) return
        setAssets(result.items)
        setNextCursor(result.next_cursor)
      })
      .catch((loadError) => {
        if (!cancelled && requestVersion === requestVersionRef.current) {
          setError(getErrorMessage(loadError))
        }
      })
      .finally(() => {
        if (!cancelled && requestVersion === requestVersionRef.current) {
          setIsInitialLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, open, refreshVersion, selectedLinkId, tripId])

  const loadMore = useCallback(async () => {
    if (!open || !selectedLinkId || nextCursor === null || isInitialLoading) return
    const requestKey = `${selectedLinkId}:${nextCursor}`
    if (loadingMoreKeyRef.current !== null) return

    const requestVersion = requestVersionRef.current
    loadingMoreKeyRef.current = requestKey
    setIsLoadingMore(true)
    setError(null)
    try {
      const result = await listTripImmichAssets({
        accessToken,
        linkId: selectedLinkId,
        cursor: nextCursor,
        pageSize: ASSET_PAGE_SIZE,
        tripId,
      })
      if (
        requestVersion !== requestVersionRef.current ||
        selectedLinkIdRef.current !== selectedLinkId
      ) {
        return
      }
      setAssets((current) => {
        const existingIds = new Set(current.map((asset) => asset.id))
        return [...current, ...result.items.filter((asset) => !existingIds.has(asset.id))]
      })
      setNextCursor(result.next_cursor)
    } catch (loadError) {
      if (
        requestVersion === requestVersionRef.current &&
        selectedLinkIdRef.current === selectedLinkId
      ) {
        setError(getErrorMessage(loadError))
      }
    } finally {
      if (loadingMoreKeyRef.current === requestKey) {
        loadingMoreKeyRef.current = null
        setIsLoadingMore(false)
      }
    }
  }, [accessToken, isInitialLoading, nextCursor, open, selectedLinkId, tripId])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (
      importStage !== 'selecting' ||
      !sentinel ||
      nextCursor === null ||
      isInitialLoading ||
      isLoadingMore
    ) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      void loadMore()
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      {
        root: sentinel.closest('.scrollbar-subtle'),
        rootMargin: PAGE_PREFETCH_MARGIN,
      },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [importStage, isInitialLoading, isLoadingMore, loadMore, nextCursor])

  const albumOptions = useMemo(
    () => createImmichAlbumOptions(links),
    [links],
  )
  const displayAssets = useMemo(
    () => assets.filter((asset) => asset.media_type === 'IMAGE' && asset.display_image_url),
    [assets],
  )
  const displayAssetIndex = displayAssetId === null
    ? -1
    : displayAssets.findIndex((asset) => asset.id === displayAssetId)

  useEffect(() => {
    if (
      displayAssetIndex < 0 ||
      displayAssetIndex < displayAssets.length - 3 ||
      nextCursor === null ||
      isLoadingMore
    ) return
    void loadMore()
  }, [displayAssetIndex, displayAssets.length, isLoadingMore, loadMore, nextCursor])

  function applyAlbum(linkId: string) {
    setSelectedLinkId(linkId)
    setSelection([])
    setImports({})
    setDisplayAssetId(null)
    setPendingLinkId(null)
  }

  function selectAlbum(linkId: string) {
    if (linkId === selectedLinkId || isImporting) return
    if (selection.length > 0) {
      setPendingLinkId(linkId)
      return
    }
    applyAlbum(linkId)
  }

  function toggleAsset(assetId: string) {
    if (isImporting || imports[assetId]?.status === 'success') return
    setSelection((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    )
  }

  async function importIds(ids: string[]) {
    setImportStage('importing')
    let hasFailures = false
    for (const assetId of ids) {
      setImports((current) => ({
        ...current,
        [assetId]: { error: null, status: 'importing' },
      }))
      try {
        const media = await importTripImmichAsset({
          accessToken,
          assetId,
          linkId: selectedLinkId,
          tripId,
        })
        onImported(media)
        setImports((current) => ({
          ...current,
          [assetId]: { error: null, status: 'success' },
        }))
      } catch (importError) {
        hasFailures = true
        setImports((current) => ({
          ...current,
          [assetId]: { error: getErrorMessage(importError), status: 'failed' },
        }))
      }
    }

    setImportStage('complete')
    if (!hasFailures) {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        closePicker()
      }, 900)
    }
  }

  return (
    <>
      <Modal
        className="sm:max-w-5xl"
        contentClassName="m-0 rounded-none px-3 py-0 sm:m-2 sm:rounded-xl sm:py-3"
        description={
          importStage === 'selecting'
            ? 'Select media from one connected album. Imports become ordinary OpenVoyage media.'
            : 'Your selected media is being added to this post.'
        }
        dismissible={!isImporting}
        footer={
          importStage === 'selecting' ? (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm font-medium text-foreground">
                {selection.length === 0
                  ? 'Select media to add'
                  : `${selection.length} selected`}
              </p>
              <div className="flex shrink-0 gap-2">
                {failedIds.length ? (
                  <Button
                    disabled={isImporting}
                    onClick={() => void importIds(failedIds)}
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw className="size-4" />
                    <span className="hidden sm:inline">Retry failed</span>
                    <span className="sm:hidden">Retry</span>
                  </Button>
                ) : null}
                <Button
                  className="border border-[#1e83f7]/35 bg-[#1e83f7]/10 text-foreground hover:bg-[#1e83f7]/15"
                  disabled={pendingIds.length === 0 || isImporting}
                  onClick={() => void importIds(pendingIds)}
                  type="button"
                >
                  <ImmichLogo className="size-4" aria-hidden="true" />
                  Add{pendingIds.length ? ` ${pendingIds.length}` : ''}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">
                {isImporting
                  ? `Importing ${importedCount + failedIds.length + 1} of ${selection.length}`
                  : failedIds.length
                    ? `${importedCount} added, ${failedIds.length} failed`
                    : `${importedCount} added — returning to your post…`}
              </p>
              {!isImporting ? (
                <div className="flex shrink-0 gap-2">
                  {failedIds.length ? (
                    <Button onClick={() => void importIds(failedIds)} type="button" variant="outline">
                      <RotateCcw className="size-4" /> Retry
                    </Button>
                  ) : null}
                  <Button onClick={closePicker} type="button">Return to post</Button>
                </div>
              ) : null}
            </div>
          )
        }
        fullscreenOnMobile
        onClose={closePicker}
        open={open}
        title={
          <span className="inline-flex items-center gap-2">
            <ImmichLogo className="size-6" aria-hidden="true" />
            {importStage === 'selecting' ? 'Add from Immich' : 'Importing media'}
          </span>
        }
        toolbar={
          importStage === 'selecting' ? <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              className="flex-1"
              disabled={isImporting}
              onValueChange={selectAlbum}
              options={albumOptions}
              placeholder="Choose a connected album"
              value={selectedLinkId}
            />
            <Button
              disabled={!selectedLinkId || isImporting || isInitialLoading}
              onClick={() => setRefreshVersion((current) => current + 1)}
              type="button"
              variant="outline"
            >
              <RefreshCw className={cn('size-4', isInitialLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div> : undefined
        }
      >
        <div className="min-h-full">
          <div className="space-y-4 pb-4 pt-3">
            {importStage !== 'selecting' ? (
              <div className="space-y-5 rounded-2xl border border-border bg-muted/40 p-5">
                <div className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span>{isImporting ? 'Adding selected media' : 'Import finished'}</span>
                  <span className="tabular-nums text-muted-foreground">{importedCount + failedIds.length} / {selection.length}</span>
                </div>
                <div aria-label="Import progress" aria-valuemax={selection.length} aria-valuemin={0} aria-valuenow={importedCount + failedIds.length} className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${importProgress}%` }} />
                </div>
                <div className="grid gap-2 text-sm">
                  <p className="inline-flex items-center gap-2 text-muted-foreground"><Check className="size-4 text-primary" /> {importedCount} added to the post</p>
                  {isImporting ? <p className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {selection.length - importedCount - failedIds.length} remaining</p> : null}
                  {failedIds.length ? <InlineNotice tone="error">{failedIds.length} item{failedIds.length === 1 ? '' : 's'} could not be imported. Retry them or return to the post with the media already added.</InlineNotice> : null}
                </div>
              </div>
            ) : error ? <InlineNotice tone="error">{error}</InlineNotice> : isLoadingAlbums || isInitialLoading ? (
              <p className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Loading media…
                </span>
              </p>
            ) : links.length === 0 ? (
              <p className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-border px-5 text-center text-sm text-muted-foreground">
                No Immich albums are connected to this trip yet.
              </p>
            ) : assets.length === 0 ? (
              <p className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
                This album is empty.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {assets.map((asset) => {
                  const order = selection.indexOf(asset.id)
                  const state = imports[asset.id]
                  return (
                    <div
                      className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted"
                      key={asset.id}
                    >
                      <button
                        aria-label={`${order >= 0 ? 'Deselect' : 'Select'} Immich asset`}
                        className={cn(
                          'group size-full',
                          order >= 0 && 'ring-2 ring-inset ring-primary',
                        )}
                        disabled={isImporting || state?.status === 'success'}
                        onClick={() => toggleAsset(asset.id)}
                        type="button"
                      >
                        <AuthenticatedImmichImage
                          accessToken={accessToken}
                          alt=""
                          url={asset.thumbnail_url}
                        />
                        {asset.media_type === 'VIDEO' ? (
                          <Badge className="absolute left-2 top-2">
                            <Video className="size-3" /> Video
                          </Badge>
                        ) : null}
                        {order >= 0 ? (
                          <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                            {order + 1}
                          </span>
                        ) : null}
                      </button>
                      {asset.media_type === 'IMAGE' && asset.display_image_url ? (
                        <Button
                          className="absolute bottom-2 right-2"
                          onClick={() => setDisplayAssetId(asset.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Open
                        </Button>
                      ) : null}
                      {state ? (
                        <div
                          className={cn(
                            'absolute inset-x-2 bottom-2 rounded-xl px-2 py-1 text-xs font-semibold shadow-sm',
                            state.status === 'failed'
                              ? 'bg-destructive text-destructive-foreground'
                              : 'bg-card/90 text-foreground',
                          )}
                        >
                          {state.status === 'importing' ? (
                            'Importing…'
                          ) : state.status === 'success' ? (
                            <span className="inline-flex items-center gap-1">
                              <Check className="size-3" /> Added
                            </span>
                          ) : (
                            state.error ?? 'Import failed'
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}

            {importStage === 'selecting' ? (
              <div className="grid min-h-10 place-items-center" ref={loadMoreSentinelRef}>
                {isLoadingMore ? (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading more…
                  </span>
                ) : nextCursor === null && assets.length > 0 ? (
                  <span className="text-xs text-muted-foreground">End of album</span>
                ) : null}
              </div>
            ) : null}
          </div>

        </div>
      </Modal>

      <Modal
        description={`${selection.length} selected item${selection.length === 1 ? '' : 's'} will be cleared. Already added media stays in the post.`}
        onClose={() => setPendingLinkId(null)}
        open={pendingLinkId !== null}
        title="Clear selection and switch albums?"
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => setPendingLinkId(null)} type="button" variant="outline">
            Keep current album
          </Button>
          <Button
            onClick={() => {
              if (pendingLinkId) applyAlbum(pendingLinkId)
            }}
            type="button"
          >
            Clear and switch
          </Button>
        </div>
      </Modal>

      {displayAssetIndex >= 0 ? (
        <ImmichImageLightbox
          accessToken={accessToken}
          activeIndex={displayAssetIndex}
          assets={displayAssets}
          loadingMore={isLoadingMore}
          onClose={() => setDisplayAssetId(null)}
          onIndexChange={(index) => setDisplayAssetId(displayAssets[index]?.id ?? null)}
        />
      ) : null}
    </>
  )
}

function ImmichImageLightbox({
  accessToken,
  activeIndex,
  assets,
  loadingMore,
  onClose,
  onIndexChange,
}: {
  accessToken: string
  activeIndex: number
  assets: readonly ImmichAsset[]
  loadingMore: boolean
  onClose: () => void
  onIndexChange: (index: number) => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const onIndexChangeRef = useRef(onIndexChange)
  const historyEntryId = useId()
  const historyCleanupTimerRef = useRef<number | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [visited, setVisited] = useState<number[]>([])
  const mountedIndices = photoWindow(visited, activeIndex, assets.length)
  const hasMultipleImages = assets.length > 1
  onCloseRef.current = onClose
  onIndexChangeRef.current = onIndexChange

  useEffect(() => {
    setVisited((current) => photoWindow(current, activeIndex, assets.length))
  }, [activeIndex, assets.length])

  const closeLightbox = useCallback(() => {
    if (window.history.state?.[immichLightboxHistoryStateKey] === historyEntryId) {
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
    if (window.history.state?.[immichLightboxHistoryStateKey] !== historyEntryId) {
      window.history.pushState(
        { ...window.history.state, [immichLightboxHistoryStateKey]: historyEntryId },
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
        if (window.history.state?.[immichLightboxHistoryStateKey] === historyEntryId) {
          window.history.back()
        }
      }, 0)
    }
  }, [historyEntryId])

  const showRelativeImage = useCallback((offset: number) => {
    if (!assets.length) return
    onIndexChangeRef.current((activeIndex + offset + assets.length) % assets.length)
  }, [activeIndex, assets.length])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()

    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === dialogRef.current)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeLightbox()
      } else if (event.key === 'ArrowLeft' && hasMultipleImages) {
        event.preventDefault()
        showRelativeImage(-1)
      } else if (event.key === 'ArrowRight' && hasMultipleImages) {
        event.preventDefault()
        showRelativeImage(1)
      }
    }

    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [closeLightbox, hasMultipleImages, showRelativeImage])

  async function toggleFullscreen() {
    try {
      setFullscreenError('')
      if (document.fullscreenElement === dialogRef.current) await document.exitFullscreen()
      else await dialogRef.current?.requestFullscreen()
    } catch {
      setFullscreenError('Fullscreen is unavailable in this browser. Tap the photo to hide controls.')
    }
  }

  if (typeof document === 'undefined' || !assets[activeIndex]) return null

  const chromeButton = 'grid size-11 shrink-0 place-items-center rounded-full border border-white/15 bg-black/55 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35'

  return createPortal(
    <div
      aria-label="Immich image viewer"
      aria-modal="true"
      className="fixed inset-0 z-[1000] overflow-hidden bg-black text-white outline-none"
      ref={dialogRef}
      role="dialog"
      style={{ height: '100dvh', overscrollBehavior: 'none' }}
      tabIndex={-1}
    >
      {mountedIndices.map((index) => {
        const asset = assets[index]
        const active = index === activeIndex
        return (
          <div
            aria-hidden={!active}
            className="absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none"
            inert={!active}
            key={asset.id}
            style={{ opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}
          >
            <ProgressiveImmichPhoto
              accessToken={accessToken}
              active={active}
              asset={asset}
              controlsVisible={controlsVisible}
              onNavigate={showRelativeImage}
              onToggleControls={() => setControlsVisible((visible) => !visible)}
            />
          </div>
        )
      })}

      {controlsVisible ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/75 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
            <div className="min-w-0 pt-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                <ImmichLogo className="size-4" aria-hidden="true" /> Immich album
              </p>
              <p aria-live="polite" className="truncate text-xs text-white/75">
                Image {activeIndex + 1}{loadingMore ? ' · Loading more…' : ''}
              </p>
              <p className="mt-1 text-xs text-white/60">Pinch or double-tap to zoom · Tap to hide controls</p>
            </div>
            <div className="pointer-events-auto flex gap-2">
              {document.fullscreenEnabled ? (
                <button aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} className={chromeButton} onClick={() => void toggleFullscreen()} type="button">
                  {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
                </button>
              ) : null}
              <button aria-label="Close image viewer" className={chromeButton} onClick={closeLightbox} type="button">
                <X className="size-5" />
              </button>
            </div>
          </div>
          {fullscreenError ? <p className="absolute inset-x-4 top-20 z-30 rounded-xl bg-black/80 p-3 text-center text-sm" role="status">{fullscreenError}</p> : null}
          <div className="absolute inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 sm:justify-center sm:gap-6">
            <button aria-label="Previous image" className={chromeButton} disabled={!hasMultipleImages} onClick={() => showRelativeImage(-1)} type="button"><ArrowLeft className="size-5" /></button>
            <span className="rounded-full bg-black/55 px-3 py-2 text-xs tabular-nums">Image {activeIndex + 1}</span>
            <button aria-label="Next image" className={chromeButton} disabled={!hasMultipleImages} onClick={() => showRelativeImage(1)} type="button"><ArrowRight className="size-5" /></button>
          </div>
        </>
      ) : (
        <button aria-label="Show gallery controls" className={`${chromeButton} absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-20 opacity-50`} onClick={() => setControlsVisible(true)} type="button"><Eye className="size-5" /></button>
      )}
    </div>,
    document.body,
  )
}

function ProgressiveImmichPhoto({
  accessToken,
  active,
  asset,
  controlsVisible,
  onNavigate,
  onToggleControls,
}: {
  accessToken: string
  active: boolean
  asset: ImmichAsset
  controlsVisible: boolean
  onNavigate: (offset: number) => void
  onToggleControls: () => void
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)
  const [loadingDisplayImage, setLoadingDisplayImage] = useState(false)

  useEffect(() => {
    let activeRequest = true
    let thumbnailObjectUrl: string | null = null
    let displayObjectUrl: string | null = null
    setThumbnailUrl(null)
    setDisplayUrl(null)
    setLoadingDisplayImage(false)

    void fetchImmichAssetBlob({ accessToken, url: asset.thumbnail_url })
      .then((blob) => {
        if (!activeRequest) return null
        thumbnailObjectUrl = URL.createObjectURL(blob)
        setThumbnailUrl(thumbnailObjectUrl)
        setLoadingDisplayImage(Boolean(asset.display_image_url))
        return asset.display_image_url
          ? fetchImmichAssetBlob({ accessToken, url: asset.display_image_url })
          : null
      })
      .then((blob) => {
        if (!activeRequest || !blob) return
        displayObjectUrl = URL.createObjectURL(blob)
        setDisplayUrl(displayObjectUrl)
      })
      .catch(() => undefined)
      .finally(() => {
        if (activeRequest) setLoadingDisplayImage(false)
      })

    return () => {
      activeRequest = false
      if (thumbnailObjectUrl) URL.revokeObjectURL(thumbnailObjectUrl)
      if (displayObjectUrl) URL.revokeObjectURL(displayObjectUrl)
    }
  }, [accessToken, asset.display_image_url, asset.thumbnail_url])

  const source = displayUrl ?? thumbnailUrl
  if (!source) {
    return <div className="absolute inset-0 grid place-items-center"><Loader2 className="size-6 animate-spin" /></div>
  }

  const media: PostMedia = {
    alt: 'Immich image',
    src: source,
    thumbnail: thumbnailUrl ?? undefined,
    type: 'image',
  }
  return (
    <LightboxPhoto
      active={active}
      controlsVisible={controlsVisible}
      loading={loadingDisplayImage}
      media={media}
      onNavigate={onNavigate}
      onToggleControls={onToggleControls}
    />
  )
}

function createPickerHistoryEntryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `immich-picker-${crypto.randomUUID()}`
  }

  return `immich-picker-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function AuthenticatedImmichImage({
  accessToken,
  alt,
  className,
  eager = false,
  url,
}: {
  accessToken: string
  alt: string
  className?: string
  eager?: boolean
  url: string
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const [shouldLoad, setShouldLoad] = useState(eager)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (eager || shouldLoad) return undefined
    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true)
          observer.disconnect()
        }
      },
      {
        root: container.closest('.scrollbar-subtle'),
        rootMargin: IMAGE_PREFETCH_MARGIN,
      },
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [eager, shouldLoad])

  useEffect(() => {
    if (!shouldLoad) return undefined
    let active = true
    let createdUrl: string | null = null
    setObjectUrl(null)
    void fetchImmichAssetBlob({ accessToken, url })
      .then((blob) => {
        if (!active) return
        createdUrl = URL.createObjectURL(blob)
        setObjectUrl(createdUrl)
      })
      .catch(() => setObjectUrl(null))
    return () => {
      active = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [accessToken, shouldLoad, url])

  return (
    <span
      className="grid size-full place-items-center text-muted-foreground"
      ref={containerRef}
    >
      {objectUrl ? (
        <img alt={alt} className={cn('size-full object-cover', className)} src={objectUrl} />
      ) : (
        <Loader2 className="size-4 animate-spin" />
      )}
    </span>
  )
}
