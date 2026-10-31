import { resolveConnectionEndpoint } from './connection-endpoints'
import 'leaflet/dist/leaflet.css'

import * as L from 'leaflet'
import {
  RepeatedWorldLayer,
  nearestWorldCoordinate,
  normalizeWorldCoordinate,
  shiftWorldCoordinate,
  shiftWorldRoute,
} from '@/lib/map-world-copies'
import { Compass } from 'lucide-react'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PlanningSessionContext } from './planning-session'
import { airportTransferLabel, getAirportTransfers, type AirportTransfer } from './airport-transfers'
import { flightFocusCoordinates } from './flight-map-focus'

import {
  type GpsPostCandidate,
  type ItineraryRouteType,
  type TrackingJourney,
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
  getMapBubbleMedia,
  getMapBubbleThumbnailSrc,
  getStopCoordinates,
  getTravelModeLabel,
} from '@/pages/trip-detail/shared-utils'
import type {
  MapStop,
  MapConnection,
  Connection,
  TravelMode,
  TravelPost,
  TravelPostRoute,
  TripTrackingGeometry,
} from '@/pages/trip-detail/models'
import {
  createRouteGeometryKey,
  createGeodesicRoute,
  getCentralAngle,
  getGeoJsonLineStringCoordinates,
} from '@/pages/trip-detail/route-geometry'
import { usePublicSetting } from '@/settings/public-settings'
import { useTheme } from '@/theme'

type RouteFitMode = 'route-selector' | 'route-preview' | 'mobile-picker' | 'mobile-travel' | 'mobile-fullscreen' | 'workspace'

type RouteEndpoint = {
  coordinates: L.LatLngTuple
  travelMode: TravelMode
}

type DraftPostLocation = {
  coordinates: L.LatLngTuple
  label: string
}

export type MapRouteMode = 'itinerary' | 'travel-timeline'
type RouteSegmentKind = 'itinerary' | 'post-link' | 'post-to-stop' | 'journey'

