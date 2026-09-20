import { Loader2, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

import type { PostMedia } from './models'
import { constrainPhoto, fitPhoto, zoomPhoto, type PhotoTransform } from './photo-gestures'

type Point = { x: number; y: number }

export function LightboxPhoto({ media, active, controlsVisible, onNavigate, onToggleControls }: {
  media: PostMedia
  active: boolean
  controlsVisible: boolean
  onNavigate: (offset: number) => void
  onToggleControls: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<{ start: Point; previous: Point; distance: number; moved: boolean; multi: boolean } | null>(null)
  const transformRef = useRef<PhotoTransform>(fitPhoto)
  const [transform, setTransform] = useState(fitPhoto)
  const [dragging, setDragging] = useState(false)
  const [swipe, setSwipe] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const lastTap = useRef<{ time: number; point: Point } | null>(null)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function update(next: PhotoTransform) {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport) return
    const bounded = constrainPhoto(next, { width: viewport.clientWidth, height: viewport.clientHeight }, {
      width: image?.naturalWidth || viewport.clientWidth || 1,
      height: image?.naturalHeight || viewport.clientHeight || 1,
    })
    transformRef.current = bounded
    setTransform(bounded)
  }

  function zoom(scale: number, point: Point = { x: 0, y: 0 }) {
    update(zoomPhoto(transformRef.current, scale, point))
  }

  useEffect(() => {
    function reset() {
      transformRef.current = fitPhoto
      setTransform(fitPhoto)
      setSwipe(0)
      setDragging(false)
      pointers.current.clear()
      gesture.current = null
      lastTap.current = null
      if (tapTimer.current) clearTimeout(tapTimer.current)
    }
    reset()
    const observer = new ResizeObserver(reset)
    if (viewportRef.current) observer.observe(viewportRef.current)
    return () => { observer.disconnect(); if (tapTimer.current) clearTimeout(tapTimer.current) }
  }, [active])

  function point(event: PointerEvent): Point {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
  }

  function pair() {
    const [a, b] = [...pointers.current.values()]
    return { center: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 }
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, point(event))
    const { center, distance } = pair()
    gesture.current = { start: center, previous: center, distance, moved: false, multi: pointers.current.size > 1 }
    if (pointers.current.size > 1) {
      if (tapTimer.current) clearTimeout(tapTimer.current)
      lastTap.current = null
      setSwipe(0)
    }
    setDragging(true)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current
    if (!current || !pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, point(event))
    const { center, distance } = pair()
    const dx = center.x - current.previous.x
    const dy = center.y - current.previous.y
    if (Math.hypot(center.x - current.start.x, center.y - current.start.y) > 8) current.moved = true
    if (pointers.current.size > 1) {
      const next = zoomPhoto(transformRef.current, transformRef.current.scale * distance / (current.distance || distance || 1), current.previous)
      update({ ...next, x: next.x + dx, y: next.y + dy })
    } else if (transformRef.current.scale > 1) {
      update({ ...transformRef.current, x: transformRef.current.x + dx, y: transformRef.current.y + dy })
    } else if (!current.multi) {
      setSwipe((center.x - current.start.x) * 0.65)
    }
    current.previous = center
    current.distance = distance
  }

  function end(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current
    if (!current || !pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    if (pointers.current.size) {
      const { center, distance } = pair()
      gesture.current = { start: center, previous: center, distance, moved: true, multi: true }
      return
    }
    gesture.current = null
    setDragging(false)
    setSwipe(0)
    if (cancelled || current.multi) return
    const endPoint = point(event)
    const dx = endPoint.x - current.start.x
    const dy = endPoint.y - current.start.y
    if (transformRef.current.scale === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      onNavigate(dx > 0 ? -1 : 1)
    } else if (!current.moved && Math.hypot(dx, dy) < 8) {
      const previous = lastTap.current
      if (previous && Date.now() - previous.time < 300 && Math.hypot(endPoint.x - previous.point.x, endPoint.y - previous.point.y) < 35) {
        if (tapTimer.current) clearTimeout(tapTimer.current)
        lastTap.current = null
        zoom(transformRef.current.scale > 1 ? 1 : 2.5, endPoint)
      } else {
        lastTap.current = { time: Date.now(), point: endPoint }
        tapTimer.current = setTimeout(onToggleControls, 300)
      }
    }
  }

  return (
    <>
      <div ref={viewportRef} className="absolute inset-0 overflow-hidden" style={{ touchAction: 'none', cursor: transform.scale > 1 ? dragging ? 'grabbing' : 'grab' : 'zoom-in' }}
        onPointerDown={start} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)}
        onLostPointerCapture={event => end(event, true)}>
        <div className="absolute inset-0 motion-reduce:!transition-none" style={{ transform: `translate3d(${transform.x + swipe}px, ${transform.y}px, 0) scale(${transform.scale})`, transition: dragging ? 'none' : 'transform 220ms ease-out' }}>
          {media.thumbnail && <img alt="" draggable={false} src={media.thumbnail} className="absolute h-full w-full select-none object-contain" />}
          <img key={attempt} ref={imageRef} alt={media.alt} draggable={false} src={media.src} decoding="async" fetchPriority={active ? 'high' : 'low'}
            onLoad={() => { setStatus('ready'); update(transformRef.current) }} onError={() => setStatus('error')}
            className="absolute h-full w-full select-none object-contain transition-opacity duration-300 motion-reduce:transition-none"
            style={{ opacity: status === 'ready' ? 1 : 0 }} />
        </div>
      </div>
      {active && status === 'loading' && <div role="status" className="pointer-events-none absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-xs"><Loader2 className="size-4 animate-spin" />Loading photo…</div>}
      {active && status === 'error' && <button type="button" className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl bg-slate-900/90 p-4 text-sm" onClick={() => { setStatus('loading'); setAttempt(value => value + 1) }}><RefreshCw className="size-4" />Unable to load photo. Retry</button>}
      {active && controlsVisible && <div className="absolute bottom-[max(4.5rem,calc(env(safe-area-inset-bottom)+4rem))] left-1/2 z-20 flex -translate-x-1/2 items-center rounded-full border border-white/15 bg-black/65 shadow-lg">
        <button aria-label="Zoom out" type="button" className="grid size-11 place-items-center disabled:opacity-35" disabled={transform.scale <= 1} onClick={() => zoom(transform.scale / 1.5)}><ZoomOut className="size-5" /></button>
        <button aria-label="Reset zoom" type="button" className="h-11 min-w-14 text-xs tabular-nums" onClick={() => zoom(1)}>{Math.round(transform.scale * 100)}%</button>
        <button aria-label="Zoom in" type="button" className="grid size-11 place-items-center disabled:opacity-35" disabled={transform.scale >= 5} onClick={() => zoom(transform.scale * 1.5)}><ZoomIn className="size-5" /></button>
      </div>}
    </>
  )
}
