import 'leaflet/dist/leaflet.css'

import * as L from 'leaflet'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Camera,
  CalendarDays,
  Check,
  Clock,
  Compass,
  Copy,
  Download,
  Eye,
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
  Plus,
  Search,
  Send,
  Share2,
  Shield,
  Settings,
  Trash2,
  Upload,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
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
type RouteFitMode = 'mobile-picker' | 'workspace'
type TripDialog = 'actions' | 'members' | 'settings' | 'share'
type MockTripVisibility = 'PLATFORM_PUBLIC' | 'PRIVATE' | 'PUBLIC'
type MockTripRole = 'MEMBER' | 'OWNER'

type MockTrip = {
  description: string
  endDate: string
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

type Stop = {
  coordinates: L.LatLngTuple
  country: string
  description: string
  id: string
  image: string
  label: string
  plannedNights: number
  plannedStartDate: string
  status: 'done' | 'planned'
}

type PostMedia = {
  alt: string
  src: string
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
  name: 'Portugal to the Dolomites',
  startDate: '2027-05-03',
  visibility: 'PRIVATE',
}

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

const draftPostMedia = [
  {
    alt: 'Porto riverfront at dusk',
    src: 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=520&q=80',
  },
  {
    alt: 'Tiled facade in Porto',
    src: 'https://images.unsplash.com/photo-1513735492246-483525079686?auto=format&fit=crop&w=520&q=80',
  },
] as const satisfies readonly PostMedia[]

const initialStops: readonly Stop[] = [
  {
    coordinates: [38.7223, -9.1393],
    country: 'Portugal',
    description: 'Arrival, Alfama walk, late dinner near the overlook.',
    id: 'lisbon',
    image:
      'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?auto=format&fit=crop&w=420&q=80',
    label: 'Lisbon',
    plannedNights: 3,
    plannedStartDate: '2027-05-03',
    status: 'done',
  },
  {
    coordinates: [41.1579, -8.6291],
    country: 'Portugal',
    description: 'Train north, bookshops, tiled churches, river evening.',
    id: 'porto',
    image:
      'https://images.unsplash.com/photo-1513735492246-483525079686?auto=format&fit=crop&w=420&q=80',
    label: 'Porto',
    plannedNights: 2,
    plannedStartDate: '2027-05-07',
    status: 'planned',
  },
  {
    coordinates: [40.4168, -3.7038],
    country: 'Spain',
    description: 'Museum day, neighborhood markets, early tapas route.',
    id: 'madrid',
    image:
      'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=420&q=80',
    label: 'Madrid',
    plannedNights: 4,
    plannedStartDate: '2027-05-10',
    status: 'planned',
  },
  {
    coordinates: [45.764, 4.8357],
    country: 'France',
    description: 'Long rail day with a mountain transfer.',
    id: 'lyon',
    image:
      'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=420&q=80',
    label: 'Lyon',
    plannedNights: 1,
    plannedStartDate: '2027-05-15',
    status: 'planned',
  },
  {
    coordinates: [46.5405, 12.1357],
    country: 'Italy',
    description: 'Trail days, lake ferry, final cabin stay.',
    id: 'dolomites',
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=420&q=80',
    label: 'Dolomites',
    plannedNights: 5,
    plannedStartDate: '2027-05-17',
    status: 'planned',
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
        src: 'https://images.unsplash.com/photo-1513735492246-483525079686?auto=format&fit=crop&w=520&q=80',
      },
      {
        alt: 'Cafe table with travel notes',
        src: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=520&q=80',
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
    <div className="relative left-1/2 min-h-[calc(100dvh-4rem-1px)] w-screen -translate-x-1/2 overflow-x-hidden px-3 py-3 sm:px-5 lg:h-[calc(100dvh-4rem-1px)] lg:overflow-hidden lg:px-6">
      <div className="mx-auto min-h-0 max-w-[132rem] lg:h-full">
        <div className="grid min-h-0 gap-4 lg:h-full lg:grid-cols-[minmax(30rem,46vw)_minmax(0,1fr)]">
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
              onTravelingViewChange={setTravelingView}
              planningView={planningView}
              stops={plannedStops}
              trip={mockTrip}
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{getVisibilityLabel(trip.visibility)}</Badge>
            <span className="text-xs font-medium text-muted-foreground">Mockup</span>
          </div>
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
  onTravelingViewChange,
  planningView,
  stops,
  trip,
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
  onTravelingViewChange: (view: TravelingView) => void
  planningView: PlanningView
  stops: readonly Stop[]
  trip: MockTrip
  travelingView: TravelingView
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm lg:h-full">
      <TripSidebarHeader onOpenDialog={onOpenDialog} trip={trip} />

      <div className="scrollbar-subtle min-w-0 flex-1 pb-24 lg:min-h-0 lg:overflow-auto lg:pb-0">
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
            stops={stops}
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
  stops,
}: {
  onAddStop: () => void
  onStopChange: (stopId: string, updates: Partial<Stop>) => void
  stops: readonly Stop[]
}) {
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
        {stops.map((stop, index) => (
          <StopCard
            index={index}
            key={stop.id}
            onChange={onStopChange}
            stop={stop}
          />
        ))}
      </div>
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
            After {selectedAfterStop?.label ?? 'selected stop'}.
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
                  {stop.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {stop.plannedStartDate}
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

function TravelingPanel({ onNewPost }: { onNewPost: () => void }) {
  return (
    <div className="min-w-0 space-y-4 p-4">
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
  const [draftMedia, setDraftMedia] = useState<PostMedia[]>(() => [
    ...draftPostMedia,
  ])
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
    const imageFiles = Array.from(files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    )

    if (imageFiles.length === 0) {
      setMediaNotice('Choose one or more image files.')
      return
    }

    const uploadedMedia = imageFiles.map((file) => {
      const objectUrl = URL.createObjectURL(file)
      uploadedMediaUrlsRef.current.push(objectUrl)

      return {
        alt: file.name,
        src: objectUrl,
      }
    })

    setDraftMedia((currentMedia) => [...currentMedia, ...uploadedMedia])
    setMediaNotice(
      `${imageFiles.length} ${imageFiles.length === 1 ? 'image' : 'images'} added.`,
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
                ? 'Add images to build the post gallery.'
                : `${draftMedia.length} ${draftMedia.length === 1 ? 'image' : 'images'} · first image becomes the map bubble.`}
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
              className="grid h-56 w-[76vw] max-w-80 shrink-0 place-items-center rounded-[1.4rem] border border-dashed border-emerald-200 bg-emerald-50/60 text-primary sm:w-80"
              onClick={() => setMediaToolsOpen(true)}
              type="button"
            >
              <span className="grid justify-items-center gap-2 text-sm font-semibold">
                <ImagePlus className="size-6" aria-hidden="true" />
                Add the first image
              </span>
            </button>
          ) : null}

          {draftMedia.map((media, index) => (
            <article
              className="group relative h-56 w-[76vw] max-w-80 shrink-0 overflow-hidden rounded-[1.4rem] bg-secondary sm:w-80"
              key={media.src}
            >
              <img alt={media.alt} className="size-full object-cover" src={media.src} />
              {index === 0 ? (
                <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[0.68rem] font-semibold text-primary shadow-sm">
                  Map bubble image
                </span>
              ) : null}

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
            </article>
          ))}

          <button
            className="grid h-56 w-[52vw] max-w-52 shrink-0 place-items-center rounded-[1.4rem] border border-dashed border-emerald-200 bg-emerald-50/60 text-primary sm:w-52"
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
              accept="image/*"
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
              Select one or more images. New uploads are added to the end of the
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
    </div>
  )
}

function TravelPostCard({ post }: { post: TravelPost }) {
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
        {post.media.map((media) => (
          <div
            className="relative h-56 w-[76vw] max-w-96 shrink-0 overflow-hidden rounded-[1.5rem] bg-secondary sm:h-64 sm:w-96 xl:h-72 xl:w-[28rem]"
            key={media.src}
          >
            <img alt={media.alt} className="size-full object-cover" src={media.src} />
          </div>
        ))}
      </div>
    </article>
  )
}

