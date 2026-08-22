import 'leaflet/dist/leaflet.css'

import * as L from 'leaflet'
import { Compass } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  type GpsPostCandidate,
  type ItineraryRouteType,
  type ItineraryTravelRoute,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { getTravelPostsInRouteOrder } from '@/pages/trip-detail/trip-selectors'
import {
  MAP_TILE_PROVIDER_SETTING_KEY,
  resolveMapTileProvider,
} from '@/lib/map-tile-providers'
import {
  escapeHtml,
  formatGpsCandidateTime,
  getMediaThumbnailSrc,
  getPrimaryPostMedia,
  getStopCoordinates,
  getTravelModeLabel,
} from '@/pages/trip-detail/shared-utils'
import type {
  Stop,
  TravelLeg,
  TravelMode,
  TravelPost,
  TravelPostRoute,
  TripTrackingGeometry,
} from '@/pages/trip-detail/models'
import {
  createRouteGeometryKey,
  createGeodesicRoute,
  createStopPairKey,
  getCentralAngle,
  getGeoJsonLineStringCoordinates,
  getSimpleRouteCoordinates,
} from '@/pages/trip-detail/route-geometry'
import { usePublicSetting } from '@/settings/public-settings'
import { useTheme } from '@/theme'

type RouteFitMode = 'mobile-picker' | 'mobile-travel' | 'workspace'

type RouteEndpoint = {
  coordinates: L.LatLngTuple
  travelMode: TravelMode
}

type DraftPostLocation = {
  coordinates: L.LatLngTuple
  label: string
}

export type MapRouteMode = 'itinerary' | 'travel-timeline'
type RouteSegmentKind = 'itinerary' | 'post-link' | 'post-to-stop'

type RouteSegment = {
  coordinates: L.LatLngTuple[]
  kind: RouteSegmentKind
  routeType: ItineraryRouteType
  travelMode?: TravelMode
  visibleToMembersOnly?: boolean
}

type FocusedPostNeighbor = {
  distanceMeters: number
  post: TravelPost
}

type FocusedPostViewPlan =
  | {
      coordinates: L.LatLngTuple
      kind: 'center'
      zoom: number
    }
  | {
      bounds: L.LatLngBounds
      kind: 'bounds'
      maxZoom: number
    }

const earthRadiusKilometers = 6371
const defaultMapCenter: L.LatLngTuple = [42.5, -3.5]
const defaultMapZoom = 4
const focusedPostDistanceThresholdsMeters = {
  cityCluster: 8_000,
  metroContext: 35_000,
  samePlace: 100,
  walkableCluster: 1_500,
} as const
const focusedPostCityOutlierRatio = 4
const focusedPostMetroOutlierRatio = 8
const focusedPostComparableFarRatio = 2.5
const focusedPostZoomDetailBias = 1
const focusedPostMinZoom = 4
const focusedPostAnimationOptions = {
  animate: true,
  duration: 0.7,
  easeLinearity: 0.25,
} satisfies L.ZoomPanOptions
const routeOverviewAnimationOptions = {
  animate: true,
  duration: 1.15,
  easeLinearity: 0.2,
} satisfies L.ZoomPanOptions