type RouteSegment = {
  coordinates: L.LatLngTuple[]
  kind: RouteSegmentKind
  routeType: ItineraryRouteType
  travelMode?: TravelMode
  visibleToMembersOnly?: boolean
  alternative?: boolean
  transfer?: AirportTransfer
  connectionId?: string
  segmentIndex?: number
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
  onPlanningPanelHostChange,
  planningPreview = null,
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
  connections,
  travelPosts,
}: {
  onPlanningPanelHostChange?: (host: HTMLDivElement | null) => void
  planningPreview?: Connection | null
  draftMapLocation: DraftPostLocation | null
  focusedPostId: string | null
  gpsPostCandidates: readonly GpsPostCandidate[]
  isTripOngoing: boolean
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  onGpsPostCandidateSelect: (candidate: GpsPostCandidate) => void
  onPostMarkerSelect: (postId: string) => void
  routeMode: MapRouteMode
  stops: readonly MapStop[]
  trackingGeometry: TripTrackingGeometry
  connections: readonly MapConnection[]
  travelPosts: readonly TravelPost[]
}) {
  const [resetNonce, setResetNonce] = useState(0)

  return (
    <section aria-label={planningPreview ? 'Connection map preview' : 'Trip map'} className="relative min-h-0 min-w-0 overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm lg:h-full">
      <TripLeafletMap
        fitMode={planningPreview ? 'route-selector' : 'workspace'}
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
        stops={planningPreview ? stops.filter((stop) => (planningPreview.from.type === 'STOP' && stop.id === planningPreview.from.stop_id) || (planningPreview.to.type === 'STOP' && stop.id === planningPreview.to.stop_id)) : stops}
        connections={planningPreview ? [planningPreview] : connections}
        trackingGeometry={trackingGeometry}
        travelPosts={travelPosts}
      />

      <div ref={onPlanningPanelHostChange} className="pointer-events-none absolute inset-y-3 left-3 z-[600] hidden w-[min(22rem,50%)] min-w-64 lg:block [&>*]:pointer-events-auto" />
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
  focusedFlightId = null,
  flightFocusBottomPadding,
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
  connections,
  travelPosts,
}: {
  draftMapLocation: DraftPostLocation | null
  fitMode?: RouteFitMode
  focusedPostId?: string | null
  focusedFlightId?: string | null
  flightFocusBottomPadding?: number
  gpsPostCandidates?: readonly GpsPostCandidate[]
  isTripOngoing?: boolean
  mapPointEnabled: boolean
  onDraftMapPointSelect: (coordinates: L.LatLngTuple) => void
  onGpsPostCandidateSelect?: (candidate: GpsPostCandidate) => void
  onPostMarkerSelect?: (postId: string) => void
  resetNonce: number
  routeMode?: MapRouteMode
  stops: readonly MapStop[]
  trackingGeometry: TripTrackingGeometry
  connections: readonly MapConnection[]
  travelPosts: readonly TravelPost[]
}) {
  const { mode: themeMode, palette: themePalette } = useTheme()
  const tileProviderSetting = usePublicSetting(MAP_TILE_PROVIDER_SETTING_KEY)
  const tileProvider = useMemo(
    () => resolveMapTileProvider(tileProviderSetting),
    [tileProviderSetting],
  )
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const draftMarkerRef = useRef<RepeatedWorldLayer | null>(null)
  const latestLocationSelectRef = useRef(onDraftMapPointSelect)
  const latestGpsPostCandidateSelectRef = useRef(onGpsPostCandidateSelect)
  const latestPostMarkerSelectRef = useRef(onPostMarkerSelect)
  const { onAirportTransferSelect } = useContext(PlanningSessionContext)
  const latestTransferSelectRef = useRef(onAirportTransferSelect)
  latestTransferSelectRef.current = onAirportTransferSelect
  const mapPointEnabledRef = useRef(mapPointEnabled)
  const mapRef = useRef<L.Map | null>(null)
  const postMarkerLayerRef = useRef<RepeatedWorldLayer | null>(null)
  const gpsPostCandidateLayerRef = useRef<RepeatedWorldLayer | null>(null)
  const routeLayerRef = useRef<RepeatedWorldLayer | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const focusedPostIdRef = useRef<string | null>(focusedPostId)
  const focusedFlightIdRef = useRef<string | null>(focusedFlightId)
  const travelPostsRef = useRef(travelPosts)
  const stopsRef = useRef(stops)
  const connectionsRef = useRef(connections)
  const trackingGeometryRef = useRef(trackingGeometry)
  const gpsPostCandidatesRef = useRef(gpsPostCandidates)
  const routeEndpointLayerRef = useRef<RepeatedWorldLayer | null>(null)
  const fittedViewRef = useRef<string | null>(null)
  const postMarkerKey = JSON.stringify(travelPosts.map(post => [post.id, post.coordinates, createPostBubbleHtml(post, false)]))
  const routeKey = createRouteKey(
    routeMode,
    stops,
    connections,
    travelPosts,
    trackingGeometry,
  )
  const selectedFlight = trackingGeometry.flightJourneys?.flatMap(journey => journey.flights).find(flight => flight.id === focusedFlightId)
  const flightFocusKey = JSON.stringify(selectedFlight ? [selectedFlight.id, selectedFlight.flight_number,
    selectedFlight.departure_airport, selectedFlight.arrival_airport] : null)

  focusedPostIdRef.current = focusedPostId
  focusedFlightIdRef.current = focusedFlightId
  travelPostsRef.current = travelPosts
  trackingGeometryRef.current = trackingGeometry
  gpsPostCandidatesRef.current = gpsPostCandidates
  stopsRef.current = stops
  connectionsRef.current = connections

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

  const showZoomControls = fitMode !== 'mobile-travel'
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

    if (showZoomControls) {
      L.control.zoom({ position: 'bottomright' }).addTo(map)
    }

    function handleMapClick(event: L.LeafletMouseEvent) {
      if (!mapPointEnabledRef.current) {
        return
      }

      const coordinate = normalizeWorldCoordinate([event.latlng.lat, event.latlng.lng])
      latestLocationSelectRef.current([
        Number(coordinate[0].toFixed(4)),
        Number(coordinate[1].toFixed(4)),
      ])
    }

    map.on('click', handleMapClick)
    mapRef.current = map
    fittedViewRef.current = null

    routeLayerRef.current = new RepeatedWorldLayer(map)
    postMarkerLayerRef.current = new RepeatedWorldLayer(map)
    gpsPostCandidateLayerRef.current = new RepeatedWorldLayer(map)
    routeEndpointLayerRef.current = new RepeatedWorldLayer(map)

    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    resizeObserver.observe(container)
    const initialFrame = window.requestAnimationFrame(() => map.invalidateSize())

    return () => {
      resizeObserver.disconnect()
      window.cancelAnimationFrame(initialFrame)
      map.off('click', handleMapClick)
      map.stop()
      // Leaflet 1.x leaves a zoom fallback timer queued after remove().
      // Clear its guard before destroying panes so resizing cannot access a removed map.
      ;(map as L.Map & { _animatingZoom?: boolean })._animatingZoom = false
      map.remove()
      draftMarkerRef.current = null
      mapRef.current = null
      routeEndpointLayerRef.current = null
      postMarkerLayerRef.current = null
      gpsPostCandidateLayerRef.current = null
      routeLayerRef.current = null
      tileLayerRef.current = null
    }
  }, [showZoomControls])

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
  }, [showZoomControls, tileProvider])

  useEffect(() => {
    const postMarkerLayer = postMarkerLayerRef.current
    if (!postMarkerLayer) {
      return
    }

    postMarkerLayer.render((layer, offset) => {
      renderPostMarkerLayer(
        layer,
        routeMode === 'travel-timeline' ? travelPostsRef.current : [],
        focusedPostId,
        (postId) => latestPostMarkerSelectRef.current?.(postId),
        offset,
      )
    }, true)
  }, [focusedPostId, routeMode, postMarkerKey, showZoomControls])

  useEffect(() => {
    const candidateLayer = gpsPostCandidateLayerRef.current
    if (!candidateLayer) {
      return
    }

    candidateLayer.render((layer, offset) => {
      if (routeMode !== 'travel-timeline') return
      renderGpsPostCandidateLayer(
        layer,
        gpsPostCandidatesRef.current,
        (candidate) => latestGpsPostCandidateSelectRef.current?.(candidate),
        offset,
      )
    })
  }, [gpsPostCandidates, routeMode])

  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    if (!map || !routeLayer) {
      return
    }

    routeLayer.render((layer, offset) => renderRouteLayer(
      layer,
      routeMode,
      stopsRef.current,
      connectionsRef.current,
      travelPostsRef.current,
      trackingGeometryRef.current.openingRoute,
      onAirportTransferSelect && routeMode === 'itinerary' ? (transfer) => latestTransferSelectRef.current?.(transfer.connectionId, transfer.side) : undefined,
      offset,
      trackingGeometryRef.current.journey,
    ))

    const routeEndpointLayer = routeEndpointLayerRef.current
    if (routeEndpointLayer) {
      routeEndpointLayer.render((layer, offset) => {
        for (const connection of connectionsRef.current) {
          for (const [side, endpoint] of [['start', connection.from], ['end', connection.to]] as const) {
            if (endpoint.type !== 'LOCATION') continue
            const anchor = resolveConnectionEndpoint(endpoint, stopsRef.current)
            if (!anchor) continue
            const marker = L.circleMarker(shiftWorldCoordinate([anchor.location.latitude, anchor.location.longitude], offset), {
              className: 'trip-map-connection-endpoint', radius: 6,
              color: getThemeColor('--primary', '#0F766E'), fillOpacity: 1,
            }).bindTooltip(escapeHtml(anchor.title)).addTo(layer)
            marker.getElement()?.setAttribute('aria-label', `Trip ${side}: ${anchor.title}`)
          }
        }
        if (routeMode === 'travel-timeline' && isTripOngoing) {
          renderRouteEndpointMarker(
            layer,
            getTravelTimelineRouteEndpoint(
              travelPostsRef.current,
              trackingGeometryRef.current.openingRoute,
            ),
            offset,
          )
        }
      })
    }
    const animationFrameId = window.requestAnimationFrame(() => {
      map.invalidateSize()
      const outsideAnchors = connectionsRef.current.flatMap((connection) =>
        [connection.from, connection.to].filter((endpoint) => endpoint.type === 'LOCATION').map((endpoint) => {
          const anchor = resolveConnectionEndpoint(endpoint, stopsRef.current)
          return anchor ? [anchor.location.latitude, anchor.location.longitude] : null
        }),
      )
      const viewKey = `${routeMode}:${fitMode}:${JSON.stringify(outsideAnchors)}:${fitMode === 'route-preview' || fitMode === 'route-selector' ? routeKey : ''}`
      if (!focusedPostIdRef.current && !focusedFlightIdRef.current && fittedViewRef.current !== viewKey) {
        fitRouteBounds(
          map,
          routeMode,
          stopsRef.current,
          connectionsRef.current,
          travelPostsRef.current,
          trackingGeometryRef.current.openingRoute,
          fitMode,
          { journey: trackingGeometryRef.current.journey },
        )
        if (getMapRouteSegments(routeMode, stopsRef.current, connectionsRef.current,
          travelPostsRef.current, trackingGeometryRef.current.openingRoute, trackingGeometryRef.current.journey).length > 0) {
          fittedViewRef.current = viewKey
        }
      }
    })

    return () => window.cancelAnimationFrame(animationFrameId)
  }, [fitMode, isTripOngoing, routeKey, routeMode, themeMode, themePalette, onAirportTransferSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map || fitMode !== 'route-selector') return
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false })
      fitRouteBounds(map, routeMode, stopsRef.current, connectionsRef.current,
        travelPostsRef.current, trackingGeometryRef.current.openingRoute, fitMode,
        { journey: trackingGeometryRef.current.journey })
    })
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [fitMode, routeMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setMinZoom(focusedFlightId && routeMode === 'travel-timeline' && fitMode.startsWith('mobile-') ? 0 : 3)
    if (routeMode !== 'travel-timeline') return

    // Flights are carousel stories too; frame their own leg instead of neighboring posts.
    if (focusedFlightId) {
      const flight = trackingGeometryRef.current.flightJourneys?.flatMap(journey => journey.flights)
        .find(item => item.id === focusedFlightId)
      if (!flight) return
      const coordinates = flightFocusCoordinates(flight)
      const first = nearestWorldCoordinate(coordinates[0], map.getCenter().lng)
      const shifted = shiftWorldRoute(coordinates, first[1] - coordinates[0][1])
      const padding = getFocusedPostFitOptions(fitMode)
      map.stop()
      map.flyToBounds(L.latLngBounds(shifted), {
        ...padding,
        ...(flightFocusBottomPadding !== undefined ? { paddingBottomRight: [40, flightFocusBottomPadding] as L.PointTuple } : {}),
        ...focusedPostAnimationOptions, maxZoom: 9,
      })
      return
    }

    if (!focusedPostId) {
      fitRouteBounds(
        map,
        routeMode,
        stopsRef.current,
        connectionsRef.current,
        travelPostsRef.current,
        trackingGeometryRef.current.openingRoute,
        fitMode,
        { animate: true, journey: trackingGeometryRef.current.journey },
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
  }, [fitMode, focusedPostId, focusedFlightId, flightFocusKey, flightFocusBottomPadding, routeMode])

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

    const draftLayer = new RepeatedWorldLayer(map)
    draftMarkerRef.current = draftLayer
    draftLayer.render((layer, offset) => {
      L.marker(shiftWorldCoordinate(draftMapLocation.coordinates, offset), {
        icon: L.divIcon({
          className: 'trip-map-div-icon',
          html: createDraftPostMarkerHtml(),
          iconAnchor: [18, 18],
          iconSize: [36, 36],
        }),
        zIndexOffset: 700,
      }).addTo(layer)
    })
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
      connectionsRef.current,
      travelPostsRef.current,
      trackingGeometryRef.current.openingRoute,
      fitMode,
      { animate: true, journey: trackingGeometryRef.current.journey },
    )
  }, [fitMode, resetNonce, routeMode])

  return (
    <div
      aria-label="Interactive trip route map"
      className={'trip-leaflet-map absolute inset-0' + (fitMode === 'route-preview' ? ' min-h-0' : '')}
      ref={mapContainerRef}
    />
  )
}

