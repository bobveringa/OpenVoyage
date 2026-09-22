export type Coordinate = readonly [number, number]
export const EARTH_RADIUS_METERS = 6_371_000
export const MIN_EDIT_RADIUS_METERS = 500
const rad = (degrees: number) => (degrees * Math.PI) / 180
export function distance(a: Coordinate, b: Coordinate) {
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) *
      Math.cos(rad(b[0])) *
      Math.sin(rad(b[1] - a[1]) / 2) ** 2
  return (
    2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))))
  )
}
export function bearing(a: Coordinate, b: Coordinate) {
  const p = rad(a[0]),
    q = rad(b[0]),
    d = rad(b[1] - a[1])
  return Math.atan2(
    Math.sin(d) * Math.cos(q),
    Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(d),
  )
}
export function destination(
  a: Coordinate,
  angle: number,
  meters: number,
): [number, number] {
  const d = meters / EARTH_RADIUS_METERS,
    p = rad(a[0]),
    l = rad(a[1])
  const lat = Math.asin(
    Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(angle),
  )
  const lon =
    l +
    Math.atan2(
      Math.sin(angle) * Math.sin(d) * Math.cos(p),
      Math.cos(d) - Math.sin(p) * Math.sin(lat),
    )
  return [(lat * 180) / Math.PI, (((lon * 180) / Math.PI + 540) % 360) - 180]
}
export function insertionArea(a: Coordinate, b: Coordinate) {
  const length = distance(a, b)
  return {
    center: destination(a, bearing(a, b), length / 2),
    // The radius is the full connection length: from the midpoint it always
    // includes both endpoints and leaves another half-connection of room past
    // each one for reconstructing a missed detour.
    radius: Math.max(MIN_EDIT_RADIUS_METERS, length),
  }
}
export function moveAreaRadius(
  origin: Coordinate,
  connections: readonly Coordinate[],
) {
  return Math.max(
    MIN_EDIT_RADIUS_METERS,
    ...connections.map((connection) => distance(origin, connection) * 1.5),
  )
}
export function clampMove(
  origin: Coordinate,
  target: Coordinate,
  maxDistance = MIN_EDIT_RADIUS_METERS,
): [number, number] {
  return distance(origin, target) <= maxDistance
    ? [...target]
    : destination(origin, bearing(origin, target), maxDistance)
}