export function MapWorkspace({
  draftMapLocation,
  focusedPostId,
  gpsPostCandidates,
  isTripOngoing,
  mapPointEnabled,
  onDraftMapPointSelect,
  onGpsPostCandidateSelect,
  onPostMarkerSelect,
  routeMode,
  stops,
  trackingGeometry,
  travelLegs,
  travelPosts,
}: {
  draftMapLocation: DraftPostLocation | null
  focusedPostId: string | null
  gpsPostCandidates: readonly GpsPostCandidate[]
  isTripOngoing: boolean
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  onGpsPostCandidateSelect: (candidate: GpsPostCandidate) => void
  onPostMarkerSelect: (postId: string) => void
  routeMode: MapRouteMode
  stops: readonly Stop[]
  trackingGeometry: TripTrackingGeometry
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const [resetNonce, setResetNonce] = useState(0)

  return (
    <section className="relative min-h-0 min-w-0 overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm lg:h-full">
      <TripLeafletMap
        draftMapLocation={draftMapLocation}
        focusedPostId={focusedPostId}
        gpsPostCandidates={gpsPostCandidates}
        isTripOngoing={isTripOngoing}
        mapPointEnabled={mapPointEnabled}
        onDraftMapPointSelect={onDraftMapPointSelect}
        onGpsPostCandidateSelect={onGpsPostCandidateSelect}
        onPostMarkerSelect={onPostMarkerSelect}
        resetNonce={resetNonce}
        routeMode={routeMode}
        stops={stops}
        travelLegs={travelLegs}
        trackingGeometry={trackingGeometry}
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

export function TripLeafletMap({
  draftMapLocation,
  fitMode = 'workspace',
  focusedPostId = null,
  gpsPostCandidates = [],
  isTripOngoing = false,
  mapPointEnabled,
  onDraftMapPointSelect,
  onGpsPostCandidateSelect,
  onPostMarkerSelect,
  resetNonce,
  routeMode = 'itinerary',
  stops,
  trackingGeometry,
  travelLegs,
  travelPosts,
}: {
  draftMapLocation: DraftPostLocation | null
  fitMode?: RouteFitMode
  focusedPostId?: string | null
  gpsPostCandidates?: readonly GpsPostCandidate[]
  isTripOngoing?: boolean
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  onGpsPostCandidateSelect?: (candidate: GpsPostCandidate) => void
  onPostMarkerSelect?: (postId: string) => void
  resetNonce: number
  routeMode?: MapRouteMode
  stops: readonly Stop[]
  trackingGeometry: TripTrackingGeometry
  travelLegs: readonly TravelLeg[]
  travelPosts: readonly TravelPost[]
}) {
  const { mode: themeMode, palette: themePalette } = useTheme()
  const tileProviderSetting = usePublicSetting(MAP_TILE_PROVIDER_SETTING_KEY)
  const tileProvider = useMemo(
    () => resolveMapTileProvider(tileProviderSetting),
    [tileProviderSetting],
  )
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const draftMarkerRef = useRef<L.Marker | null>(null)
  const latestLocationSelectRef = useRef(onDraftMapPointSelect)
  const latestGpsPostCandidateSelectRef = useRef(onGpsPostCandidateSelect)
  const latestPostMarkerSelectRef = useRef(onPostMarkerSelect)
  const mapPointEnabledRef = useRef(mapPointEnabled)
  const mapRef = useRef<L.Map | null>(null)
  const postMarkerLayerRef = useRef<L.LayerGroup | null>(null)
  const gpsPostCandidateLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const focusedPostIdRef = useRef<string | null>(focusedPostId)
  const travelPostsRef = useRef(travelPosts)
  const stopsRef = useRef(stops)
  const travelLegsRef = useRef(travelLegs)
  const trackingGeometryRef = useRef(trackingGeometry)
  const gpsPostCandidatesRef = useRef(gpsPostCandidates)
  const routeEndpointLayerRef = useRef<L.LayerGroup | null>(null)
  const routeKey = createRouteKey(
    routeMode,
    stops,
    travelLegs,
    travelPosts,
    trackingGeometry,
  )

  focusedPostIdRef.current = focusedPostId
  travelPostsRef.current = travelPosts
  trackingGeometryRef.current = trackingGeometry
  gpsPostCandidatesRef.current = gpsPostCandidates
  stopsRef.current = stops
  travelLegsRef.current = travelLegs

  useEffect(() => {
    latestLocationSelectRef.current = onDraftMapPointSelect
  }, [onDraftMapPointSelect])

  useEffect(() => {
    latestGpsPostCandidateSelectRef.current = onGpsPostCandidateSelect
  }, [onGpsPostCandidateSelect])

  useEffect(() => {
    latestPostMarkerSelectRef.current = onPostMarkerSelect
  }, [onPostMarkerSelect])

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
      minZoom: 3,
      scrollWheelZoom: true,
      zoom: defaultMapZoom,
      zoomControl: false,
    })

    if (fitMode !== 'mobile-travel') {
      L.control.zoom({ position: 'bottomright' }).addTo(map)
    }

    map.attributionControl.addAttribution(
      'Place data &copy; <a href="https://www.geonames.org/">GeoNames</a>, CC BY 4.0',
    )

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
    gpsPostCandidateLayerRef.current = L.layerGroup().addTo(map)
    routeEndpointLayerRef.current = L.layerGroup().addTo(map)

    window.requestAnimationFrame(() => map.invalidateSize())

    return () => {
      map.off('click', handleMapClick)
      map.remove()
      draftMarkerRef.current = null
      mapRef.current = null
      routeEndpointLayerRef.current = null
      postMarkerLayerRef.current = null
      gpsPostCandidateLayerRef.current = null
      routeLayerRef.current = null
      tileLayerRef.current = null
    }
  }, [fitMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return undefined
    }

    const tileLayer = L.tileLayer(tileProvider.url, tileProvider.options).addTo(map)
    tileLayerRef.current = tileLayer

    return () => {
      tileLayer.remove()
      if (tileLayerRef.current === tileLayer) {
        tileLayerRef.current = null
      }
    }
  }, [fitMode, tileProvider])

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
        (postId) => latestPostMarkerSelectRef.current?.(postId),
      )
    }
  }, [focusedPostId, routeMode, routeKey])

  useEffect(() => {
    const candidateLayer = gpsPostCandidateLayerRef.current
    if (!candidateLayer) {
      return
    }

    candidateLayer.clearLayers()
    if (routeMode !== 'travel-timeline') {
      return
    }

    renderGpsPostCandidateLayer(
      candidateLayer,
      gpsPostCandidatesRef.current,
      (candidate) => latestGpsPostCandidateSelectRef.current?.(candidate),
    )
  }, [gpsPostCandidates, routeMode])

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
      trackingGeometryRef.current.openingRoute,
    )

    const routeEndpointLayer = routeEndpointLayerRef.current
    if (routeEndpointLayer) {
      routeEndpointLayer.clearLayers()
      if (routeMode === 'travel-timeline' && isTripOngoing) {
        renderRouteEndpointMarker(
          routeEndpointLayer,
          getTravelTimelineRouteEndpoint(
            travelPostsRef.current,
            trackingGeometryRef.current.openingRoute,
          ),
        )
      }
    }
    const animationFrameId = window.requestAnimationFrame(() => {
      map.invalidateSize()
      if (!focusedPostIdRef.current) {
        fitRouteBounds(
          map,
          routeMode,
          stopsRef.current,
          travelLegsRef.current,
          travelPostsRef.current,
          trackingGeometryRef.current.openingRoute,
          fitMode,
        )
      }
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [fitMode, isTripOngoing, routeKey, routeMode, themeMode, themePalette])

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
        trackingGeometryRef.current.openingRoute,
        fitMode,
        { animate: true },
      )
      return
    }

    const focusedPostView = getFocusedPostViewPlan(
      map,
      focusedPostId,
      travelPostsRef.current,
      fitMode,
    )
    if (!focusedPostView) {
      return
    }

    if (focusedPostView.kind === 'bounds') {
      map.flyToBounds(focusedPostView.bounds, {
        ...getFocusedPostFitOptions(fitMode),
        ...focusedPostAnimationOptions,
        maxZoom: focusedPostView.maxZoom,
      })
      return
    }

    map.flyTo(
      focusedPostView.coordinates,
      focusedPostView.zoom,
      focusedPostAnimationOptions,
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
      trackingGeometryRef.current.openingRoute,
      fitMode,
      { animate: true },
    )
  }, [fitMode, resetNonce, routeMode])

  return (
    <div
      aria-label="Interactive trip route map"
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
  openingRoute: TravelPostRoute | null,
) {
  const routeSegments = getMapRouteSegments(
    routeMode,
    stops,
    travelLegs,
    travelPosts,
    openingRoute,
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
      color: getThemeColor('--card', '#FFFFFF'),
      dashArray: '2 10',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.85,
      weight: 2,
    }).addTo(routeLayer)
  }

  const showStopOrder = routeMode === 'itinerary'
  const stopMarkerSize = showStopOrder ? 22 : 14

  for (const [stopIndex, stop] of stops.entries()) {
    L.marker(getStopCoordinates(stop), {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createPlaceMarkerHtml(showStopOrder ? stopIndex + 1 : null),
        iconAnchor: [stopMarkerSize / 2, stopMarkerSize / 2],
        iconSize: [stopMarkerSize, stopMarkerSize],
      }),
    })
      .addTo(routeLayer)
      .bindPopup(`<strong>${escapeHtml(stop.title)}</strong><br>${escapeHtml(stop.notes)}`)
  }
}

