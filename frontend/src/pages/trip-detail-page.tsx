import type * as L from 'leaflet'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import {
  addTripMember,
  addTripViewer,
  createItineraryStop,
  createPost,
  createTripShareLink,
  deletePost,
  deleteTrip,
  deleteItineraryStop,
  getErrorMessage,
  getItinerary,
  listGpsPostCandidates,
  getPostTimeline,
  getTrip,
  listTripMembers,
  listTripShareLinks,
  listTripViewers,
  publishPost,
  refreshItineraryTravelLegRoute,
  removeTripMember,
  removeTripViewer,
  replaceItineraryTravelLeg,
  reverseGeocodePlaces,
  revokeTripShareLink,
  updateTripShareLink,
  updateItineraryStop,
  updatePost,
  updateTrip,
  updateTripMember,
  unpublishPost,
  uploadMedia,
  type CurrentUser,
  type GpsPostCandidate,
  type Itinerary,
  type ItineraryStopCreatePayload,
  type ItineraryStopUpdatePayload,
  type ItineraryTravelReplacePayload,
  type Post,
  type PostSocialSummary,
  type PostCreatePayload,
  type PostTimelineEntry,
  type PostTimelineOpeningRoute,
  type PostTimelineRoute,
  type PostUpdatePayload,
  type Trip,
  type TripMember,
  type TripShareLink,
  type TripShareLinkCreateResponse,
  type TripUpdatePayload,
  type TripViewer,
} from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { isTripOngoing } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/pages/trip-detail/use-media-query'
import {
  TripManagementDialog,
} from '@/pages/trip-detail/management-ui'
import { toPostOccurredAtValue } from '@/pages/trip-detail/post-form-utils'
import {
  MobileMapPointPicker,
  MobileModeSwitch,
  TripModeDock,
  TripSidebar,
} from '@/pages/trip-detail/trip-sidebar'
import {
  createDraftMapPointLocation,
  getPlaceNameLabel,
} from '@/pages/trip-detail/planning-utils'
import {
  formatDateTimeLabel,
  getUserDisplayName,
  getUserSubtitle,
} from '@/pages/trip-detail/management-utils'
import {
  getMapFocusedPostId,
  getUpcomingStops,
} from '@/pages/trip-detail/trip-selectors'
import type {
  ShareLinkViewModel,
  TripViewModel,
  TripMemberViewModel,
  TripRole,
  TripViewerViewModel,
  PostMedia,
  Stop,
  TravelLeg,
  TravelMode,
  TravelPost,
  TravelPostRoute,
  TripTrackingGeometry,
} from '@/pages/trip-detail/models'
import type {
  CreateStopDraft,
  DraftPostLocation,
  MapPointTarget,
  PostScrollRequest,
  PostSubmitDraft,
  ShareLinkCreateDraft,
  StopEditDraft,
  TravelLegEditDraft,
  TripSettingsDraft,
  UserLookupDraft,
} from '@/pages/trip-detail/page-types'
import { EMPTY_TRACKING_GEOMETRY } from '@/pages/trip-detail/models'
import {
  MapWorkspace,
  type MapRouteMode,
} from '@/pages/trip-detail/trip-map'
import {
  getGeoJsonLineStringCoordinates,
} from '@/pages/trip-detail/route-geometry'
import {
  areTripDetailUrlStatesEqual,
  normalizeTripDetailUrlState,
  readTripDetailUrlState,
  writeTripDetailUrlState,
  type PlanningView,
  type TravelingView,
  type TripDetailUrlState,
  type TripDetailHistoryAction,
  type TripDialog,
  type TripManagementSection,
  type TripMode,
} from '@/pages/trip-detail/url-state'

type TripDetailPageProps = {
  accessToken: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  tripId: string
}

type TripDetailLoadState =
  | { error: null; status: 'idle' | 'loading' | 'success' }
  | { error: string; status: 'error' }

