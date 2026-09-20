export type PhotoTransform = { scale: number; x: number; y: number }
export const fitPhoto: PhotoTransform = { scale: 1, x: 0, y: 0 }

export function constrainPhoto(
  transform: PhotoTransform,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): PhotoTransform {
  const scale = Math.min(5, Math.max(1, transform.scale))
  const fit = Math.min(viewport.width / image.width, viewport.height / image.height)
  const maxX = Math.max(0, (image.width * fit * scale - viewport.width) / 2)
  const maxY = Math.max(0, (image.height * fit * scale - viewport.height) / 2)
  return { scale, x: Math.max(-maxX, Math.min(maxX, transform.x)), y: Math.max(-maxY, Math.min(maxY, transform.y)) }
}

export function zoomPhoto(transform: PhotoTransform, scale: number, point: { x: number; y: number }): PhotoTransform {
  const nextScale = Math.min(5, Math.max(1, scale))
  const ratio = nextScale / transform.scale
  return { scale: nextScale, x: point.x - (point.x - transform.x) * ratio, y: point.y - (point.y - transform.y) * ratio }
}

// Keep a small working set of mounted images, including both neighbors. This
// reuses decoded images even when the server does not allow HTTP caching.
export function photoWindow(previous: number[], active: number, count: number): number[] {
  if (!count) return []
  return [...new Set([active, (active + 1) % count, (active - 1 + count) % count, ...previous.filter(index => index >= 0 && index < count)])].slice(0, 5)
}