function renderRouteEndpointMarker(
  layer: L.LayerGroup,
  endpoint: RouteEndpoint | null,
) {
  if (!endpoint) {
    return
  }

  L.marker(endpoint.coordinates, {
    icon: L.divIcon({
      className: 'trip-map-div-icon',
      html: createRouteEndpointBubbleHtml(endpoint.travelMode),
      iconAnchor: [16, 16],
      iconSize: [32, 32],
    }),
    zIndexOffset: 1500,
  }).addTo(layer)
}

function getTravelTimelineRouteEndpoint(
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
): RouteEndpoint | null {
  const postsInRouteOrder = getTravelPostsInRouteOrder(travelPosts)
  const finalPost = postsInRouteOrder[postsInRouteOrder.length - 1] ?? null
  // Live points after a post belong to that post's `route_after`.  Once there
  // is a newer post, its own route is the only possible live source; never
  // fall back to the pre-first-post `opening_route`.
  const route = finalPost ? finalPost.routeAfter : openingRoute
  const lastSegment = route?.segments[route.segments.length - 1]
  const coordinates = lastSegment?.coordinates[lastSegment.coordinates.length - 1]

  return coordinates
    ? { coordinates, travelMode: lastSegment.travelMode }
    : null
}

function getTravelTimelineRouteOrigin(
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
): L.LatLngTuple | null {
  const liveEndpoint = getTravelTimelineRouteEndpoint(travelPosts, openingRoute)
  if (liveEndpoint) {
    return liveEndpoint.coordinates
  }

  const postsInRouteOrder = getTravelPostsInRouteOrder(travelPosts)
  return postsInRouteOrder[postsInRouteOrder.length - 1]?.coordinates ?? null
}

