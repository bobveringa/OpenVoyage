import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import type { Stop } from '@/pages/trip-detail/models'
import { placementForGap } from './stop-timeline-utils'

const LONG_PRESS_MS = 400

type Drag = { stopId: string; from: number; gap: number; pointerId: number }

/**
 * Drag to reorder with a handle. A mouse drags right away; a finger drags
 * after a long press. Arrow keys on the handle move the stop one place.
 */
export function useStopDrag({
  disabled,
  listRef,
  onMove,
  stops,
}: {
  disabled: boolean
  listRef: React.RefObject<HTMLElement | null>
  onMove: (stopId: string, placement: { after_stop_id: string | null }) => void
  stops: readonly Stop[]
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  const focusAfterMoveRef = useRef<string | null>(null)
  const ids = stops.map((stop) => stop.id)

  // Moving the row re-renders the list; keep focus on the moved stop's handle.
  useEffect(() => {
    const stopId = focusAfterMoveRef.current
    if (!stopId) return
    focusAfterMoveRef.current = null
    listRef.current?.querySelector<HTMLElement>(`[data-stop-row="${stopId}"] [data-drag-handle]`)?.focus()
  }, [stops, listRef])

  function gapAt(clientY: number) {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-stop-row]') ?? [])]
    const index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect()
      return clientY < rect.top + rect.height / 2
    })
    return index === -1 ? rows.length : index
  }

  function move(stopId: string, from: number, gap: number) {
    const placement = placementForGap(ids, from, gap)
    if (!placement) return
    const to = gap > from ? gap - 1 : gap
    setAnnouncement(`${stops[from]!.title} moved to position ${to + 1} of ${stops.length}.`)
    focusAfterMoveRef.current = stopId
    onMove(stopId, placement)
  }

  function clearPress() {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer)
    pressRef.current = null
  }

  function handleProps(stop: Stop, index: number) {
    const start = (pointerId: number, target: HTMLElement) => {
      // Capture keeps the moves coming while the finger leaves the handle.
      try { target.setPointerCapture(pointerId) } catch { /* the pointer is already gone */ }
      navigator.vibrate?.(10)
      setDrag({ stopId: stop.id, from: index, gap: index, pointerId })
    }
    return {
      'aria-label': `Move ${stop.title}`,
      'aria-roledescription': 'drag handle',
      'data-drag-handle': '',
      disabled,
      title: 'Drag to move, or use the arrow keys',
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (drag && event.key === 'Escape') { setDrag(null); return }
        if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); move(stop.id, index, index - 1) }
        if (event.key === 'ArrowDown' && index < stops.length - 1) { event.preventDefault(); move(stop.id, index, index + 2) }
      },
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (disabled || event.button !== 0) return
        const target = event.currentTarget
        const pointerId = event.pointerId
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
          event.preventDefault()
          start(pointerId, target)
          return
        }
        pressRef.current = {
          timer: window.setTimeout(() => { pressRef.current = null; start(pointerId, target) }, LONG_PRESS_MS),
          x: event.clientX,
          y: event.clientY,
        }
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const press = pressRef.current
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) clearPress()
        if (drag && event.pointerId === drag.pointerId) {
          const gap = gapAt(event.clientY)
          if (gap !== drag.gap) setDrag({ ...drag, gap })
        }
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        clearPress()
        if (drag && event.pointerId === drag.pointerId) {
          setDrag(null)
          move(drag.stopId, drag.from, drag.gap)
        }
      },
      onPointerCancel: () => { clearPress(); setDrag(null) },
      onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
      type: 'button' as const,
    }
  }

  return {
    announcement,
    draggingStopId: drag?.stopId ?? null,
    // The gap the stop would land in, unless that's where it already is.
    dropGap: drag && placementForGap(ids, drag.from, drag.gap) ? drag.gap : null,
    handleProps,
  }
}

