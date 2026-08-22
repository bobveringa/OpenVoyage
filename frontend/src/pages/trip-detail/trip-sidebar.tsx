import {
  ArrowLeft,
  Check,
  MousePointer2,
  Navigation,
  PenLine,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import type { GpsPostCandidate } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getMapFocusedPostId } from '@/pages/trip-detail/trip-selectors'
import { TripSidebarHeader } from '@/pages/trip-detail/management-ui'
import type {
  Stop,
  TravelLeg,
  TravelPost,
  TripMemberViewModel,
  TripTrackingGeometry,
  TripViewModel,
} from '@/pages/trip-detail/models'
import type {
  CreateStopDraft,
  DraftPostLocation,
  MapPointTarget,
  PostScrollRequest,
  PostSubmitDraft,
  StopEditDraft,
  StopInsertionPoint,
  TravelLegEditDraft,
} from '@/pages/trip-detail/page-types'
import {
  CreateStopPanel,
  PlanningPanel,
} from '@/pages/trip-detail/planning-ui'
import {
  createDraftMapPointLocation,
  createFirstStopInsertionPoint,
  formatCoordinates,
} from '@/pages/trip-detail/planning-utils'
import { PostFormPanel } from '@/pages/trip-detail/post-form-panel'
import { TravelingPanel } from '@/pages/trip-detail/traveling-ui'
import { TripLeafletMap, type MapRouteMode } from '@/pages/trip-detail/trip-map'
import type {
  PlanningView,
  TravelingView,
  TripManagementSection,
  TripMode,
} from '@/pages/trip-detail/url-state'

