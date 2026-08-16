import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import {
  getErrorMessage,
  getUserByUsername,
  listTrips,
  type CurrentUser,
  type Trip,
  type TripStatusFilter,
  type User,
} from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { CreateTripModal } from '@/components/trips/create-trip-modal'
import { TripList } from '@/components/trips/trip-list'
import { TripOverviewActions } from '@/components/trips/trip-overview-actions'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { UserSummary } from '@/components/users/user-summary'

type UserTripOverviewPageProps = {
  accessToken?: string | null
  authStatus: AuthStatus
  currentUser: CurrentUser | null
  onNavigate: (to: string) => void
  username: string
}

type TripSectionStatus = Exclude<TripStatusFilter, 'all'>

type TripSectionState = {
  isLoadingMore: boolean
  page: number
  total: number
  trips: Trip[]
}

type OverviewState =
  | {
      error: null
      status: 'idle' | 'loading'
      sections: Record<TripSectionStatus, TripSectionState>
      total: 0
      user: null
    }
  | {
      error: null
      sections: Record<TripSectionStatus, TripSectionState>
      status: 'success'
      total: number
      user: User
    }
  | {
      error: string
      sections: Record<TripSectionStatus, TripSectionState>
      status: 'error'
      total: 0
      user: null
    }

const TRIPS_PAGE_SIZE = 12

const tripSectionConfigs = [
  {
    emptyDescription: 'Trips in progress will appear here.',
    emptyTitle: 'No live trips',
    sortOrder: 'desc',
    status: 'ongoing',
    title: 'Live trips',
  },
  {
    emptyDescription: 'Future trips will appear here.',
    emptyTitle: 'No upcoming trips',
    sortOrder: 'asc',
    status: 'upcoming',
    title: 'Upcoming trips',
  },
  {
    emptyDescription: 'Completed trips will appear here once an end date has passed.',
    emptyTitle: 'No past trips',
    sortOrder: 'desc',
    status: 'past',
    title: 'Past trips',
  },
] as const satisfies ReadonlyArray<{
  emptyDescription: string
  emptyTitle: string
  sortOrder: 'asc' | 'desc'
  status: TripSectionStatus
  title: string
}>

const initialState: OverviewState = {
  error: null,
  sections: createEmptySections(),
  status: 'idle',
  total: 0,
  user: null,
}