function createRouteEndpointBubbleHtml(travelMode: TravelMode) {
  const color = getThemeColor('--primary', '#0F766E')
  const ring = getThemeColor('--card', '#FFFFFF')
  return [
    `<span class="trip-map-route-endpoint" title="${getTravelModeLabel(travelMode)}"`,
    ` style="background:${color};box-shadow:0 0 0 3px ${ring},0 0 0 9px ${color}33;"`,
    '></span>',
  ].join('')
}

function createGpsPostCandidateHtml() {
  return '<button class="trip-map-gps-post-candidate" aria-label="Create post from GPS point" type="button"><svg aria-hidden="true" viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" /></svg></button>'
}

function renderPostMarkerLayer(
  postMarkerLayer: L.LayerGroup,
  travelPosts: readonly TravelPost[],
  focusedPostId: string | null,
  onPostMarkerSelect: (postId: string) => void,
) {
  const orderedPosts = [
    ...travelPosts.filter((post) => post.id !== focusedPostId),
    ...travelPosts.filter((post) => post.id === focusedPostId),
  ]

  for (const post of orderedPosts) {
    const isFocused = post.id === focusedPostId

    const marker = L.marker(post.coordinates, {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createPostBubbleHtml(post, isFocused),
        iconAnchor: [22, 22],
        iconSize: [44, 44],
      }),
      zIndexOffset: isFocused ? 1000 : 500,
    }).addTo(postMarkerLayer)

    marker.on('click', () => onPostMarkerSelect(post.id))
  }
}

function renderGpsPostCandidateLayer(
  layer: L.LayerGroup,
  candidates: readonly GpsPostCandidate[],
  onSelect: (candidate: GpsPostCandidate) => void,
) {
  for (const candidate of candidates) {
    const coordinates: L.LatLngTuple = [candidate.latitude, candidate.longitude]
    const marker = L.marker(coordinates, {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createGpsPostCandidateHtml(),
        iconAnchor: [10, 10],
        iconSize: [20, 20],
      }),
      keyboard: true,
      zIndexOffset: 300,
    }).addTo(layer)

    marker.bindTooltip(
      `Create post · ${escapeHtml(formatGpsCandidateTime(candidate.recorded_at))}`,
      {
        className: 'trip-map-gps-post-tooltip',
        direction: 'top',
        offset: [0, -10],
      },
    )
    marker.on('click', () => onSelect(candidate))
  }
}