export function MobileMapPointPicker({
  initialLocation,
  onCancel,
  onConfirm,
  open,
  routeMode,
  stops,
  target,
  trackingGeometry,
  travelLegs,
  travelPosts,
}: {
  initialLocation: DraftPostLocation | null
  onCancel: () => void
  onConfirm: (coordinates: L.LatLngTuple) => void
  open: boolean
  routeMode: MapRouteMode
  stops: readonly Stop[]
  target: MapPointTarget | null
  trackingGeometry: TripTrackingGeometry
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const [pendingLocation, setPendingLocation] =
    useState<DraftPostLocation | null>(initialLocation)

  useEffect(() => {
    if (open) {
      setPendingLocation(initialLocation)
    }
  }, [initialLocation, open])

  if (!open || !target || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] overflow-hidden bg-card"
      role="dialog"
    >
      <TripLeafletMap
        draftMapLocation={pendingLocation}
        fitMode="mobile-picker"
        mapPointEnabled
        onDraftMapPointSelect={(coordinates) =>
          setPendingLocation(createDraftMapPointLocation(coordinates, target))
        }
        resetNonce={0}
        routeMode={routeMode}
        stops={stops}
        travelLegs={travelLegs}
        trackingGeometry={trackingGeometry}
        travelPosts={travelPosts}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-gradient-to-b from-background/95 via-background/70 to-transparent px-3 pb-8 pt-3">
        <div className="pointer-events-auto flex items-center justify-between gap-3">
          <Button onClick={onCancel} type="button" variant="outline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
          <Badge variant="secondary">
            {target === 'stop' ? 'Planning stop' : 'Post location'}
          </Badge>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-background via-background/95 to-transparent p-3 pt-10">
        <div className="pointer-events-auto space-y-3 rounded-[1.5rem] border border-border bg-card p-4 shadow-xl shadow-foreground/10">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted text-primary">
              <MousePointer2 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Map point
              </p>
              <h2 className="mt-0.5 truncate text-lg font-semibold text-foreground">
                {pendingLocation?.label ?? 'No point selected'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingLocation
                  ? formatCoordinates(pendingLocation.coordinates)
                  : 'Tap a point on the map.'}
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!pendingLocation}
              onClick={() => {
                if (pendingLocation) {
                  onConfirm(pendingLocation.coordinates)
                }
              }}
              type="button"
            >
              <Check className="size-4" aria-hidden="true" />
              Use location
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function TripSidebar({
  accessToken,
  canManageTrip,
  canMutate,
  currentUserId,
  draftPostLocation,
  draftStopLocation,
  gpsPostCandidate,
  gpsPostCandidates,
  editingPostId,
  focusedPostId,
  isMutating,
  mapPointTarget,
  mutationError,
  onCreateStop,
  mode,
  onEditPost,
  onFocusedPostChange,
  onGpsPostCandidateSelect,
  onMapPointTargetChange,
  onPostMarkerSelect,
  onOpenManagement,
  onPostDelete,
  onPostSubmit,
  onPlanningViewChange,
  onRefreshTravelLegRoute,
  onStopSave,
  onStopChange,
  onStopDelete,
  onTravelLegSave,
  onTravelingViewChange,
  pendingAction,
  planningView,
  postScrollRequest,
  reserveMobileModeSwitchSpace,
  showMobileTravelMap,
  stops,
  trip,
  trackingGeometry,
  tripMembers,
  travelLegs,
  travelPosts,
  travelingView,
}: {
  accessToken?: string | null
  canManageTrip: boolean
  canMutate: boolean
  currentUserId: string | null
  draftPostLocation: DraftPostLocation | null
  draftStopLocation: DraftPostLocation | null
  gpsPostCandidate: GpsPostCandidate | null
  gpsPostCandidates: readonly GpsPostCandidate[]
  editingPostId: string | null
  focusedPostId: string | null
  isMutating: boolean
  mapPointTarget: MapPointTarget | null
  mutationError: string | null
  onCreateStop: (draft: CreateStopDraft) => void
  mode: TripMode
  onEditPost: (postId: string) => void
  onFocusedPostChange: (postId: string | null) => void
  onGpsPostCandidateSelect: (candidate: GpsPostCandidate) => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
  onPostMarkerSelect: (postId: string) => void
  onOpenManagement: (section: TripManagementSection) => void
  onPostDelete: (postId: string) => void
  onPostSubmit: (postId: string | null, draft: PostSubmitDraft) => void
  onPlanningViewChange: (view: PlanningView) => void
  onRefreshTravelLegRoute: (legId: string) => void
  onStopSave: (stopId: string, draft: StopEditDraft) => void
  onStopChange: (stopId: string, updates: Partial<Stop>) => void
  onStopDelete: (stopId: string) => void
  onTravelLegSave: (legId: string, draft: TravelLegEditDraft) => void
  onTravelingViewChange: (view: TravelingView) => void
  pendingAction: string | null
  planningView: PlanningView
  postScrollRequest: PostScrollRequest | null
  reserveMobileModeSwitchSpace: boolean
  showMobileTravelMap: boolean
  stops: readonly Stop[]
  trip: TripViewModel
  trackingGeometry: TripTrackingGeometry
  tripMembers: readonly TripMemberViewModel[]
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
  travelingView: TravelingView
}) {
  const isMobileTravelPosts = mode === 'traveling' && travelingView === 'posts'
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null)
  const [stopInsertionPoint, setStopInsertionPoint] =
    useState<StopInsertionPoint | null>(null)
  const editingPost =
    travelPosts.find((post) => post.id === editingPostId) ?? null
  const mobileTravelMapHeight = reserveMobileModeSwitchSpace
    ? 'h-[calc(100dvh-9.75rem)]'
    : 'h-[calc(100dvh-5.5rem)]'
  const fallbackStopInsertionPoint = useMemo(
    () => createFirstStopInsertionPoint(trip.startDate),
    [trip.startDate],
  )

  useEffect(() => {
    if (planningView !== 'create-stop') {
      setStopInsertionPoint(null)
    }
  }, [planningView])

  function openCreateStop(insertionPoint: StopInsertionPoint) {
    setStopInsertionPoint(insertionPoint)
    onMapPointTargetChange(null)
    onPlanningViewChange('create-stop')
  }

  function closePostForm() {
    onMapPointTargetChange(null)
    onFocusedPostChange(null)
    onTravelingViewChange('posts')
  }

  function editPost(postId: string) {
    onMapPointTargetChange(null)
    onFocusedPostChange(getMapFocusedPostId(postId, travelPosts))
    onEditPost(postId)
  }

  return (
    <aside
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm lg:h-full',
        isMobileTravelPosts && `${mobileTravelMapHeight} lg:h-full`,
      )}
    >
      <TripSidebarHeader
        canManageTrip={canManageTrip}
        canMutate={canMutate}
        currentUserId={currentUserId}
        members={tripMembers}
        onOpenManagement={onOpenManagement}
        trip={trip}
      />
      {mutationError ? (
        <p
          className="mx-4 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {mutationError}
        </p>
      ) : null}
      <div
        className={cn(
          'scrollbar-subtle min-w-0 flex-1 lg:min-h-0 lg:overflow-auto lg:pb-0',
          reserveMobileModeSwitchSpace ? 'pb-24' : 'pb-4',
          isMobileTravelPosts && 'min-h-0 overflow-hidden pb-0',
        )}
        ref={sidebarScrollRef}
      >
        {mode === 'planning' && planningView === 'create-stop' && canMutate ? (
          <CreateStopPanel
            draftLocation={draftStopLocation}
            isSubmitting={isMutating}
            insertionPoint={stopInsertionPoint ?? fallbackStopInsertionPoint}
            mapPointActive={mapPointTarget === 'stop'}
            onCancel={() => {
              onMapPointTargetChange(null)
              onPlanningViewChange('stops')
            }}
            onCreateStop={onCreateStop}
            onMapPointTargetChange={onMapPointTargetChange}
          />
        ) : mode === 'planning' ? (
          <PlanningPanel
            onAddStop={openCreateStop}
            canMutate={canMutate}
            isMutating={isMutating}
            onRefreshTravelLegRoute={onRefreshTravelLegRoute}
            onStopChange={onStopChange}
            onStopDelete={onStopDelete}
            onStopSave={onStopSave}
            onTravelLegSave={onTravelLegSave}
            pendingAction={pendingAction}
            stops={stops}
            tripStartDate={trip.startDate}
            travelLegs={travelLegs}
          />
        ) : travelingView === 'create-post' && canMutate ? (
          <PostFormPanel
            accessToken={accessToken}
            draftLocation={draftPostLocation}
            gpsPostCandidate={gpsPostCandidate}
            isSubmitting={isMutating}
            mapPointActive={mapPointTarget === 'post'}
            mode="create"
            onCancel={closePostForm}
            onMapPointTargetChange={onMapPointTargetChange}
            onSubmit={(draft) => onPostSubmit(null, draft)}
          />
        ) : travelingView === 'edit-post' && editingPost && canMutate ? (
          <PostFormPanel
            accessToken={accessToken}
            draftLocation={draftPostLocation}
            gpsPostCandidate={gpsPostCandidate}
            isSubmitting={isMutating}
            mapPointActive={mapPointTarget === 'post'}
            mode="edit"
            onCancel={closePostForm}
            onDelete={() => onPostDelete(editingPost.id)}
            onMapPointTargetChange={onMapPointTargetChange}
            onSubmit={(draft) => onPostSubmit(editingPost.id, draft)}
            post={editingPost}
          />
        ) : (
          <TravelingPanel
            canMutate={canMutate}
            focusedPostId={focusedPostId}
            gpsPostCandidates={gpsPostCandidates}
            onEditPost={editPost}
            onFocusedPostChange={onFocusedPostChange}
            onGpsPostCandidateSelect={onGpsPostCandidateSelect}
            onPostMarkerSelect={onPostMarkerSelect}
            onNewPost={() => {
              onMapPointTargetChange(null)
              onFocusedPostChange(null)
              onTravelingViewChange('create-post')
            }}
            scrollRootRef={sidebarScrollRef}
            scrollRequest={postScrollRequest}
            showMobileMap={showMobileTravelMap}
            stops={stops}
            travelLegs={travelLegs}
            trackingGeometry={trackingGeometry}
            travelPosts={travelPosts}
          />
        )}
      </div>
    </aside>
  )
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded-[1.1rem] text-sm font-semibold transition-colors',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  )
}