function StopCard({
  index,
  onChange,
  stop,
}: {
  index: number
  onChange: (stopId: string, updates: Partial<Stop>) => void
  stop: Stop
}) {
  function updateNights(nextValue: number) {
    onChange(stop.id, {
      plannedNights: Math.max(0, nextValue),
    })
  }

  return (
    <article
      className={cn(
        'grid w-full grid-cols-[3.25rem_1fr] gap-3 rounded-[1.5rem] border p-3 text-left',
        'border-emerald-100 bg-white',
      )}
    >
      <span className="grid size-11 place-items-center rounded-2xl bg-secondary text-sm font-semibold text-primary">
        {index + 1}
      </span>
      <span className="min-w-0">
        <span className="flex items-start justify-between gap-2">
          <span>
            <span className="block font-semibold text-foreground">{stop.label}</span>
            <span className="block text-xs text-muted-foreground">
              {stop.country}
            </span>
          </span>
        </span>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            Date
            <DatePicker
              className="text-foreground"
              onValueChange={(plannedStartDate) =>
                onChange(stop.id, {
                  plannedStartDate,
                })
              }
              value={stop.plannedStartDate}
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Nights</span>
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
              <button
                className="grid place-items-center border-r border-emerald-100 text-primary transition-colors hover:bg-emerald-50"
                onClick={() => updateNights(stop.plannedNights - 1)}
                type="button"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <input
                className="h-10 w-full bg-white text-center text-sm font-semibold text-foreground focus-visible:outline-none"
                min={0}
                onChange={(event) => updateNights(Number(event.target.value))}
                type="number"
                value={stop.plannedNights}
              />
              <button
                className="grid place-items-center border-l border-emerald-100 text-primary transition-colors hover:bg-emerald-50"
                onClick={() => updateNights(stop.plannedNights + 1)}
                type="button"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </span>
    </article>
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

    L.control.zoom({ position: 'bottomright' }).addTo(map)

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
  }, [])

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
  const routeCoordinates = stops.map((stop) => stop.coordinates)
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
    L.marker(stop.coordinates, {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createPlaceMarkerHtml(),
        iconAnchor: [7, 7],
        iconSize: [14, 14],
      }),
    })
      .addTo(routeLayer)
      .bindPopup(`<strong>${escapeHtml(stop.label)}</strong><br>${escapeHtml(stop.description)}`)
  }
}

function fitRouteBounds(
  map: L.Map,
  stops: readonly Stop[],
  fitMode: RouteFitMode,
) {
  const routeCoordinates = stops.map((stop) => stop.coordinates)
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
        stop.coordinates[0],
        stop.coordinates[1],
        stop.label,
        stop.description,
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
  return `
    <div class="trip-map-post-bubble">
      <img class="trip-map-post-bubble__image" src="${escapeHtml(primaryMedia.src)}" alt="${escapeHtml(primaryMedia.alt)}" />
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
  return post.media[0]
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
      coordinates: stop.coordinates,
      label: `${stop.label}, ${stop.country}`,
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
