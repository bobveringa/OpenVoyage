import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  MousePointer2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  getErrorMessage,
  uploadMediaWithProgress,
  type GpsPostCandidate,
  type Place,
} from '@/api/client'
import { PlaceSearchDropdown } from '@/components/places/place-search-dropdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  formatDateTimeInputValue,
  parseDateTime,
} from '@/pages/trip-detail/date-utils'
import { InlineNotice } from '@/pages/trip-detail/inline-notice'
import type { TravelPost } from '@/pages/trip-detail/models'
import type {
  DraftPostLocation,
  DraftPostMedia,
  MapPointTarget,
  PendingPostSubmit,
  PostSubmitDraft,
  PostSubmitIntent,
} from '@/pages/trip-detail/page-types'
import {
  LocationOptionCard,
} from '@/pages/trip-detail/planning-ui'
import { usePlaceSearch } from '@/hooks/use-place-search'
import {
  formatCoordinates,
  formatPlaceDetail,
  getPlaceCoordinates,
  getPlaceNameLabel,
  getPlaceSearchInput,
} from '@/pages/trip-detail/planning-utils'
import {
  DraftMediaUploadStatusBadge,
  MediaLightbox,
  MediaStripCard,
  mediaStripHeightClassName,
} from '@/pages/trip-detail/post-media-ui'
import {
  createExistingDraftPostMedia,
  createNewDraftPostMedia,
  formatGpsPostCandidateOccurredAt,
  getDraftMediaSectionDescription,
  getDraftMediaUploadStatusText,
  getDraftMediaUploadSummary,
  getDraftMediaUploadSummaryLabel,
  getFinishingUploadsModalDescription,
  isAbortError,
  isDraftMediaUploadBlocking,
  isSupportedMediaFile,
  toDraftMediaProgressUpdate,
  toPostMediaFromDraft,
  toPostOccurredAtValue,
  updateDraftMediaUpload,
} from '@/pages/trip-detail/post-form-utils'

