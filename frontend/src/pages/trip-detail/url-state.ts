import type { Trip } from '@/api/client'
import { getTripTiming } from '@/lib/dates'

export type TripMode = 'planning' | 'traveling'
export type PlanningView = 'create-stop' | 'stops'
export type TravelingView = 'create-post' | 'edit-post' | 'posts'
export type TripDialog = 'management'
export type TripManagementSection = 'general' | 'people' | 'sharing' | 'albums' | 'gps' | 'danger'

export type TripDetailUrlState = {
  activeDialog: TripDialog | null
  managementSection: TripManagementSection
  editingPostId: string | null
  mode: TripMode
  /** The stop whose card is open, in Plan mode on the stop list. */
  openStopId: string | null
  planningView: PlanningView
  travelingView: TravelingView
}

export type TripDetailHistoryAction = 'push' | 'replace'

type UrlStatePermissions = {
  canEditTravelPosts: boolean
  canOpenManagementDialogs: boolean
  canSwitchModes: boolean
  travelPosts: readonly { id: string }[]
}

/** The tab a member lands on when the URL doesn't name one. */
export function getDefaultTripMode(
  trip: Pick<Trip, 'start_date' | 'end_date'>,
  today: Date = new Date(),
): TripMode {
  return getTripTiming(trip, today).status === 'upcoming'
    ? 'planning'
    : 'traveling'
}

export function hasTripModeInUrl(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const tab = new URLSearchParams(window.location.search).get('tab')
  return tab === 'travel' || tab === 'plan'
}

export function readTripDetailUrlState(
  permissions: UrlStatePermissions,
  defaultMode: TripMode = 'planning',
): TripDetailUrlState {
  const defaultState = createDefaultTripDetailUrlState(
    permissions.canSwitchModes,
    defaultMode,
  )

  if (typeof window === 'undefined') {
    return defaultState
  }

  const searchParams = new URLSearchParams(window.location.search)
  const tab = searchParams.get('tab')
  const panel = searchParams.get('panel')
  const postId = searchParams.get('post')
  const stopId = searchParams.get('stop')
  const dialog = searchParams.get('dialog')
  const section = searchParams.get('section')
  const managementSection = isTripManagementSection(section)
    ? section
    : 'general'
  const mode: TripMode =
    tab === 'travel'
      ? 'traveling'
      : tab === 'plan'
        ? 'planning'
        : defaultState.mode

  return normalizeTripDetailUrlState(
    {
      activeDialog: dialog === 'management' ? 'management' : null,
      managementSection,
      editingPostId: panel === 'edit-post' ? postId : null,
      mode,
      openStopId: stopId || null,
      planningView: panel === 'new-stop' ? 'create-stop' : 'stops',
      travelingView:
        panel === 'new-post'
          ? 'create-post'
          : panel === 'edit-post'
            ? 'edit-post'
            : 'posts',
    },
    permissions,
  )
}

export function createDefaultTripDetailUrlState(
  canSwitchModes: boolean,
  defaultMode: TripMode = 'planning',
): TripDetailUrlState {
  return {
    activeDialog: null,
    managementSection: 'general',
    editingPostId: null,
    mode: canSwitchModes ? defaultMode : 'traveling',
    openStopId: null,
    planningView: 'stops',
    travelingView: 'posts',
  }
}

export function normalizeTripDetailUrlState(
  state: TripDetailUrlState,
  {
    canEditTravelPosts,
    canOpenManagementDialogs,
    canSwitchModes,
    travelPosts,
  }: UrlStatePermissions,
): TripDetailUrlState {
  const mode = canSwitchModes ? state.mode : 'traveling'
  const planningView = mode === 'planning' ? state.planningView : 'stops'
  let travelingView =
    mode === 'traveling' && canEditTravelPosts ? state.travelingView : 'posts'
  let editingPostId =
    mode === 'traveling' && canEditTravelPosts && travelingView === 'edit-post'
      ? state.editingPostId
      : null

  if (
    travelingView === 'edit-post' &&
    (!editingPostId || !travelPosts.some((post) => post.id === editingPostId))
  ) {
    travelingView = 'posts'
    editingPostId = null
  }
  return {
    activeDialog: canOpenManagementDialogs ? state.activeDialog : null,
    managementSection: state.managementSection,
    editingPostId,
    mode,
    openStopId: mode === 'planning' && planningView === 'stops' ? state.openStopId : null,
    planningView,
    travelingView,
  }
}

function isTripManagementSection(
  value: string | null,
): value is TripManagementSection {
  return (
    value === 'general' ||
    value === 'people' ||
    value === 'sharing' ||
    value === 'albums' ||
    value === 'gps' ||
    value === 'danger'
  )
}

export function writeTripDetailUrlState(
  state: TripDetailUrlState,
  historyAction: TripDetailHistoryAction,
) {
  if (typeof window === 'undefined') {
    return
  }

  const url = new URL(window.location.href)
  url.searchParams.delete('tab')
  url.searchParams.delete('panel')
  url.searchParams.delete('post')
  url.searchParams.delete('dialog')
  url.searchParams.delete('section')
  url.searchParams.delete('stop')

  url.searchParams.set('tab', state.mode === 'planning' ? 'plan' : 'travel')

  if (state.mode === 'planning' && state.planningView === 'create-stop') {
    url.searchParams.set('panel', 'new-stop')
  }
  if (state.mode === 'planning' && state.planningView === 'stops' && state.openStopId) {
    url.searchParams.set('stop', state.openStopId)
  }
  if (state.mode === 'traveling' && state.travelingView === 'create-post') {
    url.searchParams.set('panel', 'new-post')
  }
  if (
    state.mode === 'traveling' &&
    state.travelingView === 'edit-post' &&
    state.editingPostId
  ) {
    url.searchParams.set('panel', 'edit-post')
    url.searchParams.set('post', state.editingPostId)
  }
  if (state.activeDialog === 'management') {
    url.searchParams.set('dialog', 'management')
    url.searchParams.set('section', state.managementSection)
  }
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const nextUrl = `${url.pathname}${url.search}${url.hash}`

  if (nextUrl === currentUrl) {
    return
  }

  if (historyAction === 'replace') {
    window.history.replaceState(null, '', nextUrl)
    return
  }

  window.history.pushState(null, '', nextUrl)
}

export function areTripDetailUrlStatesEqual(
  leftState: TripDetailUrlState,
  rightState: TripDetailUrlState,
) {
  return (
    leftState.activeDialog === rightState.activeDialog &&
    leftState.managementSection === rightState.managementSection &&
    leftState.editingPostId === rightState.editingPostId &&
    leftState.mode === rightState.mode &&
    leftState.openStopId === rightState.openStopId &&
    leftState.planningView === rightState.planningView &&
    leftState.travelingView === rightState.travelingView
  )
}
