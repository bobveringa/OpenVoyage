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
  Search,
  Send,
  Share2,
  Shield,
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
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type TripMode = 'planning' | 'traveling'
type PlanningView = 'create-stop' | 'stops'
type TravelingView = 'create-post' | 'posts'
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
}

type MockTripViewer = {
  email: string
  id: string
  name: string
}

type MockShareLink = {
  expiresAt: string
  id: string
  label: string
  lastUsedAt: string
  token: string
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
}

type TravelLeg = {
  created_at: string
  from_stop_id: string
  id: string
  notes: string
  operator: string | null
  reference: string | null
  to_stop_id: string
  travel_mode: TravelMode
  trip_id: string
  updated_at: string
}

type PostMedia = {
  alt: string
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
  time: string
  title: string
}

type DraftPostLocation = {
  coordinates: L.LatLngTuple
  label: string
}

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
    to_stop_id: stopIds.dolomites,
    travel_mode: 'CAR',
    trip_id: mockTrip.id,
    updated_at: mockItineraryTimestamp,
  },
] as const

const travelPosts: readonly TravelPost[] = [
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
    time: '10 May, 17:48',
    title: 'A better transfer plan',
  },
] as const

export function TripDetailMockupPage() {
  const shouldUseMobileMapPicker = useMediaQuery('(max-width: 1023px)')
  const canSwitchModes = true
  const [mode, setMode] = useState<TripMode>('planning')
  const [planningView, setPlanningView] = useState<PlanningView>('stops')
  const [plannedStops, setPlannedStops] = useState<readonly Stop[]>(initialStops)
  const [travelLegs, setTravelLegs] =
    useState<readonly TravelLeg[]>(initialTravelLegs)
  const [travelingView, setTravelingView] = useState<TravelingView>('posts')
  const [activeDialog, setActiveDialog] = useState<TripDialog | null>(null)
  const [mapPointTarget, setMapPointTarget] = useState<MapPointTarget | null>(
    null,
  )
  const [mobileMapPickerTarget, setMobileMapPickerTarget] =
    useState<MapPointTarget | null>(null)
  const [draftPostLocation, setDraftPostLocation] =
    useState<DraftPostLocation | null>(null)
  const [draftStopLocation, setDraftStopLocation] =
    useState<DraftPostLocation | null>(null)

  const openDialog = useCallback((dialog: TripDialog) => {
    setActiveDialog(dialog)
  }, [])

  const closeDialog = useCallback(() => {
    setActiveDialog(null)
  }, [])

  function handleStopChange(stopId: string, updates: Partial<Stop>) {
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

  function handleTravelLegChange(legId: string, updates: Partial<TravelLeg>) {
    setTravelLegs((currentLegs) =>
      currentLegs.map((leg) =>
        leg.id === legId
          ? {
              ...leg,
              ...updates,
            }
          : leg,
      ),
    )
  }

  function handleStopDelete(stopId: string) {
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

  const applyDraftMapPointLocation = useCallback(
    (target: MapPointTarget, coordinates: L.LatLngTuple) => {
      const draftLocation = createDraftMapPointLocation(coordinates, target)

      if (target === 'post') {
        setDraftPostLocation(draftLocation)
        setMode('traveling')
        setTravelingView('create-post')
        return
      }

      if (target === 'stop') {
        setDraftStopLocation(draftLocation)
      }
    },
    [],
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

  const handleModeChange = useCallback((nextMode: TripMode) => {
    setMapPointTarget(null)
    setMobileMapPickerTarget(null)
    setMode(nextMode)
    setPlanningView('stops')
    setTravelingView('posts')
  }, [])

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

  useEffect(() => {
    if (!shouldUseMobileMapPicker) {
      setMobileMapPickerTarget(null)
    }
  }, [shouldUseMobileMapPicker])

  return (
    <div className="relative min-h-[calc(100dvh-4rem-1px)] w-full overflow-x-hidden py-3 lg:left-1/2 lg:h-[calc(100dvh-4rem-1px)] lg:w-screen lg:-translate-x-1/2 lg:overflow-hidden lg:px-6">
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
              draftPostLocation={draftPostLocation}
              draftStopLocation={draftStopLocation}
              mapPointTarget={mapPointTarget}
              onMapPointTargetChange={handleMapPointTargetChange}
              onOpenDialog={openDialog}
              onPlanningViewChange={setPlanningView}
              onStopChange={handleStopChange}
              onStopDelete={handleStopDelete}
              onTravelLegChange={handleTravelLegChange}
              onTravelingViewChange={setTravelingView}
              planningView={planningView}
              showMobileTravelMap={shouldUseMobileMapPicker}
              stops={plannedStops}
              trip={mockTrip}
              travelLegs={travelLegs}
              travelingView={travelingView}
            />
          </div>
          {!shouldUseMobileMapPicker ? (
            <MapWorkspace
              draftMapLocation={activeDraftMapLocation}
              mapPointEnabled={mapPointTarget !== null}
              onDraftMapPointSelect={handleDraftMapPointSelect}
              stops={plannedStops}
            />
          ) : null}
        </div>
      </div>

      <TripSettingsDialog
        onClose={closeDialog}
        open={activeDialog === 'settings'}
        trip={mockTrip}
      />
      <ShareManagementDialog
        onClose={closeDialog}
        open={activeDialog === 'share'}
      />
      <TripMembersDialog
        onClose={closeDialog}
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
        stops={plannedStops}
        target={mobileMapPickerTarget}
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
  onClose,
  open,
  trip,
}: {
  onClose: () => void
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
    onClose()
  }

  return (
    <Modal
      description="Mock form only. These fields match the trip update shape for later API wiring."
      onClose={onClose}
      open={open}
      title="Trip settings"
    >
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <label className="grid gap-2 text-sm font-medium text-foreground">
          Trip title
          <Input
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Start date
            <DatePicker
              onValueChange={handleStartDateChange}
              value={startDate}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-foreground">
            End date
            <DatePicker
              min={startDate || undefined}
              onValueChange={setEndDate}
              value={endDate}
            />
          </label>
        </div>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Visibility
          <Select<MockTripVisibility>
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
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>

        <section className="rounded-[1.35rem] border border-emerald-100 bg-emerald-50/70 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-primary">
              <Shield className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">API-ready fields</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Title, description, visibility, start date, and end date map to
                the trip update payload later.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={name.trim().length === 0 || !startDate} type="submit">
            Save changes
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
  onClose,
  open,
}: {
  onClose: () => void
  open: boolean
}) {
  const [linkExpiresAt, setLinkExpiresAt] = useState('2027-06-01T09:00')
  const [linkLabel, setLinkLabel] = useState('Family preview')
  const [notice, setNotice] = useState<string | null>(null)
  const [viewerEmail, setViewerEmail] = useState('')

  function handleCreateLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(`Share link "${linkLabel.trim() || 'Untitled link'}" staged.`)
    setLinkLabel('')
  }

  function handleInviteViewer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = viewerEmail.trim()
    if (!email) {
      return
    }

    setNotice(`Viewer invite staged for ${email}.`)
    setViewerEmail('')
  }

  return (
    <Modal
      description="Manage visitor access and share links without sending anything yet."
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
                onChange={(event) => setLinkLabel(event.target.value)}
                placeholder="Family preview"
                value={linkLabel}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Expiration
              <DateTimePicker
                onValueChange={setLinkExpiresAt}
                value={linkExpiresAt}
              />
            </label>
            <div className="flex justify-end">
              <Button type="submit">
                <Plus className="size-4" aria-hidden="true" />
                Create link
              </Button>
            </div>
          </form>

          <div className="grid gap-2">
            {mockShareLinks.map((link) => (
              <ShareLinkRow key={link.id} link={link} onNotice={setNotice} />
            ))}
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
              Viewer email
              <Input
                onChange={(event) => setViewerEmail(event.target.value)}
                placeholder="friend@example.com"
                type="email"
                value={viewerEmail}
              />
            </label>
            <Button
              className="self-end"
              disabled={viewerEmail.trim().length === 0}
              type="submit"
            >
              <Send className="size-4" aria-hidden="true" />
              Invite
            </Button>
          </form>

          <div className="grid gap-2">
            {mockTripViewers.map((viewer) => (
              <div
                className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-emerald-100 bg-emerald-50/40 px-3 py-2"
                key={viewer.id}
              >
                <UserSummary name={viewer.name} subtitle={viewer.email} />
                <Button
                  aria-label={`Remove ${viewer.name}`}
                  onClick={() =>
                    setNotice(`${viewer.name} removal staged for API wiring.`)
                  }
                  size="icon"
                  title={`Remove ${viewer.name}`}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function TripMembersDialog({
  onClose,
  open,
}: {
  onClose: () => void
  open: boolean
}) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MockTripRole>('MEMBER')
  const [notice, setNotice] = useState<string | null>(null)

  function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = inviteEmail.trim()
    if (!email) {
      return
    }

    setNotice(`${getRoleLabel(inviteRole)} invite staged for ${email}.`)
    setInviteEmail('')
    setInviteRole('MEMBER')
  }

  return (
    <Modal
      description="Invite collaborators and prepare role changes for later API calls."
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
                Members can help manage posts and planning once the API is wired.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Email
              <Input
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="traveler@example.com"
                type="email"
                value={inviteEmail}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Role
              <Select<MockTripRole>
                onValueChange={setInviteRole}
                options={memberRoleOptions}
                value={inviteRole}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button
              disabled={inviteEmail.trim().length === 0}
              type="submit"
            >
              <Mail className="size-4" aria-hidden="true" />
              Send invite
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
                Role selectors are interactive mock controls.
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            {mockTripMembers.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                onNotice={setNotice}
              />
            ))}
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
      description="Secondary actions stay mocked until their API contracts are connected."
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
          description="This will eventually require confirmation before an API call."
          icon={Trash2}
          label="Delete trip"
          onClick={() => setNotice('Delete confirmation would open here.')}
        />
      </div>
    </Modal>
  )
}

function ShareLinkRow({
  link,
  onNotice,
}: {
  link: MockShareLink
  onNotice: (notice: string) => void
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    setCopied(true)
    onNotice(`${link.label} copied to clipboard.`)
    void navigator.clipboard
      ?.writeText(getMockShareUrl(link.token))
      .catch(() => undefined)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="grid gap-3 rounded-[1.2rem] border border-emerald-100 bg-emerald-50/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{link.label}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {getMockShareUrl(link.token)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Expires {link.expiresAt ? formatDateTimeLabel(link.expiresAt) : 'never'} ·
          Last used {link.lastUsedAt.toLowerCase()}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleCopy} type="button" variant="outline">
          <Copy className="size-4" aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          aria-label={`Revoke ${link.label}`}
          onClick={() => onNotice(`${link.label} revoke action staged.`)}
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
  member,
  onNotice,
}: {
  member: MockTripMember
  onNotice: (notice: string) => void
}) {
  const [role, setRole] = useState<MockTripRole>(member.role)
  const isOwner = member.role === 'OWNER'

  function handleRoleChange(nextRole: MockTripRole) {
    setRole(nextRole)
    onNotice(`${member.name} role change staged as ${getRoleLabel(nextRole)}.`)
  }

  return (
    <div className="grid gap-3 rounded-[1.2rem] border border-emerald-100 bg-emerald-50/40 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center">
      <UserSummary name={member.name} subtitle={member.email} />
      <Select<MockTripRole>
        disabled={isOwner}
        onValueChange={handleRoleChange}
        options={memberRoleOptions}
        value={role}
      />
      <Button
        aria-label={`Remove ${member.name}`}
        disabled={isOwner}
        onClick={() => onNotice(`${member.name} removal staged.`)}
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
  stops,
  target,
}: {
  initialLocation: DraftPostLocation | null
  onCancel: () => void
  onConfirm: (coordinates: L.LatLngTuple) => void
  open: boolean
  stops: readonly Stop[]
  target: MapPointTarget | null
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
        stops={stops}
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
  draftPostLocation,
  draftStopLocation,
  mapPointTarget,
  mode,
  onMapPointTargetChange,
  onOpenDialog,
  onPlanningViewChange,
  onStopChange,
  onStopDelete,
  onTravelLegChange,
  onTravelingViewChange,
  planningView,
  showMobileTravelMap,
  stops,
  trip,
  travelLegs,
  travelingView,
}: {
  draftPostLocation: DraftPostLocation | null
  draftStopLocation: DraftPostLocation | null
  mapPointTarget: MapPointTarget | null
  mode: TripMode
  onMapPointTargetChange: (target: MapPointTarget | null) => void
  onOpenDialog: (dialog: TripDialog) => void
  onPlanningViewChange: (view: PlanningView) => void
  onStopChange: (stopId: string, updates: Partial<Stop>) => void
  onStopDelete: (stopId: string) => void
  onTravelLegChange: (legId: string, updates: Partial<TravelLeg>) => void
  onTravelingViewChange: (view: TravelingView) => void
  planningView: PlanningView
  showMobileTravelMap: boolean
  stops: readonly Stop[]
  trip: MockTrip
  travelLegs: readonly TravelLeg[]
  travelingView: TravelingView
}) {
  const isMobileTravelPosts = mode === 'traveling' && travelingView === 'posts'

  return (
    <aside
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm lg:h-full',
        isMobileTravelPosts && 'h-[calc(100dvh-9.75rem)] lg:h-full',
      )}
    >
      <TripSidebarHeader onOpenDialog={onOpenDialog} trip={trip} />

      <div
        className={cn(
          'scrollbar-subtle min-w-0 flex-1 pb-24 lg:min-h-0 lg:overflow-auto lg:pb-0',
          isMobileTravelPosts && 'min-h-0 overflow-hidden pb-0',
        )}
      >
        {mode === 'planning' && planningView === 'create-stop' ? (
          <CreateStopPanel
            draftLocation={draftStopLocation}
            mapPointActive={mapPointTarget === 'stop'}
            onCancel={() => {
              onMapPointTargetChange(null)
              onPlanningViewChange('stops')
            }}
            onMapPointTargetChange={onMapPointTargetChange}
            stops={stops}
          />
        ) : mode === 'planning' ? (
          <PlanningPanel
            onAddStop={() => {
              onMapPointTargetChange(null)
              onPlanningViewChange('create-stop')
            }}
            onStopChange={onStopChange}
            onStopDelete={onStopDelete}
            onTravelLegChange={onTravelLegChange}
            stops={stops}
            travelLegs={travelLegs}
          />
        ) : travelingView === 'create-post' ? (
          <CreatePostPanel
            draftLocation={draftPostLocation}
            mapPointActive={mapPointTarget === 'post'}
            onCancel={() => {
              onMapPointTargetChange(null)
              onTravelingViewChange('posts')
            }}
            onMapPointTargetChange={onMapPointTargetChange}
          />
        ) : (
          <TravelingPanel
            onNewPost={() => {
              onMapPointTargetChange(null)
              onTravelingViewChange('create-post')
            }}
            showMobileMap={showMobileTravelMap}
            stops={stops}
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

function PlanningPanel({
  onAddStop,
  onStopChange,
  onStopDelete,
  onTravelLegChange,
  stops,
  travelLegs,
}: {
  onAddStop: () => void
  onStopChange: (stopId: string, updates: Partial<Stop>) => void
  onStopDelete: (stopId: string) => void
  onTravelLegChange: (legId: string, updates: Partial<TravelLeg>) => void
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
        <Button onClick={onAddStop} size="sm" type="button">
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
                onChange={onStopChange}
                onDelete={onStopDelete}
                onDetails={setEditingStopId}
                stop={stop}
              />
              {nextStop && leg ? (
                <TravelLegCard
                  fromStop={stop}
                  leg={leg}
                  onEdit={setEditingLegId}
                  toStop={nextStop}
                />
              ) : null}
            </Fragment>
          )
        })}
      </div>

      <StopEditDialog
        onChange={onStopChange}
        onClose={() => setEditingStopId(null)}
        open={Boolean(editingStop)}
        stop={editingStop}
      />
      <TravelLegEditDialog
        fromStop={editingLegFromStop}
        leg={editingLeg}
        onChange={onTravelLegChange}
        onClose={() => setEditingLegId(null)}
        open={Boolean(editingLeg && editingLegFromStop && editingLegToStop)}
        toStop={editingLegToStop}
      />
    </div>
  )
}