function fitRouteBounds(
  map: L.Map,
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
  fitMode: RouteFitMode,
  options: { animate?: boolean } = {},
) {
  const routeCoordinates = getRouteBoundsCoordinates(
    routeMode,
    stops,
    travelLegs,
    travelPosts,
    openingRoute,
  )
  if (routeCoordinates.length === 0) {
    map.setView(defaultMapCenter, defaultMapZoom, {
      ...(options.animate ? routeOverviewAnimationOptions : { animate: false }),
    })
    return
  }

  const routeBounds = L.latLngBounds(routeCoordinates)
  const routeFitOptions = getRouteFitOptions(fitMode)
  if (options.animate) {
    map.flyToBounds(routeBounds, {
      ...routeFitOptions,
      ...routeOverviewAnimationOptions,
    })
    return
  }

  map.fitBounds(routeBounds, routeFitOptions)
}

function getRouteFitOptions(fitMode: RouteFitMode): L.FitBoundsOptions {
  if (fitMode === 'mobile-picker') {
    return {
      maxZoom: 7,
      paddingBottomRight: [32, 260],
      paddingTopLeft: [32, 96],
    }
  }

  if (fitMode === 'mobile-travel') {
    return {
      maxZoom: 8,
      paddingBottomRight: [36, 280],
      paddingTopLeft: [36, 96],
    }
  }

  return {
    paddingBottomRight: [64, 64],
    paddingTopLeft: [360, 150],
  }
}

function getFocusedPostViewPlan(
  map: L.Map,
  focusedPostId: string,
  travelPosts: readonly TravelPost[],
  fitMode: RouteFitMode,
): FocusedPostViewPlan | null {
  const focusedPostContext = getFocusedPostContext(focusedPostId, travelPosts)
  if (!focusedPostContext) {
    return null
  }

  const selectedNeighbors = selectFocusedPostZoomNeighbors(
    focusedPostContext.neighbors,
  )
  if (selectedNeighbors.length === 0) {
    return {
      coordinates: focusedPostContext.focusedPost.coordinates,
      kind: 'center',
      zoom: getSingleFocusedPostZoom(fitMode),
    }
  }

  const selectedCoordinates = [
    focusedPostContext.focusedPost.coordinates,
    ...selectedNeighbors.map((neighbor) => neighbor.post.coordinates),
  ]
  const bounds = L.latLngBounds(selectedCoordinates)
  const boundsZoom = map.getBoundsZoom(
    bounds,
    false,
    getFocusedPostZoomPadding(fitMode),
  )

  return {
    bounds,
    kind: 'bounds',
    maxZoom: clampFocusedPostZoom(
      boundsZoom + focusedPostZoomDetailBias,
      fitMode,
    ),
  }
}

function getFocusedPostContext(
  focusedPostId: string,
  travelPosts: readonly TravelPost[],
) {
  const postsInRouteOrder = getTravelPostsInRouteOrder(travelPosts)
  const focusedPostIndex = postsInRouteOrder.findIndex(
    (post) => post.id === focusedPostId,
  )
  const focusedPost = postsInRouteOrder[focusedPostIndex]
  if (focusedPostIndex < 0 || !focusedPost) {
    return null
  }

  const neighbors: FocusedPostNeighbor[] = []
  const previousPost = postsInRouteOrder[focusedPostIndex - 1] ?? null
  const nextPost = postsInRouteOrder[focusedPostIndex + 1] ?? null

  if (previousPost) {
    neighbors.push({
      distanceMeters: getCoordinateDistanceMeters(
        focusedPost.coordinates,
        previousPost.coordinates,
      ),
      post: previousPost,
    })
  }

  if (nextPost) {
    neighbors.push({
      distanceMeters: getCoordinateDistanceMeters(
        focusedPost.coordinates,
        nextPost.coordinates,
      ),
      post: nextPost,
    })
  }

  return {
    focusedPost,
    neighbors,
  }
}

