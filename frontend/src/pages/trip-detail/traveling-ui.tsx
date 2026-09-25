import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Radio,
  EllipsisVertical,
  Images,
  MapPin,
  Maximize2,
  Minimize2,
  PenLine,
  Play,
  Send,
  Heart,
  ImagePlus,
  MessageCircle,
  Trash2,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import {
  ApiError,
  createPostComment,
  deletePostComment,
  getShareLinkProfile,
  likePost,
  likePostComment,
  listPostComments,
  unlikePostComment,
  unlikePost,
  uploadMedia,
  updateShareLinkDisplayName,
  type GpsPostCandidate,
  type PostComment,
  type PostSocialSummary,
} from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MediaImage } from '@/components/ui/media-image'
import { Modal } from '@/components/ui/modal'
import { useTracking } from '@/tracking/use-tracking'
import { usePostSwipe } from '@/pages/trip-detail/use-post-swipe'
import { cn } from '@/lib/utils'
import {
  getMapFocusedPostId,
  getTravelPostsInRouteOrder,
} from '@/pages/trip-detail/trip-selectors'
import type {
  PostMedia,
  Stop,
  TravelLeg,
  TravelMode,
  TravelPost,
  TravelPostRoute,
  TripTrackingGeometry,
} from '@/pages/trip-detail/models'
import type {
  PostScrollRequest,
} from '@/pages/trip-detail/page-types'
import {
  getTravelModeIcon,
} from '@/pages/trip-detail/planning-utils'
import {
  MediaLightbox,
  MediaPreview,
  MediaStripCard,
  MediaThumbnailPreview,
} from '@/pages/trip-detail/post-media-ui'
import {
  getMediaType,
  getPrimaryPostMedia,
} from '@/pages/trip-detail/shared-utils'
import { TripLeafletMap } from '@/pages/trip-detail/trip-map'
import {
  scrollPostElementIntoView,
  setPostScrollElement,
  usePostScrollFocus,
  type PostScrollRootRef,
} from '@/pages/trip-detail/use-post-scroll-focus'

