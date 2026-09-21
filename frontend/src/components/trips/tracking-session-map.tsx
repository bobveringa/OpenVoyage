import 'leaflet/dist/leaflet.css'
import './tracking-session-map.css'
import * as L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrackSample } from '@/api/client'
import { usePublicSetting } from '@/settings/public-settings'
import {
  MAP_TILE_PROVIDER_SETTING_KEY,
  resolveMapTileProvider,
} from '@/lib/map-tile-providers'
import {
  bearing,
  clampMove,
  destination,
  distance,
  insertDistanceLimit,
  MAX_MOVE_DISTANCE_METERS,
  segmentDistance,
} from '@/tracking/edit-geometry'
import { coordinates } from '@/tracking/session-points'

type Props = {
  editablePoints?: readonly TrackSample[]
  paths: { id: string; color: string; points: readonly TrackSample[] }[]
  selectedSessionId?: string
  selectedPoint?: TrackSample
  origin?: TrackSample
  insertion?: [TrackSample, TrackSample] | null
  disabled?: boolean
  fitKey?: string
  onSelect?: (id: string) => void
  onMove?: (lat: number, lon: number) => void
  onInsert?: (lat: number, lon: number) => void
  onNotice?: (message: string) => void
}

function themeColor(variable: string, fallback: string) {
  if (typeof document === 'undefined') return fallback
  return (
    getComputedStyle(document.documentElement).getPropertyValue(variable).trim() ||
    fallback
  )
}

function mapColor(value: string, fallback: string) {
  const variable = value.match(/^var\((--[^),]+)(?:,[^)]+)?\)$/)?.[1]
  return variable ? themeColor(variable, fallback) : value
}

function rangeSlices(
  points: readonly TrackSample[],
  editablePoints: readonly TrackSample[],
) {
  if (!editablePoints.length)
    return { active: [] as readonly TrackSample[], muted: [points] }

  const editableIds = new Set(editablePoints.map((point) => point.id))
  const first = points.findIndex((point) => editableIds.has(point.id))
  let last = -1
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (editableIds.has(points[i].id)) {
      last = i
      break
    }
  }
  if (first < 0 || last < 0)
    return { active: [] as readonly TrackSample[], muted: [points] }

  return {
    active: points.slice(first, last + 1),
    // Include the range boundary point so the gray and primary strokes meet
    // without leaving a gap between recorded samples.
    muted: [
      first > 0 ? points.slice(0, first + 1) : [],
      last < points.length - 1 ? points.slice(last) : [],
    ],
  }
}

