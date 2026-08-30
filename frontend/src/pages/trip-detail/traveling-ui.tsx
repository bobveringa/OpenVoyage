import {
  ArrowLeft,
  Camera,
  Clock,
  Compass,
  EllipsisVertical,
  Images,
  MapPin,
  PenLine,
  Play,
  Send,
  Heart,
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

import {
  ApiError,
  createPostComment,
  deletePostComment,
  getShareLinkProfile,
  likePost,
  listPostComments,
  unlikePost,
  updateShareLinkDisplayName,
  type GpsPostCandidate,
  type PostComment,
  type PostSocialSummary,
} from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MediaImage } from '@/components/ui/media-image'
import { Modal } from '@/components/ui/modal'
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
  accessToken,
  currentUserId,
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
  onPostSocialSummary,
  onPublishPost,
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
  accessToken?: string | null
  currentUserId: string | null
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
  onPostSocialSummary: (postId: string, social: PostSocialSummary) => void
  onPublishPost: (postId: string) => void
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
  const mobileReturnPostIdRef = useRef<string | null>(null)
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
      onFocusedPostChange(getMapFocusedPostId(post.id, travelPosts))
      window.history.pushState(
        { ...window.history.state, openVoyageMobilePostId: post.id },
        '',
      )
      setActivePostId(post.id)
    },
    [onFocusedPostChange, travelPosts],
  )

  useEffect(() => {
    function handlePopState() {
      if (!activePostId) {
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
      mobilePostElementsRef.current
        .get(postId)
        ?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' })
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
              onBack={closeMobilePostDetail}
              onEdit={canMutate ? () => onEditPost(activePost.id) : undefined}
              onPublish={
                canMutate && activePost.isDraft
                  ? () => onPublishPost(activePost.id)
                  : undefined
              }
              publishDisabled={isMutating}
              post={activePost}
              accessToken={accessToken}
              currentUserId={currentUserId}
              onPostSocialSummary={onPostSocialSummary}
              shareToken={shareToken}
              tripId={tripId}
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
  const [comments, setComments] = useState<readonly PostComment[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [isLoading, setLoading] = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isNameModalOpen, setNameModalOpen] = useState(false)
  const [sharedName, setSharedName] = useState('')
  const canAttemptInteraction = Boolean(accessToken || shareToken)
  const isOwnPost = currentUserId === post.author.id
  const selfLikeHelpId = `post-${post.id}-self-like-help`

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
        setComments((current) =>
          cursor
            ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))]
            : page.items,
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

  async function submitComment() {
    const normalizedBody = body.trim()
    if (!normalizedBody || normalizedBody.length > 2000) return
    setSubmitting(true)
    setError(null)
    const submit = () => createPostComment({
      accessToken, payload: { body: normalizedBody }, postId: post.id, shareToken, tripId,
    })
    try {
      const comment = await submit()
      setComments((current) => [comment, ...current])
      setBody('')
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
          const comment = await submit()
          setComments((current) => [comment, ...current])
          setBody('')
          return
        }
      } catch (retryFailure) {
        commentFailure = retryFailure
      }
      setError(commentFailure instanceof Error ? commentFailure.message : 'Unable to post comment.')
    } finally {
      setSubmitting(false)
    }
  }

  async function removeComment(comment: PostComment) {
    if (!window.confirm('Delete this comment permanently?')) return
    try {
      await deletePostComment({
        accessToken, commentId: comment.id, postId: post.id, shareToken, tripId,
      })
      setComments((current) => current.filter((item) => item.id !== comment.id))
      onSummary(post.id, {
        can_interact: post.social.canInteract,
        can_like: post.social.canLike,
        comment_count: Math.max(0, post.social.commentCount - 1),
        like_count: post.social.likeCount,
        viewer_has_liked: post.social.viewerHasLiked,
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to delete comment.')
    }
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
          {comments.map((comment) => (
            <div className="rounded-xl border border-border/80 bg-background p-3 text-sm shadow-sm" key={comment.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {comment.author.type === 'user' && comment.author.user.profile_picture ? (
                    <img alt="" className="size-8 shrink-0 rounded-full object-cover" src={comment.author.user.profile_picture.urls.thumbnail ?? comment.author.user.profile_picture.urls.content} />
                  ) : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-primary">{comment.author.type === 'user' ? getCommentInitials(comment.author.user.first_name, comment.author.user.last_name, comment.author.user.username) : comment.author.display_name.slice(0, 1).toUpperCase()}</span>}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1">
                      <p className="truncate font-semibold text-foreground">
                        {comment.author.type === 'user'
                          ? [comment.author.user.first_name, comment.author.user.last_name].filter(Boolean).join(' ') || comment.author.user.username || 'User'
                          : comment.author.display_name}
                      </p>
                      {(comment.author.type === 'user' && comment.author.user.id === currentUserId) ||
                      (comment.author.type === 'share_link' && !accessToken && shareToken) ? <Badge>You</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatCommentAge(comment.created_at)}</p>
                  </div>
                </div>
                {comment.can_delete ? <Button aria-label="Delete comment" className="size-7" onClick={() => void removeComment(comment)} size="icon" type="button" variant="ghost"><Trash2 className="size-3.5" /></Button> : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{comment.body}</p>
            </div>
          ))}
          {nextCursor ? <Button disabled={isLoading} onClick={() => void loadComments(nextCursor)} size="sm" type="button" variant="outline">Load more comments</Button> : null}
          {isLoading ? <p className="text-xs text-muted-foreground">Loading comments…</p> : null}
          {canAttemptInteraction ? (
            <div className="space-y-2">
              <textarea className="min-h-20 w-full rounded-xl border border-input bg-background p-2 text-sm" maxLength={2000} onChange={(event) => setBody(event.target.value)} placeholder="Write a comment" value={body} />
              <Button disabled={isSubmitting || !body.trim() || body.trim().length > 2000 || (!post.social.canInteract && !shareToken)} onClick={() => void submitComment()} size="sm" type="button">Comment</Button>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
      ) : null}
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
  accessToken,
  currentUserId,
  onBack,
  onEdit,
  onPublish,
  onPostSocialSummary,
  post,
  publishDisabled = false,
  shareToken,
  tripId,
}: {
  accessToken?: string | null
  currentUserId: string | null
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
    <article className="scrollbar-subtle h-full min-h-0 overflow-y-auto bg-card lg:hidden">
      <div className="min-w-0 border-b border-border bg-card/85 p-3">
        <div className="flex min-w-0 items-start gap-3">
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
            <h3 className="text-base font-semibold leading-6 text-foreground">
              {post.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {post.isDraft ? <Badge>Draft</Badge> : null}
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
          {onPublish || onEdit ? (
            <div className="relative shrink-0" ref={actionMenuRef}>
              <Button
                aria-controls={`post-actions-${post.id}`}
                aria-expanded={isActionMenuOpen}
                aria-haspopup="menu"
                aria-label={`Actions for ${post.title}`}
                className="size-9 rounded-full"
                onClick={() => setIsActionMenuOpen((open) => !open)}
                size="icon"
                title="Post actions"
                type="button"
                variant="outline"
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

      <div className="space-y-4 p-4">
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
    <section aria-label={`Post media: ${mediaCount} items`}>
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