export function TripDetailPage({
  accessToken,
  authStatus,
  currentUser,
  tripId,
}: TripDetailPageProps) {
  const shouldUseMobileMapPicker = useMediaQuery('(max-width: 1023px)')
  const initialCanUseMemberUi = authStatus === 'authenticated'
  const initialUrlState = readTripDetailUrlState({
    canEditTravelPosts: initialCanUseMemberUi,
    canOpenManagementDialogs: initialCanUseMemberUi,
    canSwitchModes: initialCanUseMemberUi,
    travelPosts: [],
  })
  const [mode, setMode] = useState<TripMode>(initialUrlState.mode)
  const [planningView, setPlanningView] = useState<PlanningView>(
    initialUrlState.planningView,
  )
  const [trip, setTrip] = useState<TripViewModel>(() => createLoadingTrip(tripId))
  const [loadState, setLoadState] = useState<TripDetailLoadState>(
    { error: null, status: 'loading' },
  )
  const [itineraryRevision, setItineraryRevision] = useState(0)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [tripMembers, setTripMembers] = useState<readonly TripMemberViewModel[]>([])
  const [tripViewers, setTripViewers] = useState<readonly TripViewerViewModel[]>([])
  const [tripShareLinks, setTripShareLinks] =
    useState<readonly ShareLinkViewModel[]>([])
  const [plannedStops, setPlannedStops] = useState<readonly Stop[]>([])
  const [travelLegs, setTravelLegs] = useState<readonly TravelLeg[]>([])
  const [travelPosts, setTravelPosts] = useState<readonly TravelPost[]>([])
  const [trackingGeometry, setTrackingGeometry] = useState<TripTrackingGeometry>(
    EMPTY_TRACKING_GEOMETRY,
  )
  const [gpsPostCandidates, setGpsPostCandidates] = useState<
    readonly GpsPostCandidate[]
  >([])
  const [selectedGpsPostCandidate, setSelectedGpsPostCandidate] =
    useState<GpsPostCandidate | null>(null)
  const [travelingView, setTravelingView] = useState<TravelingView>(
    initialUrlState.travelingView,
  )
  const [editingPostId, setEditingPostId] = useState<string | null>(
    initialUrlState.editingPostId,
  )
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null)
  const [postScrollRequest, setPostScrollRequest] =
    useState<PostScrollRequest | null>(null)
  const [activeDialog, setActiveDialog] = useState<TripDialog | null>(
    initialUrlState.activeDialog,
  )
  const [managementSection, setManagementSection] =
    useState<TripManagementSection>(initialUrlState.managementSection)
  const [mapPointTarget, setMapPointTarget] = useState<MapPointTarget | null>(
    null,
  )
  const [mobileMapPickerTarget, setMobileMapPickerTarget] =
    useState<MapPointTarget | null>(null)
  const [draftPostLocation, setDraftPostLocation] =
    useState<DraftPostLocation | null>(null)
  const [draftStopLocation, setDraftStopLocation] =
    useState<DraftPostLocation | null>(null)
  const urlStateRef = useRef<TripDetailUrlState>(initialUrlState)
  // Which trip the rendered content belongs to, so a reload of the trip
  // already on screen can keep showing it instead of blanking out.
  const loadedTripIdRef = useRef<string | null>(null)
  const shareToken = useMemo(readShareTokenFromUrl, [])
  const currentUserId = currentUser?.id ?? null
  const isTripCurrentlyOngoing = isTripOngoing({
    end_date: trip.endDate || null,
    start_date: trip.startDate,
  })
  const currentTripMembership = useMemo(() => {
    if (!currentUserId) {
      return null
    }

    return (
      tripMembers.find((member) => member.userId === currentUserId) ?? null
    )
  }, [currentUserId, tripMembers])
  const canMutate = currentTripMembership !== null
  const canManageTrip = currentTripMembership?.role === 'OWNER'
  const canSwitchModes = canMutate
  const isMutating = pendingAction !== null

  const applyItinerary = useCallback((itinerary: Itinerary) => {
    setItineraryRevision(itinerary.itinerary_revision)
    setPlannedStops(itinerary.stops)
    setTravelLegs(itinerary.legs)
  }, [])

  const loadTripManagement = useCallback(
    async (options: { isCurrent: () => boolean }) => {
      if (!tripId || !accessToken) {
        setTripViewers([])
        setTripShareLinks([])
        return
      }

      const [viewers, shareLinks] = await Promise.all([
        listTripViewers({ accessToken, tripId }),
        listTripShareLinks({ accessToken, tripId }),
      ])

      if (!options.isCurrent()) {
        return
      }

      setTripViewers(viewers.map(toTripViewerViewModel))
      setTripShareLinks(shareLinks.map(toShareLinkViewModel))
    },
    [accessToken, tripId],
  )

  const fetchTravelTimeline = useCallback(async () => {
    if (!tripId) {
      return { posts: [], trackingGeometry: EMPTY_TRACKING_GEOMETRY }
    }

    const timeline = await getPostTimeline({
      accessToken,
      shareToken,
      status: accessToken ? 'all' : 'published',
      tripId,
    })

    return {
      posts: timeline.entries.map(toTravelTimelinePostViewModel),
      trackingGeometry: {
        openingRoute: toTravelPostRouteViewModel(timeline.opening_route),
      },
    }
  }, [accessToken, shareToken, tripId])

  const fetchGpsPostCandidates = useCallback(async () => {
    if (!tripId || !accessToken) {
      return []
    }

    // This request intentionally fails closed for viewers and roles that
    // cannot create posts: individual GPS timestamps never reach their map.
    try {
      return await listGpsPostCandidates({ accessToken, tripId })
    } catch {
      return []
    }
  }, [accessToken, tripId])

  const loadTripDetail = useCallback(
    async (options: { isCurrent: () => boolean }) => {
      if (!tripId) {
        return
      }

      // Re-running this for the same trip (a background refresh, a session
      // token rotation) must not drop back to the full-page spinner: that
      // read as the whole screen flashing. Only an empty or different trip
      // has nothing worth keeping on screen while the request is in flight.
      if (loadedTripIdRef.current !== tripId) {
        setLoadState({ error: null, status: 'loading' })
      }
      setMutationError(null)

      try {
        const [
          loadedTrip,
          loadedItinerary,
          loadedTimeline,
          loadedMembers,
          loadedGpsPostCandidates,
        ] =
          await Promise.all([
            getTrip({ accessToken, shareToken, tripId }),
            getItinerary({ accessToken, shareToken, tripId }),
            fetchTravelTimeline(),
            listTripMembers({ accessToken, shareToken, tripId }),
            fetchGpsPostCandidates(),
          ])
        const { posts: loadedPosts, trackingGeometry: loadedTrackingGeometry } =
          loadedTimeline

        if (!options.isCurrent()) {
          return
        }

        const loadedTripMembers = loadedMembers.map(toTripMemberViewModel)
        const loadedCurrentMembership =
          currentUserId === null
            ? null
            : loadedTripMembers.find(
                (member) => member.userId === currentUserId,
              ) ?? null

        setTrip(toTripViewModel(loadedTrip))
        applyItinerary(loadedItinerary)
        setTripMembers(loadedTripMembers)
        setTravelPosts(loadedPosts)
        setTrackingGeometry(loadedTrackingGeometry)
        setGpsPostCandidates(loadedGpsPostCandidates)
        loadedTripIdRef.current = tripId
        setLoadState({ error: null, status: 'success' })

        if (accessToken && loadedCurrentMembership?.role === 'OWNER') {
          void loadTripManagement(options).catch((managementError) => {
            if (options.isCurrent()) {
              setMutationError(getErrorMessage(managementError))
            }
          })
        } else {
          setTripViewers([])
          setTripShareLinks([])
        }
      } catch (loadError) {
        if (!options.isCurrent()) {
          return
        }

        loadedTripIdRef.current = null
        setLoadState({
          error: getErrorMessage(loadError),
          status: 'error',
        })
      }
    },
    [
      accessToken,
      applyItinerary,
      currentUserId,
      fetchGpsPostCandidates,
      fetchTravelTimeline,
      loadTripManagement,
      shareToken,
      tripId,
    ],
  )

  useEffect(() => {
    if (authStatus === 'loading') {
      return undefined
    }

    let isCurrent = true
    void loadTripDetail({
      isCurrent: () => isCurrent,
    })

    return () => {
      isCurrent = false
    }
  }, [authStatus, loadTripDetail])

  const runMutation = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (pendingAction) {
        return
      }

      setPendingAction(label)
      setMutationError(null)
      try {
        await action()
      } catch (mutationFailure) {
        setMutationError(getErrorMessage(mutationFailure))
      } finally {
        setPendingAction(null)
      }
    },
    [pendingAction],
  )

  const reloadItineraryUntilRouteReady = useCallback(
    async (legId: string, expectedProviderRoute: boolean) => {
      if (!tripId) {
        return
      }

      const maxAttempts = expectedProviderRoute ? 6 : 1
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) {
          await delay(450)
        }

        const itinerary = await getItinerary({ accessToken, shareToken, tripId })
        applyItinerary(itinerary)
        const leg = itinerary.legs.find((item) => item.id === legId)
        if (!expectedProviderRoute || leg?.route.type === 'PROVIDER_BACKED') {
          return
        }
      }
    },
    [accessToken, applyItinerary, shareToken, tripId],
  )

  const applyTripDetailUrlState = useCallback(
    (nextState: TripDetailUrlState) => {
      urlStateRef.current = nextState
      setMode(nextState.mode)
      setPlanningView(nextState.planningView)
      setTravelingView(nextState.travelingView)
      setEditingPostId(nextState.editingPostId)
      setActiveDialog(nextState.activeDialog)
      setManagementSection(nextState.managementSection)
      setMapPointTarget(null)
      setMobileMapPickerTarget(null)

      if (
        nextState.mode === 'traveling' &&
        nextState.travelingView === 'edit-post' &&
        nextState.editingPostId
      ) {
        setFocusedPostId(
          getMapFocusedPostId(nextState.editingPostId, travelPosts),
        )
        return
      }

      if (
        nextState.mode !== 'traveling' ||
        nextState.travelingView === 'create-post'
      ) {
        setFocusedPostId(null)
      }
    },
    [travelPosts],
  )

  const navigateTripDetailUrlState = useCallback(
    (
      updates: Partial<TripDetailUrlState>,
      historyAction: TripDetailHistoryAction = 'push',
    ) => {
      const nextState = normalizeTripDetailUrlState(
        {
          ...urlStateRef.current,
          ...updates,
        },
        {
          canEditTravelPosts: canMutate,
          canOpenManagementDialogs: canMutate,
          canSwitchModes,
          travelPosts,
        },
      )

      applyTripDetailUrlState(nextState)
      writeTripDetailUrlState(nextState, historyAction)
    },
    [
      applyTripDetailUrlState,
      canMutate,
      canSwitchModes,
      travelPosts,
    ],
  )

  const openManagement = useCallback((section: TripManagementSection) => {
    // GPS recordings are available to members. The other management sections
    // are owner-only, including the live-sharing switch shown inside GPS.
    if (section === 'gps' ? !canMutate : !canManageTrip) {
      return
    }

    setMutationError(null)
    navigateTripDetailUrlState({
      activeDialog: 'management',
      managementSection: section,
    })
  }, [canManageTrip, canMutate, navigateTripDetailUrlState])

  const closeDialog = useCallback(() => {
    navigateTripDetailUrlState({ activeDialog: null }, 'replace')
  }, [navigateTripDetailUrlState])

  function handleTripSettingsSave(draft: TripSettingsDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to update trip settings.')
      return
    }

    void runMutation('Saving trip settings', async () => {
      const mediaId = draft.coverFile
        ? await uploadMedia(draft.coverFile, accessToken)
        : undefined
      const updatedTrip = await updateTrip({
        accessToken,
        payload: toTripUpdatePayload(draft, mediaId),
        tripId,
      })
      setTrip(toTripViewModel(updatedTrip))
      closeDialog()
    })
  }

  function handleTripDelete() {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to delete this trip.')
      return
    }

    void runMutation('Deleting trip', async () => {
      await deleteTrip({ accessToken, tripId })
      window.location.assign(
        currentUser?.profile?.username
          ? `/users/${encodeURIComponent(currentUser.profile.username)}`
          : '/',
      )
    })
  }

  function handleShareLinkCreate(draft: ShareLinkCreateDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to create share links.')
      return
    }

    void runMutation('Creating share link', async () => {
      const shareLink = await createTripShareLink({
        accessToken,
        payload: {
          display_name: draft.displayName,
          display_name_locked: draft.displayNameLocked,
          expires_at: draft.expiresAt
            ? toPostOccurredAtValue(draft.expiresAt)
            : null,
          interactions_enabled: draft.interactionsEnabled,
          label: draft.label,
        },
        tripId,
      })
      setTripShareLinks((currentLinks) => [
        toShareLinkViewModel(shareLink),
        ...currentLinks,
      ])
    })
  }

  function handleShareLinkRevoke(link: ShareLinkViewModel) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to revoke share links.')
      return
    }

    void runMutation('Revoking share link', async () => {
      await revokeTripShareLink({
        accessToken,
        shareLinkId: link.id,
        tripId,
      })
      setTripShareLinks((currentLinks) =>
        currentLinks.filter((currentLink) => currentLink.id !== link.id),
      )
    })
  }

  function handleShareLinkUpdate(link: ShareLinkViewModel) {
    if (!tripId || !accessToken) return
    void runMutation('Updating share link', async () => {
      const updated = await updateTripShareLink({
        accessToken,
        payload: {
          display_name: link.displayName,
          display_name_locked: link.displayNameLocked,
          expires_at: link.expiresAt
            ? toPostOccurredAtValue(link.expiresAt)
            : null,
          interactions_enabled: link.interactionsEnabled,
        },
        shareLinkId: link.id,
        tripId,
      })
      setTripShareLinks((links) => links.map((item) =>
        item.id === link.id ? toShareLinkViewModel(updated) : item,
      ))
    })
  }

  function handleViewerAdd(draft: UserLookupDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to add viewers.')
      return
    }

    void runMutation('Adding viewer', async () => {
      const viewer = await addTripViewer({
        accessToken,
        payload: { user_id: draft.user.id },
        tripId,
      })
      setTripViewers((currentViewers) =>
        upsertById(currentViewers, toTripViewerViewModel(viewer)),
      )
    })
  }

  function handleViewerRemove(viewer: TripViewerViewModel) {
    const userId = viewer.userId
    if (!tripId || !accessToken || !userId) {
      setMutationError('Sign in to remove viewers.')
      return
    }

    void runMutation('Removing viewer', async () => {
      await removeTripViewer({
        accessToken,
        tripId,
        userId,
      })
      setTripViewers((currentViewers) =>
        currentViewers.filter((currentViewer) => currentViewer.id !== viewer.id),
      )
    })
  }

  function handleMemberAdd(draft: UserLookupDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to add members.')
      return
    }

    void runMutation('Adding member', async () => {
      const member = await addTripMember({
        accessToken,
        payload: {
          role: draft.role ?? 'MEMBER',
          user_id: draft.user.id,
        },
        tripId,
      })
      setTripMembers((currentMembers) =>
        upsertById(currentMembers, toTripMemberViewModel(member)),
      )
    })
  }

  function handleMemberRoleChange(member: TripMemberViewModel, role: TripRole) {
    const userId = member.userId
    if (!tripId || !accessToken || !userId) {
      setMutationError('Sign in to update members.')
      return
    }

    void runMutation('Updating member role', async () => {
      const updatedMember = await updateTripMember({
        accessToken,
        payload: { role },
        tripId,
        userId,
      })
      setTripMembers((currentMembers) =>
        upsertById(currentMembers, toTripMemberViewModel(updatedMember)),
      )
    })
  }

  function handleMemberRemove(member: TripMemberViewModel) {
    const userId = member.userId
    if (!tripId || !accessToken || !userId) {
      setMutationError('Sign in to remove members.')
      return
    }

    void runMutation('Removing member', async () => {
      await removeTripMember({
        accessToken,
        tripId,
        userId,
      })
      setTripMembers((currentMembers) =>
        currentMembers.filter((currentMember) => currentMember.id !== member.id),
      )
    })
  }

  function handleStopChange(stopId: string, updates: Partial<Stop>) {
    const stop = plannedStops.find((item) => item.id === stopId)
    if (!stop || !accessToken) {
      return
    }

    const nextStop = {
      ...stop,
      ...updates,
    }
    handleStopSave(stopId, {
      notes: nextStop.notes,
      plannedNights: nextStop.planned_nights,
      plannedStartDate: nextStop.planned_start_date,
      title: nextStop.title,
    })
  }

  function handleStopSave(stopId: string, draft: StopEditDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to update itinerary stops.')
      return
    }

    void runMutation('Saving stop', async () => {
      const payload: ItineraryStopUpdatePayload = {
        notes: draft.notes,
        planned_nights: draft.plannedNights,
        placement: {
          after_stop_id: getPreviousSameDateStopId(
            plannedStops,
            stopId,
            draft.plannedStartDate,
          ),
          planned_start_date: draft.plannedStartDate,
        },
        title: draft.title,
      }

      const itinerary = await updateItineraryStop({
        accessToken,
        itineraryRevision,
        payload,
        stopId,
        tripId,
      })
      applyItinerary(itinerary)
    })
  }

  function handleTravelLegSave(legId: string, draft: TravelLegEditDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to update travel legs.')
      return
    }

    void runMutation('Saving travel leg', async () => {
      const result = await replaceItineraryTravelLeg({
        accessToken,
        itineraryRevision,
        legId,
        payload: toTravelLegPayload(draft),
        tripId,
      })
      setTravelLegs((currentLegs) =>
        currentLegs.map((leg) => (leg.id === legId ? result.leg : leg)),
      )
      if (result.itineraryRevision !== null) {
        setItineraryRevision(result.itineraryRevision)
      }
      await reloadItineraryUntilRouteReady(
        legId,
        canUseProviderRoute(draft.travelMode),
      )
    })
  }

  function handleTravelLegRouteRefresh(legId: string) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to refresh travel routes.')
      return
    }

    void runMutation('Refreshing route', async () => {
      const result = await refreshItineraryTravelLegRoute({
        accessToken,
        legId,
        tripId,
      })
      setTravelLegs((currentLegs) =>
        currentLegs.map((leg) => (leg.id === legId ? result.leg : leg)),
      )
      if (result.itineraryRevision !== null) {
        setItineraryRevision(result.itineraryRevision)
      }
      await reloadItineraryUntilRouteReady(
        legId,
        canUseProviderRoute(result.leg.travel_mode),
      )
    })
  }

  function handleStopDelete(stopId: string) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to delete itinerary stops.')
      return
    }

    void runMutation('Deleting stop', async () => {
      const itinerary = await deleteItineraryStop({
        accessToken,
        itineraryRevision,
        stopId,
        tripId,
      })
      applyItinerary(itinerary)
    })
  }

  function handleCreateStop(draft: CreateStopDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to create itinerary stops.')
      return
    }

    void runMutation('Creating stop', async () => {
      const itinerary = await createItineraryStop({
        accessToken,
        itineraryRevision,
        payload: toCreateStopPayload(draft, plannedStops),
        tripId,
      })
      applyItinerary(itinerary)
      setDraftStopLocation(null)
      navigateTripDetailUrlState(
        {
          mode: 'planning',
          planningView: 'stops',
          travelingView: 'posts',
        },
        'replace',
      )
    })
  }

  function handlePostSubmit(postId: string | null, draft: PostSubmitDraft) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to save travel posts.')
      return
    }

    void runMutation(postId ? 'Saving post' : 'Creating post', async () => {
      const mediaIds = getPostDraftMediaIds(draft.media)
      if (postId) {
        await updatePost({
          accessToken,
          payload: toPostUpdatePayload(draft, mediaIds),
          postId,
          tripId,
        })
        if (draft.publicationAction === 'publish') {
          await publishPost({ accessToken, postId, tripId })
        } else if (draft.publicationAction === 'draft') {
          await unpublishPost({ accessToken, postId, tripId })
        }
      } else {
        await createPost({
          accessToken,
          payload: toPostCreatePayload(draft, mediaIds),
          tripId,
        })
      }
      const { posts, trackingGeometry } = await fetchTravelTimeline()
      setTravelPosts(posts)
      setTrackingGeometry(trackingGeometry)

      setDraftPostLocation(null)
      setSelectedGpsPostCandidate(null)
      navigateTripDetailUrlState(
        {
          editingPostId: null,
          mode: 'traveling',
          planningView: 'stops',
          travelingView: 'posts',
        },
        'replace',
      )
    })
  }

  function handlePostPublish(postId: string) {
    if (!tripId || !accessToken) {
      setMutationError('Sign in to publish travel posts.')
      return
    }

    void runMutation('Publishing post', async () => {
      await publishPost({ accessToken, postId, tripId })
      const { posts, trackingGeometry } = await fetchTravelTimeline()
      setTravelPosts(posts)
      setTrackingGeometry(trackingGeometry)
    })
  }

  function handlePostDelete(postId: string) {
    const finishPostDelete = () => {
      setDraftPostLocation(null)
      setSelectedGpsPostCandidate(null)
      setMapPointTarget(null)
      setMobileMapPickerTarget(null)
      setFocusedPostId(null)
      setPostScrollRequest(null)
      navigateTripDetailUrlState(
        {
          editingPostId: null,
          mode: 'traveling',
          planningView: 'stops',
          travelingView: 'posts',
        },
        'replace',
      )
    }

    if (!tripId || !accessToken) {
      setMutationError('Sign in to delete travel posts.')
      return
    }

    void runMutation('Deleting post', async () => {
      await deletePost({ accessToken, postId, tripId })
      const { posts, trackingGeometry } = await fetchTravelTimeline()
      setTravelPosts(posts)
      setTrackingGeometry(trackingGeometry)
      finishPostDelete()
    })
  }

  const applyDraftMapPointLocation = useCallback(
    (target: MapPointTarget, coordinates: L.LatLngTuple) => {
      const selectedTarget = target
      const draftLocation = createDraftMapPointLocation(coordinates, target)

      if (target === 'post') {
        setSelectedGpsPostCandidate(null)
        setDraftPostLocation(draftLocation)
        navigateTripDetailUrlState({
          editingPostId: urlStateRef.current.editingPostId,
          mode: 'traveling',
          planningView: 'stops',
          travelingView:
            urlStateRef.current.travelingView === 'edit-post'
              ? 'edit-post'
              : 'create-post',
        })
        setMapPointTarget(selectedTarget)
      } else {
        setDraftStopLocation(draftLocation)
      }

      void createReverseGeocodedDraftMapPointLocation(coordinates, selectedTarget)
        .then((resolvedLocation) => {
          if (selectedTarget === 'post') {
            setDraftPostLocation((currentLocation) =>
              hasSameCoordinates(currentLocation?.coordinates, coordinates)
                ? resolvedLocation
                : currentLocation,
            )
            return
          }

          setDraftStopLocation((currentLocation) =>
            hasSameCoordinates(currentLocation?.coordinates, coordinates)
              ? resolvedLocation
              : currentLocation,
          )
        })
        .catch(() => undefined)
    },
    [navigateTripDetailUrlState],
  )

  const handleDraftMapPointSelect = useCallback(
    (coordinates: L.LatLngTuple) => {
      if (!mapPointTarget) {
        return
      }

      applyDraftMapPointLocation(mapPointTarget, coordinates)
    },
    [applyDraftMapPointLocation, mapPointTarget],
  )

  const handleMapPointTargetChange = useCallback(
    (target: MapPointTarget | null) => {
      setMapPointTarget(target)

      if (!target) {
        setMobileMapPickerTarget(null)
        return
      }

      if (shouldUseMobileMapPicker) {
        setMobileMapPickerTarget(target)
      }
    },
    [shouldUseMobileMapPicker],
  )

  const handleGpsPostCandidateSelect = useCallback(
    (candidate: GpsPostCandidate) => {
      const coordinates: L.LatLngTuple = [candidate.latitude, candidate.longitude]

      setFocusedPostId(null)
      applyDraftMapPointLocation('post', coordinates)
      // Location follows the ordinary map-click path. This is only the
      // timestamp seed that distinguishes a retained GPS measurement.
      setSelectedGpsPostCandidate(candidate)
    },
    [applyDraftMapPointLocation],
  )

  const handleModeChange = useCallback(
    (nextMode: TripMode) => {
      setFocusedPostId(null)
      navigateTripDetailUrlState({
        activeDialog: null,
        editingPostId: null,
        mode: nextMode,
        planningView: 'stops',
        travelingView: 'posts',
      })
    },
    [navigateTripDetailUrlState],
  )

  const handlePlanningViewChange = useCallback(
    (nextView: PlanningView) => {
      navigateTripDetailUrlState(
        {
          editingPostId: null,
          mode: 'planning',
          planningView: nextView,
          travelingView: 'posts',
        },
        nextView === 'stops' ? 'replace' : 'push',
      )
    },
    [navigateTripDetailUrlState],
  )

  const handleTravelingViewChange = useCallback(
    (nextView: TravelingView) => {
      if (nextView !== 'create-post') {
        setSelectedGpsPostCandidate(null)
      } else {
        setDraftPostLocation(null)
        setSelectedGpsPostCandidate(null)
      }
      navigateTripDetailUrlState(
        {
          editingPostId: null,
          mode: 'traveling',
          planningView: 'stops',
          travelingView: nextView,
        },
        nextView === 'posts' ? 'replace' : 'push',
      )
    },
    [navigateTripDetailUrlState],
  )

  const handleEditPost = useCallback(
    (postId: string) => {
      setSelectedGpsPostCandidate(null)
      setFocusedPostId(getMapFocusedPostId(postId, travelPosts))
      navigateTripDetailUrlState({
        editingPostId: postId,
        mode: 'traveling',
        planningView: 'stops',
        travelingView: 'edit-post',
      })
    },
    [navigateTripDetailUrlState, travelPosts],
  )

  const handleFocusedPostChange = useCallback((postId: string | null) => {
    setFocusedPostId((currentPostId) =>
      currentPostId === postId ? currentPostId : postId,
    )
  }, [])

  const handlePostSocialSummary = useCallback(
    (postId: string, social: PostSocialSummary) => {
      setTravelPosts((posts) =>
        posts.map((post) =>
          post.id === postId
            ? {
                ...post,
                social: {
                  canInteract: social.can_interact,
                  canLike: social.can_like,
                  commentCount: social.comment_count,
                  likeCount: social.like_count,
                  viewerHasLiked: social.viewer_has_liked,
                },
              }
            : post,
        ),
      )
    },
    [],
  )

  const handleMapPostSelect = useCallback((postId: string) => {
    setFocusedPostId(postId)
    setPostScrollRequest((currentRequest) => ({
      postId,
      sequence: (currentRequest?.sequence ?? 0) + 1,
    }))
  }, [])

  useEffect(() => {
    const currentState = {
      activeDialog,
      managementSection,
      editingPostId,
      mode,
      planningView,
      travelingView,
    }
    const normalizedState = normalizeTripDetailUrlState(currentState, {
      canEditTravelPosts: canMutate,
      canOpenManagementDialogs: canMutate,
      canSwitchModes,
      travelPosts,
    })

    urlStateRef.current = normalizedState
    if (!areTripDetailUrlStatesEqual(normalizedState, currentState)) {
      applyTripDetailUrlState(normalizedState)
      writeTripDetailUrlState(normalizedState, 'replace')
    }
  }, [
    activeDialog,
    applyTripDetailUrlState,
    canManageTrip,
    canMutate,
    canSwitchModes,
    editingPostId,
    mode,
    managementSection,
    planningView,
    travelingView,
    travelPosts,
  ])

  useEffect(() => {
    function handlePopState() {
      applyTripDetailUrlState(
        readTripDetailUrlState({
          canEditTravelPosts: canMutate,
          canOpenManagementDialogs: canMutate,
          canSwitchModes,
          travelPosts,
        }),
      )
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [
    applyTripDetailUrlState,
    canManageTrip,
    canMutate,
    canSwitchModes,
    travelPosts,
  ])

  const activeDraftMapLocation =
    mapPointTarget === 'post'
      ? draftPostLocation
      : mapPointTarget === 'stop'
        ? draftStopLocation
        : null
  const mobileMapPickerLocation =
    mobileMapPickerTarget === 'post'
      ? draftPostLocation
      : mobileMapPickerTarget === 'stop'
        ? draftStopLocation
        : null
  const visibleMode: TripMode = canSwitchModes ? mode : 'traveling'
  const upcomingStops = getUpcomingStops(plannedStops)
  const mapRouteMode: MapRouteMode =
    visibleMode === 'traveling' ? 'travel-timeline' : 'itinerary'
  const visibleStops =
    visibleMode === 'traveling' ? upcomingStops : plannedStops
  const mobileMapPickerStops =
    mobileMapPickerTarget === 'post' ? upcomingStops : plannedStops
  const mobileMapPickerRouteMode: MapRouteMode =
    mobileMapPickerTarget === 'post' ? 'travel-timeline' : 'itinerary'

  useEffect(() => {
    if (!shouldUseMobileMapPicker) {
      setMobileMapPickerTarget(null)
    }
  }, [shouldUseMobileMapPicker])

  useEffect(() => {
    if (visibleMode !== 'traveling') {
      setFocusedPostId(null)
    }
  }, [visibleMode])

  if (authStatus === 'loading') {
    return <LoadingState label="Checking session" />
  }

  if (loadState.status === 'loading') {
    return <LoadingState label="Loading trip" />
  }

  if (loadState.status === 'error') {
    return (
      <div className="py-8 sm:py-10">
        <EmptyState
          description={loadState.error}
          title="Unable to load trip"
        />
      </div>
    )
  }

  return (
    <div className="relative z-0 min-h-[calc(100dvh-4rem-1px)] w-full overflow-x-hidden py-3 lg:left-1/2 lg:h-[calc(100dvh-4rem-1px)] lg:w-screen lg:-translate-x-1/2 lg:overflow-hidden lg:px-6">
      <div className="min-h-0 w-full lg:h-full">
        <div
          className={cn(
            'grid min-h-0 gap-4 lg:h-full',
            canSwitchModes
              ? 'lg:grid-cols-[minmax(28rem,45%)_minmax(0,1fr)]'
              : 'lg:grid-cols-[minmax(28rem,42%)_minmax(0,1fr)]',
          )}
        >
          <div
            className={cn(
              'min-h-0 min-w-0',
              canSwitchModes &&
                'lg:grid lg:grid-cols-[4.75rem_minmax(0,1fr)] lg:gap-3',
            )}
          >
            {canSwitchModes ? (
              <TripModeDock mode={mode} onModeChange={handleModeChange} />
            ) : null}
            <TripSidebar
              accessToken={accessToken}
              shareToken={shareToken}
              canManageTrip={canManageTrip}
              canMutate={canMutate}
              currentUserId={currentUser?.id ?? null}
              draftPostLocation={draftPostLocation}
              draftStopLocation={draftStopLocation}
              gpsPostCandidates={gpsPostCandidates}
              gpsPostCandidate={selectedGpsPostCandidate}
              focusedPostId={focusedPostId}
              isMutating={isMutating}
              isTripOngoing={isTripCurrentlyOngoing}
              mapPointTarget={mapPointTarget}
              mode={visibleMode}
              mutationError={activeDialog === null ? mutationError : null}
              onMapPointTargetChange={handleMapPointTargetChange}
              onGpsPostCandidateSelect={handleGpsPostCandidateSelect}
              onPostMarkerSelect={handleMapPostSelect}
              onCreateStop={handleCreateStop}
              onFocusedPostChange={handleFocusedPostChange}
              onPostSocialSummary={handlePostSocialSummary}
              onOpenManagement={openManagement}
              onEditPost={handleEditPost}
              onPostDelete={handlePostDelete}
              onPostPublish={handlePostPublish}
              onPostSubmit={handlePostSubmit}
              onPlanningViewChange={handlePlanningViewChange}
              onRefreshTravelLegRoute={handleTravelLegRouteRefresh}
              onStopSave={handleStopSave}
              onStopChange={handleStopChange}
              onStopDelete={handleStopDelete}
              onTravelLegSave={handleTravelLegSave}
              onTravelingViewChange={handleTravelingViewChange}
              pendingAction={pendingAction}
              postScrollRequest={postScrollRequest}
              editingPostId={editingPostId}
              planningView={planningView}
              reserveMobileModeSwitchSpace={canSwitchModes}
              showMobileTravelMap={shouldUseMobileMapPicker}
              stops={visibleStops}
              trip={trip}
              travelLegs={travelLegs}
              trackingGeometry={trackingGeometry}
              tripMembers={tripMembers}
              travelPosts={travelPosts}
              travelingView={travelingView}
            />
          </div>
          {!shouldUseMobileMapPicker ? (
            <MapWorkspace
              draftMapLocation={activeDraftMapLocation}
              mapPointEnabled={mapPointTarget !== null}
              focusedPostId={focusedPostId}
              gpsPostCandidates={gpsPostCandidates}
              isTripOngoing={isTripCurrentlyOngoing}
              onDraftMapPointSelect={handleDraftMapPointSelect}
              onGpsPostCandidateSelect={handleGpsPostCandidateSelect}
              onPostMarkerSelect={handleMapPostSelect}
              routeMode={mapRouteMode}
              stops={visibleStops}
              travelLegs={travelLegs}
              trackingGeometry={trackingGeometry}
              travelPosts={travelPosts}
            />
          ) : null}
        </div>
      </div>

      {canMutate ? (
        <TripManagementDialog
          accessToken={accessToken}
          canManageLiveSharing={canManageTrip}
          canManageTrip={canManageTrip}
          error={mutationError}
          isSaving={isMutating}
          members={tripMembers}
          onClose={closeDialog}
          onCreateLink={handleShareLinkCreate}
          onDeleteTrip={handleTripDelete}
          onInviteMember={handleMemberAdd}
          onInviteViewer={handleViewerAdd}
          onRemoveMember={handleMemberRemove}
          onRemoveViewer={handleViewerRemove}
          onRevokeLink={handleShareLinkRevoke}
          onUpdateLink={handleShareLinkUpdate}
          onTrackingChanged={() => {
            // Mode edits and deletions change public geometry, so reload the
            // authoritative timeline rather than patching it locally.
            void Promise.all([fetchTravelTimeline(), fetchGpsPostCandidates()]).then(
              ([{ posts, trackingGeometry }, candidates]) => {
                setTravelPosts(posts)
                setTrackingGeometry(trackingGeometry)
                setGpsPostCandidates(candidates)
              },
            )
          }}
          onUpdateMemberRole={handleMemberRoleChange}
          onSaveSettings={handleTripSettingsSave}
          onSectionChange={(section) => {
            navigateTripDetailUrlState(
              { managementSection: section },
              'replace',
            )
          }}
          open={activeDialog === 'management'}
          section={managementSection}
          shareLinks={tripShareLinks}
          tripId={tripId}
          trip={trip}
          viewers={tripViewers}
        />
      ) : null}
      <MobileMapPointPicker
        initialLocation={mobileMapPickerLocation}
        isTripOngoing={isTripCurrentlyOngoing}
        onCancel={() => {
          setMobileMapPickerTarget(null)
          if (!mobileMapPickerLocation) {
            setMapPointTarget(null)
          }
        }}
        onConfirm={(coordinates) => {
          if (mobileMapPickerTarget) {
            applyDraftMapPointLocation(mobileMapPickerTarget, coordinates)
            setMapPointTarget(mobileMapPickerTarget)
          }
          setMobileMapPickerTarget(null)
        }}
        open={Boolean(mobileMapPickerTarget && shouldUseMobileMapPicker)}
        routeMode={mobileMapPickerRouteMode}
        stops={mobileMapPickerStops}
        target={mobileMapPickerTarget}
        travelLegs={travelLegs}
        trackingGeometry={trackingGeometry}
        travelPosts={travelPosts}
      />
      {canSwitchModes ? (
        <MobileModeSwitch
          mode={mode}
          onModeChange={handleModeChange}
        />
      ) : null}
    </div>
  )
}

function toPostMediaTuple(
  media: readonly PostMedia[],
): readonly [PostMedia, ...PostMedia[]] {
  if (media.length === 0) {
    throw new Error('Posts require at least one media item.')
  }

  return media as readonly [PostMedia, ...PostMedia[]]
}

async function createReverseGeocodedDraftMapPointLocation(
  coordinates: L.LatLngTuple,
  target: MapPointTarget,
): Promise<DraftPostLocation> {
  const fallbackLocation = createDraftMapPointLocation(coordinates, target)
  const results = await reverseGeocodePlaces({
    latitude: coordinates[0],
    limit: 1,
    longitude: coordinates[1],
  })
  const nearestPlace = results[0]?.place

  if (!nearestPlace) {
    return fallbackLocation
  }

  const prefix = target === 'stop' ? 'Near' : 'At'
  return {
    coordinates,
    label: `${prefix} ${getPlaceNameLabel(nearestPlace)}`,
  }
}

function hasSameCoordinates(
  left: L.LatLngTuple | undefined,
  right: L.LatLngTuple,
) {
  return Boolean(
    left &&
      Math.abs(left[0] - right[0]) < 0.00001 &&
      Math.abs(left[1] - right[1]) < 0.00001,
  )
}

function createLoadingTrip(tripId: string): TripViewModel {
  return {
    description: '',
    endDate: '',
    id: tripId,
    name: 'Loading trip',
    startDate: '',
    visibility: 'PRIVATE',
  }
}

function readShareTokenFromUrl() {
  if (typeof window === 'undefined') {
    return null
  }

  return new URLSearchParams(window.location.search).get('share')
}

function toTripViewModel(trip: Trip): TripViewModel {
  return {
    description: trip.description,
    endDate: trip.end_date ?? '',
    id: trip.id,
    name: trip.name,
    startDate: trip.start_date,
    visibility: trip.visibility,
  }
}

function toTripUpdatePayload(
  draft: TripSettingsDraft,
  mediaId?: string,
): TripUpdatePayload {
  return {
    description: draft.description,
    end_date: draft.endDate,
    ...(mediaId ? { media_id: mediaId } : {}),
    name: draft.name,
    start_date: draft.startDate,
    visibility: draft.visibility,
  }
}

function toTripMemberViewModel(member: TripMember): TripMemberViewModel {
  return {
    email: getUserSubtitle(member.user),
    id: member.user_id,
    name: getUserDisplayName(member.user),
    profilePicture: member.user.profile_picture,
    role: member.role,
    userId: member.user_id,
    username: member.user.username,
  }
}

function toTripViewerViewModel(viewer: TripViewer): TripViewerViewModel {
  return {
    email: getUserSubtitle(viewer.user),
    id: viewer.user_id,
    name: getUserDisplayName(viewer.user),
    userId: viewer.user_id,
  }
}

function toShareLinkViewModel(
  link: TripShareLink | TripShareLinkCreateResponse,
): ShareLinkViewModel {
  return {
    displayName: link.display_name,
    displayNameLocked: link.display_name_locked,
    expiresAt: link.expires_at,
    id: link.id,
    label: link.label?.trim() || 'Untitled link',
    lastUsedAt: link.last_used_at
      ? formatDateTimeLabel(link.last_used_at)
      : null,
    interactionsEnabled: link.interactions_enabled,
    token: 'token' in link ? link.token : null,
    tripId: link.trip_id,
  }
}

function upsertById<TItem extends { id: string }>(
  items: readonly TItem[],
  item: TItem,
) {
  return items.some((currentItem) => currentItem.id === item.id)
    ? items.map((currentItem) =>
        currentItem.id === item.id ? item : currentItem,
      )
    : [item, ...items]
}

function toTravelTimelinePostViewModel(entry: PostTimelineEntry): TravelPost {
  return toTravelPostViewModel(
    entry.post,
    toTravelPostRouteViewModel(entry.route_after),
  )
}

function toTravelPostViewModel(
  post: Post,
  routeAfter: TravelPostRoute | null,
): TravelPost {
  const coordinates: L.LatLngTuple = [
    post.location.latitude,
    post.location.longitude,
  ]
  const media = post.media.map(toPostMediaViewModel)
  const authorName =
    [post.author.first_name, post.author.last_name]
      .filter(Boolean)
      .join(' ') ||
    post.author.username ||
    'User'
  const authorInitials =
    [post.author.first_name?.[0], post.author.last_name?.[0]]
      .filter(Boolean)
      .join('') ||
    post.author.username?.slice(0, 2) ||
    'U'

  return {
    author: {
      displayName: authorName,
      id: post.author.id,
      initials: authorInitials.toUpperCase(),
      profilePicture: post.author.profile_picture,
    },
    coordinates,
    excerpt: post.body,
    id: post.id,
    isDraft: post.published_at === null,
    location: post.location.full_name || post.location.name,
    media: toPostMediaTuple(
      media.length > 0 ? media : [createFallbackPostMedia(post.title)],
    ),
    occurred_at: post.occurred_at,
    routeAfter,
    time: formatDateTimeLabel(post.occurred_at),
    title: post.title,
    social: {
      canInteract: post.social.can_interact,
      canLike: post.social.can_like,
      commentCount: post.social.comment_count,
      likeCount: post.social.like_count,
      viewerHasLiked: post.social.viewer_has_liked,
    },
  }

}

function toTravelPostRouteViewModel(
  route: PostTimelineRoute | PostTimelineOpeningRoute | null,
): TravelPostRoute | null {
  if (!route) {
    return null
  }

  const segments = route.segments.flatMap((segment) => {
    const coordinates = getGeoJsonLineStringCoordinates(segment.geometry)
    return coordinates
      ? [
          {
            coordinates,
            travelMode: segment.travel_mode,
            visibleToMembersOnly: segment.visible_to_members_only,
          },
        ]
      : []
  })

  return segments.length > 0
    ? {
        durationSeconds:
          'duration_seconds' in route ? route.duration_seconds : null,
        segments,
      }
    : null
}

function toPostMediaViewModel(media: Post['media'][number]): PostMedia {
  return {
    alt: media.metadata.caption || `${media.media_type.toLowerCase()} media`,
    media_id: media.id,
    poster: media.media_type === 'VIDEO' ? media.urls.thumbnail ?? undefined : undefined,
    src: media.urls.content,
    thumbnail: media.urls.thumbnail ?? undefined,
    type: media.media_type === 'VIDEO' ? 'video' : 'image',
  }
}

function createFallbackPostMedia(title: string): PostMedia {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520">',
    '<rect width="800" height="520" fill="#ecfdf5"/>',
    '<circle cx="400" cy="230" r="84" fill="#0f766e" opacity="0.18"/>',
    '<path d="M250 345 355 240l68 68 43-43 105 80H250Z" fill="#0f766e" opacity="0.42"/>',
    '</svg>',
  ].join('')

  return {
    alt: `${title} media placeholder`,
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
  }
}

