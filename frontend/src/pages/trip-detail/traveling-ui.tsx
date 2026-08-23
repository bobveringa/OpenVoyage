import {
  ArrowLeft,
  Camera,
  Clock,
  Compass,
  MapPin,
  PenLine,
  Play,
  Send,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { GpsPostCandidate } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  setPostScrollElement,
  usePostScrollFocus,
  type PostScrollRootRef,
} from '@/pages/trip-detail/use-post-scroll-focus'

export function MobileTravelMap({
  focusedPostId,
  gpsPostCandidates,
  isTripOngoing,
  onGpsPostCandidateSelect,
  onPostMarkerSelect,
  stops,
  trackingGeometry,
  travelLegs,
  travelPosts,
}: {
  focusedPostId: string | null
  gpsPostCandidates: readonly GpsPostCandidate[]
  isTripOngoing: boolean
  onGpsPostCandidateSelect: (candidate: GpsPostCandidate) => void
  onPostMarkerSelect: (postId: string) => void
  stops: readonly Stop[]
  trackingGeometry: TripTrackingGeometry
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const [resetNonce, setResetNonce] = useState(0)

  return (
    <section className="trip-mobile-travel-map absolute inset-0 overflow-hidden bg-card lg:hidden">
      <TripLeafletMap
        draftMapLocation={null}
        fitMode="mobile-travel"
        gpsPostCandidates={gpsPostCandidates}
        isTripOngoing={isTripOngoing}
        mapPointEnabled={false}
        onDraftMapPointSelect={() => undefined}
        onGpsPostCandidateSelect={onGpsPostCandidateSelect}
        onPostMarkerSelect={onPostMarkerSelect}
        resetNonce={resetNonce}
        routeMode="travel-timeline"
        focusedPostId={focusedPostId}
        stops={stops}
        travelLegs={travelLegs}
        trackingGeometry={trackingGeometry}
        travelPosts={travelPosts}
      />

      <div className="pointer-events-none absolute right-3 top-3 z-[500]">
        <Button
          aria-label="Recenter travel map"
          className="pointer-events-auto size-10 rounded-full bg-card/90 shadow-lg shadow-foreground/10 backdrop-blur hover:bg-card"
          onClick={() => setResetNonce((current) => current + 1)}
          size="icon"
          title="Recenter"
          type="button"
          variant="outline"
        >
          <Compass className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  )
}

export function TravelingPanel({
  canMutate,
  focusedPostId,
  gpsPostCandidates,
  isTripOngoing,
  isMutating,
  onFocusedPostChange,
  onGpsPostCandidateSelect,
  onEditPost,
  onNewPost,
  onPostMarkerSelect,
  onPublishPost,
  scrollRootRef,
  scrollRequest,
  showMobileMap,
  stops,
  trackingGeometry,
  travelLegs,
  travelPosts,
}: {
  canMutate: boolean
  focusedPostId: string | null
  gpsPostCandidates: readonly GpsPostCandidate[]
  isTripOngoing: boolean
  isMutating: boolean
  onFocusedPostChange: (postId: string | null) => void
  onGpsPostCandidateSelect: (candidate: GpsPostCandidate) => void
  onEditPost: (postId: string) => void
  onNewPost: () => void
  onPostMarkerSelect: (postId: string) => void
  onPublishPost: (postId: string) => void
  scrollRootRef: PostScrollRootRef
  scrollRequest: PostScrollRequest | null
  showMobileMap: boolean
  stops: readonly Stop[]
  trackingGeometry: TripTrackingGeometry
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const [activePostId, setActivePostId] = useState<string | null>(null)
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
  const firstPostId = displayedPostIds[0] ?? null
  const desktopPostElementsRef = useRef(new Map<string, HTMLElement>())
  const mobilePostElementsRef = useRef(new Map<string, HTMLElement>())
  const mobileCarouselRef = useRef<HTMLDivElement | null>(null)
  const suppressScrollFocusRef = useRef(false)
  const handleScrollFocusedPostChange = useCallback(
    (postId: string | null) => {
      if (!suppressScrollFocusRef.current) {
        onFocusedPostChange(postId)
      }
    },
    [onFocusedPostChange],
  )

  usePostScrollFocus({
    axis: 'y',
    enabled: !showMobileMap,
    firstPostId,
    onFocusedPostChange: handleScrollFocusedPostChange,
    postElementsRef: desktopPostElementsRef,
    postIds: displayedPostIds,
    rootRef: scrollRootRef,
  })
  usePostScrollFocus({
    axis: 'x',
    enabled: showMobileMap && !activePost,
    firstPostId,
    onFocusedPostChange: handleScrollFocusedPostChange,
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
    const postElement = postElementsRef.current.get(scrollRequest.postId)
    if (!postElement) {
      return undefined
    }

    suppressScrollFocusRef.current = true
    postElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    })

    const releaseTimeout = window.setTimeout(() => {
      suppressScrollFocusRef.current = false
    }, 1_000)

    return () => {
      window.clearTimeout(releaseTimeout)
      suppressScrollFocusRef.current = false
    }
  }, [scrollRequest, showMobileMap])

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
              onBack={() => setActivePostId(null)}
              onEdit={canMutate ? () => onEditPost(activePost.id) : undefined}
              onPublish={
                canMutate && activePost.isDraft
                  ? () => onPublishPost(activePost.id)
                  : undefined
              }
              publishDisabled={isMutating}
              post={activePost}
            />
          ) : (
            <>
              <MobileTravelMap
                focusedPostId={focusedPostId}
                gpsPostCandidates={gpsPostCandidates}
                isTripOngoing={isTripOngoing}
                onGpsPostCandidateSelect={onGpsPostCandidateSelect}
                onPostMarkerSelect={onPostMarkerSelect}
                stops={stops}
                travelLegs={travelLegs}
                trackingGeometry={trackingGeometry}
                travelPosts={travelPosts}
              />

              {canMutate ? (
                <div className="pointer-events-none absolute left-3 top-3 z-[500]">
                  <Button
                    className="pointer-events-auto shadow-xl shadow-foreground/10"
                    onClick={onNewPost}
                    size="sm"
                    type="button"
                  >
                    <Camera className="size-4" aria-hidden="true" />
                    New post
                  </Button>
                </div>
              ) : null}

              <div className="absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-background/90 via-background/45 to-transparent pb-3 pt-10">
                <div
                  className="trip-mobile-post-carousel scrollbar-subtle flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1"
                  ref={mobileCarouselRef}
                >
                  {displayedPosts.map((post) => (
                    <Fragment key={post.id}>
                      <TravelPostPreviewCard
                        active={focusedPostId === post.id}
                        onOpen={() => {
                          onFocusedPostChange(
                            getMapFocusedPostId(post.id, travelPosts),
                          )
                          setActivePostId(post.id)
                        }}
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
          {canMutate ? (
            <Button onClick={onNewPost} size="sm" type="button">
              <Camera className="size-4" aria-hidden="true" />
              New post
            </Button>
          ) : null}
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
                onEdit={canMutate ? () => onEditPost(post.id) : undefined}
                onPublish={
                  canMutate && post.isDraft
                    ? () => onPublishPost(post.id)
                    : undefined
                }
                post={post}
                postRef={(element) =>
                  setPostScrollElement(desktopPostElementsRef, post.id, element)
                }
                publishDisabled={isMutating}
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

export function TravelPostCard({
  active = false,
  onEdit,
  onPublish,
  post,
  postRef,
  publishDisabled = false,
}: {
  active?: boolean
  onEdit?: () => void
  onPublish?: () => void
  post: TravelPost
  postRef?: (element: HTMLElement | null) => void
  publishDisabled?: boolean
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

      <div className="trip-post-media-strip scrollbar-subtle flex min-w-0 max-w-full gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4">
        {post.media.map((media, index) => (
          <MediaStripCard
            key={media.src}
            media={media}
            onOpen={() => setActiveMediaIndex(index)}
          />
        ))}
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
  onOpen,
  post,
  postRef,
}: {
  active?: boolean
  onOpen: () => void
  post: TravelPost
  postRef?: (element: HTMLElement | null) => void
}) {
  const primaryMedia = getPrimaryPostMedia(post)
  const isVideo = getMediaType(primaryMedia) === 'video'

  return (
    <article
      className={cn(
        'trip-mobile-post-carousel__card shrink-0 snap-center overflow-hidden rounded-[1.5rem] border shadow-sm shadow-foreground/5 transition-colors',
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
      <button
        aria-label={`Open ${post.title}`}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onOpen}
        type="button"
      >
        <div className="relative h-36 overflow-hidden bg-secondary">
          <MediaPreview
            className="size-full object-cover"
            media={primaryMedia}
            source="thumbnail"
          />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          {post.isDraft ? (
            <Badge className="absolute left-2 top-2 shadow-sm">Draft</Badge>
          ) : null}
          {isVideo ? (
            <span className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid size-11 place-items-center rounded-full bg-card/90 text-primary shadow-lg shadow-black/15">
                <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
              </span>
            </span>
          ) : null}
          {post.media.length > 1 ? (
            <span className="absolute right-2 top-2 rounded-full bg-card/90 px-2 py-1 text-[0.68rem] font-semibold text-primary shadow-sm">
              {post.media.length} media
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5 p-3">
          <h3 className="text-base font-semibold leading-6 text-foreground">
            {post.title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
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
      </button>
    </article>
  )
}

function MobilePostDetailCard({
  onBack,
  onEdit,
  onPublish,
  post,
  publishDisabled = false,
}: {
  onBack: () => void
  onEdit?: () => void
  onPublish?: () => void
  post: TravelPost
  publishDisabled?: boolean
}) {
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null)

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden bg-card lg:hidden">
      <div className="flex min-w-0 items-start gap-3 border-b border-border bg-card/85 p-3">
        <Button
          aria-label="Back to post carousel"
          className="size-9 rounded-full"
          onClick={onBack}
          size="icon"
          title="Back"
          type="button"
          variant="outline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold leading-6 text-foreground">
            {post.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {post.isDraft ? <Badge>Draft</Badge> : null}
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden="true" />
              {post.location}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden="true" />
              {post.time}
            </span>
            <span>{post.comments} comments</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onPublish ? (
            <Button
              aria-label={`Publish ${post.title}`}
              className="rounded-full"
              disabled={publishDisabled}
              onClick={onPublish}
              size="sm"
              title={`Publish ${post.title}`}
              type="button"
            >
              <Send className="size-3.5" aria-hidden="true" />
              Publish
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              aria-label={`Edit ${post.title}`}
              className="size-9 rounded-full"
              onClick={onEdit}
              size="icon"
              title={`Edit ${post.title}`}
              type="button"
              variant="outline"
            >
              <PenLine className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {post.excerpt}
        </p>

        <div className="trip-post-media-strip scrollbar-subtle -mx-4 flex min-w-0 max-w-full gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1">
          {post.media.map((media, index) => (
            <MobilePostDetailMediaCard
              key={media.src}
              media={media}
              onOpen={() => setActiveMediaIndex(index)}
            />
          ))}
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
    </article>
  )
}

function MobilePostDetailMediaCard({
  media,
  onOpen,
}: {
  media: PostMedia
  onOpen: () => void
}) {
  const isVideo = getMediaType(media) === 'video'

  return (
    <article className="group relative h-80 shrink-0 overflow-hidden rounded-[1.35rem] bg-secondary sm:h-96">
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
        {isVideo ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-10 place-items-center rounded-full bg-card/90 text-primary shadow-lg shadow-black/15">
              <Play className="ml-0.5 size-4 fill-current" aria-hidden="true" />
            </span>
          </span>
        ) : null}
      </button>
    </article>
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
