export type TripMode = 'planning' | 'traveling'
export type PlanningView = 'create-stop' | 'stops'
export type TravelingView = 'create-post' | 'edit-post' | 'posts'
export type TripDialog = 'management'
export type TripManagementSection = 'general' | 'people' | 'sharing' | 'gps' | 'danger'

export type TripDetailUrlState = {
  activeDialog: TripDialog | null
  managementSection: TripManagementSection
  editingPostId: string | null
  mode: TripMode
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

export function readTripDetailUrlState(
  permissions: UrlStatePermissions,
): TripDetailUrlState {
  const defaultState = createDefaultTripDetailUrlState(
    permissions.canSwitchModes,
  )

  if (typeof window === 'undefined') {
    return defaultState
  }

  const searchParams = new URLSearchParams(window.location.search)
  const tab = searchParams.get('tab')
  const panel = searchParams.get('panel')
  const postId = searchParams.get('post')
  const mode: TripMode =
    tab === 'travel'
      ? 'traveling'
      : tab === 'plan'
        ? 'planning'
        : defaultState.mode

  return normalizeTripDetailUrlState(
    {
      activeDialog: null,
      managementSection: 'general',
      editingPostId: panel === 'edit-post' ? postId : null,
      mode,
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
): TripDetailUrlState {
  return {
    activeDialog: null,
    managementSection: 'general',
    editingPostId: null,
    mode: canSwitchModes ? 'planning' : 'traveling',
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
    planningView,
    travelingView,
  }
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

  url.searchParams.set('tab', state.mode === 'planning' ? 'plan' : 'travel')

  if (state.mode === 'planning' && state.planningView === 'create-stop') {
    url.searchParams.set('panel', 'new-stop')
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
    leftState.planningView === rightState.planningView &&
    leftState.travelingView === rightState.travelingView
  )
}