function selectFocusedPostZoomNeighbors(
  neighbors: readonly FocusedPostNeighbor[],
) {
  if (neighbors.length <= 1) {
    return [...neighbors]
  }

  const neighborsByDistance = [...neighbors].sort(
    (leftNeighbor, rightNeighbor) =>
      leftNeighbor.distanceMeters - rightNeighbor.distanceMeters,
  )
  const nearestNeighbor = neighborsByDistance[0]
  const farthestNeighbor = neighborsByDistance[neighborsByDistance.length - 1]
  if (!nearestNeighbor || !farthestNeighbor) {
    return []
  }

  const distanceRatio =
    farthestNeighbor.distanceMeters /
    Math.max(nearestNeighbor.distanceMeters, 1)

  if (
    nearestNeighbor.distanceMeters <=
      focusedPostDistanceThresholdsMeters.cityCluster &&
    distanceRatio >= focusedPostCityOutlierRatio
  ) {
    return [nearestNeighbor]
  }

  if (
    nearestNeighbor.distanceMeters <=
      focusedPostDistanceThresholdsMeters.metroContext &&
    distanceRatio >= focusedPostMetroOutlierRatio
  ) {
    return [nearestNeighbor]
  }

  if (
    nearestNeighbor.distanceMeters >
      focusedPostDistanceThresholdsMeters.metroContext &&
    distanceRatio > focusedPostComparableFarRatio
  ) {
    return [nearestNeighbor]
  }

  return [...neighbors]
}

function getFocusedPostFitOptions(
  fitMode: RouteFitMode,
): L.FitBoundsOptions {
  if (fitMode === 'mobile-picker') {
    return {
      paddingBottomRight: [44, 280],
      paddingTopLeft: [44, 108],
    }
  }

  if (fitMode === 'mobile-travel') {
    return {
      paddingBottomRight: [48, 320],
      paddingTopLeft: [48, 112],
    }
  }

  return {
    paddingBottomRight: [104, 104],
    paddingTopLeft: [400, 176],
  }
}

function getFocusedPostZoomPadding(fitMode: RouteFitMode): L.Point {
  if (fitMode === 'mobile-picker') {
    return L.point(52, 150)
  }

  if (fitMode === 'mobile-travel') {
    return L.point(56, 170)
  }

  return L.point(220, 130)
}

function clampFocusedPostZoom(zoom: number, fitMode: RouteFitMode) {
  return Math.round(
    Math.min(Math.max(zoom, focusedPostMinZoom), getMaxFocusedPostZoom(fitMode)),
  )
}

function getSingleFocusedPostZoom(fitMode: RouteFitMode) {
  return fitMode === 'mobile-travel' ? 12 : 13
}

function getMaxFocusedPostZoom(fitMode: RouteFitMode) {
  return fitMode === 'mobile-travel' ? 14 : 15
}

function getCoordinateDistanceMeters(
  start: L.LatLngTuple,
  end: L.LatLngTuple,
) {
  return getCentralAngle(start, end) * earthRadiusKilometers * 1000
}

function createRouteKey(
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
  trackingGeometry: TripTrackingGeometry,
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
              post.routeAfter?.durationSeconds ?? 'open',
              post.routeAfter?.segments
                .map((segment) =>
                  [
                    segment.travelMode,
                    segment.visibleToMembersOnly,
                    ...segment.coordinates.flat(),
                  ].join(','),
                )
                .join(';') ?? 'no-route',
              getPrimaryPostMedia(post).src,
            ].join(':'),
          )
          .join('|')
      : ''

  const openingRouteKey = trackingGeometry.openingRoute
    ? trackingGeometry.openingRoute.segments
        .map((segment) =>
          [
            segment.travelMode,
            segment.visibleToMembersOnly,
            ...segment.coordinates.flat(),
          ].join(','),
        )
        .join(';')
    : 'no-opening-route'

  return [
    routeMode,
    stopKey,
    legKey,
    postKey,
    openingRouteKey,
  ].join('::')
}