function CreateStopPanel({
  draftLocation,
  mapPointActive,
  onCancel,
  onMapPointTargetChange,
  stops,
}: {
  draftLocation: DraftPostLocation | null
  mapPointActive: boolean
  onCancel: () => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
  stops: readonly Stop[]
}) {
  const [locationSource, setLocationSource] = useState<'map' | 'search'>(
    mapPointActive ? 'map' : 'search',
  )
  const [newStopDate, setNewStopDate] = useState('2027-05-12')
  const [newStopNights, setNewStopNights] = useState(2)
  const [searchValue, setSearchValue] = useState('Coimbra')
  const [stopTitle, setStopTitle] = useState('Coimbra')
  const [stopTitleEdited, setStopTitleEdited] = useState(false)
  const [selectedAfterStopId, setSelectedAfterStopId] = useState(
    stops[1]?.id ?? stops[0]?.id ?? '',
  )
  const selectedAfterStop = stops.find((stop) => stop.id === selectedAfterStopId)
  const suggestedStopTitle =
    locationSource === 'map' && mapPointActive && draftLocation
      ? getStopTitleSuggestion(draftLocation.label)
      : searchValue.trim() || 'Coimbra'

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

  function selectSearchLocation() {
    setLocationSource('search')
    onMapPointTargetChange(null)
  }

  function selectMapLocation() {
    setLocationSource('map')
    onMapPointTargetChange('stop')
  }

  return (
    <div className="min-w-0 space-y-5 p-4">
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
              onChange={(event) => {
                selectSearchLocation()
                setSearchValue(event.target.value)
              }}
              placeholder="Search places"
              value={searchValue}
            />
          </span>
        </label>

        <LocationOptionCard
          active={locationSource === 'search' && !mapPointActive}
          detail="Portugal · 40.2033, -8.4103"
          icon={Search}
          label={searchValue.trim() || 'Coimbra'}
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
              onValueChange={setNewStopDate}
              value={newStopDate}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Nights
            <Input
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
          {stops.slice(0, 3).map((stop) => (
            <button
              className={cn(
                'flex items-center justify-between gap-3 rounded-[1.1rem] border px-3 py-2 text-left transition-colors hover:bg-emerald-50',
                stop.id === selectedAfterStopId
                  ? 'border-primary bg-emerald-50'
                  : 'border-emerald-100 bg-white',
              )}
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
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button
          disabled={stopTitle.trim().length === 0}
          onClick={onCancel}
          type="button"
        >
          <Plus className="size-4" aria-hidden="true" />
          Create stop
        </Button>
      </div>
    </div>
  )
}

function MobileTravelMap({ stops }: { stops: readonly Stop[] }) {
  const [resetNonce, setResetNonce] = useState(0)

  return (
    <section className="trip-mobile-travel-map absolute inset-0 overflow-hidden bg-white lg:hidden">
      <TripLeafletMap
        draftMapLocation={null}
        fitMode="mobile-travel"
        mapPointEnabled={false}
        onDraftMapPointSelect={() => undefined}
        resetNonce={resetNonce}
        stops={stops}
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
  onNewPost,
  showMobileMap,
  stops,
}: {
  onNewPost: () => void
  showMobileMap: boolean
  stops: readonly Stop[]
}) {
  const [activePostId, setActivePostId] = useState<string | null>(null)
  const activePost =
    travelPosts.find((post) => post.id === activePostId) ?? null

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
              post={activePost}
            />
          ) : (
            <>
              <MobileTravelMap stops={stops} />

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
                <div className="trip-mobile-post-carousel scrollbar-subtle flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1">
                  {travelPosts.map((post) => (
                    <TravelPostPreviewCard
                      key={post.id}
                      onOpen={() => setActivePostId(post.id)}
                      post={post}
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
              {travelPosts.length} posts
            </p>
          </div>
          <Button onClick={onNewPost} size="sm" type="button">
            <Camera className="size-4" aria-hidden="true" />
            New post
          </Button>
        </div>

        <div className="space-y-5">
          {travelPosts.map((post) => (
            <TravelPostCard key={post.id} post={post} />
          ))}
        </div>
      </div>
    </div>
  )
}

function CreatePostPanel({
  draftLocation,
  mapPointActive,
  onCancel,
  onMapPointTargetChange,
}: {
  draftLocation: DraftPostLocation | null
  mapPointActive: boolean
  onCancel: () => void
  onMapPointTargetChange: (target: MapPointTarget | null) => void
}) {
  const [locationSource, setLocationSource] = useState<'map' | 'search'>(
    mapPointActive ? 'map' : 'search',
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadedMediaUrlsRef = useRef<string[]>([])
  const [draftMedia, setDraftMedia] = useState<PostMedia[]>([])
  const [activeDraftMediaIndex, setActiveDraftMediaIndex] = useState<
    number | null
  >(null)
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const [mediaToolsOpen, setMediaToolsOpen] = useState(false)
  const [occurredAt, setOccurredAt] = useState('2027-05-08T20:14')
  const [searchValue, setSearchValue] = useState('Porto riverside')
  const [story, setStory] = useState(
    'The light moved across the river just as the terraces started to fill up. This is the note I want pinned to this exact place.',
  )
  const [title, setTitle] = useState('Sunset above the Douro')
  const hasLocation =
    locationSource === 'search' ||
    (locationSource === 'map' && mapPointActive && Boolean(draftLocation))

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
      for (const objectUrl of uploadedMediaUrlsRef.current) {
        URL.revokeObjectURL(objectUrl)
      }
    },
    [],
  )

  function selectSearchLocation() {
    setLocationSource('search')
    onMapPointTargetChange(null)
  }

  function selectMapLocation() {
    setLocationSource('map')
    onMapPointTargetChange('post')
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

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-start gap-3">
        <Button
          aria-label="Back to posts"
          onClick={onCancel}
          size="icon"
          title="Back to posts"
          type="button"
          variant="outline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div>
          <h2 className="text-base font-semibold text-foreground">New post</h2>
          <p className="text-sm text-muted-foreground">
            Pick a map location, add media, then write the story.
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
              onChange={(event) => {
                selectSearchLocation()
                setSearchValue(event.target.value)
              }}
              placeholder="Search places"
              value={searchValue}
            />
          </span>
        </label>

        <LocationOptionCard
          active={locationSource === 'search' && !mapPointActive}
          detail="Portugal · 41.1408, -8.6110"
          icon={Search}
          label={searchValue.trim() || 'Ribeira, Porto'}
          onClick={selectSearchLocation}
          source="Searched place"
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
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Story
          <Textarea
            className="min-h-36 resize-none"
            onChange={(event) => setStory(event.target.value)}
            value={story}
          />
        </label>

        <label className="grid gap-2 text-sm font-medium text-foreground">
          Occurred at
          <DateTimePicker
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
                onClick={() => fileInputRef.current?.click()}
                type="button"
                variant="outline"
              >
                <Upload className="size-4" aria-hidden="true" />
                Upload files
              </Button>
              <Button
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
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Save draft
        </Button>
        <Button
          disabled={
            !hasLocation || story.trim().length === 0 || draftMedia.length === 0
          }
          onClick={onCancel}
          type="button"
        >
          Publish post
        </Button>
      </div>

      {activeDraftMediaIndex !== null ? (
        <MediaLightbox
          activeIndex={activeDraftMediaIndex}
          media={draftMedia}
          onClose={() => setActiveDraftMediaIndex(null)}
          onIndexChange={setActiveDraftMediaIndex}
          title="Draft media"
        />
      ) : null}
    </div>
  )
}

function TravelPostCard({ post }: { post: TravelPost }) {
  const [activeMediaIndex, setActiveMediaIndex] = useState<number | null>(null)

  return (
    <article className="min-w-0 overflow-hidden rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 shadow-sm shadow-emerald-950/5">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-6 text-foreground">
              {post.title}
            </h3>
          </div>
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
  onOpen,
  post,
}: {
  onOpen: () => void
  post: TravelPost
}) {
  const primaryMedia = getPrimaryPostMedia(post)
  const isVideo = getMediaType(primaryMedia) === 'video'

  return (
    <article className="trip-mobile-post-carousel__card shrink-0 snap-center overflow-hidden rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 shadow-sm shadow-emerald-950/5">
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
  post,
}: {
  onBack: () => void
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
  index,
  onChange,
  onDelete,
  onDetails,
  stop,
}: {
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
  fromStop,
  leg,
  onEdit,
  toStop,
}: {
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
  onChange,
  onClose,
  open,
  stop,
}: {
  onChange: (stopId: string, updates: Partial<Stop>) => void
  onClose: () => void
  open: boolean
  stop: Stop | null
}) {
  if (!stop) {
    return null
  }

  const editableStop = stop

  function updateNights(nextValue: number) {
    onChange(editableStop.id, {
      planned_nights: Math.max(0, nextValue),
    })
  }

  function updateLeaveDate(leaveDate: string) {
    onChange(editableStop.id, {
      planned_nights: getNightsBetweenDates(
        editableStop.planned_start_date,
        leaveDate,
      ),
    })
  }

  const leaveDate = getStayLeaveDateValue(
    editableStop.planned_start_date,
    editableStop.planned_nights,
  )

  return (
    <Modal
      description="Edit the itinerary stop fields that will map to the API."
      onClose={onClose}
      open={open}
      title={`Edit ${editableStop.title}`}
    >
      <div className="grid gap-5">
        <section className="space-y-3 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/45 p-4">
          <div>
            <h3 className="font-semibold text-foreground">Stop</h3>
            <p className="text-sm text-muted-foreground">
              {editableStop.location.full_name}
            </p>
          </div>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Title
            <Input
              maxLength={255}
              onChange={(event) =>
                onChange(editableStop.id, {
                  title: event.target.value,
                })
              }
              value={editableStop.title}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Notes
            <Textarea
              className="min-h-32 resize-none"
              onChange={(event) =>
                onChange(editableStop.id, {
                  notes: event.target.value,
                })
              }
              value={editableStop.notes}
            />
          </label>
        </section>

        <section className="grid gap-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Arrival date
            <DatePicker
              onValueChange={(planned_start_date) =>
                onChange(editableStop.id, {
                  planned_start_date,
                })
              }
              value={editableStop.planned_start_date}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Leave date
            <DatePicker
              min={editableStop.planned_start_date}
              onValueChange={updateLeaveDate}
              value={leaveDate}
            />
          </label>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Nights</span>
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
              <button
                className="grid place-items-center border-r border-emerald-100 text-primary transition-colors hover:bg-emerald-50"
                onClick={() => updateNights(editableStop.planned_nights - 1)}
                type="button"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <input
                className="h-10 w-full bg-white text-center text-sm font-semibold text-foreground focus-visible:outline-none"
                min={0}
                onChange={(event) => updateNights(Number(event.target.value))}
                type="number"
                value={editableStop.planned_nights}
              />
              <button
                className="grid place-items-center border-l border-emerald-100 text-primary transition-colors hover:bg-emerald-50"
                onClick={() => updateNights(editableStop.planned_nights + 1)}
                type="button"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={onClose} type="button">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TravelLegEditDialog({
  fromStop,
  leg,
  onChange,
  onClose,
  open,
  toStop,
}: {
  fromStop: Stop | null
  leg: TravelLeg | null
  onChange: (legId: string, updates: Partial<TravelLeg>) => void
  onClose: () => void
  open: boolean
  toStop: Stop | null
}) {
  if (!leg || !fromStop || !toStop) {
    return null
  }

  const ModeIcon = getTravelModeIcon(leg.travel_mode)

  return (
    <Modal
      description="Edit the travel leg fields that will map to the API."
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
              onValueChange={(travel_mode) =>
                onChange(leg.id, {
                  travel_mode,
                })
              }
              options={travelModeOptions}
              value={leg.travel_mode}
            />
          </label>
        </section>

        <section className="grid gap-4 rounded-[1.5rem] border border-emerald-100 bg-white p-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Operator
            <Input
              maxLength={255}
              onChange={(event) =>
                onChange(leg.id, {
                  operator: nullableTextValue(event.target.value),
                })
              }
              placeholder="Rail company, airline, rental firm"
              value={leg.operator ?? ''}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Reference
            <Input
              maxLength={255}
              onChange={(event) =>
                onChange(leg.id, {
                  reference: nullableTextValue(event.target.value),
                })
              }
              placeholder="Train number, booking code, route"
              value={leg.reference ?? ''}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground sm:col-span-2">
            Notes
            <Textarea
              className="min-h-32 resize-none"
              onChange={(event) =>
                onChange(leg.id, {
                  notes: event.target.value,
                })
              }
              placeholder="Tickets, buffers, transfers, pickup notes"
              value={leg.notes}
            />
          </label>
        </section>

        <div className="flex justify-end">
          <Button onClick={onClose} type="button">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function MapWorkspace({
  draftMapLocation,
  mapPointEnabled,
  onDraftMapPointSelect,
  stops,
}: {
  draftMapLocation: DraftPostLocation | null
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  stops: readonly Stop[]
}) {
  const [resetNonce, setResetNonce] = useState(0)

  return (
    <section className="relative min-h-0 min-w-0 overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm lg:h-full">
      <TripLeafletMap
        draftMapLocation={draftMapLocation}
        mapPointEnabled={mapPointEnabled}
        onDraftMapPointSelect={onDraftMapPointSelect}
        resetNonce={resetNonce}
        stops={stops}
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
  mapPointEnabled,
  onDraftMapPointSelect,
  resetNonce,
  stops,
}: {
  draftMapLocation: DraftPostLocation | null
  fitMode?: RouteFitMode
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  resetNonce: number
  stops: readonly Stop[]
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const draftMarkerRef = useRef<L.Marker | null>(null)
  const latestLocationSelectRef = useRef(onDraftMapPointSelect)
  const mapPointEnabledRef = useRef(mapPointEnabled)
  const mapRef = useRef<L.Map | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const stopsRef = useRef(stops)
  const routeKey = createRouteKey(stops)
 
  stopsRef.current = stops

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
      scrollWheelZoom: true,
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

    for (const post of travelPosts) {
      L.marker(post.coordinates, {
        icon: L.divIcon({
          className: 'trip-map-div-icon',
          html: createPostBubbleHtml(post),
          iconAnchor: [22, 22],
          iconSize: [44, 44],
        }),
        zIndexOffset: 500,
      })
        .addTo(map)
        .bindPopup(`<strong>${escapeHtml(post.title)}</strong><br>${escapeHtml(post.excerpt)}`)
    }

    window.requestAnimationFrame(() => map.invalidateSize())

    return () => {
      map.off('click', handleMapClick)
      map.remove()
      draftMarkerRef.current = null
      mapRef.current = null
      routeLayerRef.current = null
    }
  }, [fitMode])

  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    if (!map || !routeLayer) {
      return
    }

    routeLayer.clearLayers()
    renderRouteLayer(routeLayer, stopsRef.current)
    const animationFrameId = window.requestAnimationFrame(() => {
      map.invalidateSize()
      fitRouteBounds(map, stopsRef.current, fitMode)
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [fitMode, routeKey])

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

    fitRouteBounds(map, stopsRef.current, fitMode)
  }, [fitMode, resetNonce])

  return (
    <div
      aria-label="OpenStreetMap route mockup"
      className="trip-leaflet-map absolute inset-0"
      ref={mapContainerRef}
    />
  )
}

function renderRouteLayer(routeLayer: L.LayerGroup, stops: readonly Stop[]) {
  const routeCoordinates = stops.map(getStopCoordinates)
  if (routeCoordinates.length > 0) {
    L.polyline(routeCoordinates, {
      color: '#0f766e',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.86,
      weight: 4,
    }).addTo(routeLayer)

    L.polyline(routeCoordinates, {
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

function fitRouteBounds(
  map: L.Map,
  stops: readonly Stop[],
  fitMode: RouteFitMode,
) {
  const routeCoordinates = stops.map(getStopCoordinates)
  if (routeCoordinates.length === 0) {
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

function createRouteKey(stops: readonly Stop[]) {
  return stops
    .map((stop) =>
      [
        stop.id,
        stop.location.latitude,
        stop.location.longitude,
      ].join(':'),
    )
    .join('|')
}

function createPlaceMarkerHtml() {
  return `
    <div class="trip-map-place-marker">
    </div>
  `
}

function createPostBubbleHtml(post: TravelPost) {
  const primaryMedia = getPrimaryPostMedia(post)
  const thumbnailSrc = getMediaThumbnailSrc(primaryMedia)

  return `
    <div class="trip-map-post-bubble">
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
      fromStopId: previousStop.id,
      toStopId: nextStop.id,
      tripId: previousStop.trip_id,
    }),
  ]
}

function createDefaultTravelLeg({
  fromStopId,
  toStopId,
  tripId,
}: {
  fromStopId: string
  toStopId: string
  tripId: string
}): TravelLeg {
  return {
    created_at: mockItineraryTimestamp,
    from_stop_id: fromStopId,
    id: `mock-leg-${fromStopId}-${toStopId}`,
    notes: '',
    operator: null,
    reference: null,
    to_stop_id: toStopId,
    travel_mode: 'UNKNOWN',
    trip_id: tripId,
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

function createDraftMapPointLocation(
  coordinates: L.LatLngTuple,
  target: MapPointTarget,
): DraftPostLocation {
  return {
    coordinates,
    label: getMockReverseGeocodeLabel(coordinates, target),
  }
}

function getStopTitleSuggestion(locationLabel: string) {
  return locationLabel.replace(/^(At|Near)\s+/i, '')
}

function getMockReverseGeocodeLabel(
  coordinates: L.LatLngTuple,
  target: MapPointTarget | null,
) {
  const nearbyPlace = findNearestMockPlace(coordinates)
  const prefix = target === 'stop' ? 'Near' : 'At'

  return `${prefix} ${nearbyPlace}`
}

function findNearestMockPlace(coordinates: L.LatLngTuple) {
  const knownPlaces = [
    ...initialStops.map((stop) => ({
      coordinates: getStopCoordinates(stop),
      label: stop.location.full_name,
    })),
    ...travelPosts.map((post) => ({
      coordinates: post.coordinates,
      label: post.location,
    })),
  ]

  return knownPlaces.reduce(
    (nearestPlace, place) => {
      const distance = getCoordinateDistance(coordinates, place.coordinates)
      return distance < nearestPlace.distance
        ? {
            distance,
            label: place.label,
          }
        : nearestPlace
    },
    {
      distance: Number.POSITIVE_INFINITY,
      label: 'Selected location',
    },
  ).label
}

function getCoordinateDistance(
  [leftLat, leftLng]: L.LatLngTuple,
  [rightLat, rightLng]: L.LatLngTuple,
) {
  return Math.hypot(leftLat - rightLat, leftLng - rightLng)
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

function getMockShareUrl(token: string) {
  const origin =
    typeof window === 'undefined'
      ? 'https://openvoyage.example'
      : window.location.origin

  return `${origin}/trips/mockup?share=${encodeURIComponent(token)}`
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
