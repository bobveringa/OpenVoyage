import { useCallback, useEffect, useRef, type RefObject } from 'react'

type Direction = -1 | 1
type Options = {
  readerRef: RefObject<HTMLDivElement | null>
  blocked: boolean
  canPrevious: boolean
  canNext: boolean
  entryDirection: Direction | 0
  onPrevious: () => void
  onNext: () => void
}

// Lock intent once, rather than rejecting an otherwise horizontal thumb swipe
// when its accumulated vertical drift crosses a fixed pixel threshold.
export function usePostSwipe(options: Options) {
  const latest = useRef(options)
  const navigateRef = useRef<(direction: Direction) => void>(() => {})
  useEffect(() => { latest.current = options })

  const { readerRef, entryDirection } = options
  useEffect(() => {
    const reader = readerRef.current
    const stage = reader?.parentElement
    if (!reader || !stage) return

    let gesture: { id: number; x: number; y: number; time: number; axis: 'pending' | 'horizontal' | 'vertical' } | null = null
    let offset = 0
    let width = reader.clientWidth
    let animation: Animation | null = null
    let departing = false
    let disposed = false
    let suppressClickUntil = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const allowed = (direction: Direction) => direction === 1 ? latest.current.canNext : latest.current.canPrevious

    function clearHint() { delete stage!.dataset.swipe }

    function reset() {
      gesture = null
      animation?.cancel()
      reader!.style.transform = ''
      reader!.style.willChange = ''
      clearHint()
      if (offset && !reducedMotion.matches) {
        animation = reader!.animate([
          { transform: `translate3d(${offset}px,0,0)` },
          { transform: 'translate3d(0,0,0)' },
        ], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
      offset = 0
    }

    function navigate(direction: Direction) {
      if (departing || latest.current.blocked || !allowed(direction)) return
      departing = true
      gesture = null
      animation?.cancel()
      const complete = () => {
        if (disposed) return
        if (direction === 1) latest.current.onNext()
        else latest.current.onPrevious()
      }
      if (reducedMotion.matches) {
        complete()
        return
      }
      reader!.style.willChange = 'transform'
      animation = reader!.animate([
        { transform: `translate3d(${offset}px,0,0)`, opacity: 1 },
        { transform: `translate3d(${-direction * width}px,0,0)`, opacity: 0.5 },
      ], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
      void animation.finished.then(complete, () => {})
    }
    navigateRef.current = navigate

    if (entryDirection && !reducedMotion.matches) {
      animation = reader.animate([
        { transform: `translate3d(${entryDirection * 48}px,0,0)`, opacity: 0.6 },
        { transform: 'translate3d(0,0,0)', opacity: 1 },
      ], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' })
    }

    function onStart(event: TouchEvent) {
      if (departing) return
      const target = event.target
      if (latest.current.blocked || event.touches.length !== 1 || !(target instanceof Element)) {
        reset()
        return
      }
      const interactive = target.closest('button, a, input, textarea, select, video, [contenteditable], [role="dialog"]')
      if (interactive && !target.closest('[data-post-gallery]')) return
      animation?.cancel()
      reader!.style.transform = ''
      offset = 0
      suppressClickUntil = 0
      width = reader!.clientWidth
      const touch = event.touches[0]
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: performance.now(), axis: 'pending' }
    }

    function onMove(event: TouchEvent) {
      if (!gesture || departing) return
      if (event.touches.length !== 1 || latest.current.blocked) { reset(); return }
      const touch = Array.from(event.touches).find((item) => item.identifier === gesture!.id)
      if (!touch) { reset(); return }
      const dx = touch.clientX - gesture.x
      const dy = touch.clientY - gesture.y
      if (gesture.axis === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return
        if (Math.abs(dx) > Math.abs(dy) * 1.15) gesture.axis = 'horizontal'
        else if (Math.abs(dy) > Math.abs(dx)) gesture.axis = 'vertical'
        else return
      }
      if (gesture.axis !== 'horizontal') return
      // This local non-passive listener claims only horizontal gestures. Vertical
      // scrolling and pinch zoom remain browser-owned (including on Android).
      if (!event.cancelable) { reset(); return }
      event.preventDefault()
      suppressClickUntil = performance.now() + 450
      const direction = dx < 0 ? 1 : -1
      offset = Math.max(-width, Math.min(width, dx * (allowed(direction) ? 1 : 0.18)))
      stage!.dataset.swipe = direction === 1 ? 'next' : 'previous'
      if (!reducedMotion.matches) {
        reader!.style.willChange = 'transform'
        reader!.style.transform = `translate3d(${offset}px,0,0)`
      }
    }

    function onEnd(event: TouchEvent) {
      if (!gesture || departing) return
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === gesture!.id)
      if (!touch || event.touches.length || gesture.axis !== 'horizontal') { reset(); return }
      if (event.cancelable) event.preventDefault()
      suppressClickUntil = performance.now() + 450
      const distance = touch.clientX - gesture.x
      const speed = Math.abs(distance) / Math.max(1, performance.now() - gesture.time)
      const direction = distance < 0 ? 1 : -1
      const committed = Math.abs(distance) >= Math.min(96, width * 0.22)
        || (Math.abs(distance) >= 28 && speed >= 0.45)
      gesture = null
      if (committed && allowed(direction) && !latest.current.blocked) navigate(direction)
      else reset()
    }

    function onCancel() { if (!departing) reset() }
    function onClick(event: MouseEvent) {
      if (departing || performance.now() < suppressClickUntil) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    reader.addEventListener('touchstart', onStart, { passive: true })
    reader.addEventListener('touchmove', onMove, { passive: false })
    reader.addEventListener('touchend', onEnd, { passive: false })
    reader.addEventListener('touchcancel', onCancel)
    reader.addEventListener('click', onClick, true)
    window.addEventListener('resize', onCancel)
    return () => {
      disposed = true
      animation?.cancel()
      reader.style.transform = ''
      reader.style.willChange = ''
      clearHint()
      reader.removeEventListener('touchstart', onStart)
      reader.removeEventListener('touchmove', onMove)
      reader.removeEventListener('touchend', onEnd)
      reader.removeEventListener('touchcancel', onCancel)
      reader.removeEventListener('click', onClick, true)
      window.removeEventListener('resize', onCancel)
    }
  }, [entryDirection, readerRef])

  return useCallback((direction: Direction) => navigateRef.current(direction), [])
}