export function UserTripOverviewPage({
  accessToken,
  authStatus,
  currentUser,
  onNavigate,
  username,
}: UserTripOverviewPageProps) {
  const [state, setState] = useState<OverviewState>(initialState)
  const [createTripOpen, setCreateTripOpen] = useState(false)

  const loadOverview = useCallback(
    async (options: { isCurrent: () => boolean }) => {
      setState({
        error: null,
        sections: createEmptySections(),
        status: 'loading',
        total: 0,
        user: null,
      })

      try {
        const loadedUser = await getUserByUsername(username)
        const loadedSections = await Promise.all(
          tripSectionConfigs.map(async (section) => {
            const result = await listTrips({
              accessToken,
              page: 1,
              pageSize: TRIPS_PAGE_SIZE,
              sortBy: 'start_date',
              sortOrder: section.sortOrder,
              status: section.status,
              userId: loadedUser.id,
            })
            return [section.status, result] as const
          }),
        )

        if (!options.isCurrent()) {
          return
        }

        const sections = createEmptySections()
        for (const [sectionStatus, result] of loadedSections) {
          sections[sectionStatus] = {
            isLoadingMore: false,
            page: result.page,
            total: result.total,
            trips: result.items,
          }
        }

        setState({
          error: null,
          sections,
          status: 'success',
          total: sumSectionTotals(sections),
          user: loadedUser,
        })
      } catch (loadError) {
        if (!options.isCurrent()) {
          return
        }

        setState({
          error: getErrorMessage(loadError),
          sections: createEmptySections(),
          status: 'error',
          total: 0,
          user: null,
        })
      }
    },
    [accessToken, username],
  )

  useEffect(() => {
    if (authStatus === 'loading') {
      return undefined
    }

    let isCurrent = true

    void loadOverview({
      isCurrent: () => isCurrent,
    })

    return () => {
      isCurrent = false
    }
  }, [authStatus, loadOverview])

  if (authStatus === 'loading') {
    return <LoadingState label="Loading trips" />
  }

  if (state.status === 'idle' || state.status === 'loading') {
    return <LoadingState label="Loading trips" />
  }

  if (state.status === 'error') {
    return (
      <div className="py-8 sm:py-10">
        <EmptyState
          description={state.error}
          icon={AlertTriangle}
          title="Unable to load this user"
        />
      </div>
    )
  }

  if (state.status !== 'success') {
    return null
  }

  const isOwner = currentUser?.id === state.user.id
  const canCreateTrips =
    isOwner &&
    Boolean(accessToken) &&
    currentUser?.permissions.includes('trip:create')

  function handleTripCreated(trip: Trip) {
    onNavigate(`/trips/${encodeURIComponent(trip.id)}`)
  }

  async function handleLoadMore(sectionStatus: TripSectionStatus) {
    if (state.status !== 'success' || !state.user) {
      return
    }

    const section = state.sections[sectionStatus]
    if (section.isLoadingMore || section.trips.length >= section.total) {
      return
    }

    setState((current) => updateSectionLoading(current, sectionStatus, true))

    try {
      const result = await listTrips({
        accessToken,
        page: section.page + 1,
        pageSize: TRIPS_PAGE_SIZE,
        sortBy: 'start_date',
        sortOrder: getTripSectionSortOrder(sectionStatus),
        status: sectionStatus,
        userId: state.user.id,
      })

      setState((current) =>
        appendSectionTrips(current, sectionStatus, {
          page: result.page,
          total: result.total,
          trips: result.items,
        }),
      )
    } catch (loadError) {
      setState((current) => ({
        error: getErrorMessage(loadError),
        sections: current.sections,
        status: 'error',
        total: 0,
        user: null,
      }))
    }
  }

  return (
    <div className="space-y-8 py-6 sm:py-8 lg:py-10">
      <UserSummary
        isOwner={isOwner}
        totalTrips={state.total}
        user={state.user}
      />
      <TripOverviewActions
        canCreate={canCreateTrips}
        onCreateTrip={() => setCreateTripOpen(true)}
      />
      <div className="space-y-8">
        {tripSectionConfigs.map((sectionConfig) => {
          const section = state.sections[sectionConfig.status]
          const hasMore = section.trips.length < section.total

          return (
            <TripList
              description={`${section.total} ${
                section.total === 1 ? 'trip' : 'trips'
              }`}
              emptyDescription={sectionConfig.emptyDescription}
              emptyTitle={sectionConfig.emptyTitle}
              hasMore={hasMore}
              isLoadingMore={section.isLoadingMore}
              isOwner={isOwner}
              key={sectionConfig.status}
              onLoadMore={() => void handleLoadMore(sectionConfig.status)}
              showStatusBadge={sectionConfig.status === 'upcoming'}
              title={sectionConfig.title}
              total={section.total}
              trips={section.trips}
            />
          )
        })}
      </div>
      {canCreateTrips && accessToken ? (
        <CreateTripModal
          accessToken={accessToken}
          onClose={() => setCreateTripOpen(false)}
          onCreated={handleTripCreated}
          open={createTripOpen}
        />
      ) : null}
    </div>
  )
}

function createEmptySections(): Record<TripSectionStatus, TripSectionState> {
  return {
    ongoing: createEmptySection(),
    past: createEmptySection(),
    upcoming: createEmptySection(),
  }
}

function createEmptySection(): TripSectionState {
  return {
    isLoadingMore: false,
    page: 1,
    total: 0,
    trips: [],
  }
}

function sumSectionTotals(sections: Record<TripSectionStatus, TripSectionState>) {
  return Object.values(sections).reduce((total, section) => total + section.total, 0)
}

function getTripSectionSortOrder(sectionStatus: TripSectionStatus): 'asc' | 'desc' {
  return (
    tripSectionConfigs.find((section) => section.status === sectionStatus)
      ?.sortOrder ?? 'desc'
  )
}

function updateSectionLoading(
  state: OverviewState,
  sectionStatus: TripSectionStatus,
  isLoadingMore: boolean,
): OverviewState {
  if (state.status !== 'success') {
    return state
  }

  return {
    ...state,
    sections: {
      ...state.sections,
      [sectionStatus]: {
        ...state.sections[sectionStatus],
        isLoadingMore,
      },
    },
  }
}

function appendSectionTrips(
  state: OverviewState,
  sectionStatus: TripSectionStatus,
  nextSection: Pick<TripSectionState, 'page' | 'total' | 'trips'>,
): OverviewState {
  if (state.status !== 'success') {
    return state
  }

  const sections = {
    ...state.sections,
    [sectionStatus]: {
      isLoadingMore: false,
      page: nextSection.page,
      total: nextSection.total,
      trips: [...state.sections[sectionStatus].trips, ...nextSection.trips],
    },
  }

  return {
    ...state,
    sections,
    total: sumSectionTotals(sections),
  }
}