export function TrackingSessionMap(props: Props) {
  const element = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [themeRevision, setThemeRevision] = useState(0)
  const callbacks = useRef(props)
  const fitPoints = useMemo(
    () =>
      props.paths.find((path) => path.id === props.selectedSessionId)?.points ??
      [],
    [props.paths, props.selectedSessionId],
  )
  const fitPointsRef = useRef(fitPoints)
  fitPointsRef.current = fitPoints
  useEffect(() => {
    callbacks.current = props
  })
  const setting = usePublicSetting(MAP_TILE_PROVIDER_SETTING_KEY)
  const tiles = useMemo(() => resolveMapTileProvider(setting), [setting])
  useEffect(() => {
    // Theme tokens are read into Leaflet's canvas colors. Redraw when the
    // document theme changes because canvas cannot resolve CSS variables.
    const observer = new MutationObserver(() =>
      setThemeRevision((value) => value + 1),
    )
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!element.current) return
    const map = L.map(element.current, { preferCanvas: true }).setView(
      [20, 0],
      2,
    )
    mapRef.current = map
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(element.current)
    return () => {
      resize.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = L.tileLayer(tiles.url, tiles.options).addTo(map)
    return () => {
      layer.remove()
    }
  }, [tiles])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const group = L.layerGroup().addTo(map)
    const primary = themeColor('--primary', '#246b49')
    const background = themeColor('--background', '#f7fbf7')
    const card = themeColor('--card', '#ffffff')
    const accent = themeColor('--accent', '#d99a2b')
    const muted = themeColor('--muted-foreground', '#587064')
    // Draw the selected path last so an exact overlap still has a clear foreground.
    const paths = [...props.paths].sort(
      (a, b) =>
        Number(a.id === props.selectedSessionId) -
        Number(b.id === props.selectedSessionId),
    )
    for (const path of paths) {
      const selected = path.id === props.selectedSessionId
      const points = path.points.map(coordinates)
      if (selected) {
        L.polyline(points, {
          color: background,
          className: 'tracking-path-halo',
          weight: 9,
          interactive: false,
        }).addTo(group)
        const editablePoints = props.editablePoints ?? path.points
        const slices = rangeSlices(path.points, editablePoints)
        for (const slice of slices.muted) {
          if (slice.length < 2) continue
          L.polyline(slice.map(coordinates), {
            color: muted,
            className: 'tracking-path-muted',
            weight: 5,
            opacity: 0.8,
            interactive: false,
          }).addTo(group)
        }
        if (slices.active.length >= 2)
          L.polyline(slices.active.map(coordinates), {
            color: primary,
            className: 'tracking-path-active',
            weight: 5,
            interactive: false,
          }).addTo(group)

        // Keep long recordings responsive. Every point remains selectable by
        // proximity or its exact list index; only the decorative dots are thinned.
        const stride = Math.max(1, Math.ceil(editablePoints.length / 1500))
        for (let i = 0; i < editablePoints.length; i += stride) {
          const p = editablePoints[i]
          L.circleMarker(coordinates(p), {
            radius: 4,
            color: primary,
            fillColor: card,
            className: 'tracking-point',
            fillOpacity: 0.9,
            interactive: false,
          }).addTo(group)
        }
        continue
      }
      L.polyline(points, {
        color: mapColor(path.color, primary),
        weight: 3,
        opacity: props.selectedSessionId ? 0.35 : 1,
        interactive: false,
      }).addTo(group)
    }
    if (props.insertion) {
      const [a, b] = props.insertion.map(coordinates)
      const radius = insertDistanceLimit(a, b),
        angle = bearing(a, b)
      const edge: L.LatLngTuple[] = []
      // Geodesic capsule: the allowed corridor around this segment.
      for (let i = 0; i <= 24; i++)
        edge.push(
          destination(b, angle - Math.PI / 2 + (i * Math.PI) / 24, radius),
        )
      for (let i = 0; i <= 24; i++)
        edge.push(
          destination(a, angle + Math.PI / 2 + (i * Math.PI) / 24, radius),
        )
      L.polygon(edge, {
        color: accent,
        fillColor: accent,
        className: 'tracking-insert-area',
        fillOpacity: 0.15,
        interactive: false,
      }).addTo(group)
    } else if (props.selectedPoint) {
      const point = props.selectedPoint,
        origin = coordinates(props.origin ?? point)
      if (props.origin)
        L.circle(origin, {
          radius: MAX_MOVE_DISTANCE_METERS,
          color: primary,
          fillColor: primary,
          className: 'tracking-move-limit',
          fillOpacity: 0.05,
          dashArray: '5 5',
          interactive: false,
        }).addTo(group)
      const marker = L.marker(coordinates(point), {
        draggable: !props.disabled && Boolean(props.origin),
        icon: L.divIcon({
          className: 'tracking-selected-point',
          html: '',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
      }).addTo(group)
      marker.on('drag', () => {
        const target = marker.getLatLng(),
          clamped = clampMove(origin, [target.lat, target.lng])
        marker.setLatLng(clamped)
        if (
          distance(origin, [target.lat, target.lng]) >= MAX_MOVE_DISTANCE_METERS
        )
          callbacks.current.onNotice?.('400 m move limit reached.')
      })
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        callbacks.current.onMove?.(p.lat, p.lng)
      })
    }
    const click = (event: L.LeafletMouseEvent) => {
      if (props.disabled) return
      const point: [number, number] = [event.latlng.lat, event.latlng.lng]
      if (props.insertion) {
        const [a, b] = props.insertion.map(coordinates)
        if (segmentDistance(point, a, b) <= insertDistanceLimit(a, b))
          callbacks.current.onInsert?.(...point)
        else
          callbacks.current.onNotice?.(
            'Choose a position inside the highlighted allowed area.',
          )
        return
      }
      const editablePoints = props.editablePoints ?? []
      let best: TrackSample | undefined,
        closest = 25
      for (const p of editablePoints) {
        const pixels = map
          .latLngToContainerPoint(coordinates(p))
          .distanceTo(event.containerPoint)
        if (pixels < closest) {
          closest = pixels
          best = p
        }
      }
      if (best) callbacks.current.onSelect?.(best.id)
    }
    map.on('click', click)
    return () => {
      map.off('click', click)
      group.remove()
    }
  }, [
    props.paths,
    props.editablePoints,
    props.selectedSessionId,
    props.selectedPoint,
    props.origin,
    props.insertion,
    props.disabled,
    themeRevision,
  ])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const fitPoints = fitPointsRef.current
    if (!fitPoints.length) return

    map.invalidateSize()
    if (fitPoints.length === 1) {
      map.setView(coordinates(fitPoints[0]), 17, { animate: false })
      return
    }
    map.fitBounds(L.latLngBounds(fitPoints.map(coordinates)), {
      animate: false,
      maxZoom: 17,
      padding: [36, 36],
    })
  }, [props.fitKey, props.selectedSessionId])
  return (
    <div
      ref={element}
      className="tracking-session-map trip-leaflet-map relative z-0 h-[30dvh] min-h-48 md:h-full md:min-h-0 md:flex-1 w-full rounded-xl border border-border bg-muted"
      aria-label="Recording paths map"
    />
  )
}