export function MobileTravelMap({
  onOpenGps,
  onNewPost,
  tripId,
  fullscreenOnMount = false,
  focusedPostId,
  gpsPostCandidates,
  isTripOngoing,
  onGpsPostCandidateSelect,
  onPostOpen,
  onPostMarkerSelect,
  stops,
  trackingGeometry,
  travelLegs,
  travelPosts,
}: {
  onOpenGps?: () => void
  onNewPost?: () => void
  tripId: string
  fullscreenOnMount?: boolean
  focusedPostId: string | null
  gpsPostCandidates: readonly GpsPostCandidate[]
  isTripOngoing: boolean
  onGpsPostCandidateSelect: (candidate: GpsPostCandidate) => void
  onPostOpen?: (postId: string) => void
  onPostMarkerSelect: (postId: string) => void
  stops: readonly Stop[]
  trackingGeometry: TripTrackingGeometry
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const [resetNonce, setResetNonce] = useState(0)
  const [fullscreen, setFullscreen] = useState(fullscreenOnMount)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const { activeSession } = useTracking()
  const trackingThisTrip = activeSession?.tripId === tripId
  const gpsLabel = trackingThisTrip ? (activeSession?.endedAt ? 'Syncing' : 'Recording') : 'GPS'

  useEffect(() => {
    if (!fullscreen) return
    const previousFocus = document.activeElement
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(closeButtonRef.current))
      .map((element) => ({ element, inert: element.inert }))
    const previousOverflow = document.body.style.overflow
    background.forEach(({ element }) => { element.inert = true })
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setFullscreen(false)
    }
    function onResize() {
      if (window.matchMedia('(min-width: 64rem)').matches) setFullscreen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      background.forEach(({ element, inert }) => { element.inert = inert })
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
      if (previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus()
      else document.querySelector<HTMLButtonElement>('button[aria-label="Open fullscreen map"]')?.focus()
    }
  }, [fullscreen])

  const map = (
    <section
      aria-label={fullscreen ? 'Fullscreen travel map' : 'Travel map'}
      aria-modal={fullscreen ? true : undefined}
      role={fullscreen ? 'dialog' : undefined}
      className={cn(
        'trip-mobile-travel-map overflow-hidden bg-card lg:hidden',
        fullscreen ? 'trip-fullscreen-map fixed inset-0 z-[60]' : 'absolute inset-0',
      )}
    >
      <TripLeafletMap
        draftMapLocation={null}
        fitMode={fullscreen ? 'mobile-fullscreen' : 'mobile-travel'}
        gpsPostCandidates={gpsPostCandidates}
        isTripOngoing={isTripOngoing}
        mapPointEnabled={false}
        onDraftMapPointSelect={() => undefined}
        onGpsPostCandidateSelect={(candidate) => {
          setFullscreen(false)
          onGpsPostCandidateSelect(candidate)
        }}
        onPostMarkerSelect={(postId) => {
          setFullscreen(false)
          if (fullscreen && onPostOpen) {
            onPostOpen(postId)
          } else {
            onPostMarkerSelect(postId)
          }
        }}
        resetNonce={resetNonce}
        routeMode="travel-timeline"
        focusedPostId={focusedPostId}
        stops={stops}
        travelLegs={travelLegs}
        trackingGeometry={trackingGeometry}
        travelPosts={travelPosts}
      />

      <div
        className={cn(
          'pointer-events-none absolute right-[max(0.75rem,var(--app-safe-area-inset-right))] z-[500] flex flex-col items-end gap-2',
          fullscreen ? 'top-[max(0.75rem,var(--app-safe-area-inset-top))]' : 'top-3',
        )}
      >
        <Button
          aria-label={fullscreen ? 'Exit fullscreen map' : 'Open fullscreen map'}
          className="pointer-events-auto size-11 rounded-2xl bg-card/95 shadow-lg shadow-foreground/10 backdrop-blur hover:bg-card"
          onClick={() => setFullscreen((current) => !current)}
          ref={closeButtonRef}
          size="icon"
          type="button"
          variant="outline"
        >
          {fullscreen ? <Minimize2 className="size-5" aria-hidden="true" /> : <Maximize2 className="size-5" aria-hidden="true" />}
        </Button>
        <Button
          aria-label="Recenter travel map"
          className="pointer-events-auto size-11 rounded-2xl bg-card/95 shadow-lg shadow-foreground/10 backdrop-blur hover:bg-card"
          onClick={() => setResetNonce((current) => current + 1)}
          size="icon"
          title="Recenter"
          type="button"
          variant="outline"
        >
          <Compass className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {onNewPost || onOpenGps ? (
        <div
          className={cn(
            'pointer-events-none absolute left-3 z-[500] flex items-center gap-2',
            fullscreen ? 'top-[max(0.75rem,var(--app-safe-area-inset-top))]' : 'top-3',
          )}
        >
          {onNewPost ? (
            <Button
              className="pointer-events-auto h-11 rounded-2xl px-4 shadow-xl shadow-foreground/10"
              onClick={onNewPost}
              size="sm"
              type="button"
            >
              <Camera className="size-4" aria-hidden="true" />
              New post
            </Button>
          ) : null}
          {onOpenGps ? (
            <Button
              aria-label="Manage GPS tracking"
              className={cn('pointer-events-auto h-11 rounded-2xl bg-card/95 px-3 shadow-lg shadow-foreground/10 backdrop-blur hover:bg-card', trackingThisTrip && 'border-destructive/40 text-destructive')}
              onClick={() => { setFullscreen(false); onOpenGps() }}
              type="button"
              variant="outline"
            >
              <Radio className="size-4" aria-hidden="true" />
              {gpsLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )

  return fullscreen ? createPortal(map, document.body) : map
}

export function TravelingPanel({
  onOpenGps,
  accessToken,
  currentUserId,
  canMutate,
  focusedPostId,
  gpsPostCandidates,
  isTripOngoing,
  isMutating,
  newPostIds,
  onFocusedPostChange,
  onGpsPostCandidateSelect,
  onEditPost,
  onNewPost,
  onPostMarkerSelect,
  onPostSocialSummary,
  onPublishPost,
  onViewedPostChange,
  scrollRootRef,
  scrollRequest,
  showMobileMap,
  shareToken,
  stops,
  trackingGeometry,
  travelLegs,
  travelPosts,
  tripId,
}: {
  onOpenGps: () => void
  accessToken?: string | null
  currentUserId: string | null
  canMutate: boolean
  focusedPostId: string | null
  gpsPostCandidates: readonly GpsPostCandidate[]
  isTripOngoing: boolean
  isMutating: boolean
  newPostIds: ReadonlySet<string>
  onFocusedPostChange: (postId: string | null) => void
  onGpsPostCandidateSelect: (candidate: GpsPostCandidate) => void
  onEditPost: (postId: string) => void
  onNewPost: () => void
  onPostMarkerSelect: (postId: string) => void
  onPostSocialSummary: (postId: string, social: PostSocialSummary) => void
  onPublishPost: (postId: string) => void
  onViewedPostChange: (postId: string) => void
  scrollRootRef: PostScrollRootRef
  scrollRequest: PostScrollRequest | null
  showMobileMap: boolean
  shareToken?: string | null
  stops: readonly Stop[]
  trackingGeometry: TripTrackingGeometry
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
  tripId: string
}) {
  const [activePostId, setActivePostId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const savedPostId = window.history.state?.openVoyageMobilePostId
    return typeof savedPostId === 'string' ? savedPostId : null
  })
  const [postEntryDirection, setPostEntryDirection] = useState<-1 | 0 | 1>(0)
  const [restoreFullscreenMap, setRestoreFullscreenMap] = useState(false)
  const activePost =
    travelPosts.find((post) => post.id === activePostId) ?? null
  const displayedPosts = useMemo(
    () => getTravelPostsInRouteOrder(travelPosts),
    [travelPosts],
  )
  const displayedPostIds = useMemo(
    () => displayedPosts.map((post) => post.id),
    [displayedPosts],
  )
  const draftCount = useMemo(
    () => displayedPosts.filter((post) => post.isDraft).length,
    [displayedPosts],
  )
  const newPosts = useMemo(
    () => displayedPosts.filter((post) => newPostIds.has(post.id)),
    [displayedPosts, newPostIds],
  )
  const [viewedPostId, setViewedPostId] = useState<string | null>(null)
  const firstPostId = displayedPostIds[0] ?? null
  const desktopPostElementsRef = useRef(new Map<string, HTMLElement>())
  const mobilePostElementsRef = useRef(new Map<string, HTMLElement>())
  const mobileCarouselRef = useRef<HTMLDivElement | null>(null)
  const mobileReturnPostIdRef = useRef<string | null>(null)
  const lastRecordedPostIdRef = useRef<string | null>(null)
  const suppressScrollFocusRef = useRef(false)
  const handleScrollFocusedPostChange = useCallback(
    (postId: string | null) => {
      if (!suppressScrollFocusRef.current) {
        onFocusedPostChange(postId)
      }
    },
    [onFocusedPostChange],
  )
  const handleViewedPostChange = useCallback(
    (postId: string) => {
      setViewedPostId(postId)
      if (showMobileMap) {
        onFocusedPostChange(postId)
      }
      if (lastRecordedPostIdRef.current === postId) {
        return
      }

      lastRecordedPostIdRef.current = postId
      onViewedPostChange(postId)
    },
    [onFocusedPostChange, onViewedPostChange, showMobileMap],
  )
  const jumpToNextNewPost = useCallback(() => {
    const viewedPostIndex = viewedPostId
      ? displayedPostIds.indexOf(viewedPostId)
      : -1
    const nextPost =
      displayedPosts.find(
        (post, index) => index > viewedPostIndex && newPostIds.has(post.id),
      ) ?? newPosts[0]

    if (nextPost) {
      onPostMarkerSelect(nextPost.id)
    }
  }, [
    displayedPostIds,
    displayedPosts,
    newPostIds,
    newPosts,
    onPostMarkerSelect,
    viewedPostId,
  ])

  usePostScrollFocus({
    axis: 'y',
    enabled: !showMobileMap,
    firstPostId,
    onFocusedPostChange: handleScrollFocusedPostChange,
    onViewedPostChange: handleViewedPostChange,
    postElementsRef: desktopPostElementsRef,
    postIds: displayedPostIds,
    rootRef: scrollRootRef,
  })
  usePostScrollFocus({
    axis: 'x',
    enabled: showMobileMap && !activePost,
    firstPostId,
    keepFirstPostFocused: true,
    onFocusedPostChange: handleScrollFocusedPostChange,
    onViewedPostChange: handleViewedPostChange,
    postElementsRef: mobilePostElementsRef,
    postIds: displayedPostIds,
    rootRef: mobileCarouselRef,
  })

  useEffect(() => {
    if (!scrollRequest) {
      return undefined
    }

    const postElementsRef = showMobileMap
      ? mobilePostElementsRef
      : desktopPostElementsRef
    const scrollRoot = showMobileMap
      ? mobileCarouselRef.current
      : scrollRootRef.current
    const postElement = postElementsRef.current.get(scrollRequest.postId)
    if (!postElement || !scrollRoot) {
      return undefined
    }

    suppressScrollFocusRef.current = true
    scrollPostElementIntoView({
      axis: showMobileMap ? 'x' : 'y',
      behavior: 'smooth',
      element: postElement,
      rootElement: scrollRoot,
    })

    const releaseTimeout = window.setTimeout(() => {
      suppressScrollFocusRef.current = false
    }, 1_000)

    return () => {
      window.clearTimeout(releaseTimeout)
      suppressScrollFocusRef.current = false
    }
  }, [scrollRequest, scrollRootRef, showMobileMap])

  const closeMobilePostDetail = useCallback(() => {
    if (!activePostId) {
      return
    }

    if (window.history.state?.openVoyageMobilePostId === activePostId) {
      window.history.back()
      return
    }

    mobileReturnPostIdRef.current = activePostId
    setActivePostId(null)
  }, [activePostId])

  const openMobilePostDetail = useCallback(
    (post: TravelPost) => {
      setPostEntryDirection(0)
      setRestoreFullscreenMap(false)
      onFocusedPostChange(getMapFocusedPostId(post.id, travelPosts))
      window.history.pushState(
        { ...window.history.state, openVoyageMobilePostId: post.id },
        '',
      )
      setActivePostId(post.id)
    },
    [onFocusedPostChange, travelPosts],
  )

  function moveMobilePost(direction: -1 | 1) {
    const index = displayedPosts.findIndex((post) => post.id === activePostId)
    const next = displayedPosts[index + direction]
    if (index < 0 || !next) return
    window.history.replaceState(
      { ...window.history.state, openVoyageMobilePostId: next.id }, '',
    )
    onFocusedPostChange(getMapFocusedPostId(next.id, travelPosts))
    handleViewedPostChange(next.id)
    setPostEntryDirection(direction)
    setActivePostId(next.id)
  }

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      if (
        !activePostId ||
        event.state?.openVoyageMobilePostId === activePostId
      ) {
        return
      }

      mobileReturnPostIdRef.current = activePostId
      setActivePostId(null)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [activePostId])

  useEffect(() => {
    const postId = mobileReturnPostIdRef.current
    if (activePostId || !postId) {
      return undefined
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      const postElement = mobilePostElementsRef.current.get(postId)
      const scrollRoot = mobileCarouselRef.current
      if (postElement && scrollRoot) {
        scrollPostElementIntoView({
          axis: 'x',
          behavior: 'auto',
          element: postElement,
          rootElement: scrollRoot,
        })
      }
      mobileReturnPostIdRef.current = null
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [activePostId])

  return (
    <div
      className={cn(
        'min-w-0 lg:p-4',
        showMobileMap &&
          'relative h-full min-h-0 overflow-hidden lg:block lg:h-auto lg:overflow-visible',
      )}
    >
      {showMobileMap ? (
        <div className="relative h-full min-h-0 overflow-hidden lg:hidden">
          {activePost ? (
            <MobilePostDetailCard
              entryDirection={postEntryDirection}
              key={activePost.id}
              postIndex={displayedPosts.findIndex((post) => post.id === activePost.id)}
              postCount={displayedPosts.length}
              onPrevious={() => moveMobilePost(-1)}
              onNext={() => moveMobilePost(1)}
              onBack={closeMobilePostDetail}
              onEdit={canMutate ? () => onEditPost(activePost.id) : undefined}
              onPublish={
                canMutate && activePost.isDraft
                  ? () => onPublishPost(activePost.id)
                  : undefined
              }
              publishDisabled={isMutating}
              post={activePost}
              isNew={newPostIds.has(activePost.id)}
              accessToken={accessToken}
              currentUserId={currentUserId}
              onPostSocialSummary={onPostSocialSummary}
              shareToken={shareToken}
              tripId={tripId}
            />
          ) : (
            <>
                <MobileTravelMap
                onOpenGps={canMutate ? onOpenGps : undefined}
                onNewPost={canMutate ? onNewPost : undefined}
                tripId={tripId}
                fullscreenOnMount={restoreFullscreenMap}
                focusedPostId={focusedPostId}
                gpsPostCandidates={gpsPostCandidates}
                isTripOngoing={isTripOngoing}
                onGpsPostCandidateSelect={onGpsPostCandidateSelect}
                onPostOpen={(postId) => {
                  const post = travelPosts.find((item) => item.id === postId)
                  if (post) {
                    openMobilePostDetail(post)
                    setRestoreFullscreenMap(true)
                  }
                }}
                onPostMarkerSelect={onPostMarkerSelect}
                stops={stops}
                travelLegs={travelLegs}
                trackingGeometry={trackingGeometry}
                travelPosts={travelPosts}
              />

              {newPosts.length > 0 ? (
                <div className="pointer-events-none absolute left-3 top-[4.25rem] z-[500] flex flex-col items-start gap-2">
                  {newPosts.length > 0 ? (
                    <Button
                      className="pointer-events-auto bg-card/90 shadow-xl shadow-foreground/10 backdrop-blur"
                      onClick={jumpToNextNewPost}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {newPosts.length} new · Jump to next
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-background/80 to-transparent pb-6 pt-6">
                {displayedPosts.length === 0 ? (
                  <div className="mx-4 rounded-2xl border border-border bg-card/95 p-4 text-center shadow-sm backdrop-blur">
                    <p className="text-sm font-semibold">Your journey starts here</p>
                    <p className="mt-1 text-xs text-muted-foreground">{canMutate ? 'Add your first post to bring the map to life.' : 'Stories will appear here as the journey unfolds.'}</p>
                  </div>
                ) : null}
                <div
                  aria-label="Trip stories"
                  className="trip-mobile-post-carousel pointer-events-auto flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1"
                  ref={mobileCarouselRef}
                >
                  {displayedPosts.map((post) => (
                    <Fragment key={post.id}>
                      <TravelPostPreviewCard
                        active={focusedPostId === post.id}
                        isNew={newPostIds.has(post.id)}
                        onOpen={() => openMobilePostDetail(post)}
                        post={post}
                        postRef={(element) =>
                          setPostScrollElement(
                            mobilePostElementsRef,
                            post.id,
                            element,
                          )
                        }
                      />
                    </Fragment>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="hidden space-y-4 p-4 lg:block lg:p-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Travel posts</h2>
            <p className="text-sm text-muted-foreground">
              {displayedPosts.length} posts
              {draftCount > 0 ? ` · ${draftCount} drafts` : ''}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {newPosts.length > 0 ? (
              <Button
                onClick={jumpToNextNewPost}
                size="sm"
                type="button"
                variant="outline"
              >
                {newPosts.length} new · Jump to next
              </Button>
            ) : null}
            {canMutate ? (
              <Button onClick={onNewPost} size="sm" type="button">
                <Camera className="size-4" aria-hidden="true" />
                New post
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          {trackingGeometry.openingRoute ? (
            <PostRouteDuration
              position="before-first-post"
              route={trackingGeometry.openingRoute}
            />
          ) : null}
          {displayedPosts.map((post, index) => (
            <Fragment key={post.id}>
              <TravelPostCard
                active={focusedPostId === post.id}
                isNew={newPostIds.has(post.id)}
                onEdit={canMutate ? () => onEditPost(post.id) : undefined}
                onPublish={
                  canMutate && post.isDraft
                    ? () => onPublishPost(post.id)
                    : undefined
                }
                post={post}
                accessToken={accessToken}
                currentUserId={currentUserId}
                onPostSocialSummary={onPostSocialSummary}
                postRef={(element) =>
                  setPostScrollElement(desktopPostElementsRef, post.id, element)
                }
                publishDisabled={isMutating}
                shareToken={shareToken}
                tripId={tripId}
              />
              {index < displayedPosts.length - 1 &&
              post.routeAfter?.durationSeconds !== null &&
              post.routeAfter?.durationSeconds !== undefined ? (
                <PostRouteDuration
                  route={post.routeAfter}
                />
              ) : null}
              {index === displayedPosts.length - 1 &&
              post.routeAfter?.durationSeconds === null ? (
                <PostRouteDuration position="after-last-post" route={post.routeAfter} />
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

function PostAuthor({
  author,
}: {
  author: TravelPost['author']
}) {
  return (
    <div
      aria-label={`Posted by ${author.displayName}`}
      className="inline-flex min-w-0 items-center gap-1.5"
    >
      <MediaImage
        alt=""
        className="size-5 shrink-0 rounded-full"
        fallback={(
          <span className="text-[0.5rem] font-semibold leading-none">
            {author.initials}
          </span>
        )}
        media={author.profilePicture}
      />
      <span className="max-w-32 truncate font-medium text-foreground/80">
        {author.displayName}
      </span>
    </div>
  )
}

export function TravelPostCard({
  accessToken,
  currentUserId,
  active = false,
  isNew = false,
  onEdit,
  onPublish,
  onPostSocialSummary,
  post,
  postRef,
  publishDisabled = false,
  shareToken,
  tripId,
}: {
  accessToken?: string | null
  currentUserId: string | null
  active?: boolean
  isNew?: boolean
  onEdit?: () => void
  onPublish?: () => void
  onPostSocialSummary: (postId: string, social: PostSocialSummary) => void
  post: TravelPost
  postRef?: (element: HTMLElement | null) => void
  publishDisabled?: boolean
  shareToken?: string | null
  tripId: string
}) {
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null)

  return (
    <article
      className={cn(
        'min-w-0 overflow-hidden rounded-[1.5rem] border shadow-sm shadow-foreground/5 transition-colors',
        post.isDraft
          ? active
            ? 'border-primary/55 bg-primary/5'
            : 'border-primary/45 bg-primary/5'
          : active
            ? 'border-primary/55 bg-muted/45'
            : 'border-border bg-muted/45',
      )}
      ref={postRef}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold leading-6 text-foreground">
                {post.title}
              </h3>
              {isNew ? <Badge variant="secondary">New</Badge> : null}
              {post.isDraft ? <Badge>Draft</Badge> : null}
            </div>
            {post.isDraft ? (
              <p className="mt-1 text-xs font-medium text-primary">
                Only trip members can see this draft.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onPublish ? (
              <Button
                disabled={publishDisabled}
                onClick={onPublish}
                size="sm"
                type="button"
              >
                <Send className="size-3.5" aria-hidden="true" />
                Publish
              </Button>
            ) : null}
            {onEdit ? (
              <Button
                aria-label={`Edit ${post.title}`}
                className="size-8 rounded-xl"
                onClick={onEdit}
                size="icon"
                title={`Edit ${post.title}`}
                type="button"
                variant="outline"
              >
                <PenLine className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {post.excerpt}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <PostAuthor author={post.author} />
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5" aria-hidden="true" />
            {post.location}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            {post.time}
          </span>
        </div>
      </div>

      <div className="trip-post-media-strip scrollbar-subtle flex min-w-0 max-w-full gap-3 overflow-x-auto overscroll-x-contain px-4 pb-3">
        {post.media.map((media, index) => (
          <MediaStripCard
            key={media.src}
            media={media}
            onOpen={() => setActiveMediaIndex(index)}
          />
        ))}
      </div>

      <div className="px-4 pb-4">
        <PostSocialControls
          accessToken={accessToken}
          currentUserId={currentUserId}
          onSummary={onPostSocialSummary}
          post={post}
          shareToken={shareToken}
          tripId={tripId}
        />
      </div>

      {activeMediaIndex !== null ? (
        <MediaLightbox
          activeIndex={activeMediaIndex}
          media={post.media}
          onClose={() => setActiveMediaIndex(null)}
          onIndexChange={setActiveMediaIndex}
          title={post.title}
        />
      ) : null}
    </article>
  )
}

function PostSocialControls({
  accessToken,
  currentUserId,
  onSummary,
  post,
  shareToken,
  tripId,
}: {
  accessToken?: string | null
  currentUserId: string | null
  onSummary: (postId: string, social: PostSocialSummary) => void
  post: TravelPost
  shareToken?: string | null
  tripId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [comments, setComments] = useState<PostComment[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<PostComment | null>(null)
  const [commentMediaId, setCommentMediaId] = useState<string | null>(null)
  const [commentMediaFile, setCommentMediaFile] = useState<File | null>(null)
  const [commentMediaName, setCommentMediaName] = useState<string | null>(null)
  const [commentMediaPreviewUrl, setCommentMediaPreviewUrl] = useState<string | null>(null)
  const [activeCommentMedia, setActiveCommentMedia] = useState<PostComment['media']>(null)
  const [deleteTarget, setDeleteTarget] = useState<PostComment | null>(null)
  const [deletedCommentIds, setDeletedCommentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [deleteCommentError, setDeleteCommentError] = useState<string | null>(null)
  const [isDeletingComment, setDeletingComment] = useState(false)
  const [isUploadingMedia, setUploadingMedia] = useState(false)
  const [isLoading, setLoading] = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isNameModalOpen, setNameModalOpen] = useState(false)
  const [sharedName, setSharedName] = useState('')
  const canAttemptInteraction = Boolean(accessToken || shareToken)
  const isOwnPost = currentUserId === post.author.id
  const selfLikeHelpId = `post-${post.id}-self-like-help`
  const commentMediaInputRef = useRef<HTMLInputElement>(null)
  const deletedCommentIdsRef = useRef(new Set<string>())

  useEffect(() => () => {
    if (commentMediaPreviewUrl) URL.revokeObjectURL(commentMediaPreviewUrl)
  }, [commentMediaPreviewUrl])

  const loadComments = useCallback(
    async (cursor?: string | null) => {
      setLoading(true)
      setError(null)
      try {
        const page = await listPostComments({
          accessToken,
          cursor,
          pageSize: 4,
          postId: post.id,
          shareToken,
          tripId,
        })
        let pageItems = page.items
        for (const commentId of deletedCommentIdsRef.current) {
          pageItems = removeCommentTree(pageItems, commentId)
        }
        setComments((current) =>
          cursor
            ? [...current, ...pageItems.filter((item) => !current.some((known) => known.id === item.id))]
            : pageItems,
        )
        setNextCursor(page.next_cursor)
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Unable to load comments.')
      } finally {
        setLoading(false)
      }
    },
    [accessToken, post.id, shareToken, tripId],
  )

  const ensureShareName = useCallback(async () => {
    if (!shareToken || accessToken) return false
    const profile = await getShareLinkProfile({ shareToken, tripId })
    if (profile.display_name) return true
    if (profile.display_name_locked) return false
    setSharedName('')
    setNameModalOpen(true)
    return false
  }, [accessToken, shareToken, tripId])

  async function saveSharedName() {
    if (!shareToken || !sharedName.trim()) return
    setSubmitting(true)
    try {
      await updateShareLinkDisplayName({ displayName: sharedName.trim(), shareToken, tripId })
      setNameModalOpen(false)
      setError('Shared name saved. Try your like or comment again.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save shared name.')
    } finally {
      setSubmitting(false)
    }
  }

  async function runInteraction(action: () => Promise<PostSocialSummary>) {
    setError(null)
    try {
      onSummary(post.id, await action())
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 428 && await ensureShareName()) {
        onSummary(post.id, await action())
        return
      }
      setError(failure instanceof Error ? failure.message : 'Unable to update reaction.')
    }
  }

  function toggleComments() {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (nextExpanded && comments.length === 0) void loadComments()
  }

  function appendComment(current: PostComment[], comment: PostComment): PostComment[] {
    if (!comment.parent_comment_id) return [...current, comment]
    return current.map((item) => item.id === comment.parent_comment_id
      ? { ...item, replies: [...(item.replies ?? []), comment], reply_count: (item.replies?.length ?? 0) + 1 }
      : { ...item, replies: appendComment(item.replies ?? [], comment) })
  }

  function updateComment(current: PostComment[], commentId: string, update: (comment: PostComment) => PostComment): PostComment[] {
    return current.map((item) => item.id === commentId
      ? update(item)
      : { ...item, replies: updateComment(item.replies ?? [], commentId, update) })
  }

  function clearCommentImage() {
    setCommentMediaFile(null)
    setCommentMediaId(null)
    setCommentMediaName(null)
    setCommentMediaPreviewUrl(null)
    if (commentMediaInputRef.current) commentMediaInputRef.current.value = ''
  }

  function selectCommentImage(file: File | undefined) {
    if (!file) return
    if (file.type && !file.type.startsWith('image/')) {
      setError('Please select an image file.')
      return
    }
    setCommentMediaId(null)
    setCommentMediaFile(file)
    setCommentMediaName(file.name)
    setCommentMediaPreviewUrl(URL.createObjectURL(file))
    setError(null)
  }

  async function submitComment() {
    const normalizedBody = body.trim()
    if ((!normalizedBody && !commentMediaFile && !commentMediaId) || normalizedBody.length > 2000) return
    setSubmitting(true)
    setError(null)
    const submit = (mediaId: string | null) => createPostComment({
      accessToken,
      payload: {
        body: normalizedBody || null,
        media_id: mediaId,
        parent_comment_id: replyTo?.id ?? null,
      },
      postId: post.id,
      shareToken,
      tripId,
    })
    let mediaId = commentMediaId
    try {
      if (commentMediaFile) {
        if (!accessToken) return
        setUploadingMedia(true)
        mediaId = await uploadMedia(commentMediaFile, accessToken)
        setCommentMediaId(mediaId)
        setUploadingMedia(false)
      }
      const comment = await submit(mediaId)
      setComments((current) => appendComment(current, comment))
      setBody('')
      setReplyTo(null)
      clearCommentImage()
      onSummary(post.id, {
        can_interact: post.social.canInteract,
        can_like: post.social.canLike,
        comment_count: post.social.commentCount + 1,
        like_count: post.social.likeCount,
        viewer_has_liked: post.social.viewerHasLiked,
      })
    } catch (failure) {
      let commentFailure = failure
      try {
        if (commentFailure instanceof ApiError && commentFailure.status === 428 && await ensureShareName()) {
          const comment = await submit(mediaId)
          setComments((current) => appendComment(current, comment))
          setBody('')
          setReplyTo(null)
          clearCommentImage()
          return
        }
      } catch (retryFailure) {
        commentFailure = retryFailure
      }
      setError(commentFailure instanceof Error ? commentFailure.message : 'Unable to post comment.')
    } finally {
      setSubmitting(false)
      setUploadingMedia(false)
    }
  }

  function requestCommentDeletion(comment: PostComment) {
    setDeleteCommentError(null)
    setDeleteTarget(comment)
  }

  async function confirmCommentDeletion() {
    if (!deleteTarget || isDeletingComment) return
    const commentId = deleteTarget.id
    const removeDeletedComment = () => {
      deletedCommentIdsRef.current.add(commentId)
      setDeletedCommentIds((current) => {
        const next = new Set(current)
        next.add(commentId)
        return next
      })
      setComments((current) => removeCommentTree(current, commentId))
      setDeleteTarget(null)
    }
    setDeletingComment(true)
    setDeleteCommentError(null)
    try {
      const result = await deletePostComment({
        accessToken,
        commentId,
        postId: post.id,
        shareToken,
        tripId,
      })
      removeDeletedComment()
      onSummary(post.id, result.social)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) {
        removeDeletedComment()
        return
      }
      try {
        let cursor: string | null = null
        let commentStillExists = false
        do {
          const page = await listPostComments({
            accessToken,
            cursor,
            pageSize: 100,
            postId: post.id,
            shareToken,
            tripId,
          })
          commentStillExists = page.items.some((comment) => commentTreeContains(comment, commentId))
          cursor = page.next_cursor
        } while (!commentStillExists && cursor)
        if (!commentStillExists) {
          removeDeletedComment()
          return
        }
      } catch {
        setDeleteCommentError(failure instanceof Error ? failure.message : 'Unable to delete comment.')
        return
      }
      setDeleteCommentError(failure instanceof Error ? failure.message : 'Unable to delete comment.')
    } finally {
      setDeletingComment(false)
    }
  }

  async function toggleCommentLike(comment: PostComment) {
    setError(null)
    try {
      const summary = await (comment.viewer_has_liked
        ? unlikePostComment({ accessToken, commentId: comment.id, postId: post.id, shareToken, tripId })
        : likePostComment({ accessToken, commentId: comment.id, postId: post.id, shareToken, tripId }))
      setComments((current) => updateComment(current, comment.id, (item) => ({
        ...item,
        can_like: summary.can_like,
        like_count: summary.like_count,
        viewer_has_liked: summary.viewer_has_liked,
      })))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to update comment like.')
    }
  }

  function renderComposer() {
    const canSubmit = !isSubmitting && !isUploadingMedia && (Boolean(body.trim()) || Boolean(commentMediaFile) || Boolean(commentMediaId))
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2" data-comment-composer>
        {replyTo ? <p className="text-xs text-muted-foreground">Replying to {replyTo.author.type === 'user' ? replyTo.author.user.username || 'this reader' : replyTo.author.display_name}</p> : null}
        <textarea className="min-h-20 w-full rounded-xl border border-input bg-background p-2 text-sm" maxLength={2000} onChange={(event) => setBody(event.target.value)} placeholder={replyTo ? 'Write a reply' : 'Write a comment'} value={body} />
        {commentMediaPreviewUrl ? (
          <div className="relative w-fit max-w-full overflow-hidden rounded-xl border border-border bg-secondary">
            <img alt={`Preview of ${commentMediaName ?? 'selected image'}`} className="max-h-56 max-w-full object-contain" src={commentMediaPreviewUrl} />
            <button aria-label="Remove selected image" className="absolute right-2 top-2 rounded-full bg-slate-950/70 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-slate-950/85" onClick={clearCommentImage} type="button">Remove</button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {accessToken ? (
            <>
              <Button disabled={isUploadingMedia} onClick={() => commentMediaInputRef.current?.click()} size="sm" type="button" variant="outline"><ImagePlus className="size-3.5" aria-hidden="true" />{commentMediaFile ? 'Replace image' : 'Select image'}</Button>
              <input accept="image/*" className="hidden" disabled={isUploadingMedia} onChange={(event) => selectCommentImage(event.target.files?.[0])} ref={commentMediaInputRef} tabIndex={-1} type="file" />
            </>
          ) : null}
          {isUploadingMedia ? <span className="text-xs text-muted-foreground">Uploading image…</span> : null}
          {commentMediaName ? <span className="max-w-full truncate text-xs text-muted-foreground">{commentMediaName}</span> : null}
          <Button disabled={!canSubmit || (!post.social.canInteract && !shareToken)} onClick={() => void submitComment()} size="sm" type="button">{replyTo ? 'Reply' : 'Comment'}</Button>
          {replyTo ? <Button onClick={() => { setReplyTo(null); setBody(''); clearCommentImage() }} size="sm" type="button" variant="ghost">Cancel</Button> : null}
        </div>
      </div>
    )
  }

  function renderComment(comment: PostComment, depth = 0) {
    if (deletedCommentIds.has(comment.id)) return null
    const isReply = depth > 0
    return (
      <div className="relative min-w-0" key={comment.id}>
        {isReply ? <span aria-hidden="true" className="absolute -left-3 top-5 h-px w-3 bg-border sm:-left-4 sm:w-4" /> : null}
        <div className={cn(
          'rounded-xl border p-3 text-sm',
          isReply
            ? 'border-border/70 bg-muted/25'
            : 'border-border/80 bg-background shadow-sm',
        )} data-comment-card data-comment-depth={depth}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {comment.author.type === 'user' && comment.author.user.profile_picture ? (
                <img alt="" className="size-8 shrink-0 rounded-full object-cover" src={comment.author.user.profile_picture.urls.thumbnail ?? comment.author.user.profile_picture.urls.content} />
              ) : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-primary">{comment.author.type === 'user' ? getCommentInitials(comment.author.user.first_name, comment.author.user.last_name, comment.author.user.username) : comment.author.display_name.slice(0, 1).toUpperCase()}</span>}
              <div className="min-w-0"><div className="flex min-w-0 items-center gap-1"><p className="truncate font-semibold text-foreground">{comment.author.type === 'user' ? [comment.author.user.first_name, comment.author.user.last_name].filter(Boolean).join(' ') || comment.author.user.username || 'User' : comment.author.display_name}</p>{comment.authored_by_viewer ? <Badge>You</Badge> : null}</div><p className="text-xs text-muted-foreground">{formatCommentAge(comment.created_at)}</p></div>
            </div>
            {comment.can_delete ? <Button aria-label="Delete comment" className="size-7" onClick={() => requestCommentDeletion(comment)} size="icon" type="button" variant="ghost"><Trash2 className="size-3.5" /></Button> : null}
          </div>
          {comment.body ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{comment.body}</p> : null}
          {comment.media ? <button aria-label="Open attached comment image" className="mt-2 block max-w-sm overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setActiveCommentMedia(comment.media)} type="button"><MediaImage alt="Attached comment image" className="max-h-64 w-full" media={comment.media} /></button> : null}
          <div className="mt-2 flex items-center gap-2">
            {!comment.authored_by_viewer && (comment.can_like || comment.viewer_has_liked) ? <Button aria-label={comment.viewer_has_liked ? 'Unlike comment' : 'Like comment'} aria-pressed={comment.viewer_has_liked} className="h-7 px-2" disabled={isSubmitting} onClick={() => void toggleCommentLike(comment)} size="sm" type="button" variant={comment.viewer_has_liked ? 'default' : 'outline'}><Heart className={cn('size-3', comment.viewer_has_liked && 'fill-current')} aria-hidden="true" />{comment.like_count}</Button> : <span className="text-xs text-muted-foreground">{comment.like_count} likes</span>}
            {comment.can_reply ? <Button className="h-7 px-2" data-comment-reply-action onClick={() => { setReplyTo(comment); setBody(''); clearCommentImage() }} size="sm" type="button" variant="ghost">Reply</Button> : null}
          </div>
          {replyTo?.id === comment.id ? renderComposer() : null}
        </div>
        {(comment.replies?.length ?? 0) > 0 ? (
          <div className="ml-3 mt-2 space-y-2 border-l border-border/80 pl-3 sm:ml-4 sm:pl-4">
            {comment.replies?.map((reply) => renderComment(reply, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  if (post.isDraft) return null

  return (
    <section className="border-t border-border pt-3" aria-label="Post interactions">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex"
          title={isOwnPost ? 'You cannot like your own post.' : undefined}
        >
          <Button
            aria-describedby={isOwnPost ? selfLikeHelpId : undefined}
            aria-pressed={post.social.viewerHasLiked}
            disabled={isSubmitting || !post.social.canLike}
            onClick={() => void runInteraction(() => post.social.viewerHasLiked
              ? unlikePost({ accessToken, postId: post.id, shareToken, tripId })
              : likePost({ accessToken, postId: post.id, shareToken, tripId }))}
            size="sm"
            type="button"
            variant={post.social.viewerHasLiked ? 'default' : 'outline'}
          >
            <Heart className={cn('size-3.5', post.social.viewerHasLiked && 'fill-current')} aria-hidden="true" />
            {post.social.likeCount}
          </Button>
        </span>
        {isOwnPost ? (
          <span className="sr-only" id={selfLikeHelpId}>
            You cannot like your own post.
          </span>
        ) : null}
        <Button aria-expanded={expanded} onClick={toggleComments} size="sm" type="button" variant="outline">
          <MessageCircle className="size-3.5" aria-hidden="true" />
          {post.social.commentCount} comments
        </Button>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-3">
          {comments.map((comment) => renderComment(comment))}
          {nextCursor ? <Button disabled={isLoading} onClick={() => void loadComments(nextCursor)} size="sm" type="button" variant="outline">Load more comments</Button> : null}
          {isLoading ? <p className="text-xs text-muted-foreground">Loading comments…</p> : null}
          {canAttemptInteraction && !replyTo ? renderComposer() : null}
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
      ) : null}
      {activeCommentMedia ? (
        <MediaLightbox
          activeIndex={0}
          media={[{
            alt: 'Attached comment image',
            media_id: activeCommentMedia.id,
            src: activeCommentMedia.urls.content,
            thumbnail: activeCommentMedia.urls.thumbnail ?? undefined,
            type: 'image',
          }]}
          onClose={() => setActiveCommentMedia(null)}
          onIndexChange={() => undefined}
          title="Comment image"
        />
      ) : null}
      <Modal
        bottomSheetOnMobile
        className="sm:max-w-md"
        description={deleteTarget?.reply_count
          ? 'This permanently deletes the comment and every reply beneath it, including replies written by other people.'
          : 'This permanently deletes the comment. This action cannot be undone.'}
        dismissible={!isDeletingComment}
        onClose={() => {
          if (!isDeletingComment) setDeleteTarget(null)
        }}
        open={deleteTarget !== null}
        title="Delete comment?"
      >
        <div className="space-y-5 p-1">
          {deleteTarget?.body ? (
            <p className="line-clamp-4 rounded-xl bg-muted px-4 py-3 text-sm text-foreground">
              {deleteTarget.body}
            </p>
          ) : null}
          {deleteCommentError ? <p className="text-sm text-destructive" role="alert">{deleteCommentError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button disabled={isDeletingComment} onClick={() => setDeleteTarget(null)} type="button" variant="ghost">Cancel</Button>
            <Button disabled={isDeletingComment} onClick={() => void confirmCommentDeletion()} type="button" variant="destructive"><Trash2 className="size-4" aria-hidden="true" />{isDeletingComment ? 'Deleting…' : 'Delete comment'}</Button>
          </div>
        </div>
      </Modal>
      <Modal
        description="This name belongs to the shared link: every holder uses it, any holder may change it while unlocked, and earlier comments are relabeled."
        onClose={() => setNameModalOpen(false)}
        open={isNameModalOpen}
        title="Choose a shared name"
      >
        <div className="space-y-4 p-1">
          <input autoFocus className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm" maxLength={80} onChange={(event) => setSharedName(event.target.value)} placeholder="The trail crew" value={sharedName} />
          <div className="flex justify-end gap-2"><Button onClick={() => setNameModalOpen(false)} type="button" variant="outline">Cancel</Button><Button disabled={isSubmitting || !sharedName.trim()} onClick={() => void saveSharedName()} type="button">Save name</Button></div>
        </div>
      </Modal>
    </section>
  )
}

function removeCommentTree(current: PostComment[], commentId: string): PostComment[] {
  return current
    .filter((item) => item.id !== commentId)
    .map((item) => {
      const replies = removeCommentTree(item.replies ?? [], commentId)
      return replies.length === (item.replies?.length ?? 0)
        ? item
        : { ...item, replies, reply_count: replies.length }
    })
}

function commentTreeContains(comment: PostComment, commentId: string): boolean {
  return comment.id === commentId
    || (comment.replies ?? []).some((reply) => commentTreeContains(reply, commentId))
}

function formatCommentAge(value: string) {
  const date = new Date(value)
  const differenceMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000))
  if (differenceMinutes < 60) return `${differenceMinutes} ${differenceMinutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(differenceMinutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days <= 3) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function getCommentInitials(firstName: string | null, lastName: string | null, username: string | null) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.trim() || username?.slice(0, 1).toUpperCase() || '?'
}

function PostRouteDuration({
  position = 'between-posts',
  route,
}: {
  position?: 'after-last-post' | 'before-first-post' | 'between-posts'
  route: TravelPostRoute
}) {
  const label = formatPostRouteDuration(route.durationSeconds ?? 0)
  const travelMode = getPostRouteTravelMode(route)
  const ModeIcon = getTravelModeIcon(travelMode)
  const copy =
    position === 'before-first-post'
      ? {
          ariaLabel: 'The journey begins',
          text: 'The journey begins',
        }
      : position === 'after-last-post'
        ? {
            ariaLabel: 'The journey continues',
            text: 'The journey continues',
          }
        : {
            ariaLabel: `Traveled for ${label} until the next post`,
            text: 'Traveled for',
          }

  return (
    <div className="grid grid-cols-[3.25rem_1fr] gap-3 px-1 py-0.5">
      <div className="flex justify-center" aria-hidden="true">
        <div className="flex w-0 flex-col items-center">
          <span className="h-2 w-px bg-border" />
          <span className="grid size-8 shrink-0 place-items-center rounded-2xl border border-border bg-card text-primary shadow-sm">
            <ModeIcon className="size-4" />
          </span>
          <span className="h-2 w-px bg-border" />
        </div>
      </div>
      <div
        aria-label={copy.ariaLabel}
        className="flex min-h-10 items-center gap-2 rounded-[1.1rem] border border-border bg-card/85 px-3 py-2 text-sm shadow-sm"
      >
        <span className="text-muted-foreground">{copy.text}</span>
        {position === 'between-posts' ? (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
            <Clock className="size-3" aria-hidden="true" />
            {label}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function TravelPostPreviewCard({
  active = false,
  isNew = false,
  onOpen,
  post,
  postRef,
}: {
  active?: boolean
  isNew?: boolean
  onOpen: () => void
  post: TravelPost
  postRef?: (element: HTMLElement | null) => void
}) {
  const primaryMedia = getPrimaryPostMedia(post)
  const isVideo = getMediaType(primaryMedia) === 'video'

  return (
    <article
      className={cn(
        'trip-mobile-post-carousel__card shrink-0 snap-center overflow-hidden rounded-2xl border bg-card shadow-lg shadow-foreground/10 transition-colors',
        post.isDraft
          ? active
            ? 'border-primary/55'
            : 'border-primary/45'
          : active
            ? 'border-primary/55'
            : 'border-border',
      )}
      ref={postRef}
    >
      <button
        aria-label={`Open ${post.title}`}
        className="flex w-full items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
        type="button"
      >
        <div className="relative m-2 size-20 shrink-0 overflow-hidden rounded-xl bg-secondary">
          <MediaPreview
            className="size-full object-cover"
            media={primaryMedia}
            source="thumbnail"
          />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          {isNew || post.isDraft ? (
            <span className="absolute left-2 top-2 flex gap-1.5">
              {isNew ? (
                <Badge className="shadow-sm" variant="secondary">New</Badge>
              ) : null}
              {post.isDraft ? <Badge className="shadow-sm">Draft</Badge> : null}
            </span>
          ) : null}
          {isVideo ? (
            <span className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid size-11 place-items-center rounded-full bg-card/90 text-primary shadow-lg shadow-black/15">
                <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
              </span>
            </span>
          ) : null}
        </div>

        <div className="min-w-0 space-y-1.5 py-3 pl-1 pr-3">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
            {post.title}
          </h3>
          <div className="space-y-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{post.location}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden="true" />
              {post.time}
            </span>
          </div>
        </div>
      </button>
    </article>
  )
}

function MobilePostDetailCard({
  entryDirection,
  postIndex,
  postCount,
  onPrevious,
  onNext,
  accessToken,
  currentUserId,
  isNew = false,
  onBack,
  onEdit,
  onPublish,
  onPostSocialSummary,
  post,
  publishDisabled = false,
  shareToken,
  tripId,
}: {
  entryDirection: -1 | 0 | 1
  postIndex: number
  postCount: number
  onPrevious: () => void
  onNext: () => void
  accessToken?: string | null
  currentUserId: string | null
  isNew?: boolean
  onBack: () => void
  onEdit?: () => void
  onPublish?: () => void
  onPostSocialSummary: (postId: string, social: PostSocialSummary) => void
  post: TravelPost
  publishDisabled?: boolean
  shareToken?: string | null
  tripId: string
}) {
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [isPublishConfirmationOpen, setPublishConfirmationOpen] = useState(false)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const navigatePost = usePostSwipe({
    readerRef,
    entryDirection,
    blocked: activeMediaIndex !== null || isActionMenuOpen || isPublishConfirmationOpen,
    canPrevious: postIndex > 0,
    canNext: postIndex < postCount - 1,
    onPrevious,
    onNext,
  })
  const { activeSession } = useTracking()

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    readerRef.current?.focus({ preventScroll: true })
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  useEffect(() => {
    if (!isActionMenuOpen) {
      return undefined
    }

    function handlePointerDown(event: PointerEvent) {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setIsActionMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsActionMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActionMenuOpen])

  return (
    <article aria-label="Post reader" className="mobile-post-reader fixed inset-0 z-40 flex flex-col bg-card lg:hidden">
      <div className="shrink-0 border-b border-border bg-card pt-[var(--app-safe-area-inset-top)]">
        <div className="flex h-14 min-w-0 items-center gap-1 px-2">
          <Button
            aria-label="Back to map"
            className="h-11 shrink-0 gap-1 rounded-xl px-2"
            onClick={onBack}
            size="sm"
            title="Back"
            type="button"
            variant="ghost"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>Back</span>
            {activeSession ? <span role="img" aria-label={activeSession.endedAt ? 'GPS recording syncing' : 'GPS recording active'} className={cn('size-2 rounded-full', activeSession.endedAt ? 'bg-amber-500' : 'bg-destructive')} /> : null}
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <Button aria-label="Previous post" className="size-11 shrink-0" size="icon" variant="ghost" disabled={postIndex <= 0} onClick={() => navigatePost(-1)}><ChevronLeft className="size-5" aria-hidden="true" /></Button>
            <span className="whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">Post {postIndex + 1} of {postCount}</span>
            <Button aria-label="Next post" className="size-11 shrink-0" size="icon" variant="ghost" disabled={postIndex >= postCount - 1} onClick={() => navigatePost(1)}><ChevronRight className="size-5" aria-hidden="true" /></Button>
          </div>
          {onPublish || onEdit ? (
            <div className="relative shrink-0" ref={actionMenuRef}>
              <Button
                aria-controls={`post-actions-${post.id}`}
                aria-expanded={isActionMenuOpen}
                aria-haspopup="menu"
                aria-label={`Actions for ${post.title}`}
                className="size-11 rounded-2xl"
                onClick={() => setIsActionMenuOpen((open) => !open)}
                size="icon"
                title="Post actions"
                type="button"
                variant="ghost"
              >
                <EllipsisVertical className="size-4" aria-hidden="true" />
              </Button>
              {isActionMenuOpen ? (
                <div
                  className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-lg"
                  id={`post-actions-${post.id}`}
                  role="menu"
                >
                  {onEdit ? (
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        setIsActionMenuOpen(false)
                        onEdit()
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <PenLine className="size-4" aria-hidden="true" />
                      Edit {post.isDraft ? 'draft' : 'post'}
                    </button>
                  ) : null}
                  {onPublish ? (
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={publishDisabled}
                      onClick={() => {
                        setIsActionMenuOpen(false)
                        setPublishConfirmationOpen(true)
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Send className="size-4" aria-hidden="true" />
                      Publish draft
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mobile-post-swipe-stage relative min-h-0 flex-1 overflow-hidden bg-muted/50">
        {postIndex > 0 ? (
          <div aria-hidden="true" className="mobile-post-swipe-hint mobile-post-swipe-hint--previous pointer-events-none absolute inset-y-0 left-3 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <ChevronLeft className="size-5" />Previous post
          </div>
        ) : null}
        {postIndex < postCount - 1 ? (
          <div aria-hidden="true" className="mobile-post-swipe-hint mobile-post-swipe-hint--next pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            Next post<ChevronRight className="size-5" />
          </div>
        ) : null}
      <div
        aria-label={`Reading ${post.title}`}
        className="scrollbar-subtle relative h-full min-h-0 bg-card [touch-action:pan-y_pinch-zoom] overflow-y-auto overscroll-y-contain px-5 py-6 pb-[max(1.5rem,var(--app-safe-area-inset-bottom))] outline-none"
        data-pull-to-refresh-scroll-root
        ref={readerRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'ArrowLeft' && postIndex > 0) { event.preventDefault(); navigatePost(-1) }
          if (event.key === 'ArrowRight' && postIndex < postCount - 1) { event.preventDefault(); navigatePost(1) }
        }}
      >
        <div className="mx-auto max-w-2xl space-y-5">
        <div className="space-y-3">
          {isNew || post.isDraft ? <div className="flex flex-wrap items-center gap-2">
            {isNew ? <Badge variant="secondary">New</Badge> : null}
            {post.isDraft ? <Badge>Draft</Badge> : null}
          </div> : null}
          <h2 className="text-2xl font-semibold leading-tight">{post.title}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <PostAuthor author={post.author} />
            <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" aria-hidden="true" />{post.location}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" aria-hidden="true" />{post.time}</span>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {post.excerpt}
        </p>

        <MobilePostMediaGallery
          media={post.media}
          onOpen={setActiveMediaIndex}
        />

        <PostSocialControls
          accessToken={accessToken}
          currentUserId={currentUserId}
          onSummary={onPostSocialSummary}
          post={post}
          shareToken={shareToken}
          tripId={tripId}
        />
        </div>
      </div>

      </div>

      {activeMediaIndex !== null ? (
        <MediaLightbox
          activeIndex={activeMediaIndex}
          media={post.media}
          onClose={() => setActiveMediaIndex(null)}
          onIndexChange={setActiveMediaIndex}
          title={post.title}
        />
      ) : null}

      <Modal
        description="This will make the draft visible to everyone who can view this trip."
        onClose={() => setPublishConfirmationOpen(false)}
        open={isPublishConfirmationOpen}
        title="Publish draft?"
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={publishDisabled}
            onClick={() => setPublishConfirmationOpen(false)}
            type="button"
            variant="outline"
          >
            Keep editing
          </Button>
          <Button
            disabled={publishDisabled}
            onClick={() => {
              setPublishConfirmationOpen(false)
              onPublish?.()
            }}
            type="button"
          >
            <Send className="size-4" aria-hidden="true" />
            Publish draft
          </Button>
        </div>
      </Modal>
    </article>
  )
}

function MobilePostMediaGallery({
  media,
  onOpen,
}: {
  media: readonly PostMedia[]
  onOpen: (index: number) => void
}) {
  const previewMedia = media.slice(0, 4)
  const mediaCount = media.length

  return (
    <section aria-label={`Post media: ${mediaCount} items`} data-post-gallery>
      <div
        className={cn(
          'relative grid h-56 overflow-hidden rounded-[1.35rem] border border-border bg-secondary shadow-sm sm:h-72',
          mediaCount === 1 && 'grid-cols-1',
          mediaCount === 2 && 'grid-cols-2',
          mediaCount === 3 && 'grid-cols-2 grid-rows-2',
          mediaCount >= 4 && 'grid-cols-2 grid-rows-2',
        )}
      >
        {previewMedia.map((item, index) => {
          const hasMoreMedia = index === 3 && mediaCount > 4
          const isVideo = getMediaType(item) === 'video'

          return (
            <button
              className={cn(
                'group relative min-h-0 overflow-hidden border-border bg-secondary text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                mediaCount === 3 && index === 0 && 'row-span-2 border-r',
                mediaCount === 3 && index > 0 && 'border-l',
                mediaCount === 3 && index === 2 && 'border-t',
                mediaCount >= 4 && index % 2 === 0 && 'border-r',
                mediaCount >= 4 && index >= 2 && 'border-t',
                mediaCount === 2 && index === 0 && 'border-r',
              )}
              key={item.src}
              onClick={() => onOpen(index)}
              type="button"
            >
              <MediaThumbnailPreview
                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                media={item}
              />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
              <span className="sr-only">Open {item.alt}</span>
              {isVideo && !hasMoreMedia ? (
                <span className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="grid size-10 place-items-center rounded-full bg-card/90 text-primary shadow-lg shadow-black/15">
                    <Play className="ml-0.5 size-4 fill-current" aria-hidden="true" />
                  </span>
                </span>
              ) : null}
              {hasMoreMedia ? (
                <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 text-xl font-semibold text-white">
                  +{mediaCount - previewMedia.length}
                </span>
              ) : null}
            </button>
          )
        })}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 right-2 z-10 inline-flex h-9 items-center gap-1.5 rounded-full bg-card/95 px-3 text-xs font-semibold text-primary shadow-md backdrop-blur"
        >
          <Images className="size-4" aria-hidden="true" />
          View gallery
        </span>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Tap any photo to view the full gallery
      </p>
    </section>
  )
}

function formatPostRouteDuration(durationSeconds: number) {
  const totalMinutes = Math.max(0, Math.floor(durationSeconds / 60))
  const totalHours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const parts: string[] = []

  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours > 0) parts.push(`${hours} hr`)
  if (minutes > 0 && days === 0) parts.push(`${minutes} min`)
  return parts.length > 0 ? parts.join(' ') : '0 min'
}

function getPostRouteTravelMode(route: TravelPostRoute): TravelMode {
  return (
    route.segments.find((segment) => segment.travelMode !== 'UNKNOWN')
      ?.travelMode ?? route.segments[0]?.travelMode ?? 'UNKNOWN'
  )
}