function TripModeSwitch({
  className,
  mode,
  onModeChange,
}: {
  className?: string
  mode: TripMode
  onModeChange: (mode: TripMode) => void
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 rounded-[1.4rem] border border-border bg-card/92 p-1 shadow-xl shadow-foreground/10 backdrop-blur',
        className,
      )}
    >
      <ModeButton
        active={mode === 'planning'}
        icon={<PenLine className="size-4" aria-hidden="true" />}
        label="Plan"
        onClick={() => onModeChange('planning')}
      />
      <ModeButton
        active={mode === 'traveling'}
        icon={<Navigation className="size-4" aria-hidden="true" />}
        label="Travel"
        onClick={() => onModeChange('traveling')}
      />
    </div>
  )
}

export function TripModeDock({
  mode,
  onModeChange,
}: {
  mode: TripMode
  onModeChange: (mode: TripMode) => void
}) {
  return (
    <div className="hidden min-h-0 items-center lg:flex">
      <div className="flex w-full flex-col gap-1.5 rounded-[1.35rem] border border-border bg-card/95 p-1.5 shadow-xl shadow-foreground/10">
        <DockModeButton
          active={mode === 'planning'}
          icon={PenLine}
          label="Plan"
          onClick={() => onModeChange('planning')}
        />
        <DockModeButton
          active={mode === 'traveling'}
          icon={Navigation}
          label="Travel"
          onClick={() => onModeChange('traveling')}
        />
      </div>
    </div>
  )
}

function DockModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'h-16 w-full flex-col gap-1 rounded-[1rem] border px-1 py-1.5 text-center text-[13px] font-semibold leading-none tracking-normal transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
          : 'border-transparent bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="w-full truncate">{label}</span>
    </Button>
  )
}

export function MobileModeSwitch({
  mode,
  onModeChange,
}: {
  mode: TripMode
  onModeChange: (mode: TripMode) => void
}) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-x-3 bottom-3 z-50 lg:hidden">
      <TripModeSwitch
        className="mx-auto max-w-sm"
        mode={mode}
        onModeChange={onModeChange}
      />
    </div>,
    document.body,
  )
}
