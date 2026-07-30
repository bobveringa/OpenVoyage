import 'leaflet/dist/leaflet.css'

import * as L from 'leaflet'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bike,
  Bus,
  Camera,
  CalendarDays,
  Check,
  Clock,
  Compass,
  Copy,
  Download,
  Eye,
  Car,
  Globe2,
  ImagePlus,
  Link2,
  Lock,
  Mail,
  MapPin,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Navigation,
  PenLine,
  Plane,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  Ship,
  Settings,
  Footprints,
  Trash2,
  TrainFront,
  Upload,
  UserPlus,
  Users,
  Play,
  type LucideIcon,
  X,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type TouchEvent,
} from 'react'
import { createPortal } from 'react-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DatePicker, DateTimePicker } from '@/components/ui/date-time-picker'
import { EmptyState, LoadingState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  addTripMember,
  addTripViewer,
  createItineraryStop,
  createPost,
  createTripShareLink,
  deleteItineraryStop,
  geocodePlaces,
  getErrorMessage,
  getItinerary,
  getTrip,
  listTripMembers,
  listTripShareLinks,
  listTripViewers,
  listPosts,
  refreshItineraryTravelLegRoute,
  removeTripMember,
  removeTripViewer,
  replaceItineraryTravelLeg,
  reverseGeocodePlaces,
  revokeTripShareLink,
  searchUsers,
  updateItineraryStop,
  updatePost,
  updateTrip,
  updateTripMember,
  uploadMedia,
  type GeoJsonLineString,
  type Itinerary,
  type ItineraryStopCreatePayload,
  type ItineraryStopUpdatePayload,
  type ItineraryTravelRoute,
  type ItineraryRouteType,
  type ItineraryTravelReplacePayload,
  type Place,
  type Post,
  type PostCreatePayload,
  type PostUpdatePayload,
  type Trip,
  type TripMember,
  type TripShareLink,
  type TripShareLinkCreateResponse,
  type TripUpdatePayload,
  type TripViewer,
  type UserSummary,
} from '@/api/client'
import type { AuthStatus } from '@/auth/auth-context'
import { cn } from '@/lib/utils'

type TripMode = 'planning' | 'traveling'
type PlanningView = 'create-stop' | 'stops'
type TravelingView = 'create-post' | 'edit-post' | 'posts'
type MapPointTarget = 'post' | 'stop'
type RouteFitMode = 'mobile-picker' | 'mobile-travel' | 'workspace'
type TripDialog = 'actions' | 'members' | 'settings' | 'share'
type MockTripVisibility = 'PLATFORM_PUBLIC' | 'PRIVATE' | 'PUBLIC'
type MockTripRole = 'MEMBER' | 'OWNER'
type TravelMode =
  | 'BIKE'
  | 'BUS'
  | 'CAR'
  | 'FERRY'
  | 'FLIGHT'
  | 'OTHER'
  | 'TRAIN'
  | 'UNKNOWN'
  | 'WALK'

type MockTrip = {
  description: string
  endDate: string
  id: string
  name: string
  startDate: string
  visibility: MockTripVisibility
}

type MockTripMember = {
  email: string
  id: string
  name: string
  role: MockTripRole
  userId?: string
}

type MockTripViewer = {
  email: string
  id: string
  name: string
  userId?: string
}

type MockShareLink = {
  expiresAt: string | null
  id: string
  label: string
  lastUsedAt: string | null
  token?: string | null
  tripId?: string
}

type MockUserSummary = {
  first_name: string | null
  id: string
  last_name: string | null
  username: string | null
}

type ItineraryLocation = {
  country_code: string
  full_name: string
  id: string
  latitude: number
  longitude: number
  name: string
  region: string
}

type Stop = {
  created_at: string
  created_by: MockUserSummary
  id: string
  location: ItineraryLocation
  notes: string
  planned_nights: number
  planned_start_date: string
  same_day_position: number
  title: string
  trip_id: string
  updated_at: string
  visited: boolean
}

type TravelLeg = {
  created_at: string
  from_stop_id: string
  id: string
  notes: string
  operator: string | null
  reference: string | null
  route: ItineraryTravelRoute
  to_stop_id: string
  travel_mode: TravelMode
  trip_id: string
  updated_at: string
}

type PostMedia = {
  alt: string
  file?: File
  media_id?: string
  poster?: string
  src: string
  type?: 'image' | 'video'
}

type TravelPost = {
  comments: number
  coordinates: L.LatLngTuple
  excerpt: string
  id: string
  location: string
  media: readonly [PostMedia, ...PostMedia[]]
  occurred_at: string
  time: string
  title: string
}

type DraftPostLocation = {
  coordinates: L.LatLngTuple
  label: string
}

type MapRouteMode = 'itinerary' | 'travel-timeline'
type RouteSegmentKind = 'itinerary' | 'post-link' | 'post-to-stop'

type RouteSegment = {
  coordinates: L.LatLngTuple[]
  kind: RouteSegmentKind
  routeType: ItineraryRouteType
}

type TripDetailHistoryAction = 'push' | 'replace'

type TripDetailUrlState = {
  activeDialog: TripDialog | null
  editingPostId: string | null
  mode: TripMode
  planningView: PlanningView
  travelingView: TravelingView
}

type TripDetailPageProps = {
  accessToken?: string | null
  authStatus?: AuthStatus
  tripId?: string
}

type TripDetailLoadState =
  | { error: null; status: 'idle' | 'loading' | 'success' }
  | { error: string; status: 'error' }

type CreateStopDraft = {
  afterStopId: string | null
  coordinates: L.LatLngTuple
  notes: string
  placeId: string | null
  plannedNights: number
  plannedStartDate: string
  title: string
}

type StopEditDraft = {
  notes: string
  plannedNights: number
  plannedStartDate: string
  title: string
}

type TravelLegEditDraft = {
  notes: string
  operator: string | null
  reference: string | null
  travelMode: TravelMode
}

type PostSubmitDraft = {
  coordinates: L.LatLngTuple
  locationLabel: string
  media: readonly PostMedia[]
  occurredAt: string
  placeId: string | null
  publish: boolean
  story: string
  title: string
}

type TripSettingsDraft = {
  description: string
  endDate: string | null
  name: string
  startDate: string
  visibility: MockTripVisibility
}

type ShareLinkCreateDraft = {
  expiresAt: string | null
  label: string | null
}

type UserLookupDraft = {
  query: string
  role?: MockTripRole
}

type PlaceSearchStatus = 'error' | 'idle' | 'loading' | 'success'

const earthRadiusKilometers = 6371
const geodesicSegmentKilometers = 125
const defaultMapCenter: L.LatLngTuple = [42.5, -3.5]
const defaultMapZoom = 4

const mockTrip: MockTrip = {
  description:
    'A rail-heavy route through Portugal, Spain, France, and the Italian mountains.',
  endDate: '2027-05-24',
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Portugal to the Dolomites',
  startDate: '2027-05-03',
  visibility: 'PRIVATE',
}

const mockItineraryTimestamp = '2027-04-20T12:00:00Z'

const mockItineraryCreator: MockUserSummary = {
  first_name: 'Bob',
  id: '22222222-2222-4222-8222-222222222222',
  last_name: 'Vermeer',
  username: 'bob',
}

const stopIds = {
  dolomites: '33333333-3333-4333-8333-333333333335',
  lisbon: '33333333-3333-4333-8333-333333333331',
  lyon: '33333333-3333-4333-8333-333333333334',
  madrid: '33333333-3333-4333-8333-333333333333',
  porto: '33333333-3333-4333-8333-333333333332',
} as const

const visibilityOptions = [
  { label: 'Private', value: 'PRIVATE' },
  { label: 'Platform public', value: 'PLATFORM_PUBLIC' },
  { label: 'Public', value: 'PUBLIC' },
] as const satisfies ReadonlyArray<{
  label: string
  value: MockTripVisibility
}>

const memberRoleOptions = [
  { label: 'Owner', value: 'OWNER' },
  { label: 'Member', value: 'MEMBER' },
] as const satisfies ReadonlyArray<{ label: string; value: MockTripRole }>

const travelModeOptions = [
  { label: 'Unknown', value: 'UNKNOWN' },
  { label: 'Walk', value: 'WALK' },
  { label: 'Bike', value: 'BIKE' },
  { label: 'Car', value: 'CAR' },
  { label: 'Bus', value: 'BUS' },
  { label: 'Train', value: 'TRAIN' },
  { label: 'Ferry', value: 'FERRY' },
  { label: 'Flight', value: 'FLIGHT' },
  { label: 'Other', value: 'OTHER' },
] as const satisfies ReadonlyArray<{ label: string; value: TravelMode }>

const mockTripMembers: readonly MockTripMember[] = [
  {
    email: 'bob@example.com',
    id: 'bob',
    name: 'Bob Vermeer',
    role: 'OWNER',
  },
  {
    email: 'nora@example.com',
    id: 'nora',
    name: 'Nora Lane',
    role: 'MEMBER',
  },
]

const mockTripViewers: readonly MockTripViewer[] = [
  {
    email: 'mila@example.com',
    id: 'mila',
    name: 'Mila Hart',
  },
  {
    email: 'sam@example.com',
    id: 'sam',
    name: 'Sam Park',
  },
]

const mockShareLinks: readonly MockShareLink[] = [
  {
    expiresAt: '2027-06-01T09:00',
    id: 'friends-link',
    label: 'Friends and family',
    lastUsedAt: 'Yesterday',
    token: 'mock-friends-family-token',
  },
  {
    expiresAt: '',
    id: 'planning-link',
    label: 'Planning review',
    lastUsedAt: 'Never',
    token: 'mock-planning-review-token',
  },
]

const initialStops: readonly Stop[] = [
  {
    created_at: mockItineraryTimestamp,
    created_by: mockItineraryCreator,
    id: stopIds.lisbon,
    location: {
      country_code: 'PT',
      full_name: 'Lisbon, Portugal',
      id: '44444444-4444-4444-8444-444444444441',
      latitude: 38.7223,
      longitude: -9.1393,
      name: 'Lisbon',
      region: 'Lisbon',
    },
    notes: 'Arrival, Alfama walk, late dinner near the overlook.',
    planned_nights: 3,
    planned_start_date: '2027-05-03',
    same_day_position: 0,
    title: 'Lisbon',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
    visited: true,
  },
  {
    created_at: mockItineraryTimestamp,
    created_by: mockItineraryCreator,
    id: stopIds.porto,
    location: {
      country_code: 'PT',
      full_name: 'Porto, Portugal',
      id: '44444444-4444-4444-8444-444444444442',
      latitude: 41.1579,
      longitude: -8.6291,
      name: 'Porto',
      region: 'Porto',
    },
    notes: 'Train north, bookshops, tiled churches, river evening.',
    planned_nights: 2,
    planned_start_date: '2027-05-07',
    same_day_position: 0,
    title: 'Porto',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
    visited: true,
  },
  {
    created_at: mockItineraryTimestamp,
    created_by: mockItineraryCreator,
    id: stopIds.madrid,
    location: {
      country_code: 'ES',
      full_name: 'Madrid, Spain',
      id: '44444444-4444-4444-8444-444444444443',
      latitude: 40.4168,
      longitude: -3.7038,
      name: 'Madrid',
      region: 'Community of Madrid',
    },
    notes: 'Museum day, neighborhood markets, early tapas route.',
    planned_nights: 4,
    planned_start_date: '2027-05-10',
    same_day_position: 0,
    title: 'Madrid',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
    visited: true,
  },
  {
    created_at: mockItineraryTimestamp,
    created_by: mockItineraryCreator,
    id: stopIds.lyon,
    location: {
      country_code: 'FR',
      full_name: 'Lyon, Auvergne-Rhone-Alpes, France',
      id: '44444444-4444-4444-8444-444444444444',
      latitude: 45.764,
      longitude: 4.8357,
      name: 'Lyon',
      region: 'Auvergne-Rhone-Alpes',
    },
    notes: 'Long rail day with a mountain transfer.',
    planned_nights: 1,
    planned_start_date: '2027-05-15',
    same_day_position: 0,
    title: 'Lyon transfer',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
    visited: false,
  },
  {
    created_at: mockItineraryTimestamp,
    created_by: mockItineraryCreator,
    id: stopIds.dolomites,
    location: {
      country_code: 'IT',
      full_name: 'Dolomites, Veneto, Italy',
      id: '44444444-4444-4444-8444-444444444445',
      latitude: 46.5405,
      longitude: 12.1357,
      name: 'Dolomites',
      region: 'Veneto',
    },
    notes: 'Trail days, lake ferry, final cabin stay.',
    planned_nights: 5,
    planned_start_date: '2027-05-17',
    same_day_position: 0,
    title: 'Dolomites',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
    visited: false,
  },
] as const

const initialTravelLegs: readonly TravelLeg[] = [
  {
    created_at: mockItineraryTimestamp,
    from_stop_id: stopIds.lisbon,
    id: '55555555-5555-4555-8555-555555555551',
    notes: 'Prefer the direct morning train so arrival still leaves time for dinner.',
    operator: 'Comboios de Portugal',
    reference: 'AP 130',
    route: createMockProviderRoute({
      coordinates: [
        [-9.1393, 38.7223],
        [-8.9439, 39.2619],
        [-8.8071, 40.2109],
        [-8.6291, 41.1579],
      ],
      distanceMeters: 332000,
      durationSeconds: 10800,
    }),
    to_stop_id: stopIds.porto,
    travel_mode: 'TRAIN',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
  },
  {
    created_at: mockItineraryTimestamp,
    from_stop_id: stopIds.porto,
    id: '55555555-5555-4555-8555-555555555552',
    notes: 'Long leg. Keep one flexible buffer day before committing the Madrid lodging.',
    operator: 'Iberia',
    reference: 'IB3095',
    route: createMockSimpleRoute([
      [-8.6291, 41.1579],
      [-3.7038, 40.4168],
    ]),
    to_stop_id: stopIds.madrid,
    travel_mode: 'FLIGHT',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
  },
  {
    created_at: mockItineraryTimestamp,
    from_stop_id: stopIds.madrid,
    id: '55555555-5555-4555-8555-555555555553',
    notes: 'Check whether splitting this in Barcelona makes the day less brutal.',
    operator: 'Renfe / SNCF',
    reference: null,
    route: createMockProviderRoute({
      coordinates: [
        [-3.7038, 40.4168],
        [-0.3763, 39.4699],
        [2.1734, 41.3851],
        [4.8357, 45.764],
      ],
      distanceMeters: 1258000,
      durationSeconds: 40800,
    }),
    to_stop_id: stopIds.lyon,
    travel_mode: 'TRAIN',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
  },
  {
    created_at: mockItineraryTimestamp,
    from_stop_id: stopIds.lyon,
    id: '55555555-5555-4555-8555-555555555554',
    notes: 'Mountain transfer details still rough. Add pickup notes once lodging is booked.',
    operator: null,
    reference: null,
    route: createMockProviderRoute({
      coordinates: [
        [4.8357, 45.764],
        [7.2619, 45.737],
        [9.19, 45.4642],
        [11.1217, 46.0679],
        [12.1357, 46.5405],
      ],
      distanceMeters: 681000,
      durationSeconds: 25200,
    }),
    to_stop_id: stopIds.dolomites,
    travel_mode: 'CAR',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
  },
] as const

const initialTravelPosts: readonly TravelPost[] = [
  {
    comments: 8,
    coordinates: [41.1418, -8.6159],
    excerpt: 'Blue tiles, steep alleys, and a dinner plan that turned into three snack stops.',
    id: 'douro-evening',
    location: 'Porto',
    media: [
      {
        alt: 'Porto riverfront at dusk',
        src: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=520&q=80',
      },
      {
        alt: 'Tiled facade in Porto',
        src: 'https://plus.unsplash.com/premium_photo-1781636233496-0b8b7760f0cb?q=80&w=830&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
      },
      {
        alt: 'Short clip from the riverside',
        poster:
          'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=780&q=80',
        src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        type: 'video',
      },
    ],
    occurred_at: '2027-05-08T20:14:00Z',
    time: 'Today, 20:14',
    title: 'First evening above the Douro',
  },
  {
    comments: 3,
    coordinates: [38.7139, -9.13],
    excerpt: 'A slower morning after the train, saved as a practical note.',
    id: 'alfama-note',
    location: 'Lisbon',
    media: [
      {
        alt: 'Lisbon tram on a narrow street',
        src: 'https://images.unsplash.com/photo-1548707309-dcebeab9ea9b?auto=format&fit=crop&w=520&q=80',
      },
      {
        alt: 'Lisbon overlook with orange rooftops',
        src: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?auto=format&fit=crop&w=520&q=80',
      },
      {
        alt: 'Packed travel bag on a hotel bed',
        src: 'https://images.unsplash.com/photo-1553531580-652231dae097?auto=format&fit=crop&w=520&q=80',
      },
      {
        alt: 'Quiet cafe breakfast',
        src: 'https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?auto=format&fit=crop&w=520&q=80',
      },
    ],
    occurred_at: '2027-05-06T09:32:00Z',
    time: 'Yesterday, 09:32',
    title: 'Packing lighter for rail days',
  },
  {
    comments: 5,
    coordinates: [40.4218, -3.7057],
    excerpt: 'The route changed after lunch, but the detour made the day easier.',
    id: 'madrid-transfer',
    location: 'Madrid',
    media: [
      {
        alt: 'Madrid street corner in warm light',
        src: 'https://images.unsplash.com/photo-1578305698944-874fa44d04c9?auto=format&fit=crop&w=520&q=80',
      },
      {
        alt: 'Metro station platform',
        src: 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=520&q=80',
      },
      {
        alt: 'Train window view',
        src: 'https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=520&q=80',
      },
    ],
    occurred_at: '2027-05-10T17:48:00Z',
    time: '10 May, 17:48',
    title: 'A better transfer plan',
  },
] as const