function toCreateStopPayload(
  draft: CreateStopDraft,
  stops: readonly Stop[],
): ItineraryStopCreatePayload {
  const afterStop = stops.find((stop) => stop.id === draft.afterStopId) ?? null

  return {
    incoming_travel: null,
    location: toLocationInput(draft.placeId, draft.coordinates),
    notes: draft.notes,
    outgoing_travel: null,
    placement: {
      after_stop_id:
        afterStop?.planned_start_date === draft.plannedStartDate
          ? afterStop.id
          : null,
      planned_start_date: draft.plannedStartDate,
    },
    planned_nights: draft.plannedNights,
    title: draft.title,
  }
}

function toTravelLegPayload(
  draft: TravelLegEditDraft,
): ItineraryTravelReplacePayload {
  return {
    notes: draft.notes,
    operator: draft.operator,
    reference: draft.reference,
    travel_mode: draft.travelMode,
  }
}

function toPostCreatePayload(
  draft: PostSubmitDraft,
  mediaIds: string[],
): PostCreatePayload {
  return {
    body: draft.story,
    location: toLocationInput(draft.placeId, draft.coordinates),
    media_ids: mediaIds,
    occurred_at: draft.occurredAt,
    publish: draft.publish,
    title: draft.title,
  }
}

function toPostUpdatePayload(
  draft: PostSubmitDraft,
  mediaIds: string[],
): PostUpdatePayload {
  return {
    body: draft.story,
    location: toLocationInput(draft.placeId, draft.coordinates),
    media_ids: mediaIds,
    occurred_at: draft.occurredAt,
    title: draft.title,
  }
}

function toLocationInput(placeId: string | null, coordinates: L.LatLngTuple) {
  if (placeId) {
    return { place_id: placeId }
  }

  return toLocationCoordinatesInput(coordinates)
}

function toLocationCoordinatesInput([latitude, longitude]: L.LatLngTuple) {
  return { latitude, longitude }
}

function getPostDraftMediaIds(media: readonly PostMedia[]) {
  return media
    .map((item) => item.media_id ?? null)
    .filter((mediaId): mediaId is string => Boolean(mediaId))
}

function getPreviousSameDateStopId(
  stops: readonly Stop[],
  stopId: string,
  plannedStartDate: string,
) {
  const sameDateStops = stops.filter(
    (stop) => stop.planned_start_date === plannedStartDate,
  )
  const stopIndex = sameDateStops.findIndex((stop) => stop.id === stopId)
  if (stopIndex <= 0) {
    return null
  }

  return sameDateStops[stopIndex - 1]?.id ?? null
}

function canUseProviderRoute(travelMode: TravelMode) {
  return travelMode === 'WALK' || travelMode === 'BIKE' || travelMode === 'CAR'
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
