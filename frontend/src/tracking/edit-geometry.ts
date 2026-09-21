export type Coordinate = readonly [number, number]
export const EARTH_RADIUS_METERS = 6_371_000
export const MAX_MOVE_DISTANCE_METERS = 400
export const INSERT_DISTANCE_RATIO = 0.25
export const MIN_INSERT_DISTANCE_METERS = 20
export const MAX_INSERT_DISTANCE_METERS = 200
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
export function segmentDistance(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
) {
  const length = distance(a, b)
  if (length < 0.001) return distance(point, a)
  const delta = distance(a, point) / EARTH_RADIUS_METERS,
    angle = bearing(a, point) - bearing(a, b)
  const along =
    Math.atan2(Math.sin(delta) * Math.cos(angle), Math.cos(delta)) *
    EARTH_RADIUS_METERS
  if (along <= 0) return distance(point, a)
  if (along >= length) return distance(point, b)
  return (
    Math.abs(
      Math.asin(Math.max(-1, Math.min(1, Math.sin(delta) * Math.sin(angle)))),
    ) * EARTH_RADIUS_METERS
  )
}
export const insertDistanceLimit = (a: Coordinate, b: Coordinate) =>
  Math.min(
    MAX_INSERT_DISTANCE_METERS,
    Math.max(
      MIN_INSERT_DISTANCE_METERS,
      distance(a, b) * INSERT_DISTANCE_RATIO,
    ),
  )
export function clampMove(
  origin: Coordinate,
  target: Coordinate,
): [number, number] {
  return distance(origin, target) <= MAX_MOVE_DISTANCE_METERS
    ? [...target]
    : destination(origin, bearing(origin, target), MAX_MOVE_DISTANCE_METERS)
}