export function PostFormPanel({
  accessToken,
  draftLocation,
  gpsPostCandidate,
  isSubmitting,
  mapPointActive,
  mode,
  onCancel,
  onDelete,
  onMapPointTargetChange,
  onSubmit,
  post = null,
}: {
  accessToken?: string | null
  draftLocation: DraftPostLocation | null
  gpsPostCandidate: GpsPostCandidate | null
  isSubmitting: boolean
  mapPointActive: boolean
  mode: 'create' | 'edit'
  onCancel: () => void
  onDelete?: () => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
  onSubmit: (draft: PostSubmitDraft) => void
  post?: TravelPost | null
}) {
  const editingPost = mode === 'edit' ? post : null
  const [locationSource, setLocationSource] = useState<'map' | 'search'>(
    mapPointActive ? 'map' : 'search',
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map())
  const uploadedMediaUrlsRef = useRef<string[]>([])
  const keepUploadedMediaUrlsRef = useRef(false)
  const [draftMedia, setDraftMedia] = useState<DraftPostMedia[]>(() =>
    editingPost ? editingPost.media.map(createExistingDraftPostMedia) : [],
  )
  const [activeDraftMediaIndex, setActiveDraftMediaIndex] = useState<
    number | null
  >(null)
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const [pendingSubmit, setPendingSubmit] = useState<PendingPostSubmit | null>(
    null,
  )
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const [occurredAt, setOccurredAt] = useState(() =>
    editingPost
      ? formatDateTimeInputValue(parseDateTime(editingPost.occurred_at))
      : gpsPostCandidate
        ? formatGpsPostCandidateOccurredAt(gpsPostCandidate)
        : formatDateTimeInputValue(new Date()),
  )
  const [searchValue, setSearchValue] = useState(
    editingPost?.location ?? '',
  )
  const [selectedSearchPlace, setSelectedSearchPlace] = useState<Place | null>(
    null,
  )
  const [placeResultsOpen, setPlaceResultsOpen] = useState(false)
  const [story, setStory] = useState(
    editingPost?.excerpt ?? '',
  )
  const [title, setTitle] = useState(editingPost?.title ?? '')

  // The map selection belongs to the page-level map. Treat it as the source
  // of truth so the form cannot briefly fall back to its local search state
  // while the side panel is opening after a map click.
  const selectedMapLocation = mapPointActive ? draftLocation : null
  const selectedSearchCoordinates = selectedSearchPlace
    ? getPlaceCoordinates(selectedSearchPlace)
    : null
  const selectedSearchLabel =
    selectedSearchPlace ? getPlaceNameLabel(selectedSearchPlace) : searchValue.trim()
  const selectedPostCoordinates =
    selectedMapLocation?.coordinates ??
    (selectedSearchPlace
      ? selectedSearchCoordinates
      : editingPost?.coordinates ?? selectedSearchCoordinates)
  const selectedLocationLabel =
    selectedMapLocation?.label ??
    (selectedSearchPlace
      ? selectedSearchLabel
      : editingPost?.location ?? selectedSearchLabel)
  const isFinishingUploads = pendingSubmit !== null
  const formDisabled = isSubmitting || isFinishingUploads
  const placeSearch = usePlaceSearch(
    searchValue,
    locationSource === 'search' && !formDisabled,
  )
  const hasLocation =
    selectedLocationLabel.length > 0 &&
    (mapPointActive
      ? Boolean(selectedMapLocation)
      : Boolean(selectedSearchPlace || editingPost))
  const canSubmit =
    hasLocation &&
    title.trim().length > 0 &&
    story.trim().length > 0 &&
    occurredAt.trim().length > 0 &&
    draftMedia.length > 0
  const uploadSummary = getDraftMediaUploadSummary(draftMedia)
  const mediaDescription = getDraftMediaSectionDescription(
    draftMedia.length,
    uploadSummary,
  )
  const editSubmitLabel =
    pendingSubmit?.intent === 'save'
      ? 'Finishing uploads...'
      : isSubmitting
        ? 'Saving'
        : 'Save post'
  const draftSubmitLabel =
    pendingSubmit?.intent === 'draft'
      ? 'Finishing uploads...'
      : isSubmitting
        ? 'Saving'
        : 'Save draft'
  const publishSubmitLabel =
    pendingSubmit?.intent === 'publish'
      ? 'Finishing uploads...'
      : isSubmitting
        ? 'Publishing'
        : 'Publish post'

  const abortDraftMediaUploads = useCallback(() => {
    for (const controller of uploadControllersRef.current.values()) {
      controller.abort()
    }
    uploadControllersRef.current.clear()
  }, [])

  const startDraftMediaUpload = useCallback(
    (media: DraftPostMedia, token: string) => {
      if (!media.file || uploadControllersRef.current.has(media.clientId)) {
        return
      }

      const controller = new AbortController()
      uploadControllersRef.current.set(media.clientId, controller)
      setDraftMedia((currentMedia) =>
        updateDraftMediaUpload(currentMedia, media.clientId, {
          error: null,
          loadedBytes: null,
          progress: null,
          status: 'uploading',
          totalBytes: null,
        }),
      )

      void uploadMediaWithProgress({
        accessToken: token,
        file: media.file,
        onProgress: (progress) => {
          setDraftMedia((currentMedia) =>
            updateDraftMediaUpload(
              currentMedia,
              media.clientId,
              toDraftMediaProgressUpdate(progress),
            ),
          )
        },
        signal: controller.signal,
      })
        .then((uploadedMedia) => {
          setDraftMedia((currentMedia) =>
            updateDraftMediaUpload(currentMedia, media.clientId, {
              error: null,
              loadedBytes: media.file?.size ?? null,
              mediaId: uploadedMedia.id,
              progress: 1,
              status: 'uploaded',
              totalBytes: media.file?.size ?? null,
            }).map((item) =>
              item.clientId === media.clientId
                ? { ...item, media_id: uploadedMedia.id }
                : item,
            ),
          )
        })
        .catch((uploadError: unknown) => {
          if (isAbortError(uploadError)) {
            return
          }

          setDraftMedia((currentMedia) =>
            updateDraftMediaUpload(currentMedia, media.clientId, {
              error: getErrorMessage(uploadError),
              status: 'failed',
            }),
          )
        })
        .finally(() => {
          uploadControllersRef.current.delete(media.clientId)
        })
    },
    [],
  )

  const finishPostSubmit = useCallback(
    (submit: PendingPostSubmit) => {
      const media = draftMedia.map(toPostMediaFromDraft)
      if (media.length === 0) {
        setMediaNotice('Add at least one media item before publishing.')
        return
      }

      if (media.some((item) => !item.media_id)) {
        setMediaNotice('Wait for media uploads to finish before publishing.')
        return
      }

      keepUploadedMediaUrlsRef.current = false
      onSubmit({
        ...submit.draft,
        media,
      })
    },
    [draftMedia, onSubmit],
  )

  useEffect(() => {
    keepUploadedMediaUrlsRef.current = false
    abortDraftMediaUploads()
    for (const objectUrl of uploadedMediaUrlsRef.current) {
      URL.revokeObjectURL(objectUrl)
    }
    uploadedMediaUrlsRef.current = []
    setActiveDraftMediaIndex(null)
    setDraftMedia(editingPost ? editingPost.media.map(createExistingDraftPostMedia) : [])
    setLocationSource('search')
    setSelectedSearchPlace(null)
    setPlaceResultsOpen(false)
    setMediaNotice(null)
    setPendingSubmit(null)
    setDeleteConfirmationOpen(false)
    setOccurredAt(
      editingPost
        ? formatDateTimeInputValue(parseDateTime(editingPost.occurred_at))
        : formatDateTimeInputValue(new Date()),
    )
    setSearchValue(editingPost?.location ?? '')
    setStory(editingPost?.excerpt ?? '')
    setTitle(editingPost?.title ?? '')
  }, [abortDraftMediaUploads, editingPost, mode])

  useEffect(() => {
    if (!gpsPostCandidate) {
      return
    }

    setLocationSource('map')
    setOccurredAt(formatGpsPostCandidateOccurredAt(gpsPostCandidate))
  }, [gpsPostCandidate])

  useEffect(() => {
    if (mapPointActive) {
      setLocationSource('map')
      return
    }

    if (!draftLocation) {
      setLocationSource('search')
    }
  }, [draftLocation, mapPointActive])

  useEffect(
    () => () => {
      abortDraftMediaUploads()
      if (keepUploadedMediaUrlsRef.current) {
        return
      }

      for (const objectUrl of uploadedMediaUrlsRef.current) {
        URL.revokeObjectURL(objectUrl)
      }
    },
    [abortDraftMediaUploads],
  )

  useEffect(() => {
    if (!accessToken) {
      return
    }

    for (const media of draftMedia) {
      if (media.upload.status === 'queued' && media.file) {
        startDraftMediaUpload(media, accessToken)
      }
    }
  }, [accessToken, draftMedia, startDraftMediaUpload])

  useEffect(() => {
    if (!pendingSubmit || isSubmitting) {
      return
    }

    const currentSummary = getDraftMediaUploadSummary(draftMedia)
    if (currentSummary.failed > 0 || currentSummary.pending > 0) {
      return
    }

    if (draftMedia.length === 0) {
      setMediaNotice('Add at least one media item before publishing.')
      setPendingSubmit(null)
      return
    }

    setPendingSubmit(null)
    finishPostSubmit(pendingSubmit)
  }, [draftMedia, finishPostSubmit, isSubmitting, pendingSubmit])

  function selectSearchLocation() {
    if (formDisabled) {
      return
    }

    setLocationSource('search')
    onMapPointTargetChange(null)
    setPlaceResultsOpen(true)
  }

  function selectMapLocation() {
    if (formDisabled) {
      return
    }

    setLocationSource('map')
    onMapPointTargetChange('post')
  }

  function handleSearchValueChange(value: string) {
    selectSearchLocation()
    setSearchValue(value)
    setSelectedSearchPlace(null)
    setPlaceResultsOpen(true)
  }

  function handlePlaceSelect(place: Place) {
    selectSearchLocation()
    setSelectedSearchPlace(place)
    setSearchValue(getPlaceSearchInput(place))
    setPlaceResultsOpen(false)
  }

  function handleUploadFiles(files: FileList | null) {
    if (formDisabled) {
      return
    }

    const mediaFiles = Array.from(files ?? []).filter((file) =>
      isSupportedMediaFile(file),
    )

    if (mediaFiles.length === 0) {
      setMediaNotice('Choose one or more image or video files.')
      return
    }

    const uploadedMedia = mediaFiles.map((file) => {
      const objectUrl = URL.createObjectURL(file)
      uploadedMediaUrlsRef.current.push(objectUrl)

      return createNewDraftPostMedia(file, objectUrl)
    })

    setDraftMedia((currentMedia) => [...currentMedia, ...uploadedMedia])
    setMediaNotice(
      `${mediaFiles.length} ${mediaFiles.length === 1 ? 'media item' : 'media items'} added.`,
    )
  }

  function moveDraftMedia(index: number, direction: -1 | 1) {
    if (formDisabled) {
      return
    }

    setDraftMedia((currentMedia) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= currentMedia.length) {
        return currentMedia
      }

      const nextMedia = [...currentMedia]
      const currentItem = nextMedia[index]
      const nextItem = nextMedia[nextIndex]
      if (!currentItem || !nextItem) {
        return currentMedia
      }

      nextMedia[index] = nextItem
      nextMedia[nextIndex] = currentItem
      return nextMedia
    })
  }

  function removeDraftMedia(media: DraftPostMedia) {
    uploadControllersRef.current.get(media.clientId)?.abort()
    uploadControllersRef.current.delete(media.clientId)
    revokeUploadedMediaUrl(media.src)
    setActiveDraftMediaIndex(null)
    setDraftMedia((currentMedia) =>
      currentMedia.filter((item) => item.clientId !== media.clientId),
    )
    setMediaNotice(`${media.alt} removed.`)
  }

  function retryDraftMedia(media: DraftPostMedia) {
    if (!media.file || isSubmitting) {
      return
    }

    uploadControllersRef.current.get(media.clientId)?.abort()
    uploadControllersRef.current.delete(media.clientId)
    setDraftMedia((currentMedia) =>
      updateDraftMediaUpload(currentMedia, media.clientId, {
        error: null,
        loadedBytes: null,
        progress: null,
        status: 'queued',
        totalBytes: null,
      }),
    )
    setMediaNotice(`${media.alt} queued for retry.`)
  }

  function retryFailedDraftMedia() {
    const failedMedia = draftMedia.filter(
      (media) => media.upload.status === 'failed',
    )
    for (const media of failedMedia) {
      retryDraftMedia(media)
    }
  }

  function revokeUploadedMediaUrl(src: string) {
    if (!uploadedMediaUrlsRef.current.includes(src)) {
      return
    }

    URL.revokeObjectURL(src)
    uploadedMediaUrlsRef.current = uploadedMediaUrlsRef.current.filter(
      (objectUrl) => objectUrl !== src,
    )
  }

  function discardUploadedMediaUrls() {
    for (const objectUrl of uploadedMediaUrlsRef.current) {
      URL.revokeObjectURL(objectUrl)
    }
    uploadedMediaUrlsRef.current = []
  }

  function handleCancel() {
    keepUploadedMediaUrlsRef.current = false
    setPendingSubmit(null)
    abortDraftMediaUploads()
    discardUploadedMediaUrls()
    onCancel()
  }

  function createPostSubmitDraft(publish: boolean): Omit<PostSubmitDraft, 'media'> {
    if (!selectedPostCoordinates) {
      throw new Error('Select a location before saving the post.')
    }

    return {
      coordinates: selectedPostCoordinates,
      locationLabel: selectedLocationLabel,
      occurredAt: toPostOccurredAtValue(occurredAt),
      placeId:
        locationSource === 'search' && selectedSearchPlace
          ? selectedSearchPlace.id
          : null,
      publish,
      story: story.trim(),
      title: title.trim(),
    }
  }

  function submitPost(intent: PostSubmitIntent) {
    if (!canSubmit) {
      return
    }

    const submit = {
      draft: createPostSubmitDraft(intent === 'publish'),
      intent,
    }

    if (!accessToken) {
      setMediaNotice('Sign in to upload media before publishing.')
      return
    }

    const currentSummary = getDraftMediaUploadSummary(draftMedia)
    if (currentSummary.failed > 0) {
      setMediaNotice('Retry or remove failed uploads before publishing.')
      return
    }

    if (currentSummary.pending > 0) {
      setMediaNotice(null)
      setPendingSubmit(submit)
      return
    }

    finishPostSubmit(submit)
  }

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-start gap-3">
        <Button
          aria-label="Back to posts"
          onClick={handleCancel}
          size="icon"
          title="Back to posts"
          type="button"
          variant="outline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {mode === 'edit' ? 'Edit post' : 'New post'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {mode === 'edit'
              ? 'Update the location, media, and story.'
              : 'Pick a map location, add media, then write the story.'}
          </p>
        </div>
      </div>

      <section className="space-y-3 rounded-[1.5rem] border border-border bg-muted/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Location</h3>
            <p className="text-sm text-muted-foreground">
              Search for a place or use an exact map point.
            </p>
          </div>
          <Badge variant={hasLocation ? 'default' : 'outline'}>
            {hasLocation ? 'Selected' : 'Required'}
          </Badge>
        </div>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Search places
          <span className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-9"
              disabled={formDisabled}
              onChange={(event) => {
                handleSearchValueChange(event.target.value)
              }}
              onFocus={() => setPlaceResultsOpen(true)}
              placeholder="Search places"
              value={searchValue}
            />
          </span>
        </label>
        <PlaceSearchDropdown
          disabled={formDisabled}
          error={placeSearch.error}
          onSelect={handlePlaceSelect}
          open={
            locationSource === 'search' &&
            placeResultsOpen &&
            !selectedSearchPlace
          }
          places={placeSearch.places}
          query={searchValue}
          status={placeSearch.status}
        />

        <LocationOptionCard
          active={!mapPointActive && locationSource === 'search'}
          detail={
            selectedSearchPlace
              ? formatPlaceDetail(selectedSearchPlace)
              : editingPost
              ? formatCoordinates(editingPost.coordinates)
              : 'Select a place from the geocode results.'
          }
          icon={Search}
          label={
            selectedSearchLabel ||
            editingPost?.location ||
            'Search for a place'
          }
          onClick={selectSearchLocation}
          source={editingPost ? 'Saved place' : 'Searched place'}
        />

        <LocationOptionCard
          active={mapPointActive}
          detail={
            mapPointActive && draftLocation
              ? `Map point · ${formatCoordinates(draftLocation.coordinates)}`
              : mapPointActive
                ? 'Click on the map to select an exact point.'
                : 'Map placement disabled'
          }
          icon={MousePointer2}
          label={draftLocation?.label ?? 'Map point'}
          onClick={selectMapLocation}
          source={
            mapPointActive
              ? 'Active map source'
              : 'Exact point'
          }
        />
      </section>

      <section className="space-y-4 rounded-[1.5rem] border border-border bg-card p-4">
        <label className="grid gap-2 text-sm font-medium text-foreground">
          Title
          <Input
            disabled={formDisabled}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Post title"
            value={title}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Story
          <Textarea
            className="min-h-36 resize-none"
            disabled={formDisabled}
            onChange={(event) => setStory(event.target.value)}
            placeholder="Write the story"
            value={story}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Occurred at
          <DateTimePicker
            disabled={formDisabled}
            onValueChange={setOccurredAt}
            value={occurredAt}
          />
        </label>
      </section>

      <section className="space-y-4 rounded-[1.5rem] border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Media</h3>
            <p className="text-sm text-muted-foreground">
              {mediaDescription}
            </p>
          </div>
          <Button
            disabled={formDisabled}
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload className="size-4" aria-hidden="true" />
            Add media
          </Button>
        </div>

        {mediaNotice ? <InlineNotice>{mediaNotice}</InlineNotice> : null}

        <input
          accept="image/*,video/*"
          className="sr-only"
          disabled={formDisabled}
          multiple
          onChange={(event) => {
            handleUploadFiles(event.currentTarget.files)
            event.currentTarget.value = ''
          }}
          ref={fileInputRef}
          type="file"
        />

        <div className="trip-post-media-strip scrollbar-subtle flex min-w-0 max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-1">
          {draftMedia.length === 0 ? (
            <button
              className={cn(
                'grid w-[76vw] max-w-80 shrink-0 place-items-center rounded-[1.4rem] border border-dashed border-input bg-muted/60 text-primary sm:w-80',
                mediaStripHeightClassName,
              )}
              disabled={formDisabled}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <span className="grid justify-items-center gap-2 text-sm font-semibold">
                <ImagePlus className="size-6" aria-hidden="true" />
                Add the first media
              </span>
            </button>
          ) : null}

          {draftMedia.map((media, index) => (
            <MediaStripCard
              badge={index === 0 ? 'Map bubble media' : null}
              key={media.clientId}
              media={media}
              onOpen={() => setActiveDraftMediaIndex(index)}
            >
              <DraftMediaUploadStatusBadge
                media={media}
                onRetry={() => retryDraftMedia(media)}
                retryDisabled={isSubmitting}
              />
              <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-2xl bg-card/90 p-1.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <div className="flex gap-1">
                  <Button
                    aria-label={`Move ${media.alt} left`}
                    className="size-8 rounded-xl"
                    disabled={formDisabled || index === 0}
                    onClick={() => moveDraftMedia(index, -1)}
                    size="icon"
                    title={`Move ${media.alt} left`}
                    type="button"
                    variant="ghost"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    aria-label={`Move ${media.alt} right`}
                    className="size-8 rounded-xl"
                    disabled={formDisabled || index === draftMedia.length - 1}
                    onClick={() => moveDraftMedia(index, 1)}
                    size="icon"
                    title={`Move ${media.alt} right`}
                    type="button"
                    variant="ghost"
                  >
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <Button
                  aria-label={`Remove ${media.alt}`}
                  className="size-8 rounded-xl"
                  disabled={
                    isSubmitting ||
                    (isFinishingUploads && media.upload.status !== 'failed')
                  }
                  onClick={() => removeDraftMedia(media)}
                  size="icon"
                  title={`Remove ${media.alt}`}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </MediaStripCard>
          ))}

          <button
            className={cn(
              'grid w-[52vw] max-w-52 shrink-0 place-items-center rounded-[1.4rem] border border-dashed border-input bg-muted/60 text-primary sm:w-52',
              mediaStripHeightClassName,
            )}
            disabled={formDisabled}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <span className="grid justify-items-center gap-2 text-sm font-semibold">
              <Plus className="size-5" aria-hidden="true" />
              Add media
            </span>
          </button>
        </div>

      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {mode === 'edit' && onDelete ? (
          <Button
            disabled={formDisabled}
            onClick={() => setDeleteConfirmationOpen(true)}
            type="button"
            variant="destructive"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete post
          </Button>
        ) : null}
        <Button
          disabled={isSubmitting}
          onClick={handleCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        {mode === 'edit' ? (
          <Button
            disabled={!canSubmit || isSubmitting || isFinishingUploads}
            onClick={() => submitPost('save')}
            type="button"
          >
            <Check className="size-4" aria-hidden="true" />
            {editSubmitLabel}
          </Button>
        ) : (
          <>
            <Button
              disabled={!canSubmit || isSubmitting || isFinishingUploads}
              onClick={() => submitPost('draft')}
              type="button"
              variant="outline"
            >
              {draftSubmitLabel}
            </Button>
            <Button
              disabled={!canSubmit || isSubmitting || isFinishingUploads}
              onClick={() => submitPost('publish')}
              type="button"
            >
              {publishSubmitLabel}
            </Button>
          </>
        )}
      </div>

      <Modal
        description={`Permanently delete ${editingPost?.title ?? 'this post'}? This cannot be undone.`}
        onClose={() => setDeleteConfirmationOpen(false)}
        open={deleteConfirmationOpen}
        title="Delete post"
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={isSubmitting}
            onClick={() => setDeleteConfirmationOpen(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={formDisabled}
            onClick={() => {
              setDeleteConfirmationOpen(false)
              onDelete?.()
            }}
            type="button"
            variant="destructive"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {isSubmitting ? 'Deleting post' : 'Delete post'}
          </Button>
        </div>
      </Modal>

      <Modal
        description={getFinishingUploadsModalDescription(pendingSubmit?.intent)}
        onClose={() => setPendingSubmit(null)}
        open={pendingSubmit !== null}
        title="Finishing uploads"
      >
        <div className="space-y-4">
          <div className="rounded-[1.1rem] border border-border bg-muted/70 px-3 py-3">
            <p className="text-sm font-semibold text-foreground">
              {getDraftMediaUploadSummaryLabel(uploadSummary)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {uploadSummary.failed > 0
                ? 'Retry the failed uploads before the post can be saved.'
                : 'The post will continue automatically when every media item is uploaded.'}
            </p>
          </div>

          <div className="space-y-2">
            {draftMedia
              .filter((media) => isDraftMediaUploadBlocking(media))
              .map((media) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-[1.1rem] border border-border px-3 py-2"
                  key={media.clientId}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {media.alt}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getDraftMediaUploadStatusText(media)}
                    </p>
                  </div>
                  {media.upload.status === 'failed' ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        onClick={() => retryDraftMedia(media)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <RefreshCw className="size-4" aria-hidden="true" />
                        Retry
                      </Button>
                      <Button
                        aria-label={`Remove ${media.alt}`}
                        onClick={() => removeDraftMedia(media)}
                        size="sm"
                        title={`Remove ${media.alt}`}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
          </div>

          <div className="flex justify-end gap-2">
            {uploadSummary.failed > 0 ? (
              <Button
                onClick={retryFailedDraftMedia}
                type="button"
                variant="outline"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Retry failed
              </Button>
            ) : null}
            <Button onClick={() => setPendingSubmit(null)} type="button">
              Keep editing
            </Button>
          </div>
        </div>
      </Modal>

      {activeDraftMediaIndex !== null ? (
        <MediaLightbox
          activeIndex={activeDraftMediaIndex}
          media={draftMedia}
          onClose={() => setActiveDraftMediaIndex(null)}
          onIndexChange={setActiveDraftMediaIndex}
          title={title.trim() || (editingPost ? editingPost.title : 'Draft media')}
        />
      ) : null}
    </div>
  )
}