function renderRouteLayer(
  routeLayer: L.LayerGroup,
  routeMode: MapRouteMode,
  stops: readonly MapStop[],
  connections: readonly MapConnection[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
  onTransferSelect?: (transfer: AirportTransfer) => void,
  longitudeOffset = 0,
  journey?: TrackingJourney,
) {
  const routeSegments = getMapRouteSegments(
    routeMode,
    stops,
    connections,
    travelPosts,
    openingRoute,
    journey,
  )
  for (const segment of routeSegments) {
    if (segment.coordinates.length < 2) {
      continue
    }

    const coordinates = shiftWorldRoute(segment.coordinates, longitudeOffset)
    const line = L.polyline(
      coordinates,
      getRouteSegmentPathOptions(segment, routeMode),
    ).addTo(routeLayer)

    if (segment.connectionId) line.getElement()?.setAttribute('data-itinerary-connection-id', segment.connectionId)
    if (segment.segmentIndex !== undefined) line.getElement()?.setAttribute('data-itinerary-segment-index', String(segment.segmentIndex))

    if (segment.transfer) {
      const transfer = segment.transfer
      const label = airportTransferLabel(transfer)
      line.bindTooltip(escapeHtml(label) + '<br>Transport not chosen · Approximate connection')
      const element = line.getElement()
      element?.setAttribute('aria-label', label)
      if (onTransferSelect) {
        line.on('click', () => onTransferSelect(transfer))
        element?.setAttribute('role', 'button')
        element?.setAttribute('tabindex', '0')
        element?.addEventListener('keydown', (event) => {
          if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') {
            event.preventDefault()
            onTransferSelect(transfer)
          }
        })
      }
    }

    if (
      routeMode === 'itinerary' ||
      segment.kind !== 'itinerary' ||
      segment.routeType === 'SIMPLE'
    ) {
      continue
    }

    L.polyline(coordinates, {
      color: getThemeColor('--card', '#FFFFFF'),
      dashArray: '2 10',
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.85,
      weight: 2,
    }).addTo(routeLayer)
  }

  if (routeMode === 'travel-timeline' && journey) {
    if (journey.position && journey.active_flight_id) {
      const marker = L.circleMarker(shiftWorldCoordinate([journey.position.latitude, journey.position.longitude], longitudeOffset), {
        className: 'trip-map-flight-position', radius: 7, color: getThemeColor('--card', '#FFFFFF'), weight: 3,
        fillColor: getThemeColor('--primary', '#0F766E'), fillOpacity: 1,
      }).addTo(routeLayer).bindTooltip(journey.position.source === 'FLIGHT_TRACK' ? 'Observed flight position' : 'Estimated flight position')
      marker.getElement()?.setAttribute('aria-label', journey.position.source === 'FLIGHT_TRACK' ? 'Observed flight position' : 'Estimated flight position')
    }
  }

  const showStopOrder = routeMode === 'itinerary'
  const stopMarkerSize = showStopOrder ? 22 : 14

  for (const [stopIndex, stop] of stops.entries()) {
    L.marker(shiftWorldCoordinate(getStopCoordinates(stop), longitudeOffset), {
      icon: L.divIcon({
        className: 'trip-map-div-icon',
        html: createPlaceMarkerHtml(showStopOrder ? stopIndex + 1 : null),
        iconAnchor: [stopMarkerSize / 2, stopMarkerSize / 2],
        iconSize: [stopMarkerSize, stopMarkerSize],
      }),
    })
      .addTo(routeLayer)
      .bindPopup(`<strong>${escapeHtml(stop.title)}</strong><br>${escapeHtml(routeMode === 'itinerary' ? stop.notes ?? '' : '')}`)
  }
}

