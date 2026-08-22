import 'leaflet/dist/leaflet.css'

import * as L from 'leaflet'
import { MapPinOff, Plus, Save, Trash2, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import {
  createGpsPrivacyZone,
  deleteGpsPrivacyZone,
  getErrorMessage,
  listGpsPrivacyZones,
  replaceGpsPrivacyZone,
  type GpsPrivacyZone,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { privacyZoneMarkerIcon } from '@/components/users/privacy-zone-map-marker'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import {
  MAP_TILE_PROVIDER_SETTING_KEY,
  resolveMapTileProvider,
} from '@/lib/map-tile-providers'
import { usePublicSetting } from '@/settings/public-settings'

const MIN_RADIUS_METERS = 100
const MAX_RADIUS_METERS = 10_000
const DEFAULT_RADIUS_METERS = 500
const MAX_ZONES = 20
const DEFAULT_MAP_CENTER: L.LatLngTuple = [20, 0]
const DEFAULT_MAP_ZOOM = 2
const SELECTED_MAP_ZOOM = 15

type GpsPrivacyZonesFormProps = {
  accessToken: string
}

type ZoneFormState = {
  latitude: string
  longitude: string
  name: string
  radiusMeters: string
}

function createEmptyForm(): ZoneFormState {
  return {
    latitude: '',
    longitude: '',
    name: '',
    radiusMeters: String(DEFAULT_RADIUS_METERS),
  }
}

function toFormState(zone: GpsPrivacyZone): ZoneFormState {
  return {
    latitude: String(zone.latitude),
    longitude: String(zone.longitude),
    name: zone.name,
    radiusMeters: String(zone.radius_meters),
  }
}

function getCoordinates(form: ZoneFormState): L.LatLngTuple | null {
  const latitude = Number(form.latitude)
  const longitude = Number(form.longitude)

  if (
    form.latitude.trim() === '' ||
    form.longitude.trim() === '' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null
  }

  return [latitude, longitude]
}

function formatCoordinates(coordinates: L.LatLngTuple | null) {
  if (!coordinates) {
    return 'Choose a point on the map'
  }

  return `${coordinates[0].toFixed(5)}, ${coordinates[1].toFixed(5)}`
}

export function GpsPrivacyZonesForm({ accessToken }: GpsPrivacyZonesFormProps) {
  const [zones, setZones] = useState<readonly GpsPrivacyZone[]>([])
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [form, setForm] = useState<ZoneFormState>(createEmptyForm)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLocating, setIsLocating] = useState(false)

  const loadZones = useCallback(async () => {
    try {
      setZones(await listGpsPrivacyZones({ accessToken }))
      setError(null)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void loadZones()
  }, [loadZones])

  const closeEditor = () => {
    setEditingZoneId(null)
    setIsCreating(false)
    setForm(createEmptyForm())
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const coordinates = getCoordinates(form)
    if (!coordinates) {
      setError('Choose the centre of this privacy zone on the map.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    const payload = {
      latitude: coordinates[0],
      longitude: coordinates[1],
      name: form.name.trim(),
      radius_meters: Number(form.radiusMeters),
    }

    try {
      if (editingZoneId) {
        await replaceGpsPrivacyZone({
          accessToken,
          payload,
          zoneId: editingZoneId,
        })
      } else {
        await createGpsPrivacyZone({ accessToken, payload })
      }
      closeEditor()
      await loadZones()
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (zoneId: string) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await deleteGpsPrivacyZone({ accessToken, zoneId })
      if (editingZoneId === zoneId) {
        closeEditor()
      }
      await loadZones()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Your browser does not support location access.')
      return
    }

    setIsLocating(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        }))
        setIsLocating(false)
      },
      () => {
        setError('Could not get your location. Choose the centre on the map instead.')
        setIsLocating(false)
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 },
    )
  }

  const isEditorOpen = isCreating || editingZoneId !== null

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPS privacy zones</CardTitle>
        <CardDescription>
          Coordinates recorded inside one of these circles are never stored.
          Zones apply to every trip you are a member of, and nobody else can see
          their name, centre, or size.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">
          A zone only filters <strong>future</strong> uploads. Creating, moving,
          shrinking, or deleting one never deletes or restores a coordinate that
          was already recorded — use the trip&apos;s point deletion controls for
          that. Zones cover GPS tracking only: they do not hide post locations,
          photo metadata, or anything you write.
        </p>

        {error ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading zones…</p>
        ) : zones.length === 0 && !isEditorOpen ? (
          <EmptyState
            description="Add a circle around your home or any other area you would rather not have recorded."
            icon={MapPinOff}
            title="No privacy zones yet"
          />
        ) : (
          <ul className="space-y-2">
            {zones.map((zone) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                key={zone.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {zone.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {zone.latitude.toFixed(5)}, {zone.longitude.toFixed(5)} ·{' '}
                    {zone.radius_meters} m radius
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={isSubmitting}
                    onClick={() => {
                      setIsCreating(false)
                      setEditingZoneId(zone.id)
                      setForm(toFormState(zone))
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Edit
                  </Button>
                  <Button
                    aria-label={`Delete ${zone.name}`}
                    disabled={isSubmitting}
                    onClick={() => void handleDelete(zone.id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {isEditorOpen ? (
          <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">Name</span>
                <Input
                  maxLength={100}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Home"
                  required
                  value={form.name}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">
                  Radius (metres)
                </span>
                <Input
                  max={MAX_RADIUS_METERS}
                  min={MIN_RADIUS_METERS}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      radiusMeters: event.target.value,
                    }))
                  }
                  required
                  type="number"
                  value={form.radiusMeters}
                />
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Zone centre</p>
                  <p aria-live="polite" className="text-xs text-muted-foreground">
                    {formatCoordinates(getCoordinates(form))}
                  </p>
                </div>
                <Button
                  disabled={isSubmitting || isLocating}
                  onClick={handleUseCurrentLocation}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isLocating ? 'Locating…' : 'Use my location'}
                </Button>
              </div>
              <PrivacyZoneMap
                coordinates={getCoordinates(form)}
                onCoordinatesChange={(coordinates) =>
                  setForm((current) => ({
                    ...current,
                    latitude: String(coordinates[0]),
                    longitude: String(coordinates[1]),
                  }))
                }
                radiusMeters={Number(form.radiusMeters) || DEFAULT_RADIUS_METERS}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Click the map to place the centre. The circle shows the area that
                will be excluded from future GPS uploads.
              </p>
            </div>

            <p className="text-xs leading-5 text-muted-foreground">
              A small radius still lets someone guess roughly where the hidden
              area is, because the route keeps ending and restarting around its
              edge. {DEFAULT_RADIUS_METERS} m is a reasonable default.
            </p>

            <div className="flex gap-2">
              <Button disabled={isSubmitting} size="sm" type="submit">
                <Save className="size-4" />
                {editingZoneId ? 'Save zone' : 'Add zone'}
              </Button>
              <Button
                disabled={isSubmitting}
                onClick={closeEditor}
                size="sm"
                type="button"
                variant="ghost"
              >
                <X className="size-4" />
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            disabled={zones.length >= MAX_ZONES || isSubmitting}
            onClick={() => {
              setEditingZoneId(null)
              setIsCreating(true)
              setForm(createEmptyForm())
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            Add privacy zone
          </Button>
        )}

        {zones.length >= MAX_ZONES ? (
          <p className="text-xs text-muted-foreground">
            You have reached the limit of {MAX_ZONES} zones.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PrivacyZoneMap({
  coordinates,
  onCoordinatesChange,
  radiusMeters,
}: {
  coordinates: L.LatLngTuple | null
  onCoordinatesChange: (coordinates: L.LatLngTuple) => void
  radiusMeters: number
}) {
  const tileProviderSetting = usePublicSetting(MAP_TILE_PROVIDER_SETTING_KEY)
  const tileProvider = useMemo(
    () => resolveMapTileProvider(tileProviderSetting),
    [tileProviderSetting],
  )
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const selectionLayerRef = useRef<L.LayerGroup | null>(null)
  const onCoordinatesChangeRef = useRef(onCoordinatesChange)
  const shouldCenterOnSelectionRef = useRef(true)

  useEffect(() => {
    onCoordinatesChangeRef.current = onCoordinatesChange
  }, [onCoordinatesChange])

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) {
      return undefined
    }

    const map = L.map(container, {
      center: DEFAULT_MAP_CENTER,
      scrollWheelZoom: true,
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: true,
    })
    map.on('click', (event: L.LeafletMouseEvent) => {
      shouldCenterOnSelectionRef.current = false
      onCoordinatesChangeRef.current([
        Number(event.latlng.lat.toFixed(6)),
        Number(event.latlng.lng.toFixed(6)),
      ])
    })
    mapRef.current = map
    selectionLayerRef.current = L.layerGroup().addTo(map)

    window.requestAnimationFrame(() => map.invalidateSize())

    return () => {
      map.remove()
      mapRef.current = null
      selectionLayerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return undefined
    }

    const tileLayer = L.tileLayer(tileProvider.url, tileProvider.options).addTo(map)
    return () => {
      tileLayer.remove()
    }
  }, [tileProvider])

  useEffect(() => {
    const map = mapRef.current
    const selectionLayer = selectionLayerRef.current
    if (!map || !selectionLayer) {
      return
    }

    selectionLayer.clearLayers()
    if (!coordinates) {
      return
    }

    L.circle(coordinates, {
      color: 'var(--primary)',
      fillColor: 'var(--primary)',
      fillOpacity: 0.16,
      radius: radiusMeters,
      weight: 2,
    }).addTo(selectionLayer)
    L.marker(coordinates, {
      icon: privacyZoneMarkerIcon,
      interactive: false,
    }).addTo(selectionLayer)

    if (shouldCenterOnSelectionRef.current) {
      map.setView(coordinates, SELECTED_MAP_ZOOM)
      shouldCenterOnSelectionRef.current = false
    }
  }, [coordinates, radiusMeters])

  return (
    <div
      aria-label="Choose privacy-zone centre"
      className="privacy-zone-map rounded-lg border border-border"
      ref={mapContainerRef}
    />
  )
}