function getMapRouteSegments(
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
): RouteSegment[] {
  if (routeMode === 'travel-timeline') {
    return getTravelTimelineRouteSegments(
      stops,
      travelLegs,
      travelPosts,
      openingRoute,
    )
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
  openingRoute: TravelPostRoute | null,
): RouteSegment[] {
  const postsInRouteOrder = getTravelPostsInRouteOrder(travelPosts)
  // The opening route leads into the first post, so it is drawn before every
  // post-to-post segment. When no post is visible it is the only geometry.
  const segments = [
    ...toPostRouteSegments(openingRoute),
    ...getBackendTravelPostRouteSegments(postsInRouteOrder),
  ]
  const origin = getTravelTimelineRouteOrigin(travelPosts, openingRoute)
  const upcomingStop = stops[0] ?? null

  if (origin && upcomingStop) {
    segments.push({
      coordinates: getPointToPointRouteCoordinates(
        origin,
        getStopCoordinates(upcomingStop),
      ),
      kind: 'post-to-stop',
      routeType: 'SIMPLE',
    })
  }

  segments.push(...getItineraryRouteSegments(stops, travelLegs))
  return segments
}

function getBackendTravelPostRouteSegments(
  postsInRouteOrder: readonly TravelPost[],
): RouteSegment[] {
  return postsInRouteOrder.flatMap((post) =>
    toPostRouteSegments(post.routeAfter),
  )
}

function toPostRouteSegments(route: TravelPostRoute | null): RouteSegment[] {
  return (route?.segments ?? []).map((segment) => ({
    coordinates: segment.coordinates,
    kind: 'post-link' as const,
    routeType: 'SIMPLE' as const,
    travelMode: segment.travelMode,
    visibleToMembersOnly: segment.visibleToMembersOnly,
  }))
}

function getRouteSegmentPathOptions(
  segment: RouteSegment,
  routeMode: MapRouteMode,
): L.PolylineOptions {
  if (segment.kind === 'post-link') {
    return {
      ...getPostRouteSegmentPathOptions(),
      color: segment.visibleToMembersOnly
        ? getThemeColor('--chart-4', '#C2410C')
        : getThemeColor('--primary', '#0F766E'),
      // GPS-derived traces are visual-only: they must not receive clicks or
      // hover/focus events that would show a Leaflet tooltip.
      interactive: false,
    }
  }

  if (segment.kind === 'post-to-stop') {
    return {
      color: getThemeColor('--muted-foreground', '#334155'),
      dashArray: '7 9',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.62,
      weight: 3,
    }
  }

  if (routeMode === 'itinerary') {
    return {
      color: getThemeColor('--primary', '#0F766E'),
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.82,
      weight: 4,
    }
  }

  return {
    color: getThemeColor('--primary', '#0F766E'),
    dashArray: segment.routeType === 'SIMPLE' ? '10 10' : undefined,
    lineCap: 'round',
    lineJoin: 'round',
    opacity: segment.routeType === 'SIMPLE' ? 0.62 : 0.86,
    weight: 4,
  }
}

function getPostRouteSegmentPathOptions(): L.PolylineOptions {
  return {
    color: getThemeColor('--primary', '#0F766E'),
    lineCap: 'round',
    lineJoin: 'round',
    opacity: 0.78,
    weight: 4,
  }
}

function getThemeColor(variable: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback
}

function getRouteBoundsCoordinates(
  routeMode: MapRouteMode,
  stops: readonly Stop[],
  travelLegs: readonly TravelLeg[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
) {
  const routeCoordinates = getMapRouteSegments(
    routeMode,
    stops,
    travelLegs,
    travelPosts,
    openingRoute,
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
  const coordinates = getGeoJsonLineStringCoordinates(route.geometry)
  if (!coordinates) {
    return null
  }

  return route.type === 'SIMPLE'
    ? createGeodesicRoute(coordinates)
    : coordinates
}

function createPlaceMarkerHtml(stopOrder: number | null) {
  const className =
    stopOrder === null
      ? 'trip-map-place-marker'
      : 'trip-map-place-marker trip-map-place-marker--numbered'
  const labelHtml =
    stopOrder === null
      ? ''
      : `<span class="trip-map-place-marker__number">${stopOrder}</span>`

  return `
    <div class="${className}">
      ${labelHtml}
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
