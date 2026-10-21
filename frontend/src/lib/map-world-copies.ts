import * as L from 'leaflet'

export function shiftWorldCoordinate(
  [latitude, longitude]: L.LatLngTuple,
  offset: number,
): [number, number] {
  return [latitude, longitude + offset]
}

export function normalizeWorldCoordinate([latitude, longitude]: L.LatLngTuple): [number, number] {
  if (longitude >= -180 && longitude < 180) return [latitude, longitude]
  return [latitude, ((((longitude + 180) % 360) + 360) % 360) - 180]
}

export function nearestWorldCoordinate(coordinate: L.LatLngTuple, referenceLongitude: number) {
  return shiftWorldCoordinate(coordinate, 360 * Math.round((referenceLongitude - coordinate[1]) / 360))
}

export function shiftWorldRoute(coordinates: readonly L.LatLngTuple[], offset: number): L.LatLngTuple[] {
  let previousLongitude = coordinates[0]?.[1] ?? 0
  return coordinates.map(([latitude, longitude]) => {
    const unwrapped = longitude + 360 * Math.round((previousLongitude - longitude) / 360)
    previousLongitude = unwrapped
    return [latitude, unwrapped + offset]
  })
}

export function getVisibleWorldOffsets(west: number, east: number, sourceWest: number, sourceEast: number) {
  if (![west, east, sourceWest, sourceEast].every(Number.isFinite)) return [0]
  const first = Math.ceil((west - sourceEast) / 360)
  const last = Math.floor((east - sourceWest) / 360)
  const offsets = new Set([0])
  for (let world = first; world <= last; world += 1) offsets.add(world * 360)
  return [...offsets]
}

type RenderWorld = (layer: L.LayerGroup, longitudeOffset: number) => void

// Tile layers wrap automatically; Leaflet overlays do not. Render the same
// already-authorized data in nearby worlds, with the original event handlers.
export class RepeatedWorldLayer {
  private readonly root: L.LayerGroup
  private readonly copies = new Map<number, L.FeatureGroup>()
  private renderWorld: RenderWorld | null = null
  private sourceBounds: L.LatLngBounds | null = null
  private frame: number | null = null
  private readonly map: L.Map

  constructor(map: L.Map) {
    this.map = map
    this.root = L.layerGroup().addTo(map)
    map.on('move zoom resize', this.scheduleUpdate)
    map.once('unload', this.remove)
  }

  render(renderWorld: RenderWorld) {
    this.root.clearLayers()
    this.copies.clear()
    this.renderWorld = renderWorld
    const original = L.featureGroup().addTo(this.root)
    this.copies.set(0, original)
    renderWorld(original, 0)
    this.sourceBounds = original.getBounds()
    this.update()
  }

  remove = () => {
    this.map.off('move zoom resize', this.scheduleUpdate)
    this.map.off('unload', this.remove)
    if (this.frame !== null) window.cancelAnimationFrame(this.frame)
    this.frame = null
    this.root.remove()
    this.root.clearLayers()
    this.copies.clear()
    this.renderWorld = null
  }

  private scheduleUpdate = () => {
    if (this.frame !== null) return
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null
      this.update()
    })
  }

  private update() {
    if (!this.renderWorld || !this.sourceBounds?.isValid()) return
    // Buffer the viewport so copies are ready before a drag reaches the edge.
    const viewport = this.map.getBounds().pad(0.25)
    const offsets = new Set(getVisibleWorldOffsets(
      viewport.getWest(), viewport.getEast(),
      this.sourceBounds.getWest(), this.sourceBounds.getEast(),
    ))
    for (const [offset, group] of this.copies) {
      if (offsets.has(offset)) continue
      this.root.removeLayer(group)
      this.copies.delete(offset)
    }
    for (const offset of offsets) {
      if (this.copies.has(offset)) continue
      const group = L.featureGroup().addTo(this.root)
      this.copies.set(offset, group)
      this.renderWorld(group, offset)
    }
  }
}