function renderRouteEndpointMarker(
  layer: L.LayerGroup,
  endpoint: RouteEndpoint | null,
  longitudeOffset = 0,
) {
  if (!endpoint) {
    return
  }

  L.marker(shiftWorldCoordinate(endpoint.coordinates, longitudeOffset), {
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

const postMarkersByLayer = new WeakMap<L.LayerGroup, Map<string, { marker: L.Marker; html: string }>>()

function renderPostMarkerLayer(
  postMarkerLayer: L.LayerGroup,
  travelPosts: readonly TravelPost[],
  focusedPostId: string | null,
  onPostMarkerSelect: (postId: string) => void,
  longitudeOffset = 0,
) {
  let markers = postMarkersByLayer.get(postMarkerLayer)
  if (!markers) {
    markers = new Map()
    postMarkersByLayer.set(postMarkerLayer, markers)
  }
  const ids = new Set(travelPosts.map(post => post.id))
  for (const [id, entry] of markers) {
    if (!ids.has(id)) {
      postMarkerLayer.removeLayer(entry.marker)
      markers.delete(id)
    }
  }
  const orderedPosts = [
    ...travelPosts.filter((post) => post.id !== focusedPostId),
    ...travelPosts.filter((post) => post.id === focusedPostId),
  ]

  for (const post of orderedPosts) {
    const isFocused = post.id === focusedPostId
    const html = createPostBubbleHtml(post, isFocused)
    const coordinates = shiftWorldCoordinate(post.coordinates, longitudeOffset)
    const existing = markers.get(post.id)
    const icon = () => L.divIcon({
      className: 'trip-map-div-icon',
      html,
      iconAnchor: [22, 22],
      iconSize: [44, 44],
    })
    if (existing) {
      if (!existing.marker.getLatLng().equals(coordinates)) existing.marker.setLatLng(coordinates)
      if (existing.html !== html) {
        existing.marker.setIcon(icon())
        existing.html = html
      }
      existing.marker.setZIndexOffset(isFocused ? 1000 : 500)
      continue
    }
    const marker = L.marker(coordinates, {
      icon: icon(),
      zIndexOffset: isFocused ? 1000 : 500,
    }).addTo(postMarkerLayer)

    marker.on('click', () => onPostMarkerSelect(post.id))
    markers.set(post.id, { marker, html })
  }
}

function renderGpsPostCandidateLayer(
  layer: L.LayerGroup,
  candidates: readonly GpsPostCandidate[],
  onSelect: (candidate: GpsPostCandidate) => void,
  longitudeOffset = 0,
) {
  for (const candidate of candidates) {
    const coordinates: L.LatLngTuple = [candidate.latitude, candidate.longitude]
    const marker = L.marker(shiftWorldCoordinate(coordinates, longitudeOffset), {
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
  stops: readonly MapStop[],
  connections: readonly MapConnection[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
  fitMode: RouteFitMode,
  options: { animate?: boolean; journey?: TrackingJourney } = {},
) {
  const routeCoordinates = getRouteBoundsCoordinates(
    routeMode,
    stops,
    connections,
    travelPosts,
    openingRoute,
    options.journey,
  )
  if (routeCoordinates.length === 0) {
    map.setView(defaultMapCenter, defaultMapZoom, {
      ...(options.animate ? routeOverviewAnimationOptions : { animate: false }),
    })
    return
  }

  const routeBounds = L.latLngBounds(routeCoordinates)
  const routeFitOptions = fitMode === 'route-selector'
    ? { paddingTopLeft: [Math.min(352, Math.max(256, map.getSize().x / 2)) + 24, 48] as L.PointTuple, paddingBottomRight: [40, 48] as L.PointTuple, maxZoom: 12, animate: false }
    : getRouteFitOptions(fitMode)
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
  if (fitMode === 'route-preview') return { paddingTopLeft: [28, 28], paddingBottomRight: [48, 40], maxZoom: 12, animate: false }
  if (fitMode === 'mobile-fullscreen') {
    return { maxZoom: 8, paddingTopLeft: [32, 112], paddingBottomRight: [64, 48] }
  }
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
      paddingBottomRight: [36, 144],
      paddingTopLeft: [36, 72],
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
  const focusedCoordinate = nearestWorldCoordinate(
    focusedPostContext.focusedPost.coordinates, map.getCenter().lng,
  )
  if (selectedNeighbors.length === 0) {
    return {
      coordinates: focusedCoordinate,
      kind: 'center',
      zoom: getSingleFocusedPostZoom(fitMode),
    }
  }

  const selectedCoordinates = [
    focusedCoordinate,
    ...selectedNeighbors.map((neighbor) => nearestWorldCoordinate(neighbor.post.coordinates, focusedCoordinate[1])),
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
  if (fitMode === 'mobile-fullscreen') {
    return getRouteFitOptions(fitMode)
  }
  if (fitMode === 'mobile-picker') {
    return {
      paddingBottomRight: [44, 280],
      paddingTopLeft: [44, 108],
    }
  }

  if (fitMode === 'mobile-travel') {
    return {
      paddingBottomRight: [40, 156],
      paddingTopLeft: [40, 80],
    }
  }

  return {
    paddingBottomRight: [104, 104],
    paddingTopLeft: [400, 176],
  }
}

function getFocusedPostZoomPadding(fitMode: RouteFitMode): L.Point {
  if (fitMode === 'mobile-fullscreen') {
    return L.point(56, 100)
  }
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
  stops: readonly MapStop[],
  connections: readonly MapConnection[],
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
  const connectionKey = connections
    .map((connection) =>
      [
        connection.id,
        JSON.stringify(connection.from),
        JSON.stringify(connection.to),
        connection.route.type,
        createRouteGeometryKey(connection.route.geometry),
        ...connection.segments.flatMap((segment) => [segment.intent.travel_mode, segment.route_state, segment.geometry ? createRouteGeometryKey(segment.geometry) : '', ...(segment.route_options || []).map((option) => createRouteGeometryKey(option.geometry))]),
      ].join(':'),
    )
    .join('|')
  const postKey =
    routeMode === 'travel-timeline'
      ? getTravelPostsInRouteOrder(travelPosts)
          .map((post) =>
            [
              post.id,
              post.coordinates[0],
              post.coordinates[1],
              post.occurredAt,
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
            ].join(':'),
          )
          .join('|')
      : ''

  const openingRouteKey = routeMode === 'travel-timeline' && trackingGeometry.openingRoute
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
    connectionKey,
    postKey,
    openingRouteKey,
    // Request timestamps do not change map geometry.
    JSON.stringify(trackingGeometry.journey ? { ...trackingGeometry.journey, server_time: undefined } : null),
  ].join('::')
}

function getMapRouteSegments(
  routeMode: MapRouteMode,
  stops: readonly MapStop[],
  connections: readonly MapConnection[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
  journey?: TrackingJourney,
): RouteSegment[] {
  if (routeMode === 'travel-timeline') {
    return getTravelTimelineRouteSegments(
      stops,
      connections,
      travelPosts,
      openingRoute,
      journey,
    )
  }

  return getItineraryRouteSegments(stops, connections)
}

function getItineraryRouteSegments(
  stops: readonly MapStop[],
  connections: readonly MapConnection[],
  journey?: TrackingJourney,
): RouteSegment[] {
  const segments: RouteSegment[] = []
  for (const connection of connections) {
    const current = connection.id === journey?.current_connection_id
    // Travel hides visited stops. The current connection must still render its
    // later legs when its departure stop has already left the visible stop list.
    const origin = connection.segments[0]?.from_endpoint
    const fromStop = resolveConnectionEndpoint(connection.from, stops) ?? (current && origin
      ? { title: origin.name, location: origin } : null)
    const toStop = resolveConnectionEndpoint(connection.to, stops)
    if ((!fromStop || !toStop) && !current) continue
    const flightIndex = current ? journey?.current_flight_segment_index ?? -1 : -1
    if (connection?.segments?.length) {
      for (const transfer of fromStop && toStop ? getAirportTransfers(connection, fromStop, toStop) : []) {
        if (current && (transfer.side === 'departure' || flightIndex < 0)) continue
        segments.push({
          coordinates: createGeodesicRoute([[transfer.from.latitude, transfer.from.longitude], [transfer.to.latitude, transfer.to.longitude]]),
          kind: 'itinerary', routeType: 'SIMPLE', transfer, connectionId: connection.id,
        })
      }
      for (const [index, segment] of connection.segments.entries()) {
        if (current && (flightIndex < 0 || index < flightIndex || (index === flightIndex && journey?.active_flight_id))) continue
        // Missing road calculations have no honest road geometry to draw.
        if (['CAR', 'BIKE', 'WALK'].includes(segment.intent.travel_mode) && segment.route_state !== 'READY') continue
        const geometry = segment.geometry ?? (segment.intent.travel_mode === 'FLIGHT' && segment.from_endpoint && segment.to_endpoint
          ? { type: 'LineString' as const, coordinates: [
            [segment.from_endpoint.longitude, segment.from_endpoint.latitude],
            [segment.to_endpoint.longitude, segment.to_endpoint.latitude],
          ] } : null)
        if (!geometry) continue
        const coordinates = getGeoJsonLineStringCoordinates(geometry)
        if (!coordinates) continue
        for (const option of segment.route_options || []) {
          if (createRouteGeometryKey(option.geometry) === createRouteGeometryKey(geometry)) continue
          const alternative = getGeoJsonLineStringCoordinates(option.geometry)
          if (alternative) segments.push({ coordinates: alternative, kind: 'itinerary', routeType: 'PROVIDER_BACKED', alternative: true, connectionId: connection.id })
        }
        segments.push({
          coordinates: segment.route_state === 'READY' ? coordinates : createGeodesicRoute(coordinates),
          kind: 'itinerary',
          connectionId: connection.id,
          segmentIndex: index,
          routeType: segment.route_state === 'READY' ? 'PROVIDER_BACKED' : 'SIMPLE',
          travelMode: segment.intent.travel_mode,
        })
      }
    }
  }

  return segments
}

function getTravelTimelineRouteSegments(
  stops: readonly MapStop[],
  connections: readonly MapConnection[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
  journey?: TrackingJourney,
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

  if (!journey && origin && upcomingStop) {
    segments.push({
      coordinates: getPointToPointRouteCoordinates(
        origin,
        getStopCoordinates(upcomingStop),
      ),
      kind: 'post-to-stop',
      routeType: 'SIMPLE',
    })
  }

  // Replace only the current leg. Later flights and arrival transfers remain
  // visible until landing makes that ground leg current.
  segments.push(...getItineraryRouteSegments(stops, connections, journey))
  if (journey) {
    for (const geometry of [journey.connector, journey.remaining_flight_route]) {
      if (!geometry) continue
      const coordinates = getGeoJsonLineStringCoordinates(geometry)
      if (coordinates) segments.push({
        coordinates, kind: 'journey', routeType: 'SIMPLE',
        visibleToMembersOnly: journey.visible_to_members_only,
      })
    }
  }
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
      className: 'trip-map-traveled-route',
      ...getPostRouteSegmentPathOptions(),
      color: segment.visibleToMembersOnly
        ? getThemeColor('--chart-4', '#C2410C')
        : getThemeColor('--primary', '#0F766E'),
      // GPS-derived traces are visual-only: they must not receive clicks or
      // hover/focus events that would show a Leaflet tooltip.
      interactive: false,
    }
  }

  if (segment.kind === 'journey') return {
    className: 'trip-map-journey-guidance',
    color: getThemeColor('--muted-foreground', '#64748b'),
    dashArray: '7 9', weight: 3, opacity: .7, interactive: false,
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

  if (segment.alternative) return { color: '#64748b', weight: 4, opacity: 0.5, interactive: false }

  if (routeMode === 'itinerary') {
    return {
      className: segment.transfer ? 'trip-map-airport-transfer' : undefined,
      dashArray: segment.routeType === 'SIMPLE' ? '7 9' : undefined,
      color: getThemeColor('--primary', '#0F766E'),
      lineCap: 'round',
      lineJoin: 'round',
      opacity: 0.82,
      weight: 4,
    }
  }

  return {
    className: segment.transfer ? 'trip-map-airport-transfer' : undefined,
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
  stops: readonly MapStop[],
  connections: readonly MapConnection[],
  travelPosts: readonly TravelPost[],
  openingRoute: TravelPostRoute | null,
  journey?: TrackingJourney,
) {
  const routeCoordinates = getMapRouteSegments(
    routeMode,
    stops,
    connections,
    travelPosts,
    openingRoute,
    journey,
  ).flatMap((segment) => segment.coordinates)

  if (routeMode === 'travel-timeline' && journey) {
    for (const point of [journey.position, journey.target]) {
      if (point) routeCoordinates.push([point.latitude, point.longitude])
    }
  }
  for (const connection of connections) {
    if (routeMode === 'travel-timeline' && connection.id === journey?.current_connection_id) continue
    for (const endpoint of [connection.from, connection.to]) {
      if (routeMode !== 'itinerary' && endpoint.type !== 'LOCATION') continue
      const anchor = resolveConnectionEndpoint(endpoint, stops)
      if (anchor) routeCoordinates.push([anchor.location.latitude, anchor.location.longitude])
    }
  }
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
  const bubbleMedia = getMapBubbleMedia(post)
  const thumbnailSrc = getMapBubbleThumbnailSrc(bubbleMedia)
  const bubbleClassName = active
    ? 'trip-map-post-bubble trip-map-post-bubble--active'
    : 'trip-map-post-bubble'
  const className = bubbleMedia
    ? bubbleClassName
    : `${bubbleClassName} trip-map-post-bubble--text`

  return `
    <div class="${className}">
      ${bubbleMedia && thumbnailSrc
        ? `<img class="trip-map-post-bubble__image" src="${escapeHtml(thumbnailSrc)}" alt="${escapeHtml(bubbleMedia.alt)}" width="44" height="44" />`
        : `<span class="trip-map-post-bubble__text" role="img" aria-label="${escapeHtml(post.title)}"></span>`}
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