export function TripDetailPage({
  accessToken = null,
  authStatus = 'unauthenticated',
  tripId,
}: TripDetailPageProps = {}) {
  const shouldUseMobileMapPicker = useMediaQuery('(max-width: 1023px)')
  const isApiBacked = Boolean(tripId)
  const canSwitchModes = true
  const sourceStops = isApiBacked ? [] : initialStops
  const sourceTravelLegs = isApiBacked ? [] : initialTravelLegs
  const sourceTravelPosts = isApiBacked ? [] : initialTravelPosts
  const initialUrlState = readTripDetailUrlState({
    canSwitchModes,
    travelPosts: sourceTravelPosts,
  })
  const [mode, setMode] = useState<TripMode>(initialUrlState.mode)
  const [planningView, setPlanningView] = useState<PlanningView>(
    initialUrlState.planningView,
  )
  const [trip, setTrip] = useState<MockTrip>(() =>
    isApiBacked ? createPendingTrip(tripId) : mockTrip,
  )
  const [loadState, setLoadState] = useState<TripDetailLoadState>(
    isApiBacked
      ? { error: null, status: 'loading' }
      : { error: null, status: 'success' },
  )
  const [itineraryRevision, setItineraryRevision] = useState(0)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [tripMembers, setTripMembers] = useState<readonly MockTripMember[]>(
    isApiBacked ? [] : mockTripMembers,
  )
  const [tripViewers, setTripViewers] = useState<readonly MockTripViewer[]>(
    isApiBacked ? [] : mockTripViewers,
  )
  const [tripShareLinks, setTripShareLinks] =
    useState<readonly MockShareLink[]>(
      isApiBacked ? [] : mockShareLinks,
    )
  const [plannedStops, setPlannedStops] =
    useState<readonly Stop[]>(sourceStops)
  const [travelLegs, setTravelLegs] =
    useState<readonly TravelLeg[]>(sourceTravelLegs)
  const [travelPosts, setTravelPosts] =
    useState<readonly TravelPost[]>(sourceTravelPosts)
  const [travelingView, setTravelingView] = useState<TravelingView>(
    initialUrlState.travelingView,
  )
  const [editingPostId, setEditingPostId] = useState<string | null>(
    initialUrlState.editingPostId,
  )
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null)
  const [activeDialog, setActiveDialog] = useState<TripDialog | null>(
    initialUrlState.activeDialog,
  )
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
  const shareToken = useMemo(readShareTokenFromUrl, [])
  const canMutate = !isApiBacked || Boolean(accessToken)
  const isMutating = pendingAction !== null

  const applyItinerary = useCallback((itinerary: Itinerary) => {
    setItineraryRevision(itinerary.itinerary_revision)
    setPlannedStops(itinerary.stops)
    setTravelLegs(itinerary.legs)
  }, [])

  const loadTripManagement = useCallback(
    async (options: { isCurrent: () => boolean }) => {
      if (!tripId || !accessToken) {
        setTripMembers(isApiBacked ? [] : mockTripMembers)
        setTripViewers(isApiBacked ? [] : mockTripViewers)
        setTripShareLinks(isApiBacked ? [] : mockShareLinks)
        return
      }

      const [members, viewers, shareLinks] = await Promise.all([
        listTripMembers({ accessToken, tripId }),
        listTripViewers({ accessToken, tripId }),
        listTripShareLinks({ accessToken, tripId }),
      ])

      if (!options.isCurrent()) {
        return
      }

      setTripMembers(members.map(toTripMemberViewModel))
      setTripViewers(viewers.map(toTripViewerViewModel))
      setTripShareLinks(shareLinks.map(toShareLinkViewModel))
    },
    [accessToken, isApiBacked, tripId],
  )

  const loadTripDetail = useCallback(
    async (options: { isCurrent: () => boolean }) => {
      if (!tripId) {
        return
      }

      setLoadState({ error: null, status: 'loading' })
      setMutationError(null)

      try {
        const [loadedTrip, loadedItinerary, loadedPosts] = await Promise.all([
          getTrip({ accessToken, shareToken, tripId }),
          getItinerary({ accessToken, shareToken, tripId }),
          listPosts({
            accessToken,
            pageSize: 100,
            shareToken,
            sortBy: 'occurred_at',
            sortOrder: 'asc',
            status: accessToken ? 'all' : 'published',
            tripId,
          }),
        ])

        if (!options.isCurrent()) {
          return
        }

        setTrip(toTripViewModel(loadedTrip))
        applyItinerary(loadedItinerary)
        setTravelPosts(loadedPosts.items.map(toTravelPostViewModel))
        setLoadState({ error: null, status: 'success' })

        if (accessToken) {
          void loadTripManagement(options).catch((managementError) => {
            if (options.isCurrent()) {
              setMutationError(getErrorMessage(managementError))
            }
          })
        }
      } catch (loadError) {
        if (!options.isCurrent()) {
          return
        }

        setLoadState({
          error: getErrorMessage(loadError),
          status: 'error',
        })
      }
    },
    [accessToken, applyItinerary, loadTripManagement, shareToken, tripId],
  )

  useEffect(() => {
    if (!isApiBacked || authStatus === 'loading') {
      return undefined
    }

    let isCurrent = true
    void loadTripDetail({
      isCurrent: () => isCurrent,
    })

    return () => {
      isCurrent = false
    }
  }, [authStatus, isApiBacked, loadTripDetail])

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
          canSwitchModes,
          travelPosts,
        },
      )

      applyTripDetailUrlState(nextState)
      writeTripDetailUrlState(nextState, historyAction)
    },
    [applyTripDetailUrlState, canSwitchModes, travelPosts],
  )

  const openDialog = useCallback((dialog: TripDialog) => {
    navigateTripDetailUrlState({ activeDialog: dialog })
  }, [navigateTripDetailUrlState])

  const closeDialog = useCallback(() => {
    navigateTripDetailUrlState({ activeDialog: null }, 'replace')
  }, [navigateTripDetailUrlState])

  const resolveUserForQuery = useCallback(
    async (query: string): Promise<UserSummary> => {
      if (!accessToken) {
        throw new Error('Sign in to search users.')
      }

      const trimmedQuery = query.trim()
      if (trimmedQuery.length < 2) {
        throw new Error('Enter at least two characters to search users.')
      }

      const users = await searchUsers({
        accessToken,
        excludeCurrentUser: true,
        pageSize: 5,
        query: trimmedQuery,
      })
      const user = users.items[0]

      if (!user) {
        throw new Error(`No user found for "${trimmedQuery}".`)
      }

      return user
    },
    [accessToken],
  )

  function handleTripSettingsSave(draft: TripSettingsDraft) {
    if (isApiBacked) {
      if (!tripId || !accessToken) {
        setMutationError('Sign in to update trip settings.')
        return
      }

      void runMutation('Saving trip settings', async () => {
        const updatedTrip = await updateTrip({
          accessToken,
          payload: toTripUpdatePayload(draft),
          tripId,
        })
        setTrip(toTripViewModel(updatedTrip))
        closeDialog()
      })
      return
    }

    setTrip((currentTrip) => ({
      ...currentTrip,
      description: draft.description,
      endDate: draft.endDate ?? '',
      name: draft.name,
      startDate: draft.startDate,
      visibility: draft.visibility,
    }))
    closeDialog()
  }

  function handleShareLinkCreate(draft: ShareLinkCreateDraft) {
    if (isApiBacked) {
      if (!tripId || !accessToken) {
        setMutationError('Sign in to create share links.')
        return
      }

      void runMutation('Creating share link', async () => {
        const shareLink = await createTripShareLink({
          accessToken,
          payload: {
            expires_at: draft.expiresAt
              ? toPostOccurredAtValue(draft.expiresAt)
              : null,
            label: draft.label,
          },
          tripId,
        })
        setTripShareLinks((currentLinks) => [
          toShareLinkViewModel(shareLink),
          ...currentLinks,
        ])
      })
      return
    }

    setTripShareLinks((currentLinks) => [
      {
        expiresAt: draft.expiresAt,
        id: createClientId('share-link'),
        label: draft.label || 'Untitled link',
        lastUsedAt: null,
        token: createClientId('token'),
      },
      ...currentLinks,
    ])
  }

  function handleShareLinkRevoke(link: MockShareLink) {
    if (isApiBacked) {
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
      return
    }

    setTripShareLinks((currentLinks) =>
      currentLinks.filter((currentLink) => currentLink.id !== link.id),
    )
  }

  function handleViewerAdd(draft: UserLookupDraft) {
    if (isApiBacked) {
      if (!tripId || !accessToken) {
        setMutationError('Sign in to add viewers.')
        return
      }

      void runMutation('Adding viewer', async () => {
        const user = await resolveUserForQuery(draft.query)
        const viewer = await addTripViewer({
          accessToken,
          payload: { user_id: user.id },
          tripId,
        })
        setTripViewers((currentViewers) =>
          upsertById(currentViewers, toTripViewerViewModel(viewer)),
        )
      })
      return
    }

    const query = draft.query.trim()
    setTripViewers((currentViewers) => [
      {
        email: query,
        id: createClientId('viewer'),
        name: query,
      },
      ...currentViewers,
    ])
  }

  function handleViewerRemove(viewer: MockTripViewer) {
    const userId = viewer.userId
    if (isApiBacked) {
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
      return
    }

    setTripViewers((currentViewers) =>
      currentViewers.filter((currentViewer) => currentViewer.id !== viewer.id),
    )
  }

  function handleMemberAdd(draft: UserLookupDraft) {
    if (isApiBacked) {
      if (!tripId || !accessToken) {
        setMutationError('Sign in to add members.')
        return
      }

      void runMutation('Adding member', async () => {
        const user = await resolveUserForQuery(draft.query)
        const member = await addTripMember({
          accessToken,
          payload: {
            role: draft.role ?? 'MEMBER',
            user_id: user.id,
          },
          tripId,
        })
        setTripMembers((currentMembers) =>
          upsertById(currentMembers, toTripMemberViewModel(member)),
        )
      })
      return
    }

    const query = draft.query.trim()
    setTripMembers((currentMembers) => [
      {
        email: query,
        id: createClientId('member'),
        name: query,
        role: draft.role ?? 'MEMBER',
      },
      ...currentMembers,
    ])
  }

  function handleMemberRoleChange(member: MockTripMember, role: MockTripRole) {
    const userId = member.userId
    if (isApiBacked) {
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
      return
    }

    setTripMembers((currentMembers) =>
      currentMembers.map((currentMember) =>
        currentMember.id === member.id
          ? { ...currentMember, role }
          : currentMember,
      ),
    )
  }

  function handleMemberRemove(member: MockTripMember) {
    const userId = member.userId
    if (isApiBacked) {
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
      return
    }

    setTripMembers((currentMembers) =>
      currentMembers.filter((currentMember) => currentMember.id !== member.id),
    )
  }

  function handleStopChange(stopId: string, updates: Partial<Stop>) {
    if (isApiBacked) {
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
      return
    }

    setPlannedStops((currentStops) =>
      currentStops.map((stop) =>
        stop.id === stopId
          ? {
              ...stop,
              ...updates,
            }
          : stop,
      ),
    )
  }

  function handleStopSave(stopId: string, draft: StopEditDraft) {
    if (isApiBacked) {
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
      return
    }

    handleStopChange(stopId, {
      notes: draft.notes,
      planned_nights: draft.plannedNights,
      planned_start_date: draft.plannedStartDate,
      title: draft.title,
    })
  }

  function handleTravelLegChange(legId: string, updates: Partial<TravelLeg>) {
    setTravelLegs((currentLegs) =>
      currentLegs.map((leg) => {
        if (leg.id !== legId) {
          return leg
        }

        const nextLeg = {
          ...leg,
          ...updates,
        }
        if (!hasRouteDefiningTravelLegUpdate(updates)) {
          return nextLeg
        }

        const fromStop =
          plannedStops.find((stop) => stop.id === nextLeg.from_stop_id) ?? null
        const toStop =
          plannedStops.find((stop) => stop.id === nextLeg.to_stop_id) ?? null
        if (!fromStop || !toStop) {
          return nextLeg
        }

        return {
          ...nextLeg,
          route: createSimpleRouteForStops(fromStop, toStop),
        }
      }),
    )
  }

  function handleTravelLegSave(legId: string, draft: TravelLegEditDraft) {
    if (isApiBacked) {
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
      return
    }

    handleTravelLegChange(legId, {
      notes: draft.notes,
      operator: draft.operator,
      reference: draft.reference,
      travel_mode: draft.travelMode,
    })
  }

  function handleTravelLegRouteRefresh(legId: string) {
    if (!isApiBacked) {
      return
    }
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
    if (isApiBacked) {
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
      return
    }

    const stopIndex = plannedStops.findIndex((stop) => stop.id === stopId)
    if (stopIndex < 0) {
      return
    }

    const previousStop = plannedStops[stopIndex - 1] ?? null
    const nextStop = plannedStops[stopIndex + 1] ?? null

    setPlannedStops((currentStops) =>
      currentStops.filter((stop) => stop.id !== stopId),
    )
    setTravelLegs((currentLegs) =>
      rebalanceTravelLegsAfterStopDelete({
        currentLegs,
        nextStop,
        previousStop,
        stopId,
      }),
    )
  }

  function handlePostChange(postId: string, updates: Partial<TravelPost>) {
    setTravelPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === postId
          ? {
              ...post,
              ...updates,
            }
          : post,
      ),
    )
  }

  function handleCreateStop(draft: CreateStopDraft) {
    if (isApiBacked) {
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
      return
    }

    const createdStop = createMockStopFromDraft(draft, trip.id)
    const nextStops = orderStops([...plannedStops, createdStop]).map(
      assignStopPosition,
    )
    setPlannedStops(nextStops)
    setTravelLegs((currentLegs) =>
      rebalanceTravelLegsForStops(nextStops, currentLegs),
    )
    setDraftStopLocation(null)
    navigateTripDetailUrlState(
      {
        mode: 'planning',
        planningView: 'stops',
        travelingView: 'posts',
      },
      'replace',
    )
  }

  function handlePostSubmit(postId: string | null, draft: PostSubmitDraft) {
    if (isApiBacked) {
      if (!tripId || !accessToken) {
        setMutationError('Sign in to save travel posts.')
        return
      }

      void runMutation(postId ? 'Saving post' : 'Creating post', async () => {
        const mediaIds = await uploadPostDraftMedia(draft.media, accessToken)
        if (postId) {
          const updatedPost = await updatePost({
            accessToken,
            payload: toPostUpdatePayload(draft, mediaIds),
            postId,
            tripId,
          })
          setTravelPosts((currentPosts) =>
            currentPosts.map((post) =>
              post.id === postId ? toTravelPostViewModel(updatedPost) : post,
            ),
          )
        } else {
          const createdPost = await createPost({
            accessToken,
            payload: toPostCreatePayload(draft, mediaIds),
            tripId,
          })
          setTravelPosts((currentPosts) => [
            ...currentPosts,
            toTravelPostViewModel(createdPost),
          ])
        }

        setDraftPostLocation(null)
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
      return
    }

    if (postId) {
      handlePostChange(postId, toTravelPostUpdates(draft))
    } else {
      setTravelPosts((currentPosts) => [
        ...currentPosts,
        createMockPostFromDraft(draft),
      ])
    }
    setDraftPostLocation(null)
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

  const applyDraftMapPointLocation = useCallback(
    (target: MapPointTarget, coordinates: L.LatLngTuple) => {
      const selectedTarget = target
      const draftLocation = createDraftMapPointLocation(coordinates, target)

      if (target === 'post') {
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

  useEffect(() => {
    urlStateRef.current = normalizeTripDetailUrlState(
      {
        activeDialog,
        editingPostId,
        mode,
        planningView,
        travelingView,
      },
      {
        canSwitchModes,
        travelPosts,
      },
    )
  }, [
    activeDialog,
    canSwitchModes,
    editingPostId,
    mode,
    planningView,
    travelingView,
    travelPosts,
  ])

  useEffect(() => {
    function handlePopState() {
      applyTripDetailUrlState(
        readTripDetailUrlState({
          canSwitchModes,
          travelPosts,
        }),
      )
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [applyTripDetailUrlState, canSwitchModes, travelPosts])

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

  if (isApiBacked && authStatus === 'loading') {
    return <LoadingState label="Checking session" />
  }

  if (isApiBacked && loadState.status === 'loading') {
    return <LoadingState label="Loading trip" />
  }

  if (isApiBacked && loadState.status === 'error') {
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
        <div className="grid min-h-0 gap-4 lg:h-full lg:grid-cols-[minmax(28rem,45%)_minmax(0,1fr)]">
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
              mode={visibleMode}
              canMutate={canMutate}
              draftPostLocation={draftPostLocation}
              draftStopLocation={draftStopLocation}
              focusedPostId={focusedPostId}
              isMutating={isMutating}
              mapPointTarget={mapPointTarget}
              mutationError={mutationError}
              onMapPointTargetChange={handleMapPointTargetChange}
              onCreateStop={handleCreateStop}
              onFocusedPostChange={handleFocusedPostChange}
              onOpenDialog={openDialog}
              onEditPost={handleEditPost}
              onPostSubmit={handlePostSubmit}
              onPlanningViewChange={handlePlanningViewChange}
              onRefreshTravelLegRoute={handleTravelLegRouteRefresh}
              onStopSave={handleStopSave}
              onStopChange={handleStopChange}
              onStopDelete={handleStopDelete}
              onTravelLegSave={handleTravelLegSave}
              onTravelingViewChange={handleTravelingViewChange}
              pendingAction={pendingAction}
              editingPostId={editingPostId}
              planningView={planningView}
              reserveMobileModeSwitchSpace={canSwitchModes}
              showMobileTravelMap={shouldUseMobileMapPicker}
              stops={visibleStops}
              trip={trip}
              travelLegs={travelLegs}
              travelPosts={travelPosts}
              travelingView={travelingView}
            />
          </div>
          {!shouldUseMobileMapPicker ? (
            <MapWorkspace
              draftMapLocation={activeDraftMapLocation}
              mapPointEnabled={mapPointTarget !== null}
              focusedPostId={focusedPostId}
              onDraftMapPointSelect={handleDraftMapPointSelect}
              routeMode={mapRouteMode}
              stops={visibleStops}
              travelLegs={travelLegs}
              travelPosts={travelPosts}
            />
          ) : null}
        </div>
      </div>

      <TripSettingsDialog
        canMutate={canMutate}
        isSaving={isMutating}
        onClose={closeDialog}
        onSave={handleTripSettingsSave}
        open={activeDialog === 'settings'}
        trip={trip}
      />
      <ShareManagementDialog
        canMutate={canMutate}
        isSaving={isMutating}
        onClose={closeDialog}
        onCreateLink={handleShareLinkCreate}
        onInviteViewer={handleViewerAdd}
        onRemoveViewer={handleViewerRemove}
        onRevokeLink={handleShareLinkRevoke}
        open={activeDialog === 'share'}
        shareLinks={tripShareLinks}
        viewers={tripViewers}
      />
      <TripMembersDialog
        canMutate={canMutate}
        isSaving={isMutating}
        members={tripMembers}
        onClose={closeDialog}
        onInviteMember={handleMemberAdd}
        onRemoveMember={handleMemberRemove}
        onUpdateMemberRole={handleMemberRoleChange}
        open={activeDialog === 'members'}
      />
      <TripActionsDialog
        onClose={closeDialog}
        open={activeDialog === 'actions'}
      />
      <MobileMapPointPicker
        initialLocation={mobileMapPickerLocation}
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

function TripSidebarHeader({
  onOpenDialog,
  trip,
}: {
  onOpenDialog: (dialog: TripDialog) => void
  trip: MockTrip
}) {
  return (
    <div className="space-y-2 border-b border-emerald-100 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-lg font-semibold tracking-normal text-foreground">
            {trip.name}
          </h1>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatTripDateRange(trip.startDate, trip.endDate)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <TripActionButton
            icon={Settings}
            label="Trip settings"
            onClick={() => onOpenDialog('settings')}
          />
          <TripActionButton
            icon={Share2}
            label="Share management"
            onClick={() => onOpenDialog('share')}
          />
          <TripActionButton
            icon={Users}
            label="Members"
            onClick={() => onOpenDialog('members')}
          />
          <TripActionButton
            icon={MoreHorizontal}
            label="More actions"
            onClick={() => onOpenDialog('actions')}
          />
        </div>
      </div>
    </div>
  )
}

function TripActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      className="size-8 rounded-xl"
      onClick={onClick}
      size="icon"
      title={label}
      type="button"
      variant="outline"
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </Button>
  )
}

function TripSettingsDialog({
  canMutate,
  isSaving,
  onClose,
  onSave,
  open,
  trip,
}: {
  canMutate: boolean
  isSaving: boolean
  onClose: () => void
  onSave: (draft: TripSettingsDraft) => void
  open: boolean
  trip: MockTrip
}) {
  const [description, setDescription] = useState(trip.description)
  const [endDate, setEndDate] = useState(trip.endDate)
  const [name, setName] = useState(trip.name)
  const [startDate, setStartDate] = useState(trip.startDate)
  const [visibility, setVisibility] = useState<MockTripVisibility>(
    trip.visibility,
  )

  useEffect(() => {
    if (!open) {
      return
    }

    setDescription(trip.description)
    setEndDate(trip.endDate)
    setName(trip.name)
    setStartDate(trip.startDate)
    setVisibility(trip.visibility)
  }, [open, trip])

  function handleStartDateChange(nextStartDate: string) {
    setStartDate(nextStartDate)
    setEndDate((currentEndDate) =>
      currentEndDate && currentEndDate < nextStartDate ? '' : currentEndDate,
    )
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({
      description: description.trim(),
      endDate: endDate || null,
      name: name.trim(),
      startDate,
      visibility,
    })
  }

  return (
    <Modal
      description="Update the trip details, dates, and visibility."
      onClose={onClose}
      open={open}
      title="Trip settings"
    >
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <label className="grid gap-2 text-sm font-medium text-foreground">
          Trip title
          <Input
            disabled={!canMutate || isSaving}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Start date
            <DatePicker
              disabled={!canMutate || isSaving}
              onValueChange={handleStartDateChange}
              value={startDate}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-foreground">
            End date
            <DatePicker
              disabled={!canMutate || isSaving}
              min={startDate || undefined}
              onValueChange={setEndDate}
              value={endDate}
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Visibility
          <Select<MockTripVisibility>
            disabled={!canMutate || isSaving}
            onValueChange={setVisibility}
            options={visibilityOptions}
            value={visibility}
          />
        </label>

        <VisibilityPreview visibility={visibility} />

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Description
          <Textarea
            className="min-h-32"
            disabled={!canMutate || isSaving}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={isSaving} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!canMutate || isSaving || name.trim().length === 0 || !startDate}
            type="submit"
          >
            {isSaving ? 'Saving' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function VisibilityPreview({
  visibility,
}: {
  visibility: MockTripVisibility
}) {
  const Icon =
    visibility === 'PRIVATE'
      ? Lock
      : visibility === 'PLATFORM_PUBLIC'
        ? Users
        : Globe2

  return (
    <div className="flex items-start gap-3 rounded-[1.25rem] border border-emerald-100 bg-emerald-50/70 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold text-foreground">
          {getVisibilityLabel(visibility)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {getVisibilityDescription(visibility)}
        </p>
      </div>
    </div>
  )
}

function ShareManagementDialog({
  canMutate,
  isSaving,
  onClose,
  onCreateLink,
  onInviteViewer,
  onRemoveViewer,
  onRevokeLink,
  open,
  shareLinks,
  viewers,
}: {
  canMutate: boolean
  isSaving: boolean
  onClose: () => void
  onCreateLink: (draft: ShareLinkCreateDraft) => void
  onInviteViewer: (draft: UserLookupDraft) => void
  onRemoveViewer: (viewer: MockTripViewer) => void
  onRevokeLink: (link: MockShareLink) => void
  open: boolean
  shareLinks: readonly MockShareLink[]
  viewers: readonly MockTripViewer[]
}) {
  const [linkExpiresAt, setLinkExpiresAt] = useState('2027-06-01T09:00')
  const [linkLabel, setLinkLabel] = useState('Family preview')
  const [notice, setNotice] = useState<string | null>(null)
  const [viewerQuery, setViewerQuery] = useState('')

  function handleCreateLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onCreateLink({
      expiresAt: linkExpiresAt || null,
      label: linkLabel.trim() || null,
    })
    setNotice(null)
    setLinkLabel('')
  }

  function handleInviteViewer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = viewerQuery.trim()
    if (query.length < 2) {
      return
    }

    onInviteViewer({ query })
    setNotice(null)
    setViewerQuery('')
  }

  return (
    <Modal
      description="Manage read-only visitor access and share links."
      onClose={onClose}
      open={open}
      title="Share management"
    >
      <div className="grid gap-5">
        {notice ? <MockNotice>{notice}</MockNotice> : null}

        <section className="space-y-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
              <Link2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Share links</h3>
              <p className="text-sm text-muted-foreground">
                Links are read-only visitor access for people outside the member list.
              </p>
            </div>
          </div>

          <form className="grid gap-3" onSubmit={handleCreateLink}>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Link label
              <Input
                disabled={!canMutate || isSaving}
                onChange={(event) => setLinkLabel(event.target.value)}
                placeholder="Family preview"
                value={linkLabel}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Expiration
              <DateTimePicker
                disabled={!canMutate || isSaving}
                onValueChange={setLinkExpiresAt}
                value={linkExpiresAt}
              />
            </label>
            <div className="flex justify-end">
              <Button disabled={!canMutate || isSaving} type="submit">
                <Plus className="size-4" aria-hidden="true" />
                {isSaving ? 'Creating' : 'Create link'}
              </Button>
            </div>
          </form>

          <div className="grid gap-2">
            {shareLinks.map((link) => (
              <ShareLinkRow
                canMutate={canMutate}
                isSaving={isSaving}
                key={link.id}
                link={link}
                onNotice={setNotice}
                onRevoke={onRevokeLink}
              />
            ))}
            {shareLinks.length === 0 ? (
              <p className="rounded-[1.1rem] bg-emerald-50/70 px-3 py-2 text-sm text-muted-foreground">
                No share links yet.
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
              <Eye className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Viewer allowlist</h3>
              <p className="text-sm text-muted-foreground">
                Viewers can open the trip but cannot edit planning or posts.
              </p>
            </div>
          </div>

          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleInviteViewer}>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              User search
              <Input
                disabled={!canMutate || isSaving}
                onChange={(event) => setViewerQuery(event.target.value)}
                placeholder="Name, username, or email"
                value={viewerQuery}
              />
            </label>
            <Button
              className="self-end"
              disabled={!canMutate || isSaving || viewerQuery.trim().length < 2}
              type="submit"
            >
              <Send className="size-4" aria-hidden="true" />
              {isSaving ? 'Adding' : 'Add viewer'}
            </Button>
          </form>

          <div className="grid gap-2">
            {viewers.map((viewer) => (
              <div
                className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-emerald-100 bg-emerald-50/40 px-3 py-2"
                key={viewer.id}
              >
                <UserSummary name={viewer.name} subtitle={viewer.email} />
                <Button
                  aria-label={`Remove ${viewer.name}`}
                  disabled={!canMutate || isSaving}
                  onClick={() => onRemoveViewer(viewer)}
                  size="icon"
                  title={`Remove ${viewer.name}`}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            {viewers.length === 0 ? (
              <p className="rounded-[1.1rem] bg-emerald-50/70 px-3 py-2 text-sm text-muted-foreground">
                No viewers yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function TripMembersDialog({
  canMutate,
  isSaving,
  members,
  onClose,
  onInviteMember,
  onRemoveMember,
  onUpdateMemberRole,
  open,
}: {
  canMutate: boolean
  isSaving: boolean
  members: readonly MockTripMember[]
  onClose: () => void
  onInviteMember: (draft: UserLookupDraft) => void
  onRemoveMember: (member: MockTripMember) => void
  onUpdateMemberRole: (member: MockTripMember, role: MockTripRole) => void
  open: boolean
}) {
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteRole, setInviteRole] = useState<MockTripRole>('MEMBER')
  const [notice, setNotice] = useState<string | null>(null)

  function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = inviteQuery.trim()
    if (query.length < 2) {
      return
    }

    onInviteMember({ query, role: inviteRole })
    setNotice(null)
    setInviteQuery('')
    setInviteRole('MEMBER')
  }

  return (
    <Modal
      description="Invite collaborators and manage trip roles."
      onClose={onClose}
      open={open}
      title="Members"
    >
      <div className="grid gap-5">
        {notice ? <MockNotice>{notice}</MockNotice> : null}

        <form
          className="grid gap-3 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-4"
          onSubmit={handleInviteMember}
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-primary">
              <UserPlus className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Invite user</h3>
              <p className="text-sm text-muted-foreground">
                Members can help manage posts and planning.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <label className="grid gap-2 text-sm font-medium text-foreground">
              User search
              <Input
                disabled={!canMutate || isSaving}
                onChange={(event) => setInviteQuery(event.target.value)}
                placeholder="Name, username, or email"
                value={inviteQuery}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Role
              <Select<MockTripRole>
                disabled={!canMutate || isSaving}
                onValueChange={setInviteRole}
                options={memberRoleOptions}
                value={inviteRole}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button
              disabled={!canMutate || isSaving || inviteQuery.trim().length < 2}
              type="submit"
            >
              <Mail className="size-4" aria-hidden="true" />
              {isSaving ? 'Adding' : 'Add member'}
            </Button>
          </div>
        </form>

        <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
              <Users className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">Current members</h3>
              <p className="text-sm text-muted-foreground">
                Owners can manage roles and member access.
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            {members.map((member) => (
              <MemberRow
                canMutate={canMutate}
                isSaving={isSaving}
                key={member.id}
                member={member}
                onNotice={setNotice}
                onRemove={onRemoveMember}
                onRoleChange={onUpdateMemberRole}
              />
            ))}
            {members.length === 0 ? (
              <p className="rounded-[1.1rem] bg-emerald-50/70 px-3 py-2 text-sm text-muted-foreground">
                No members yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function TripActionsDialog({
  onClose,
  open,
}: {
  onClose: () => void
  open: boolean
}) {
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <Modal
      description="Secondary trip actions."
      onClose={onClose}
      open={open}
      title="More actions"
    >
      <div className="grid gap-4">
        {notice ? <MockNotice>{notice}</MockNotice> : null}

        <ActionRow
          description="Prepare a downloadable trip archive."
          icon={Download}
          label="Export trip data"
          onClick={() => setNotice('Export action staged.')}
        />
        <ActionRow
          description="Use the same route as a starting point for another trip."
          icon={Copy}
          label="Duplicate planning route"
          onClick={() => setNotice('Duplicate action staged.')}
        />
        <ActionRow
          description="Hide this trip from active planning without deleting it."
          icon={Archive}
          label="Archive trip"
          onClick={() => setNotice('Archive action staged.')}
        />
        <ActionRow
          destructive
          description="Requires confirmation before removing trip data."
          icon={Trash2}
          label="Delete trip"
          onClick={() => setNotice('Delete confirmation would open here.')}
        />
      </div>
    </Modal>
  )
}

function ShareLinkRow({
  canMutate,
  isSaving,
  link,
  onNotice,
  onRevoke,
}: {
  canMutate: boolean
  isSaving: boolean
  link: MockShareLink
  onNotice: (notice: string) => void
  onRevoke: (link: MockShareLink) => void
}) {
  const [copied, setCopied] = useState(false)
  const shareUrl = link.token ? getShareUrl(link.token, link.tripId) : null

  function handleCopy() {
    if (!shareUrl) {
      return
    }

    setCopied(true)
    onNotice(`${link.label} copied to clipboard.`)
    void navigator.clipboard
      ?.writeText(shareUrl)
      .catch(() => undefined)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="grid gap-3 rounded-[1.2rem] border border-emerald-100 bg-emerald-50/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{link.label}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {shareUrl ?? 'Token hidden after creation'}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Expires {link.expiresAt ? formatDateTimeLabel(link.expiresAt) : 'never'} ·
          Last used {link.lastUsedAt ? link.lastUsedAt.toLowerCase() : 'never'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!shareUrl}
          onClick={handleCopy}
          type="button"
          variant="outline"
        >
          <Copy className="size-4" aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          aria-label={`Revoke ${link.label}`}
          disabled={!canMutate || isSaving}
          onClick={() => onRevoke(link)}
          size="icon"
          title={`Revoke ${link.label}`}
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function MemberRow({
  canMutate,
  isSaving,
  member,
  onNotice,
  onRemove,
  onRoleChange,
}: {
  canMutate: boolean
  isSaving: boolean
  member: MockTripMember
  onNotice: (notice: string) => void
  onRemove: (member: MockTripMember) => void
  onRoleChange: (member: MockTripMember, role: MockTripRole) => void
}) {
  const [role, setRole] = useState<MockTripRole>(member.role)
  const isOwner = member.role === 'OWNER'

  useEffect(() => {
    setRole(member.role)
  }, [member.role])

  function handleRoleChange(nextRole: MockTripRole) {
    setRole(nextRole)
    onNotice(`${member.name} role changed to ${getRoleLabel(nextRole)}.`)
    onRoleChange(member, nextRole)
  }

  return (
    <div className="grid gap-3 rounded-[1.2rem] border border-emerald-100 bg-emerald-50/40 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center">
      <UserSummary name={member.name} subtitle={member.email} />
      <Select<MockTripRole>
        disabled={!canMutate || isSaving || isOwner}
        onValueChange={handleRoleChange}
        options={memberRoleOptions}
        value={role}
      />
      <Button
        aria-label={`Remove ${member.name}`}
        disabled={!canMutate || isSaving || isOwner}
        onClick={() => onRemove(member)}
        size="icon"
        title={`Remove ${member.name}`}
        type="button"
        variant="ghost"
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

function ActionRow({
  description,
  destructive = false,
  icon: Icon,
  label,
  onClick,
}: {
  description: string
  destructive?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-3 rounded-[1.25rem] border p-3 text-left transition-colors',
        destructive
          ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
          : 'border-emerald-100 bg-white hover:bg-emerald-50',
      )}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-2xl',
          destructive
            ? 'bg-destructive/10 text-destructive'
            : 'bg-emerald-50 text-primary',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-foreground">{label}</span>
        <span className="mt-1 block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}

function UserSummary({
  name,
  subtitle,
}: {
  name: string
  subtitle: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-sm font-semibold text-primary">
        {getInitials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-foreground">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </div>
  )
}

function MockNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-[1.2rem] border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm font-medium text-primary"
      role="status"
    >
      {children}
    </p>
  )
}

function MobileMapPointPicker({
  initialLocation,
  onCancel,
  onConfirm,
  open,
  routeMode,
  stops,
  target,
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
      className="fixed inset-0 z-[70] overflow-hidden bg-white"
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
        travelPosts={travelPosts}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] bg-gradient-to-b from-white/95 via-white/70 to-transparent px-3 pb-8 pt-3">
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

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-white via-white/95 to-transparent p-3 pt-10">
        <div className="pointer-events-auto space-y-3 rounded-[1.5rem] border border-emerald-100 bg-white p-4 shadow-xl shadow-emerald-950/10">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-primary">
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

function TripSidebar({
  canMutate,
  draftPostLocation,
  draftStopLocation,
  editingPostId,
  focusedPostId,
  isMutating,
  mapPointTarget,
  mutationError,
  onCreateStop,
  mode,
  onEditPost,
  onFocusedPostChange,
  onMapPointTargetChange,
  onOpenDialog,
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
  reserveMobileModeSwitchSpace,
  showMobileTravelMap,
  stops,
  trip,
  travelLegs,
  travelPosts,
  travelingView,
}: {
  canMutate: boolean
  draftPostLocation: DraftPostLocation | null
  draftStopLocation: DraftPostLocation | null
  editingPostId: string | null
  focusedPostId: string | null
  isMutating: boolean
  mapPointTarget: MapPointTarget | null
  mutationError: string | null
  onCreateStop: (draft: CreateStopDraft) => void
  mode: TripMode
  onEditPost: (postId: string) => void
  onFocusedPostChange: (postId: string | null) => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
  onOpenDialog: (dialog: TripDialog) => void
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
  reserveMobileModeSwitchSpace: boolean
  showMobileTravelMap: boolean
  stops: readonly Stop[]
  trip: MockTrip
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
  travelingView: TravelingView
}) {
  const isMobileTravelPosts = mode === 'traveling' && travelingView === 'posts'
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null)
  const editingPost =
    travelPosts.find((post) => post.id === editingPostId) ?? null
  const mobileTravelMapHeight = reserveMobileModeSwitchSpace
    ? 'h-[calc(100dvh-9.75rem)]'
    : 'h-[calc(100dvh-5.5rem)]'

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
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm lg:h-full',
        isMobileTravelPosts && `${mobileTravelMapHeight} lg:h-full`,
      )}
    >
      <TripSidebarHeader onOpenDialog={onOpenDialog} trip={trip} />
      {mutationError ? (
        <p
          className="mx-4 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {mutationError}
        </p>
      ) : null}
      {!canMutate ? (
        <p className="mx-4 mt-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm text-muted-foreground">
          Sign in as a trip member to make changes.
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
        {mode === 'planning' && planningView === 'create-stop' ? (
          <CreateStopPanel
            draftLocation={draftStopLocation}
            isSubmitting={isMutating}
            mapPointActive={mapPointTarget === 'stop'}
            onCancel={() => {
              onMapPointTargetChange(null)
              onPlanningViewChange('stops')
            }}
            onCreateStop={onCreateStop}
            onMapPointTargetChange={onMapPointTargetChange}
            stops={stops}
          />
        ) : mode === 'planning' ? (
          <PlanningPanel
            onAddStop={() => {
              onMapPointTargetChange(null)
              onPlanningViewChange('create-stop')
            }}
            canMutate={canMutate}
            isMutating={isMutating}
            onRefreshTravelLegRoute={onRefreshTravelLegRoute}
            onStopChange={onStopChange}
            onStopDelete={onStopDelete}
            onStopSave={onStopSave}
            onTravelLegSave={onTravelLegSave}
            pendingAction={pendingAction}
            stops={stops}
            travelLegs={travelLegs}
          />
        ) : travelingView === 'create-post' ? (
          <PostFormPanel
            draftLocation={draftPostLocation}
            isSubmitting={isMutating}
            mapPointActive={mapPointTarget === 'post'}
            mode="create"
            onCancel={closePostForm}
            onMapPointTargetChange={onMapPointTargetChange}
            onSubmit={(draft) => onPostSubmit(null, draft)}
          />
        ) : travelingView === 'edit-post' && editingPost ? (
          <PostFormPanel
            draftLocation={draftPostLocation}
            isSubmitting={isMutating}
            mapPointActive={mapPointTarget === 'post'}
            mode="edit"
            onCancel={closePostForm}
            onMapPointTargetChange={onMapPointTargetChange}
            onSubmit={(draft) => onPostSubmit(editingPost.id, draft)}
            post={editingPost}
          />
        ) : (
          <TravelingPanel
            focusedPostId={focusedPostId}
            onEditPost={editPost}
            onFocusedPostChange={onFocusedPostChange}
            onNewPost={() => {
              onMapPointTargetChange(null)
              onFocusedPostChange(null)
              onTravelingViewChange('create-post')
            }}
            scrollRootRef={sidebarScrollRef}
            showMobileMap={showMobileTravelMap}
            stops={stops}
            travelLegs={travelLegs}
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
          ? 'bg-white text-foreground shadow-sm'
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
        'grid grid-cols-2 rounded-[1.4rem] border border-emerald-100 bg-white/92 p-1 shadow-xl shadow-emerald-950/10 backdrop-blur',
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

function TripModeDock({
  mode,
  onModeChange,
}: {
  mode: TripMode
  onModeChange: (mode: TripMode) => void
}) {
  return (
    <div className="hidden min-h-0 items-center lg:flex">
      <div className="flex w-full flex-col gap-1.5 rounded-[1.35rem] border border-emerald-100 bg-white/95 p-1.5 shadow-xl shadow-emerald-950/10">
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
          : 'border-transparent bg-white text-muted-foreground hover:bg-emerald-50 hover:text-foreground',
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

function MobileModeSwitch({
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

function LocationOptionCard({
  active,
  detail,
  icon: Icon,
  label,
  onClick,
  source,
}: {
  active: boolean
  detail: string
  icon: LucideIcon
  label: string
  onClick: () => void
  source: string
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-3 rounded-[1.25rem] border p-3 text-left transition-colors',
        active
          ? 'border-primary bg-white shadow-sm ring-2 ring-primary/12'
          : 'border-emerald-100 bg-white/75 hover:bg-white',
      )}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-2xl',
          active ? 'bg-primary text-primary-foreground' : 'bg-emerald-50 text-primary',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase text-muted-foreground">
          {source}
        </span>
        <span className="mt-0.5 block truncate font-semibold text-foreground">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
          {detail}
        </span>
      </span>
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full border transition-colors',
          active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-emerald-100 bg-white text-transparent',
        )}
      >
        <Check className="size-4" aria-hidden="true" />
      </span>
    </button>
  )
}

function PlaceSearchDropdown({
  disabled,
  error,
  onSelect,
  open,
  places,
  query,
  status,
}: {
  disabled: boolean
  error: string | null
  onSelect: (place: Place) => void
  open: boolean
  places: readonly Place[]
  query: string
  status: PlaceSearchStatus
}) {
  if (!open) {
    return null
  }

  const trimmedQuery = query.trim()

  return (
    <div
      aria-label="Place search results"
      className="overflow-hidden rounded-[1.25rem] border border-emerald-100 bg-white shadow-sm"
      role="listbox"
    >
      {!trimmedQuery ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Start typing to search places.
        </p>
      ) : null}
      {trimmedQuery && status === 'loading' ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Searching places...
        </p>
      ) : null}
      {trimmedQuery && status === 'error' ? (
        <p className="px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {trimmedQuery && status === 'success' && places.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          No places found.
        </p>
      ) : null}
      {places.map((place) => (
        <button
          aria-selected={false}
          className="grid w-full gap-1 border-t border-emerald-50 px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          key={place.id}
          onClick={() => onSelect(place)}
          role="option"
          type="button"
        >
          <span className="font-semibold text-foreground">
            {getPlaceNameLabel(place)}
          </span>
          <span className="text-sm text-muted-foreground">
            {formatPlaceDetail(place)}
          </span>
        </button>
      ))}
    </div>
  )
}

function usePlaceSearch(query: string, enabled: boolean) {
  const [places, setPlaces] = useState<readonly Place[]>([])
  const [status, setStatus] = useState<PlaceSearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmedQuery = query.trim()
    if (!enabled || trimmedQuery.length === 0) {
      setPlaces([])
      setStatus('idle')
      setError(null)
      return undefined
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    const timeoutId = window.setTimeout(() => {
      void geocodePlaces({
        limit: 8,
        query: trimmedQuery,
      })
        .then((results) => {
          if (cancelled) {
            return
          }

          setPlaces(results)
          setStatus('success')
        })
        .catch((searchError) => {
          if (cancelled) {
            return
          }

          setPlaces([])
          setStatus('error')
          setError(getErrorMessage(searchError))
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [enabled, query])

  return { error, places, status }
}

function PlanningPanel({
  canMutate,
  isMutating,
  onAddStop,
  onRefreshTravelLegRoute,
  onStopChange,
  onStopDelete,
  onStopSave,
  onTravelLegSave,
  pendingAction,
  stops,
  travelLegs,
}: {
  canMutate: boolean
  isMutating: boolean
  onAddStop: () => void
  onRefreshTravelLegRoute: (legId: string) => void
  onStopChange: (stopId: string, updates: Partial<Stop>) => void
  onStopDelete: (stopId: string) => void
  onStopSave: (stopId: string, draft: StopEditDraft) => void
  onTravelLegSave: (legId: string, draft: TravelLegEditDraft) => void
  pendingAction: string | null
  stops: readonly Stop[]
  travelLegs: readonly TravelLeg[]
}) {
  const [editingStopId, setEditingStopId] = useState<string | null>(null)
  const [editingLegId, setEditingLegId] = useState<string | null>(null)
  const editingStop = stops.find((stop) => stop.id === editingStopId) ?? null
  const editingLeg = travelLegs.find((leg) => leg.id === editingLegId) ?? null
  const editingLegFromStop =
    editingLeg
      ? stops.find((stop) => stop.id === editingLeg.from_stop_id) ?? null
      : null
  const editingLegToStop =
    editingLeg
      ? stops.find((stop) => stop.id === editingLeg.to_stop_id) ?? null
      : null

  return (
    <div className="min-w-0 space-y-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Planning</h2>
          <p className="text-sm text-muted-foreground">Build the route one stop at a time.</p>
        </div>
        <Button disabled={!canMutate || isMutating} onClick={onAddStop} size="sm" type="button">
          <Plus className="size-4" aria-hidden="true" />
          Add stop
        </Button>
      </div>

      <div className="space-y-3">
        {stops.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-emerald-200 bg-emerald-50/45 p-4 text-sm text-muted-foreground">
            No planned stops yet.
          </div>
        ) : null}

        {stops.map((stop, index) => {
          const nextStop = stops[index + 1]
          const leg = nextStop
            ? travelLegs.find(
                (travelLeg) =>
                  travelLeg.from_stop_id === stop.id &&
                  travelLeg.to_stop_id === nextStop.id,
              )
            : undefined

          return (
            <Fragment key={stop.id}>
              <StopCard
                index={index}
                disabled={!canMutate || isMutating}
                onChange={onStopChange}
                onDelete={onStopDelete}
                onDetails={setEditingStopId}
                stop={stop}
              />
              {nextStop && leg ? (
                <TravelLegCard
                  fromStop={stop}
                  leg={leg}
                  disabled={!canMutate || isMutating}
                  onEdit={setEditingLegId}
                  toStop={nextStop}
                />
              ) : null}
            </Fragment>
          )
        })}
      </div>

      <StopEditDialog
        onClose={() => setEditingStopId(null)}
        onSave={onStopSave}
        open={Boolean(editingStop)}
        saving={isMutating}
        stop={editingStop}
      />
      <TravelLegEditDialog
        fromStop={editingLegFromStop}
        leg={editingLeg}
        onClose={() => setEditingLegId(null)}
        onRefreshRoute={onRefreshTravelLegRoute}
        onSave={onTravelLegSave}
        open={Boolean(editingLeg && editingLegFromStop && editingLegToStop)}
        pendingAction={pendingAction}
        saving={isMutating}
        toStop={editingLegToStop}
      />
    </div>
  )
}

function CreateStopPanel({
  draftLocation,
  isSubmitting,
  mapPointActive,
  onCancel,
  onCreateStop,
  onMapPointTargetChange,
  stops,
}: {
  draftLocation: DraftPostLocation | null
  isSubmitting: boolean
  mapPointActive: boolean
  onCancel: () => void
  onCreateStop: (draft: CreateStopDraft) => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
  stops: readonly Stop[]
}) {
  const [locationSource, setLocationSource] = useState<'map' | 'search'>(
    mapPointActive ? 'map' : 'search',
  )
  const [newStopDate, setNewStopDate] = useState('2027-05-12')
  const [newStopNights, setNewStopNights] = useState(2)
  const [searchValue, setSearchValue] = useState('Coimbra')
  const [selectedSearchPlace, setSelectedSearchPlace] = useState<Place | null>(
    null,
  )
  const [placeResultsOpen, setPlaceResultsOpen] = useState(false)
  const [stopTitle, setStopTitle] = useState('Coimbra')
  const [stopTitleEdited, setStopTitleEdited] = useState(false)
  const [selectedAfterStopId, setSelectedAfterStopId] = useState(
    stops[1]?.id ?? stops[0]?.id ?? '',
  )
  const placeSearch = usePlaceSearch(
    searchValue,
    locationSource === 'search' && !isSubmitting,
  )
  const sameDateStops = stops.filter(
    (stop) => stop.planned_start_date === newStopDate,
  )
  const selectedAfterStop =
    sameDateStops.find((stop) => stop.id === selectedAfterStopId) ?? null
  const selectedSearchCoordinates = selectedSearchPlace
    ? getPlaceCoordinates(selectedSearchPlace)
    : getSearchLocationCoordinates(searchValue, 'stop')
  const selectedSearchLabel =
    selectedSearchPlace ? getPlaceNameLabel(selectedSearchPlace) : searchValue.trim()
  const suggestedStopTitle =
    locationSource === 'map' && mapPointActive && draftLocation
      ? getStopTitleSuggestion(draftLocation.label)
      : (selectedSearchPlace?.name ?? searchValue.trim()) || 'Coimbra'
  const selectedCoordinates =
    locationSource === 'map' && mapPointActive && draftLocation
      ? draftLocation.coordinates
      : selectedSearchCoordinates
  const hasSelectedLocation =
    locationSource === 'map'
      ? Boolean(mapPointActive && draftLocation)
      : Boolean(selectedSearchPlace)

  useEffect(() => {
    if (mapPointActive) {
      setLocationSource('map')
      return
    }

    if (!draftLocation) {
      setLocationSource('search')
    }
  }, [draftLocation, mapPointActive])

  useEffect(() => {
    if (!stopTitleEdited) {
      setStopTitle(suggestedStopTitle)
    }
  }, [stopTitleEdited, suggestedStopTitle])

  useEffect(() => {
    if (selectedAfterStopId && !selectedAfterStop) {
      setSelectedAfterStopId('')
    }
  }, [selectedAfterStop, selectedAfterStopId])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (stopTitle.trim().length === 0 || !hasSelectedLocation || isSubmitting) {
      return
    }

    onCreateStop({
      afterStopId: selectedAfterStop?.id ?? null,
      coordinates: selectedCoordinates,
      notes: '',
      placeId:
        locationSource === 'search' && selectedSearchPlace
          ? selectedSearchPlace.id
          : null,
      plannedNights: newStopNights,
      plannedStartDate: newStopDate,
      title: stopTitle.trim(),
    })
  }

  function selectSearchLocation() {
    setLocationSource('search')
    onMapPointTargetChange(null)
    setPlaceResultsOpen(true)
  }

  function selectMapLocation() {
    setLocationSource('map')
    onMapPointTargetChange('stop')
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
    setStopTitle(place.name)
    setStopTitleEdited(false)
    setPlaceResultsOpen(false)
  }

  return (
    <form className="min-w-0 space-y-5 p-4" onSubmit={handleSubmit}>
      <div className="flex items-start gap-3">
        <Button
          aria-label="Back to stops"
          onClick={onCancel}
          size="icon"
          title="Back to stops"
          type="button"
          variant="outline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div>
          <h2 className="text-base font-semibold text-foreground">New stop</h2>
          <p className="text-sm text-muted-foreground">Coimbra between Porto and Madrid.</p>
        </div>
      </div>

      <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-4">
        <label className="grid gap-2 text-sm font-medium text-foreground">
          Search places
          <span className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-9"
              disabled={isSubmitting}
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
          disabled={isSubmitting}
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
          active={locationSource === 'search' && !mapPointActive}
          detail={
            selectedSearchPlace
              ? formatPlaceDetail(selectedSearchPlace)
              : 'Select a place from the geocode results.'
          }
          icon={Search}
          label={selectedSearchLabel || 'Search for a place'}
          onClick={selectSearchLocation}
          source="Searched place"
        />

        <LocationOptionCard
          active={locationSource === 'map' && mapPointActive}
          detail={
            locationSource === 'map' && mapPointActive && draftLocation
              ? `Map point · ${formatCoordinates(draftLocation.coordinates)}`
              : locationSource === 'map' && mapPointActive
                ? 'Click on the map to place this stop.'
                : 'Map placement disabled'
          }
          icon={MousePointer2}
          label={draftLocation?.label ?? 'Map point'}
          onClick={selectMapLocation}
          source={
            locationSource === 'map' && mapPointActive
              ? 'Active map source'
              : 'Exact point'
          }
        />
      </section>

      <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
        <div>
          <h3 className="font-semibold text-foreground">Stop title</h3>
          <p className="text-sm text-muted-foreground">
            Prefilled from the selected place, editable for the itinerary.
          </p>
        </div>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Title
            <Input
              disabled={isSubmitting}
              maxLength={255}
              onChange={(event) => {
                setStopTitle(event.target.value)
                setStopTitleEdited(true)
              }}
              value={stopTitle}
            />
        </label>

        {stopTitleEdited && stopTitle !== suggestedStopTitle ? (
          <Button
            className="w-fit"
            onClick={() => {
              setStopTitle(suggestedStopTitle)
              setStopTitleEdited(false)
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Use place name
          </Button>
        ) : null}
      </section>

      <section className="min-w-0 space-y-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
        <div>
          <h3 className="font-semibold text-foreground">Schedule</h3>
          <p className="text-sm text-muted-foreground">
            {newStopDate} · {newStopNights} nights
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Date
            <DatePicker
              disabled={isSubmitting}
              onValueChange={setNewStopDate}
              value={newStopDate}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Nights
            <Input
              disabled={isSubmitting}
              min={0}
              onChange={(event) =>
                setNewStopNights(Math.max(0, Number(event.target.value)))
              }
              type="number"
              value={newStopNights}
            />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
        <div>
          <h3 className="font-semibold text-foreground">Placement</h3>
          <p className="text-sm text-muted-foreground">
            After {selectedAfterStop?.title ?? 'selected stop'}.
          </p>
        </div>

        <div className="grid gap-2">
          {sameDateStops.length === 0 ? (
            <button
              className={cn(
                'flex items-center justify-between gap-3 rounded-[1.1rem] border px-3 py-2 text-left transition-colors hover:bg-emerald-50',
                selectedAfterStopId === ''
                  ? 'border-primary bg-emerald-50'
                  : 'border-emerald-100 bg-white',
              )}
              disabled={isSubmitting}
              onClick={() => setSelectedAfterStopId('')}
              type="button"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  First stop on {newStopDate}
                </span>
                <span className="block text-xs text-muted-foreground">
                  No same-day anchor
                </span>
              </span>
              {selectedAfterStopId === '' ? <Badge>First</Badge> : null}
            </button>
          ) : null}
          {sameDateStops.slice(0, 3).map((stop) => (
            <button
              className={cn(
                'flex items-center justify-between gap-3 rounded-[1.1rem] border px-3 py-2 text-left transition-colors hover:bg-emerald-50',
                stop.id === selectedAfterStopId
                  ? 'border-primary bg-emerald-50'
                  : 'border-emerald-100 bg-white',
              )}
              disabled={isSubmitting}
              key={stop.id}
              onClick={() => setSelectedAfterStopId(stop.id)}
              type="button"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  {stop.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {stop.planned_start_date}
                </span>
              </span>
              {stop.id === selectedAfterStopId ? <Badge>After</Badge> : null}
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button disabled={isSubmitting} onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={
            stopTitle.trim().length === 0 || !hasSelectedLocation || isSubmitting
          }
          type="submit"
        >
          <Plus className="size-4" aria-hidden="true" />
          {isSubmitting ? 'Creating' : 'Create stop'}
        </Button>
      </div>
    </form>
  )
}

function MobileTravelMap({
  focusedPostId,
  stops,
  travelLegs,
  travelPosts,
}: {
  focusedPostId: string | null
  stops: readonly Stop[]
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const [resetNonce, setResetNonce] = useState(0)

  return (
    <section className="trip-mobile-travel-map absolute inset-0 overflow-hidden bg-white lg:hidden">
      <TripLeafletMap
        draftMapLocation={null}
        fitMode="mobile-travel"
        mapPointEnabled={false}
        onDraftMapPointSelect={() => undefined}
        resetNonce={resetNonce}
        routeMode="travel-timeline"
        focusedPostId={focusedPostId}
        stops={stops}
        travelLegs={travelLegs}
        travelPosts={travelPosts}
      />

      <div className="pointer-events-none absolute right-3 top-3 z-[500]">
        <Button
          aria-label="Recenter travel map"
          className="pointer-events-auto size-10 rounded-full bg-white/90 shadow-lg shadow-emerald-950/10 backdrop-blur hover:bg-white"
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

function TravelingPanel({
  focusedPostId,
  onFocusedPostChange,
  onEditPost,
  onNewPost,
  scrollRootRef,
  showMobileMap,
  stops,
  travelLegs,
  travelPosts,
}: {
  focusedPostId: string | null
  onFocusedPostChange: (postId: string | null) => void
  onEditPost: (postId: string) => void
  onNewPost: () => void
  scrollRootRef: PostScrollRootRef
  showMobileMap: boolean
  stops: readonly Stop[]
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
  const firstPostId = displayedPostIds[0] ?? null
  const desktopPostElementsRef = useRef(new Map<string, HTMLElement>())
  const mobilePostElementsRef = useRef(new Map<string, HTMLElement>())
  const mobileCarouselRef = useRef<HTMLDivElement | null>(null)

  usePostScrollFocus({
    axis: 'y',
    enabled: !showMobileMap,
    firstPostId,
    onFocusedPostChange,
    postElementsRef: desktopPostElementsRef,
    postIds: displayedPostIds,
    rootRef: scrollRootRef,
  })
  usePostScrollFocus({
    axis: 'x',
    enabled: showMobileMap && !activePost,
    firstPostId,
    onFocusedPostChange,
    postElementsRef: mobilePostElementsRef,
    postIds: displayedPostIds,
    rootRef: mobileCarouselRef,
  })

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
              onEdit={() => onEditPost(activePost.id)}
              post={activePost}
            />
          ) : (
            <>
              <MobileTravelMap
                focusedPostId={focusedPostId}
                stops={stops}
                travelLegs={travelLegs}
                travelPosts={travelPosts}
              />

              <div className="pointer-events-none absolute left-3 top-3 z-[500]">
                <Button
                  className="pointer-events-auto shadow-xl shadow-emerald-950/10"
                  onClick={onNewPost}
                  size="sm"
                  type="button"
                >
                  <Camera className="size-4" aria-hidden="true" />
                  New post
                </Button>
              </div>

              <div className="absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-white/90 via-white/45 to-transparent pb-3 pt-10">
                <div
                  className="trip-mobile-post-carousel scrollbar-subtle flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1"
                  ref={mobileCarouselRef}
                >
                  {displayedPosts.map((post) => (
                    <TravelPostPreviewCard
                      active={focusedPostId === post.id}
                      key={post.id}
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
            </p>
          </div>
          <Button onClick={onNewPost} size="sm" type="button">
            <Camera className="size-4" aria-hidden="true" />
            New post
          </Button>
        </div>

        <div className="space-y-5">
          {displayedPosts.map((post) => (
            <TravelPostCard
              active={focusedPostId === post.id}
              key={post.id}
              onEdit={() => onEditPost(post.id)}
              post={post}
              postRef={(element) =>
                setPostScrollElement(desktopPostElementsRef, post.id, element)
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PostFormPanel({
  draftLocation,
  isSubmitting,
  mapPointActive,
  mode,
  onCancel,
  onMapPointTargetChange,
  onSubmit,
  post = null,
}: {
  draftLocation: DraftPostLocation | null
  isSubmitting: boolean
  mapPointActive: boolean
  mode: 'create' | 'edit'
  onCancel: () => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
  onSubmit: (draft: PostSubmitDraft) => void
  post?: TravelPost | null
}) {
  const editingPost = mode === 'edit' ? post : null
  const [locationSource, setLocationSource] = useState<'map' | 'search'>(
    mapPointActive ? 'map' : 'search',
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadedMediaUrlsRef = useRef<string[]>([])
  const keepUploadedMediaUrlsRef = useRef(false)
  const [draftMedia, setDraftMedia] = useState<PostMedia[]>(() =>
    editingPost ? [...editingPost.media] : [],
  )
  const [activeDraftMediaIndex, setActiveDraftMediaIndex] = useState<
    number | null
  >(null)
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const [mediaToolsOpen, setMediaToolsOpen] = useState(false)
  const [occurredAt, setOccurredAt] = useState(() =>
    editingPost
      ? formatDateTimeInputValue(parseDateTime(editingPost.occurred_at))
      : '2027-05-08T20:14',
  )
  const [searchValue, setSearchValue] = useState(
    editingPost?.location ?? 'Porto riverside',
  )
  const [selectedSearchPlace, setSelectedSearchPlace] = useState<Place | null>(
    null,
  )
  const [placeResultsOpen, setPlaceResultsOpen] = useState(false)
  const [story, setStory] = useState(
    editingPost?.excerpt ??
      'The light moved across the river just as the terraces started to fill up. This is the note I want pinned to this exact place.',
  )
  const [title, setTitle] = useState(
    editingPost?.title ?? 'Sunset above the Douro',
  )
  const selectedMapLocation =
    locationSource === 'map' && mapPointActive ? draftLocation : null
  const selectedSearchCoordinates = selectedSearchPlace
    ? getPlaceCoordinates(selectedSearchPlace)
    : getSearchLocationCoordinates(searchValue, 'post')
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
  const placeSearch = usePlaceSearch(
    searchValue,
    locationSource === 'search' && !isSubmitting,
  )
  const hasLocation =
    selectedLocationLabel.length > 0 &&
    (locationSource === 'map'
      ? Boolean(selectedMapLocation)
      : Boolean(selectedSearchPlace || editingPost))
  const canSubmit =
    hasLocation &&
    title.trim().length > 0 &&
    story.trim().length > 0 &&
    occurredAt.trim().length > 0 &&
    draftMedia.length > 0

  useEffect(() => {
    keepUploadedMediaUrlsRef.current = false
    for (const objectUrl of uploadedMediaUrlsRef.current) {
      URL.revokeObjectURL(objectUrl)
    }
    uploadedMediaUrlsRef.current = []
    setActiveDraftMediaIndex(null)
    setDraftMedia(editingPost ? [...editingPost.media] : [])
    setLocationSource('search')
    setSelectedSearchPlace(null)
    setPlaceResultsOpen(false)
    setMediaNotice(null)
    setMediaToolsOpen(false)
    setOccurredAt(
      editingPost
        ? formatDateTimeInputValue(parseDateTime(editingPost.occurred_at))
        : '2027-05-08T20:14',
    )
    setSearchValue(editingPost?.location ?? 'Porto riverside')
    setStory(
      editingPost?.excerpt ??
        'The light moved across the river just as the terraces started to fill up. This is the note I want pinned to this exact place.',
    )
    setTitle(editingPost?.title ?? 'Sunset above the Douro')
  }, [editingPost, mode])

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
      if (keepUploadedMediaUrlsRef.current) {
        return
      }

      for (const objectUrl of uploadedMediaUrlsRef.current) {
        URL.revokeObjectURL(objectUrl)
      }
    },
    [],
  )

  function selectSearchLocation() {
    setLocationSource('search')
    onMapPointTargetChange(null)
    setPlaceResultsOpen(true)
  }

  function selectMapLocation() {
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

      return {
        alt: file.name,
        file,
        type: getPostMediaType(file),
        src: objectUrl,
      }
    })

    setDraftMedia((currentMedia) => [...currentMedia, ...uploadedMedia])
    setMediaNotice(
      `${mediaFiles.length} ${mediaFiles.length === 1 ? 'media item' : 'media items'} added.`,
    )
  }

  function moveDraftMedia(index: number, direction: -1 | 1) {
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

  function removeDraftMedia(media: PostMedia) {
    revokeUploadedMediaUrl(media.src)
    setActiveDraftMediaIndex(null)
    setDraftMedia((currentMedia) =>
      currentMedia.filter((item) => item.src !== media.src),
    )
    setMediaNotice(`${media.alt} removed.`)
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
    discardUploadedMediaUrls()
    onCancel()
  }

  function handleSaveEdit() {
    if (!canSubmit) {
      return
    }

    keepUploadedMediaUrlsRef.current = true
    onSubmit({
      coordinates: selectedPostCoordinates,
      locationLabel: selectedLocationLabel,
      media: draftMedia,
      occurredAt: toPostOccurredAtValue(occurredAt),
      placeId:
        locationSource === 'search' && selectedSearchPlace
          ? selectedSearchPlace.id
          : null,
      publish: mode === 'create',
      story: story.trim(),
      title: title.trim(),
    })
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

      <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/70 p-4">
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
              disabled={isSubmitting}
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
          disabled={isSubmitting}
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
          active={locationSource === 'search' && !mapPointActive}
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
          active={locationSource === 'map' && mapPointActive}
          detail={
            locationSource === 'map' && mapPointActive && draftLocation
              ? `Map point · ${formatCoordinates(draftLocation.coordinates)}`
              : locationSource === 'map' && mapPointActive
                ? 'Click on the map to select an exact point.'
                : 'Map placement disabled'
          }
          icon={MousePointer2}
          label={draftLocation?.label ?? 'Map point'}
          onClick={selectMapLocation}
          source={
            locationSource === 'map' && mapPointActive
              ? 'Active map source'
              : 'Exact point'
          }
        />
      </section>

      <section className="space-y-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
        <label className="grid gap-2 text-sm font-medium text-foreground">
          Title
          <Input
            disabled={isSubmitting}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Story
          <Textarea
            className="min-h-36 resize-none"
            disabled={isSubmitting}
            onChange={(event) => setStory(event.target.value)}
            value={story}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Occurred at
          <DateTimePicker
            disabled={isSubmitting}
            onValueChange={setOccurredAt}
            value={occurredAt}
          />
        </label>
      </section>

      <section className="space-y-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">Media</h3>
            <p className="text-sm text-muted-foreground">
              {draftMedia.length === 0
                ? 'Add photos or videos to build the post gallery.'
                : `${draftMedia.length} ${draftMedia.length === 1 ? 'media item' : 'media items'} · first visual becomes the map bubble.`}
            </p>
          </div>
          <Button
            disabled={isSubmitting}
            onClick={() => setMediaToolsOpen((current) => !current)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>

        {mediaNotice ? <MockNotice>{mediaNotice}</MockNotice> : null}

        <div className="trip-post-media-strip scrollbar-subtle flex min-w-0 max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-1">
          {draftMedia.length === 0 ? (
            <button
              className={cn(
                'grid w-[76vw] max-w-80 shrink-0 place-items-center rounded-[1.4rem] border border-dashed border-emerald-200 bg-emerald-50/60 text-primary sm:w-80',
                mediaStripHeightClassName,
              )}
              onClick={() => setMediaToolsOpen(true)}
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
              key={media.src}
              media={media}
              onOpen={() => setActiveDraftMediaIndex(index)}
            >
              <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-2xl bg-white/90 p-1.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <div className="flex gap-1">
                  <Button
                    aria-label={`Move ${media.alt} left`}
                    className="size-8 rounded-xl"
                    disabled={index === 0}
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
                    disabled={index === draftMedia.length - 1}
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
              'grid w-[52vw] max-w-52 shrink-0 place-items-center rounded-[1.4rem] border border-dashed border-emerald-200 bg-emerald-50/60 text-primary sm:w-52',
              mediaStripHeightClassName,
            )}
            onClick={() => setMediaToolsOpen(true)}
            type="button"
          >
            <span className="grid justify-items-center gap-2 text-sm font-semibold">
              <Plus className="size-5" aria-hidden="true" />
              Add media
            </span>
          </button>
        </div>

        {mediaToolsOpen ? (
          <div className="space-y-3 rounded-[1.25rem] border border-emerald-100 bg-emerald-50/70 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                disabled={isSubmitting}
                onClick={() => fileInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <Upload className="size-4" aria-hidden="true" />
                Upload files
              </Button>
              <Button
                disabled={isSubmitting}
                onClick={() => fileInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <Camera className="size-4" aria-hidden="true" />
                Use camera roll
              </Button>
            </div>

            <input
              accept="image/*,video/*"
              className="sr-only"
              multiple
              disabled={isSubmitting}
              onChange={(event) => {
                handleUploadFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
              ref={fileInputRef}
              type="file"
            />

            <p className="rounded-[1.1rem] bg-white/75 px-3 py-2 text-sm text-muted-foreground">
              Select photos or videos. New uploads are added to the end of the
              strip and can be reordered before publishing.
            </p>
          </div>
        ) : null}
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button disabled={isSubmitting} onClick={handleCancel} type="button" variant="outline">
          Cancel
        </Button>
        {mode === 'edit' ? (
          <Button disabled={!canSubmit || isSubmitting} onClick={handleSaveEdit} type="button">
            <Check className="size-4" aria-hidden="true" />
            {isSubmitting ? 'Saving' : 'Save post'}
          </Button>
        ) : (
          <>
            <Button
              disabled={!canSubmit || isSubmitting}
              onClick={() => {
                keepUploadedMediaUrlsRef.current = true
                onSubmit({
                  coordinates: selectedPostCoordinates,
                  locationLabel: selectedLocationLabel,
                  media: draftMedia,
                  occurredAt: toPostOccurredAtValue(occurredAt),
                  placeId:
                    locationSource === 'search' && selectedSearchPlace
                      ? selectedSearchPlace.id
                      : null,
                  publish: false,
                  story: story.trim(),
                  title: title.trim(),
                })
              }}
              type="button"
              variant="outline"
            >
              Save draft
            </Button>
            <Button
              disabled={!canSubmit || isSubmitting}
              onClick={handleSaveEdit}
              type="button"
            >
              {isSubmitting ? 'Publishing' : 'Publish post'}
            </Button>
          </>
        )}
      </div>

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

function TravelPostCard({
  active = false,
  onEdit,
  post,
  postRef,
}: {
  active?: boolean
  onEdit: () => void
  post: TravelPost
  postRef?: (element: HTMLElement | null) => void
}) {
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null)

  return (
    <article
      className={cn(
        'min-w-0 overflow-hidden rounded-[1.5rem] border bg-emerald-50/45 shadow-sm shadow-emerald-950/5 transition-colors',
        active ? 'border-primary/55' : 'border-emerald-100',
      )}
      ref={postRef}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-6 text-foreground">
              {post.title}
            </h3>
          </div>
          <Button
            aria-label={`Edit ${post.title}`}
            className="size-8 shrink-0 rounded-xl"
            onClick={onEdit}
            size="icon"
            title={`Edit ${post.title}`}
            type="button"
            variant="outline"
          >
            <PenLine className="size-3.5" aria-hidden="true" />
          </Button>
        </div>

        <p className="text-sm leading-6 text-muted-foreground">{post.excerpt}</p>

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
        'trip-mobile-post-carousel__card shrink-0 snap-center overflow-hidden rounded-[1.5rem] border bg-emerald-50/45 shadow-sm shadow-emerald-950/5 transition-colors',
        active ? 'border-primary/55' : 'border-emerald-100',
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
          />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          {isVideo ? (
            <span className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid size-11 place-items-center rounded-full bg-white/90 text-primary shadow-lg shadow-black/15">
                <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
              </span>
            </span>
          ) : null}
          {post.media.length > 1 ? (
            <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[0.68rem] font-semibold text-primary shadow-sm">
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
  post,
}: {
  onBack: () => void
  onEdit: () => void
  post: TravelPost
}) {
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null)

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden bg-white lg:hidden">
      <div className="flex min-w-0 items-start gap-3 border-b border-emerald-100 bg-white/85 p-3">
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
        <Button
          aria-label={`Edit ${post.title}`}
          className="size-9 shrink-0 rounded-full"
          onClick={onEdit}
          size="icon"
          title={`Edit ${post.title}`}
          type="button"
          variant="outline"
        >
          <PenLine className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 p-4">
        <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">
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
    <article className="group relative h-44 w-[min(20rem,calc(100vw-3rem))] shrink-0 overflow-hidden rounded-[1.35rem] bg-secondary">
      <button
        className="block size-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onOpen}
        type="button"
      >
        <MediaPreview
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
          media={media}
        />
        <span className="sr-only">Open {media.alt}</span>
        {isVideo ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-10 place-items-center rounded-full bg-white/90 text-primary shadow-lg shadow-black/15">
              <Play className="ml-0.5 size-4 fill-current" aria-hidden="true" />
            </span>
          </span>
        ) : null}
      </button>
    </article>
  )
}

function MediaStripCard({
  badge,
  children,
  media,
  onOpen,
}: {
  badge?: string | null
  children?: ReactNode
  media: PostMedia
  onOpen: () => void
}) {
  const isVideo = getMediaType(media) === 'video'

  return (
    <article
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-[1.5rem] bg-secondary',
        mediaStripHeightClassName,
      )}
    >
      <button
        className="block h-full w-fit text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onOpen}
        type="button"
      >
        <MediaPreview
          className="h-full w-auto transition-transform duration-300 group-hover:scale-[1.025]"
          media={media}
        />
        <span className="sr-only">Open {media.alt}</span>
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        {isVideo ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-12 place-items-center rounded-full bg-white/90 text-primary shadow-lg shadow-black/15">
              <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
            </span>
          </span>
        ) : null}
      </button>

      {badge ? (
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[0.68rem] font-semibold text-primary shadow-sm">
          {badge}
        </span>
      ) : null}

      {children}
    </article>
  )
}

function MediaLightbox({
  activeIndex,
  media,
  onClose,
  onIndexChange,
  title,
}: {
  activeIndex: number
  media: readonly PostMedia[]
  onClose: () => void
  onIndexChange: (index: number) => void
  title: string
}) {
  const activeMedia = media[activeIndex]
  const hasMultipleMedia = media.length > 1
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  function showRelativeMedia(offset: number) {
    if (media.length === 0) {
      return
    }

    onIndexChange((activeIndex + offset + media.length) % media.length)
  }

  useEffect(() => {
    if (!activeMedia) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === 'ArrowLeft' && hasMultipleMedia) {
        event.preventDefault()
        onIndexChange((activeIndex - 1 + media.length) % media.length)
        return
      }

      if (event.key === 'ArrowRight' && hasMultipleMedia) {
        event.preventDefault()
        onIndexChange((activeIndex + 1) % media.length)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    activeIndex,
    activeMedia,
    hasMultipleMedia,
    media.length,
    onClose,
    onIndexChange,
  ])

  if (!activeMedia || typeof document === 'undefined') {
    return null
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    if (!touch) {
      return
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null

    if (!start || !touch || !hasMultipleMedia) {
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return
    }

    showRelativeMedia(deltaX > 0 ? -1 : 1)
  }

  return createPortal(
    <div
      aria-label={`${title} media viewer`}
      aria-modal="true"
      className="fixed inset-0 z-[1000] bg-slate-950/95 text-white"
      onClick={onClose}
      role="dialog"
    >
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          <p className="truncate text-xs text-white/65">
            {activeMedia.alt} · {activeIndex + 1} of {media.length}
          </p>
        </div>
        <Button
          aria-label="Close media viewer"
          className="size-10 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={onClose}
          size="icon"
          title="Close"
          type="button"
          variant="ghost"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <button
        aria-label="Previous media"
        className="absolute left-3 top-1/2 z-20 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-white/10 text-white shadow-xl transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35 sm:grid"
        disabled={!hasMultipleMedia}
        onClick={(event) => {
          event.stopPropagation()
          showRelativeMedia(-1)
        }}
        type="button"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </button>

      <button
        aria-label="Next media"
        className="absolute right-3 top-1/2 z-20 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-white/10 text-white shadow-xl transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35 sm:grid"
        disabled={!hasMultipleMedia}
        onClick={(event) => {
          event.stopPropagation()
          showRelativeMedia(1)
        }}
        type="button"
      >
        <ArrowRight className="size-5" aria-hidden="true" />
      </button>

      <div
        className="flex h-full items-center justify-center px-4 py-20 sm:px-20"
        onClick={(event) => event.stopPropagation()}
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
      >
        <MediaPreview
          className="max-h-[calc(100dvh-10rem)] max-w-[calc(100dvw-2rem)] rounded-[1.35rem] object-contain shadow-2xl shadow-black/35 sm:max-w-[calc(100dvw-10rem)]"
          controls
          media={activeMedia}
        />
      </div>

      <div className="absolute inset-x-4 bottom-4 z-20 flex items-center justify-between gap-3 sm:justify-center">
        <Button
          aria-label="Previous media"
          className="size-11 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-35 sm:hidden"
          disabled={!hasMultipleMedia}
          onClick={(event) => {
            event.stopPropagation()
            showRelativeMedia(-1)
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Button>
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
          {activeIndex + 1} / {media.length}
        </span>
        <Button
          aria-label="Next media"
          className="size-11 rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-35 sm:hidden"
          disabled={!hasMultipleMedia}
          onClick={(event) => {
            event.stopPropagation()
            showRelativeMedia(1)
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowRight className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </div>,
    document.body,
  )
}

function MediaPreview({
  className,
  controls = false,
  media,
}: {
  className?: string
  controls?: boolean
  media: PostMedia
}) {
  if (getMediaType(media) === 'video') {
    return (
      <video
        aria-label={media.alt}
        className={cn('bg-black object-contain', className)}
        controls={controls}
        muted={!controls}
        playsInline
        poster={media.poster}
        preload="metadata"
        src={media.src}
      />
    )
  }

  return (
    <img
      alt={media.alt}
      className={cn('object-cover', className)}
      loading="lazy"
      src={media.src}
    />
  )
}

function StopCard({
  disabled,
  index,
  onChange,
  onDelete,
  onDetails,
  stop,
}: {
  disabled: boolean
  index: number
  onChange: (stopId: string, updates: Partial<Stop>) => void
  onDelete: (stopId: string) => void
  onDetails: (stopId: string) => void
  stop: Stop
}) {
  function updateNights(nextValue: number) {
    onChange(stop.id, {
      planned_nights: Math.max(0, nextValue),
    })
  }

  function updateLeaveDate(leaveDate: string) {
    onChange(stop.id, {
      planned_nights: getNightsBetweenDates(stop.planned_start_date, leaveDate),
    })
  }

  const leaveDate = getStayLeaveDateValue(
    stop.planned_start_date,
    stop.planned_nights,
  )

  return (
    <article
      className={cn(
        'grid w-full grid-cols-[3rem_1fr] gap-3 rounded-[1.5rem] border p-3 text-left',
        'border-emerald-100 bg-emerald-50/45 shadow-sm shadow-emerald-950/5',
      )}
    >
      <span className="grid size-10 place-items-center rounded-2xl bg-secondary text-sm font-semibold text-primary">
        {index + 1}
      </span>
      <span className="min-w-0 space-y-3">
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-foreground">
              {stop.title}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button
              aria-label={`Show details for ${stop.title}`}
              className="size-8 rounded-xl"
              disabled={disabled}
              onClick={() => onDetails(stop.id)}
              size="icon"
              title={`Show details for ${stop.title}`}
              type="button"
              variant="outline"
            >
              <PenLine className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              aria-label={`Delete ${stop.title}`}
              className="size-8 rounded-xl text-destructive hover:bg-destructive/10"
              disabled={disabled}
              onClick={() => onDelete(stop.id)}
              size="icon"
              title={`Delete ${stop.title}`}
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </span>
        </span>

        <div className="grid grid-cols-2 rounded-2xl border border-emerald-100 bg-white shadow-sm sm:min-h-14 sm:grid-cols-[minmax(0,1fr)_7.75rem_minmax(0,1fr)]">
          <div className="min-w-0 px-3 py-2">
            <span className="block text-[0.65rem] font-semibold uppercase text-muted-foreground">
              Arrive
            </span>
            <DatePicker
              ariaLabel={`Edit arrival date for ${stop.title}`}
              className="mt-1"
              disabled={disabled}
              displayValue={formatStopDateLabel(stop.planned_start_date)}
              onValueChange={(planned_start_date) =>
                onChange(stop.id, {
                  planned_start_date,
                })
              }
              triggerClassName="h-auto min-h-0 justify-start gap-1.5 rounded-lg border-0 bg-transparent p-0 text-sm font-semibold shadow-none hover:border-transparent hover:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [&>svg]:size-3.5"
              value={stop.planned_start_date}
            />
          </div>

          <div className="min-w-0 border-l border-emerald-100 bg-white/70 px-3 py-2 text-right sm:order-3">
            <span className="block text-[0.65rem] font-semibold uppercase text-muted-foreground">
              Leave
            </span>
            <DatePicker
              ariaLabel={`Edit leave date for ${stop.title}`}
              className="mt-1"
              disabled={disabled}
              displayValue={formatStopDateLabel(leaveDate)}
              min={stop.planned_start_date}
              onValueChange={updateLeaveDate}
              popoverAlign="end"
              triggerClassName="h-auto min-h-0 justify-end gap-1.5 rounded-lg border-0 bg-transparent p-0 text-sm font-semibold shadow-none hover:border-transparent hover:bg-transparent focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [&>svg]:size-3.5"
              value={leaveDate}
            />
          </div>

          <div className="col-span-2 grid grid-cols-[2rem_minmax(0,1fr)_2rem] border-t border-emerald-100 bg-emerald-50/50 sm:order-2 sm:col-span-1 sm:border-x sm:border-t-0">
            <button
              aria-label={`Remove one night from ${stop.title}`}
              className="grid place-items-center border-r border-emerald-100 text-primary transition-colors hover:bg-emerald-100/70"
              disabled={disabled}
              onClick={() => updateNights(stop.planned_nights - 1)}
              type="button"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <span className="grid min-h-14 place-items-center px-1 text-center leading-none">
              <span className="text-[0.65rem] font-semibold uppercase text-muted-foreground">
                Stay
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatNights(stop.planned_nights)}
              </span>
            </span>
            <button
              aria-label={`Add one night to ${stop.title}`}
              className="grid place-items-center border-l border-emerald-100 text-primary transition-colors hover:bg-emerald-100/70"
              disabled={disabled}
              onClick={() => updateNights(stop.planned_nights + 1)}
              type="button"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </span>
    </article>
  )
}

function TravelLegCard({
  disabled,
  fromStop,
  leg,
  onEdit,
  toStop,
}: {
  disabled: boolean
  fromStop: Stop
  leg: TravelLeg
  onEdit: (legId: string) => void
  toStop: Stop
}) {
  const ModeIcon = getTravelModeIcon(leg.travel_mode)
  const legDetail = [leg.operator, leg.reference].filter(Boolean).join(' · ')

  return (
    <div className="grid grid-cols-[3.25rem_1fr] gap-3 px-1 py-0.5">
      <div className="flex justify-center">
        <div className="flex w-0 flex-col items-center">
          <span className="h-2 w-px bg-emerald-100" />
          <span className="grid size-8 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-primary shadow-sm">
            <ModeIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="h-2 w-px bg-emerald-100" />
        </div>
      </div>

      <section className="min-w-0">
        <button
          className="flex min-h-10 w-full items-center gap-2 rounded-[1.1rem] border border-emerald-100 bg-white/85 px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-emerald-50"
          disabled={disabled}
          onClick={() => onEdit(leg.id)}
          type="button"
        >
          <span className="shrink-0 font-semibold text-primary">
            {getTravelModeLabel(leg.travel_mode)}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {fromStop.title} to {toStop.title}
          </span>
          {legDetail ? (
            <span className="hidden max-w-36 shrink-0 truncate text-xs text-muted-foreground sm:block">
              {legDetail}
            </span>
          ) : null}
          <Badge
            className="hidden shrink-0 sm:inline-flex"
            variant={leg.route.type === 'PROVIDER_BACKED' ? 'default' : 'outline'}
          >
            {leg.route.type === 'PROVIDER_BACKED' ? 'Provider route' : 'Simple route'}
          </Badge>
          <PenLine
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </section>
    </div>
  )
}

function StopEditDialog({
  onClose,
  onSave,
  open,
  saving,
  stop,
}: {
  onClose: () => void
  onSave: (stopId: string, draft: StopEditDraft) => void
  open: boolean
  saving: boolean
  stop: Stop | null
}) {
  const [draft, setDraft] = useState<StopEditDraft>(() =>
    createStopEditDraft(stop),
  )

  function updateNights(nextValue: number) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      plannedNights: Math.max(0, nextValue),
    }))
  }

  function updateLeaveDate(leaveDate: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      plannedNights: getNightsBetweenDates(
        currentDraft.plannedStartDate,
        leaveDate,
      ),
    }))
  }

  useEffect(() => {
    if (open) {
      setDraft(createStopEditDraft(stop))
    }
  }, [open, stop])

  if (!stop) {
    return null
  }

  const leaveDate = getStayLeaveDateValue(
    draft.plannedStartDate,
    draft.plannedNights,
  )
  const canSave = draft.title.trim().length > 0 && !saving

  return (
    <Modal
      description="Edit this itinerary stop."
      onClose={onClose}
      open={open}
      title={`Edit ${stop.title}`}
    >
      <div className="grid gap-5">
        <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 p-4">
          <div>
            <h3 className="font-semibold text-foreground">Stop</h3>
            <p className="text-sm text-muted-foreground">
              {getStopPlaceName(stop)}
            </p>
          </div>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Title
            <Input
              disabled={saving}
              maxLength={255}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  title: event.target.value,
                }))
              }
              value={draft.title}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Notes
            <Textarea
              className="min-h-32 resize-none"
              disabled={saving}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  notes: event.target.value,
                }))
              }
              value={draft.notes}
            />
          </label>
        </section>

        <section className="grid gap-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Arrival date
            <DatePicker
              disabled={saving}
              onValueChange={(planned_start_date) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  plannedStartDate: planned_start_date,
                }))
              }
              value={draft.plannedStartDate}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Leave date
            <DatePicker
              disabled={saving}
              min={draft.plannedStartDate}
              onValueChange={updateLeaveDate}
              value={leaveDate}
            />
          </label>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Nights</span>
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
              <button
                className="grid place-items-center border-r border-emerald-100 text-primary transition-colors hover:bg-emerald-50"
                disabled={saving}
                onClick={() => updateNights(draft.plannedNights - 1)}
                type="button"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <input
                className="h-10 w-full bg-white text-center text-sm font-semibold text-foreground focus-visible:outline-none"
                disabled={saving}
                min={0}
                onChange={(event) => updateNights(Number(event.target.value))}
                type="number"
                value={draft.plannedNights}
              />
              <button
                className="grid place-items-center border-l border-emerald-100 text-primary transition-colors hover:bg-emerald-50"
                disabled={saving}
                onClick={() => updateNights(draft.plannedNights + 1)}
                type="button"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={saving} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => onSave(stop.id, draft)}
            type="button"
          >
            {saving ? 'Saving' : 'Save stop'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TravelLegEditDialog({
  fromStop,
  leg,
  onClose,
  onRefreshRoute,
  onSave,
  open,
  pendingAction,
  saving,
  toStop,
}: {
  fromStop: Stop | null
  leg: TravelLeg | null
  onClose: () => void
  onRefreshRoute: (legId: string) => void
  onSave: (legId: string, draft: TravelLegEditDraft) => void
  open: boolean
  pendingAction: string | null
  saving: boolean
  toStop: Stop | null
}) {
  const [draft, setDraft] = useState<TravelLegEditDraft>(() =>
    createTravelLegEditDraft(leg),
  )

  useEffect(() => {
    if (open) {
      setDraft(createTravelLegEditDraft(leg))
    }
  }, [leg, open])

  if (!leg || !fromStop || !toStop) {
    return null
  }

  const ModeIcon = getTravelModeIcon(draft.travelMode)
  const isRefreshing = pendingAction === 'Refreshing route'

  return (
    <Modal
      description="Edit the travel leg and route source."
      onClose={onClose}
      open={open}
      title={`${fromStop.title} to ${toStop.title}`}
    >
      <div className="grid gap-5">
        <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-primary">
              <ModeIcon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground">Travel leg</h3>
              <p className="truncate text-sm text-muted-foreground">
                {fromStop.location.name} to {toStop.location.name}
              </p>
            </div>
          </div>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Mode
            <Select<TravelMode>
              disabled={saving}
              onValueChange={(travelMode) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  travelMode,
                }))
              }
              options={travelModeOptions}
              value={draft.travelMode}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={leg.route.type === 'PROVIDER_BACKED' ? 'default' : 'outline'}
            >
              {leg.route.type === 'PROVIDER_BACKED'
                ? 'Provider route'
                : 'Simple route'}
            </Badge>
            {leg.route.distance_meters ? (
              <span className="text-xs text-muted-foreground">
                {formatDistance(leg.route.distance_meters)}
              </span>
            ) : null}
            {leg.route.duration_seconds ? (
              <span className="text-xs text-muted-foreground">
                {formatDuration(leg.route.duration_seconds)}
              </span>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Operator
            <Input
              disabled={saving}
              maxLength={255}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  operator: nullableTextValue(event.target.value),
                }))
              }
              placeholder="Rail company, airline, rental firm"
              value={draft.operator ?? ''}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Reference
            <Input
              disabled={saving}
              maxLength={255}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  reference: nullableTextValue(event.target.value),
                }))
              }
              placeholder="Train number, booking code, route"
              value={draft.reference ?? ''}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground sm:col-span-2">
            Notes
            <Textarea
              className="min-h-32 resize-none"
              disabled={saving}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  notes: event.target.value,
                }))
              }
              placeholder="Tickets, buffers, transfers, pickup notes"
              value={draft.notes}
            />
          </label>
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            disabled={saving}
            onClick={() => onRefreshRoute(leg.id)}
            type="button"
            variant="outline"
          >
            <RefreshCw
              className={cn('size-4', isRefreshing && 'animate-spin')}
              aria-hidden="true"
            />
            {isRefreshing ? 'Refreshing route' : 'Refresh route'}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={() => onSave(leg.id, draft)}
              type="button"
            >
              {saving ? 'Saving' : 'Save leg'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function MapWorkspace({
  draftMapLocation,
  focusedPostId,
  mapPointEnabled,
  onDraftMapPointSelect,
  routeMode,
  stops,
  travelLegs,
  travelPosts,
}: {
  draftMapLocation: DraftPostLocation | null
  focusedPostId: string | null
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  routeMode: MapRouteMode
  stops: readonly Stop[]
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const [resetNonce, setResetNonce] = useState(0)

  return (
    <section className="relative min-h-0 min-w-0 overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm lg:h-full">
      <TripLeafletMap
        draftMapLocation={draftMapLocation}
        focusedPostId={focusedPostId}
        mapPointEnabled={mapPointEnabled}
        onDraftMapPointSelect={onDraftMapPointSelect}
        resetNonce={resetNonce}
        routeMode={routeMode}
        stops={stops}
        travelLegs={travelLegs}
        travelPosts={travelPosts}
      />

      <div className="pointer-events-none absolute right-4 top-4 z-[500] lg:right-5">
        <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
          <Button
            onClick={() => setResetNonce((current) => current + 1)}
            type="button"
            variant="outline"
          >
            <Compass className="size-4" aria-hidden="true" />
            Recenter
          </Button>
        </div>
      </div>
    </section>
  )
}

function TripLeafletMap({
  draftMapLocation,
  fitMode = 'workspace',
  focusedPostId = null,
  mapPointEnabled,
  onDraftMapPointSelect,
  resetNonce,
  routeMode = 'itinerary',
  stops,
  travelLegs,
  travelPosts,
}: {
  draftMapLocation: DraftPostLocation | null
  fitMode?: RouteFitMode
  focusedPostId?: string | null
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  resetNonce: number
  routeMode?: MapRouteMode
  stops: readonly Stop[]
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const draftMarkerRef = useRef<L.Marker | null>(null)
  const latestLocationSelectRef = useRef(onDraftMapPointSelect)
  const mapPointEnabledRef = useRef(mapPointEnabled)
  const mapRef = useRef<L.Map | null>(null)
  const postMarkerLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const focusedPostIdRef = useRef<string | null>(focusedPostId)
  const travelPostsRef = useRef(travelPosts)
  const stopsRef = useRef(stops)
  const travelLegsRef = useRef(travelLegs)
  const routeKey = createRouteKey(routeMode, stops, travelLegs, travelPosts)

  focusedPostIdRef.current = focusedPostId
  travelPostsRef.current = travelPosts
  stopsRef.current = stops
  travelLegsRef.current = travelLegs

  useEffect(() => {
    latestLocationSelectRef.current = onDraftMapPointSelect
  }, [onDraftMapPointSelect])

  useEffect(() => {
    mapPointEnabledRef.current = mapPointEnabled

    mapContainerRef.current?.classList.toggle(
      'trip-leaflet-map--selecting',
      mapPointEnabled,
    )
  }, [mapPointEnabled])

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) {
      return undefined
    }

    const map = L.map(container, {
      attributionControl: true,
      center: defaultMapCenter,
      scrollWheelZoom: true,
      zoom: defaultMapZoom,
      zoomControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    if (fitMode !== 'mobile-travel') {
      L.control.zoom({ position: 'bottomright' }).addTo(map)
    }

    function handleMapClick(event: L.LeafletMouseEvent) {
      if (!mapPointEnabledRef.current) {
        return
      }

      latestLocationSelectRef.current([
        Number(event.latlng.lat.toFixed(4)),
        Number(event.latlng.lng.toFixed(4)),
      ])
    }

    map.on('click', handleMapClick)
    mapRef.current = map

    routeLayerRef.current = L.layerGroup().addTo(map)
    postMarkerLayerRef.current = L.layerGroup().addTo(map)

    window.requestAnimationFrame(() => map.invalidateSize())

    return () => {
      map.off('click', handleMapClick)
      map.remove()
      draftMarkerRef.current = null
      mapRef.current = null
      postMarkerLayerRef.current = null
      routeLayerRef.current = null
    }
  }, [fitMode])

  useEffect(() => {
    const postMarkerLayer = postMarkerLayerRef.current
    if (!postMarkerLayer) {
      return
    }

    postMarkerLayer.clearLayers()
    if (routeMode === 'travel-timeline') {
      renderPostMarkerLayer(
        postMarkerLayer,
        travelPostsRef.current,
        focusedPostId,
      )
    }
  }, [focusedPostId, routeMode, routeKey])

  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    if (!map || !routeLayer) {
      return
    }

    routeLayer.clearLayers()
    renderRouteLayer(
      routeLayer,
      routeMode,
      stopsRef.current,
      travelLegsRef.current,
      travelPostsRef.current,
    )
    const animationFrameId = window.requestAnimationFrame(() => {
      map.invalidateSize()
      if (!focusedPostIdRef.current) {
        fitRouteBounds(
          map,
          routeMode,
          stopsRef.current,
          travelLegsRef.current,
          travelPostsRef.current,
          fitMode,
        )
      }
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [fitMode, routeKey, routeMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map || routeMode !== 'travel-timeline') {
      return
    }

    if (!focusedPostId) {
      fitRouteBounds(
        map,
        routeMode,
        stopsRef.current,
        travelLegsRef.current,
        travelPostsRef.current,
        fitMode,
      )
      return
    }

    const focusedPost =
      travelPostsRef.current.find((post) => post.id === focusedPostId) ?? null
    if (!focusedPost) {
      return
    }

    map.flyTo(
      focusedPost.coordinates,
      getFocusedPostZoom(map.getZoom(), fitMode),
      {
        animate: true,
        duration: 0.7,
        easeLinearity: 0.25,
      },
    )
  }, [fitMode, focusedPostId, routeKey, routeMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    if (draftMarkerRef.current) {
      draftMarkerRef.current.remove()
      draftMarkerRef.current = null
    }

    if (!draftMapLocation) {
      return
    }

    draftMarkerRef.current = L.marker(draftMapLocation.coordinates, {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createDraftPostMarkerHtml(),
        iconAnchor: [18, 18],
        iconSize: [36, 36],
      }),
      zIndexOffset: 700,
    }).addTo(map)
  }, [draftMapLocation])

  useEffect(() => {
    const map = mapRef.current
    if (!map || resetNonce === 0) {
      return
    }

    fitRouteBounds(
      map,
      routeMode,
      stopsRef.current,
      travelLegsRef.current,
      travelPostsRef.current,
      fitMode,
    )
  }, [fitMode, resetNonce, routeMode])

  return (
    <div
        aria-label="OpenStreetMap route map"
      className="trip-leaflet-map absolute inset-0"
      ref={mapContainerRef}
    />
  )
}

function renderRouteLayer(
  routeLayer: L.LayerGroup,
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
) {
  const routeSegments = getMapRouteSegments(
    routeMode,
    stops,
    travelLegs,
    travelPosts,
  )
  for (const segment of routeSegments) {
    if (segment.coordinates.length < 2) {
      continue
    }

    L.polyline(
      segment.coordinates,
      getRouteSegmentPathOptions(segment, routeMode),
    ).addTo(routeLayer)

    if (
      routeMode === 'itinerary' ||
      segment.kind !== 'itinerary' ||
      segment.routeType === 'SIMPLE'
    ) {
      continue
    }

    L.polyline(segment.coordinates, {
      color: '#ffffff',
      dashArray: '2 10',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.85,
      weight: 2,
    }).addTo(routeLayer)
  }

  for (const stop of stops) {
    L.marker(getStopCoordinates(stop), {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createPlaceMarkerHtml(),
        iconAnchor: [7, 7],
        iconSize: [14, 14],
      }),
    })
      .addTo(routeLayer)
      .bindPopup(`<strong>${escapeHtml(stop.title)}</strong><br>${escapeHtml(stop.notes)}`)
  }
}

function renderPostMarkerLayer(
  postMarkerLayer: L.LayerGroup,
  travelPosts: readonly TravelPost[],
  focusedPostId: string | null,
) {
  const orderedPosts = [
    ...travelPosts.filter((post) => post.id !== focusedPostId),
    ...travelPosts.filter((post) => post.id === focusedPostId),
  ]

  for (const post of orderedPosts) {
    const isFocused = post.id === focusedPostId

    L.marker(post.coordinates, {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createPostBubbleHtml(post, isFocused),
        iconAnchor: [22, 22],
        iconSize: [44, 44],
      }),
      zIndexOffset: isFocused ? 1000 : 500,
    })
      .addTo(postMarkerLayer)
      .bindPopup(
        `<strong>${escapeHtml(post.title)}</strong><br>${escapeHtml(post.excerpt)}`,
      )
  }
}

function fitRouteBounds(
  map: L.Map,
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
  fitMode: RouteFitMode,
) {
  const routeCoordinates = getRouteBoundsCoordinates(
    routeMode,
    stops,
    travelLegs,
    travelPosts,
  )
  if (routeCoordinates.length === 0) {
    map.setView(defaultMapCenter, defaultMapZoom, {
      animate: false,
    })
    return
  }

  map.fitBounds(L.latLngBounds(routeCoordinates), getRouteFitOptions(fitMode))
}

function getRouteFitOptions(fitMode: RouteFitMode): L.FitBoundsOptions {
  if (fitMode === 'mobile-picker') {
    return {
      maxZoom: 4,
      paddingBottomRight: [32, 260],
      paddingTopLeft: [32, 96],
    }
  }

  if (fitMode === 'mobile-travel') {
    return {
      maxZoom: 4,
      paddingBottomRight: [36, 280],
      paddingTopLeft: [36, 96],
    }
  }

  return {
    paddingBottomRight: [64, 64],
    paddingTopLeft: [360, 150],
  }
}

function getFocusedPostZoom(currentZoom: number, fitMode: RouteFitMode) {
  const maxFocusedZoom = fitMode === 'mobile-travel' ? 6 : 7
  const minFocusedZoom = fitMode === 'mobile-travel' ? 5 : 6
  const focusedZoom = Math.min(
    Math.max(currentZoom + 1, minFocusedZoom),
    maxFocusedZoom,
  )

  return Math.max(currentZoom, focusedZoom)
}

function createRouteKey(
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
) {
  const stopKey = stops
    .map((stop) =>
      [
        stop.id,
        stop.location.latitude,
        stop.location.longitude,
      ].join(':'),
    )
    .join('|')
  const legKey = travelLegs
    .map((leg) =>
      [
        leg.id,
        leg.from_stop_id,
        leg.to_stop_id,
        leg.route.type,
        createRouteGeometryKey(leg.route.geometry),
      ].join(':'),
    )
    .join('|')
  const postKey =
    routeMode === 'travel-timeline'
      ? getTravelPostsInRouteOrder(travelPosts)
          .map((post) =>
            [
              post.id,
              post.title,
              post.excerpt,
              post.location,
              post.coordinates[0],
              post.coordinates[1],
              post.occurred_at,
              getPrimaryPostMedia(post).src,
            ].join(':'),
          )
          .join('|')
      : ''

  return `${routeMode}::${stopKey}::${legKey}::${postKey}`
}

function getUpcomingStops(stops: readonly Stop[]) {
  return stops.filter((stop) => !stop.visited)
}

function getTravelPostsInRouteOrder(travelPosts: readonly TravelPost[]) {
  return [...travelPosts].sort((leftPost, rightPost) => {
    const timeDelta =
      getPostRouteTime(leftPost) - getPostRouteTime(rightPost)

    return timeDelta || leftPost.id.localeCompare(rightPost.id)
  })
}

function getMapFocusedPostId(
  postId: string,
  travelPosts: readonly TravelPost[],
) {
  const firstPost = getTravelPostsInRouteOrder(travelPosts)[0] ?? null

  return firstPost?.id === postId ? null : postId
}

function getPostRouteTime(post: TravelPost) {
  const time = Date.parse(post.occurred_at)
  return Number.isFinite(time) ? time : 0
}

function getMapRouteSegments(
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
): RouteSegment[] {
  if (routeMode === 'travel-timeline') {
    return getTravelTimelineRouteSegments(stops, travelLegs, travelPosts)
  }

  return getItineraryRouteSegments(stops, travelLegs)
}

function getItineraryRouteSegments(
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
): RouteSegment[] {
  const legsByPair = new Map<string, TravelLeg>(
    travelLegs.map((leg): [string, TravelLeg] => [
      createStopPairKey(leg.from_stop_id, leg.to_stop_id),
      leg,
    ]),
  )
  const segments: RouteSegment[] = []

  for (let index = 0; index < stops.length - 1; index += 1) {
    const fromStop = stops[index]
    const toStop = stops[index + 1]
    if (!fromStop || !toStop) {
      continue
    }

    const leg = legsByPair.get(createStopPairKey(fromStop.id, toStop.id))
    const routeCoordinates = leg
      ? getRouteCoordinates(leg.route)
      : getSimpleRouteCoordinates(fromStop, toStop)
    const coordinates =
      routeCoordinates ?? getSimpleRouteCoordinates(fromStop, toStop)

    segments.push({
      coordinates,
      kind: 'itinerary',
      routeType: leg?.route.type ?? 'SIMPLE',
    })
  }

  return segments
}

function getTravelTimelineRouteSegments(
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
): RouteSegment[] {
  const postsInRouteOrder = getTravelPostsInRouteOrder(travelPosts)
  const segments = getTravelPostRouteSegments(postsInRouteOrder)
  const finalPost = postsInRouteOrder[postsInRouteOrder.length - 1] ?? null
  const upcomingStop = stops[0] ?? null

  if (finalPost && upcomingStop) {
    segments.push({
      coordinates: getPointToPointRouteCoordinates(
        finalPost.coordinates,
        getStopCoordinates(upcomingStop),
      ),
      kind: 'post-to-stop',
      routeType: 'SIMPLE',
    })
  }

  segments.push(...getItineraryRouteSegments(stops, travelLegs))
  return segments
}

function getTravelPostRouteSegments(
  postsInRouteOrder: readonly TravelPost[],
): RouteSegment[] {
  const segments: RouteSegment[] = []

  for (let index = 0; index < postsInRouteOrder.length - 1; index += 1) {
    const fromPost = postsInRouteOrder[index]
    const toPost = postsInRouteOrder[index + 1]
    if (!fromPost || !toPost) {
      continue
    }

    segments.push({
      coordinates: getPointToPointRouteCoordinates(
        fromPost.coordinates,
        toPost.coordinates,
      ),
      kind: 'post-link',
      routeType: 'SIMPLE',
    })
  }

  return segments
}

function getRouteSegmentPathOptions(
  segment: RouteSegment,
  routeMode: MapRouteMode,
): L.PolylineOptions {
  if (segment.kind === 'post-link') {
    return {
      color: '#334155',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.52,
      weight: 3,
    }
  }

  if (segment.kind === 'post-to-stop') {
    return {
      color: '#334155',
      dashArray: '7 9',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.62,
      weight: 3,
    }
  }

  if (routeMode === 'itinerary') {
    return {
      color: '#0f766e',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.82,
      weight: 4,
    }
  }

  return {
    color: '#0f766e',
    dashArray: segment.routeType === 'SIMPLE' ? '10 10' : undefined,
    lineCap: 'round',
    lineJoin: 'round',
    opacity: segment.routeType === 'SIMPLE' ? 0.62 : 0.86,
    weight: 4,
  }
}

function getRouteBoundsCoordinates(
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
) {
  const routeCoordinates = getMapRouteSegments(
    routeMode,
    stops,
    travelLegs,
    travelPosts,
  ).flatMap((segment) => segment.coordinates)

  if (routeCoordinates.length > 0) {
    return routeCoordinates
  }

  if (routeMode === 'travel-timeline') {
    const postCoordinates = getTravelPostsInRouteOrder(travelPosts).map(
      (post) => post.coordinates,
    )
    if (postCoordinates.length > 0) {
      return postCoordinates
    }
  }

  return stops.map(getStopCoordinates)
}

function getPointToPointRouteCoordinates(
  fromCoordinates: L.LatLngTuple,
  toCoordinates: L.LatLngTuple,
) {
  return [fromCoordinates, toCoordinates]
}

function getRouteCoordinates(
  route: ItineraryTravelRoute,
): L.LatLngTuple[] | null {
  if (
    route.geometry.type !== 'LineString' ||
    route.geometry.coordinates.length < 2
  ) {
    return null
  }

  const coordinates: L.LatLngTuple[] = []
  for (const position of route.geometry.coordinates) {
    const coordinate = getLeafletCoordinate(position)
    if (!coordinate) {
      return null
    }
    coordinates.push(coordinate)
  }

  if (route.type === 'SIMPLE') {
    return createGeodesicRoute(coordinates)
  }

  return unwrapRouteLongitudes(coordinates)
}

function getSimpleRouteCoordinates(fromStop: Stop, toStop: Stop) {
  return createGeodesicRoute([
    getStopCoordinates(fromStop),
    getStopCoordinates(toStop),
  ])
}

function getLeafletCoordinate(
  position: GeoJsonLineString['coordinates'][number],
): L.LatLngTuple | null {
  const [longitude, latitude] = position
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90
  ) {
    return null
  }

  return [latitude, longitude]
}

function createGeodesicRoute(coordinates: readonly L.LatLngTuple[]) {
  if (coordinates.length < 2) {
    return [...coordinates]
  }

  const route: L.LatLngTuple[] = []
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]
    const end = coordinates[index + 1]
    if (!start || !end) {
      continue
    }

    const segment = interpolateGeodesicSegment(start, end)
    route.push(...(route.length > 0 ? segment.slice(1) : segment))
  }

  return unwrapRouteLongitudes(route)
}

function interpolateGeodesicSegment(
  start: L.LatLngTuple,
  end: L.LatLngTuple,
) {
  const angularDistance = getCentralAngle(start, end)
  if (angularDistance < 1e-9) {
    return [start, end]
  }

  const segmentCount = Math.max(
    1,
    Math.min(
      128,
      Math.ceil(
        (angularDistance * earthRadiusKilometers) / geodesicSegmentKilometers,
      ),
    ),
  )
  const points: L.LatLngTuple[] = []

  for (let index = 0; index <= segmentCount; index += 1) {
    points.push(interpolateGreatCirclePoint(start, end, index / segmentCount))
  }

  return points
}

function interpolateGreatCirclePoint(
  start: L.LatLngTuple,
  end: L.LatLngTuple,
  fraction: number,
): L.LatLngTuple {
  const startLat = toRadians(start[0])
  const startLng = toRadians(start[1])
  const endLat = toRadians(end[0])
  const endLng = toRadians(end[1])
  const angularDistance = getCentralAngle(start, end)
  const sinDistance = Math.sin(angularDistance)

  if (Math.abs(sinDistance) < 1e-9) {
    return [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]
  }

  const startWeight = Math.sin((1 - fraction) * angularDistance) / sinDistance
  const endWeight = Math.sin(fraction * angularDistance) / sinDistance
  const x =
    startWeight * Math.cos(startLat) * Math.cos(startLng) +
    endWeight * Math.cos(endLat) * Math.cos(endLng)
  const y =
    startWeight * Math.cos(startLat) * Math.sin(startLng) +
    endWeight * Math.cos(endLat) * Math.sin(endLng)
  const z = startWeight * Math.sin(startLat) + endWeight * Math.sin(endLat)

  return [
    toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y))),
    normalizeLongitude(toDegrees(Math.atan2(y, x))),
  ]
}

function getCentralAngle(start: L.LatLngTuple, end: L.LatLngTuple) {
  const startLat = toRadians(start[0])
  const endLat = toRadians(end[0])
  const deltaLat = endLat - startLat
  const deltaLng = toRadians(end[1] - start[1])
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2

  return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
}

function unwrapRouteLongitudes(coordinates: readonly L.LatLngTuple[]) {
  if (coordinates.length <= 1) {
    return [...coordinates]
  }

  const firstCoordinate = coordinates[0]
  if (!firstCoordinate) {
    return []
  }

  const unwrapped: L.LatLngTuple[] = [firstCoordinate]
  let previousLongitude = firstCoordinate[1]
  for (const coordinate of coordinates.slice(1)) {
    const longitude = unwrapLongitude(coordinate[1], previousLongitude)
    unwrapped.push([coordinate[0], longitude])
    previousLongitude = longitude
  }

  return unwrapped
}

function unwrapLongitude(longitude: number, previousLongitude: number) {
  let unwrapped = longitude
  while (unwrapped - previousLongitude > 180) {
    unwrapped -= 360
  }
  while (unwrapped - previousLongitude < -180) {
    unwrapped += 360
  }
  return unwrapped
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI
}

function createRouteGeometryKey(geometry: GeoJsonLineString) {
  return geometry.coordinates
    .map((position) => `${position[0]},${position[1]}`)
    .join(';')
}

function createStopPairKey(fromStopId: string, toStopId: string) {
  return `${fromStopId}:${toStopId}`
}

function createPlaceMarkerHtml() {
  return `
    <div class="trip-map-place-marker">
    </div>
  `
}

function createPostBubbleHtml(post: TravelPost, active: boolean) {
  const primaryMedia = getPrimaryPostMedia(post)
  const thumbnailSrc = getMediaThumbnailSrc(primaryMedia)
  const className = active
    ? 'trip-map-post-bubble trip-map-post-bubble--active'
    : 'trip-map-post-bubble'

  return `
    <div class="${className}">
      <img class="trip-map-post-bubble__image" src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(primaryMedia.alt)}" width="44" height="44" />
    </div>
  `
}

function createDraftPostMarkerHtml() {
  return `
    <div class="trip-map-draft-post-marker">
      <span>+</span>
    </div>
  `
}

function getPrimaryPostMedia(post: TravelPost): PostMedia {
  return (
    post.media.find((media) => getMediaType(media) === 'image') ??
    post.media[0]
  )
}

function getMediaType(media: PostMedia): NonNullable<PostMedia['type']> {
  return media.type ?? 'image'
}

function getMediaThumbnailSrc(media: PostMedia) {
  return getMediaType(media) === 'video'
    ? media.poster ?? media.src
    : media.src
}

const mediaStripHeightClassName = 'h-56 sm:h-64 lg:h-72 xl:h-80'

function isSupportedMediaFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

function getPostMediaType(file: File): NonNullable<PostMedia['type']> {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

function toPostOccurredAtValue(value: string) {
  const date = parseDateTime(value)
  return date ? date.toISOString() : value
}

function toPostMediaTuple(
  media: readonly PostMedia[],
): readonly [PostMedia, ...PostMedia[]] {
  if (media.length === 0) {
    throw new Error('Posts require at least one media item.')
  }

  return media as readonly [PostMedia, ...PostMedia[]]
}

function getVisibilityLabel(visibility: MockTripVisibility) {
  switch (visibility) {
    case 'PRIVATE':
      return 'Private'
    case 'PLATFORM_PUBLIC':
      return 'Platform public'
    case 'PUBLIC':
      return 'Public'
  }
}

function getVisibilityDescription(visibility: MockTripVisibility) {
  switch (visibility) {
    case 'PRIVATE':
      return 'Only members and explicitly allowed viewers can see this trip.'
    case 'PLATFORM_PUBLIC':
      return 'Signed-in OpenVoyage users can find and open this trip.'
    case 'PUBLIC':
      return 'Anyone with the route can view the published trip.'
  }
}

function getRoleLabel(role: MockTripRole) {
  switch (role) {
    case 'OWNER':
      return 'Owner'
    case 'MEMBER':
      return 'Member'
  }
}

function getTravelModeLabel(travelMode: TravelMode) {
  return (
    travelModeOptions.find((option) => option.value === travelMode)?.label ??
    'Unknown'
  )
}

function createMockProviderRoute({
  coordinates,
  distanceMeters,
  durationSeconds,
}: {
  coordinates: GeoJsonLineString['coordinates']
  distanceMeters: number
  durationSeconds: number
}): ItineraryTravelRoute {
  return {
    distance_meters: distanceMeters,
    duration_seconds: durationSeconds,
    geometry: {
      coordinates,
      type: 'LineString',
    },
    type: 'PROVIDER_BACKED',
  }
}

function createMockSimpleRoute(
  coordinates: GeoJsonLineString['coordinates'],
): ItineraryTravelRoute {
  return {
    distance_meters: null,
    duration_seconds: null,
    geometry: {
      coordinates,
      type: 'LineString',
    },
    type: 'SIMPLE',
  }
}

function createSimpleRouteForStops(
  fromStop: Stop,
  toStop: Stop,
): ItineraryTravelRoute {
  return createMockSimpleRoute([
    [fromStop.location.longitude, fromStop.location.latitude],
    [toStop.location.longitude, toStop.location.latitude],
  ])
}

function hasRouteDefiningTravelLegUpdate(updates: Partial<TravelLeg>) {
  return (
    'from_stop_id' in updates ||
    'to_stop_id' in updates ||
    'travel_mode' in updates
  )
}

function formatNights(nights: number) {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`
}

function formatStopDateLabel(value: string) {
  const date = parseDateOnly(value)
  return date ? formatMonthDayLabel(date) : value
}

function getStayLeaveDateValue(startDateValue: string, nights: number) {
  const startDate = parseDateOnly(startDateValue)
  if (!startDate) {
    return startDateValue
  }

  return formatDateInputValue(addDays(startDate, Math.max(0, nights)))
}

function getNightsBetweenDates(startDateValue: string, endDateValue: string) {
  const startDate = parseDateOnly(startDateValue)
  const endDate = parseDateOnly(endDateValue)
  if (!startDate || !endDate) {
    return 0
  }

  return Math.max(
    0,
    Math.round((toDateOnlyTime(endDate) - toDateOnlyTime(startDate)) / dayInMs),
  )
}

function rebalanceTravelLegsAfterStopDelete({
  currentLegs,
  nextStop,
  previousStop,
  stopId,
}: {
  currentLegs: readonly TravelLeg[]
  nextStop: Stop | null
  previousStop: Stop | null
  stopId: string
}) {
  const remainingLegs = currentLegs.filter(
    (leg) => leg.from_stop_id !== stopId && leg.to_stop_id !== stopId,
  )

  if (!previousStop || !nextStop) {
    return remainingLegs
  }

  const hasRebalancedLeg = remainingLegs.some(
    (leg) =>
      leg.from_stop_id === previousStop.id && leg.to_stop_id === nextStop.id,
  )

  if (hasRebalancedLeg) {
    return remainingLegs
  }

  return [
    ...remainingLegs,
    createDefaultTravelLeg({
      fromStop: previousStop,
      toStop: nextStop,
    }),
  ]
}

function createDefaultTravelLeg({
  fromStop,
  toStop,
}: {
  fromStop: Stop
  toStop: Stop
}): TravelLeg {
  return {
    created_at: mockItineraryTimestamp,
    from_stop_id: fromStop.id,
    id: `mock-leg-${fromStop.id}-${toStop.id}`,
    notes: '',
    operator: null,
    reference: null,
    route: createSimpleRouteForStops(fromStop, toStop),
    to_stop_id: toStop.id,
    travel_mode: 'UNKNOWN',
    trip_id: fromStop.trip_id,
    updated_at: mockItineraryTimestamp,
  }
}

function getTravelModeIcon(travelMode: TravelMode): LucideIcon {
  switch (travelMode) {
    case 'BIKE':
      return Bike
    case 'BUS':
      return Bus
    case 'CAR':
      return Car
    case 'FERRY':
      return Ship
    case 'FLIGHT':
      return Plane
    case 'TRAIN':
      return TrainFront
    case 'WALK':
      return Footprints
    case 'OTHER':
    case 'UNKNOWN':
      return Navigation
  }
}

function getStopCoordinates(stop: Stop): L.LatLngTuple {
  return [stop.location.latitude, stop.location.longitude]
}

function nullableTextValue(value: string) {
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

function getPlaceCoordinates(place: Place): L.LatLngTuple {
  return [place.latitude, place.longitude]
}

function getStopPlaceName(stop: Stop) {
  return stop.location.name || stop.location.full_name
}

function getPlaceNameLabel(place: Place) {
  return place.name || place.full_name
}

function getPlaceSearchInput(place: Place) {
  return getPlaceNameLabel(place)
}

function formatPlaceDetail(place: Place) {
  const regionLabel = [place.region, place.country_code]
    .filter(Boolean)
    .join(', ')
  const coordinates = formatCoordinates(getPlaceCoordinates(place))

  return regionLabel ? `${regionLabel} · ${coordinates}` : coordinates
}

function createDraftMapPointLocation(
  coordinates: L.LatLngTuple,
  target: MapPointTarget,
): DraftPostLocation {
  return {
    coordinates,
    label: target === 'stop' ? 'Selected stop location' : 'Selected post location',
  }
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

function getStopTitleSuggestion(locationLabel: string) {
  return locationLabel.replace(/^(At|Near)\s+/i, '')
}

function createPendingTrip(tripId: string | undefined): MockTrip {
  return {
    description: '',
    endDate: '',
    id: tripId ?? 'loading',
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

function toTripViewModel(trip: Trip): MockTrip {
  return {
    description: trip.description,
    endDate: trip.end_date ?? '',
    id: trip.id,
    name: trip.name,
    startDate: trip.start_date,
    visibility: trip.visibility,
  }
}

function toTripUpdatePayload(draft: TripSettingsDraft): TripUpdatePayload {
  return {
    description: draft.description,
    end_date: draft.endDate,
    name: draft.name,
    start_date: draft.startDate,
    visibility: draft.visibility,
  }
}

function toTripMemberViewModel(member: TripMember): MockTripMember {
  return {
    email: getUserSubtitle(member.user),
    id: member.user_id,
    name: getUserDisplayName(member.user),
    role: member.role,
    userId: member.user_id,
  }
}

function toTripViewerViewModel(viewer: TripViewer): MockTripViewer {
  return {
    email: getUserSubtitle(viewer.user),
    id: viewer.user_id,
    name: getUserDisplayName(viewer.user),
    userId: viewer.user_id,
  }
}

function toShareLinkViewModel(
  link: TripShareLink | TripShareLinkCreateResponse,
): MockShareLink {
  return {
    expiresAt: link.expires_at,
    id: link.id,
    label: link.label?.trim() || 'Untitled link',
    lastUsedAt: link.last_used_at
      ? formatDateTimeLabel(link.last_used_at)
      : null,
    token: 'token' in link ? link.token : null,
    tripId: link.trip_id,
  }
}

function getUserDisplayName(user: UserSummary) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return fullName || user.username || 'Traveler'
}

function getUserSubtitle(user: UserSummary) {
  return user.username ? `@${user.username}` : user.id
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

function toTravelPostViewModel(post: Post): TravelPost {
  const coordinates: L.LatLngTuple = [
    post.location.latitude,
    post.location.longitude,
  ]
  const media = post.media.map(toPostMediaViewModel)

  return {
    comments: 0,
    coordinates,
    excerpt: post.body,
    id: post.id,
    location: post.location.full_name || post.location.name,
    media: toPostMediaTuple(
      media.length > 0 ? media : [createFallbackPostMedia(post.title)],
    ),
    occurred_at: post.occurred_at,
    time: formatDateTimeLabel(post.occurred_at),
    title: post.title,
  }
}

function toPostMediaViewModel(media: Post['media'][number]): PostMedia {
  return {
    alt: media.metadata.caption || `${media.media_type.toLowerCase()} media`,
    media_id: media.id,
    poster: media.media_type === 'VIDEO' ? media.urls.thumbnail ?? undefined : undefined,
    src: media.urls.content,
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

async function uploadPostDraftMedia(
  media: readonly PostMedia[],
  accessToken: string,
) {
  const mediaIds = await Promise.all(
    media.map(async (item) => {
      if (item.media_id) {
        return item.media_id
      }
      if (item.file) {
        return uploadMedia(item.file, accessToken)
      }
      return null
    }),
  )

  return mediaIds.filter((mediaId): mediaId is string => Boolean(mediaId))
}

function toTravelPostUpdates(draft: PostSubmitDraft): Partial<TravelPost> {
  return {
    coordinates: draft.coordinates,
    excerpt: draft.story,
    location: draft.locationLabel,
    media: toPostMediaTuple(draft.media),
    occurred_at: draft.occurredAt,
    time: formatDateTimeLabel(draft.occurredAt),
    title: draft.title,
  }
}

function createMockPostFromDraft(draft: PostSubmitDraft): TravelPost {
  return {
    comments: 0,
    coordinates: draft.coordinates,
    excerpt: draft.story,
    id: createClientId('mock-post'),
    location: draft.locationLabel,
    media: toPostMediaTuple(draft.media),
    occurred_at: draft.occurredAt,
    time: formatDateTimeLabel(draft.occurredAt),
    title: draft.title,
  }
}

function createMockStopFromDraft(draft: CreateStopDraft, tripId: string): Stop {
  return {
    created_at: new Date().toISOString(),
    created_by: mockItineraryCreator,
    id: createClientId('mock-stop'),
    location: {
      country_code: 'ZZ',
      full_name: draft.title,
      id: createClientId('mock-location'),
      latitude: draft.coordinates[0],
      longitude: draft.coordinates[1],
      name: draft.title,
      region: 'Selected location',
    },
    notes: draft.notes,
    planned_nights: draft.plannedNights,
    planned_start_date: draft.plannedStartDate,
    same_day_position: 0,
    title: draft.title,
    trip_id: tripId,
    updated_at: new Date().toISOString(),
    visited: false,
  }
}

function orderStops(stops: readonly Stop[]) {
  return [...stops].sort((leftStop, rightStop) => {
    const dateComparison = leftStop.planned_start_date.localeCompare(
      rightStop.planned_start_date,
    )
    if (dateComparison !== 0) {
      return dateComparison
    }

    return (
      leftStop.same_day_position - rightStop.same_day_position ||
      leftStop.id.localeCompare(rightStop.id)
    )
  })
}

function assignStopPosition(
  stop: Stop,
  index: number,
  orderedStops: readonly Stop[],
): Stop {
  const sameDayPosition = orderedStops
    .slice(0, index)
    .filter((item) => item.planned_start_date === stop.planned_start_date).length

  return {
    ...stop,
    same_day_position: sameDayPosition,
  }
}

function rebalanceTravelLegsForStops(
  stops: readonly Stop[],
  currentLegs: readonly TravelLeg[],
) {
  const legsByPair = new Map(
    currentLegs.map((leg): [string, TravelLeg] => [
      createStopPairKey(leg.from_stop_id, leg.to_stop_id),
      leg,
    ]),
  )
  const nextLegs: TravelLeg[] = []

  for (let index = 0; index < stops.length - 1; index += 1) {
    const fromStop = stops[index]
    const toStop = stops[index + 1]
    if (!fromStop || !toStop) {
      continue
    }

    nextLegs.push(
      legsByPair.get(createStopPairKey(fromStop.id, toStop.id)) ??
        createDefaultTravelLeg({ fromStop, toStop }),
    )
  }

  return nextLegs
}

function createStopEditDraft(stop: Stop | null): StopEditDraft {
  return {
    notes: stop?.notes ?? '',
    plannedNights: stop?.planned_nights ?? 1,
    plannedStartDate: stop?.planned_start_date ?? formatDateInputValue(new Date()),
    title: stop?.title ?? '',
  }
}

function createTravelLegEditDraft(
  leg: TravelLeg | null,
): TravelLegEditDraft {
  return {
    notes: leg?.notes ?? '',
    operator: leg?.operator ?? null,
    reference: leg?.reference ?? null,
    travelMode: leg?.travel_mode ?? 'UNKNOWN',
  }
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

function getSearchLocationCoordinates(
  value: string,
  target: MapPointTarget,
): L.LatLngTuple {
  const normalizedValue = value.trim().toLowerCase()
  const knownPlace = [
    ...initialStops.map((stop) => ({
      coordinates: getStopCoordinates(stop),
      label: stop.title.toLowerCase(),
    })),
    { coordinates: [40.2033, -8.4103] as L.LatLngTuple, label: 'coimbra' },
    { coordinates: [41.1408, -8.611] as L.LatLngTuple, label: 'porto riverside' },
  ].find((place) => normalizedValue.includes(place.label))

  if (knownPlace) {
    return knownPlace.coordinates
  }

  return target === 'stop' ? [40.2033, -8.4103] : [41.1408, -8.611]
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${Math.round(distanceMeters / 1000).toLocaleString()} km`
  }

  return `${distanceMeters.toLocaleString()} m`
}

function formatDuration(durationSeconds: number) {
  const totalMinutes = Math.round(durationSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) {
    return `${minutes} min`
  }
  if (minutes === 0) {
    return `${hours} hr`
  }
  return `${hours} hr ${minutes} min`
}

function canUseProviderRoute(travelMode: TravelMode) {
  return travelMode === 'WALK' || travelMode === 'BIKE' || travelMode === 'CAR'
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function createClientId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatTripDateRange(startDate: string, endDate: string) {
  if (!endDate) {
    return `${formatDateLabel(startDate)} onward`
  }

  return `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`
}

function formatDateLabel(value: string) {
  const date = parseDateOnly(value)
  if (!date) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function formatMonthDayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function formatDateTimeLabel(value: string) {
  const date = parseDateTime(value)
  if (!date) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) {
    return null
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTimeInputValue(date: Date | null) {
  if (!date) {
    return ''
  }

  return `${formatDateInputValue(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const dayInMs = 24 * 60 * 60 * 1000

function toDateOnlyTime(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

function parseDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) {
    return null
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  )
}

function getShareUrl(token: string, tripId: string | undefined) {
  const origin =
    typeof window === 'undefined'
      ? 'https://openvoyage.example'
      : window.location.origin
  const tripPath = tripId ? `/trips/${encodeURIComponent(tripId)}` : '/trips'

  return `${origin}${tripPath}?share=${encodeURIComponent(token)}`
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function formatCoordinates([lat, lng]: L.LatLngTuple) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

type PostScrollElementsRef = {
  current: Map<string, HTMLElement>
}

type PostScrollRootRef = {
  current: HTMLElement | null
}

type PostScrollAxis = 'x' | 'y'

function setPostScrollElement(
  postElementsRef: PostScrollElementsRef,
  postId: string,
  element: HTMLElement | null,
) {
  if (!element) {
    postElementsRef.current.delete(postId)
    return
  }

  element.dataset.tripPostId = postId
  postElementsRef.current.set(postId, element)
}

function usePostScrollFocus({
  axis,
  enabled,
  firstPostId,
  onFocusedPostChange,
  postElementsRef,
  postIds,
  rootRef,
}: {
  axis: PostScrollAxis
  enabled: boolean
  firstPostId: string | null
  onFocusedPostChange: (postId: string | null) => void
  postElementsRef: PostScrollElementsRef
  postIds: readonly string[]
  rootRef?: PostScrollRootRef
}) {
  const latestFocusedPostChangeRef = useRef(onFocusedPostChange)

  useEffect(() => {
    latestFocusedPostChangeRef.current = onFocusedPostChange
  }, [onFocusedPostChange])

  useEffect(() => {
    if (!enabled) {
      latestFocusedPostChangeRef.current(null)
      return undefined
    }

    if (typeof window === 'undefined') {
      return undefined
    }

    const elements = postIds
      .map((postId) => postElementsRef.current.get(postId) ?? null)
      .filter((element): element is HTMLElement => Boolean(element))
    const rootElement =
      rootRef?.current ?? getNearestScrollAncestor(elements[0] ?? null, axis)
    const scrollTarget: HTMLElement | Window = rootElement ?? window
    let animationFrameId: number | null = null

    function updateFocusedPost() {
      animationFrameId = null
      const nextPostId = getFocusedPostIdFromScrollPosition({
        axis,
        elements,
        postIds,
        rootElement,
      })

      latestFocusedPostChangeRef.current(
        nextPostId === firstPostId ? null : nextPostId,
      )
    }

    function scheduleFocusedPostUpdate() {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(updateFocusedPost)
    }

    scheduleFocusedPostUpdate()
    scrollTarget.addEventListener('scroll', scheduleFocusedPostUpdate, {
      passive: true,
    })
    window.addEventListener('resize', scheduleFocusedPostUpdate)

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleFocusedPostUpdate)
    if (resizeObserver) {
      for (const element of elements) {
        resizeObserver.observe(element)
      }
      if (rootElement) {
        resizeObserver.observe(rootElement)
      }
    }

    return () => {
      scrollTarget.removeEventListener('scroll', scheduleFocusedPostUpdate)
      window.removeEventListener('resize', scheduleFocusedPostUpdate)
      resizeObserver?.disconnect()
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
    }
  }, [axis, enabled, firstPostId, postElementsRef, postIds, rootRef])
}

function getFocusedPostIdFromScrollPosition({
  axis,
  elements,
  postIds,
  rootElement,
}: {
  axis: PostScrollAxis
  elements: readonly HTMLElement[]
  postIds: readonly string[]
  rootElement: HTMLElement | null
}) {
  if (elements.length === 0) {
    return null
  }

  const rootRange = getScrollRootRange(rootElement, axis)
  if (isScrollRootAtEnd(rootElement, axis)) {
    return postIds[postIds.length - 1] ?? null
  }

  const activationPoint = rootRange.start + rootRange.size * 0.5
  let nextPostId: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const element of elements) {
    const postId = element.dataset.tripPostId
    if (!postId) {
      continue
    }

    const elementRange = getElementRange(element, axis)
    const visibleSize =
      Math.min(rootRange.end, elementRange.end) -
      Math.max(rootRange.start, elementRange.start)
    if (visibleSize <= 0) {
      continue
    }

    const elementCenter = elementRange.start + elementRange.size * 0.5
    const distance = Math.abs(elementCenter - activationPoint)
    if (distance < bestDistance) {
      nextPostId = postId
      bestDistance = distance
    }
  }

  return nextPostId
}

function getScrollRootRange(
  rootElement: HTMLElement | null,
  axis: PostScrollAxis,
) {
  const rootRect = rootElement?.getBoundingClientRect()
  const start =
    axis === 'x' ? rootRect?.left ?? 0 : rootRect?.top ?? 0
  const end =
    axis === 'x'
      ? rootRect?.right ?? window.innerWidth
      : rootRect?.bottom ?? window.innerHeight

  return {
    end,
    size: end - start,
    start,
  }
}

function getElementRange(element: HTMLElement, axis: PostScrollAxis) {
  const rect = element.getBoundingClientRect()
  const start = axis === 'x' ? rect.left : rect.top
  const end = axis === 'x' ? rect.right : rect.bottom

  return {
    end,
    size: end - start,
    start,
  }
}

function isScrollRootAtEnd(
  rootElement: HTMLElement | null,
  axis: PostScrollAxis,
) {
  if (!rootElement) {
    return false
  }

  const scrollOffset = axis === 'x' ? rootElement.scrollLeft : rootElement.scrollTop
  const clientSize = axis === 'x' ? rootElement.clientWidth : rootElement.clientHeight
  const scrollSize = axis === 'x' ? rootElement.scrollWidth : rootElement.scrollHeight

  if (scrollSize <= clientSize + 2) {
    return false
  }

  return scrollOffset + clientSize >= scrollSize - 2
}

function getNearestScrollAncestor(
  element: HTMLElement | null,
  axis: PostScrollAxis,
) {
  let currentElement = element?.parentElement ?? null
  while (currentElement) {
    const style = window.getComputedStyle(currentElement)
    const overflow = axis === 'x' ? style.overflowX : style.overflowY
    const isScrollable =
      overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
    const hasScrollableContent =
      axis === 'x'
        ? currentElement.scrollWidth > currentElement.clientWidth
        : currentElement.scrollHeight > currentElement.clientHeight

    if (isScrollable && hasScrollableContent) {
      return currentElement
    }

    currentElement = currentElement.parentElement
  }

  return null
}

function readTripDetailUrlState({
  canSwitchModes,
  travelPosts,
}: {
  canSwitchModes: boolean
  travelPosts: readonly TravelPost[]
}): TripDetailUrlState {
  const defaultState = createDefaultTripDetailUrlState(canSwitchModes)

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
      activeDialog: parseTripDialogParam(searchParams.get('dialog')),
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
    {
      canSwitchModes,
      travelPosts,
    },
  )
}

function createDefaultTripDetailUrlState(
  canSwitchModes: boolean,
): TripDetailUrlState {
  return {
    activeDialog: null,
    editingPostId: null,
    mode: canSwitchModes ? 'planning' : 'traveling',
    planningView: 'stops',
    travelingView: 'posts',
  }
}

function normalizeTripDetailUrlState(
  state: TripDetailUrlState,
  {
    canSwitchModes,
    travelPosts,
  }: {
    canSwitchModes: boolean
    travelPosts: readonly TravelPost[]
  },
): TripDetailUrlState {
  const mode = canSwitchModes ? state.mode : 'traveling'
  const planningView = mode === 'planning' ? state.planningView : 'stops'
  let travelingView = mode === 'traveling' ? state.travelingView : 'posts'
  let editingPostId =
    mode === 'traveling' && travelingView === 'edit-post'
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
    activeDialog: state.activeDialog,
    editingPostId,
    mode,
    planningView,
    travelingView,
  }
}

function writeTripDetailUrlState(
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
  if (state.activeDialog) {
    url.searchParams.set('dialog', state.activeDialog)
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

function parseTripDialogParam(value: string | null): TripDialog | null {
  switch (value) {
    case 'actions':
    case 'members':
    case 'settings':
    case 'share':
      return value
    default:
      return null
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const mediaQuery = window.matchMedia(query)

    function handleChange() {
      setMatches(mediaQuery.matches)
    }

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [query])

  return matches
}
