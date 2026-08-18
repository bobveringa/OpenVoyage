import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { isNativePlatform } from '@/native/platform'

const PULL_TRIGGER_DISTANCE = 72
const MAX_PULL_DISTANCE = 120
const PULL_RESISTANCE = 0.5
const INDICATOR_HEIGHT = 56

// Leaflet drives its own drag/pan/zoom touch handling on this element; a
// pull gesture that starts on the map must be left alone rather than
// hijacked into a page refresh (see TripLeafletMap in trip-detail-page.tsx).
const IGNORE_GESTURE_SELECTOR = '.trip-leaflet-map'

type PullPhase = 'idle' | 'pulling' | 'ready' | 'refreshing'

export function PullToRefresh({ children }: { children: ReactNode }) {
  const [enabled] = useState(isNativePlatform)
  const [phase, setPhase] = useState<PullPhase>('idle')
  const [pullDistance, setPullDistance] = useState(0)
  const [animated, setAnimated] = useState(false)

  const phaseRef = useRef<PullPhase>('idle')
  const trackingRef = useRef(false)
  const ignoredRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!enabled) {
      return
    }

    const root = document.documentElement
    const previousOverscroll = root.style.overscrollBehaviorY
    root.style.overscrollBehaviorY = 'contain'

    function setPhaseState(next: PullPhase) {
      phaseRef.current = next
      setPhase(next)
    }

    function reset() {
      trackingRef.current = false
      setAnimated(true)
      setPullDistance(0)
      setPhaseState('idle')
    }

    function handleTouchStart(event: TouchEvent) {
      if (phaseRef.current === 'refreshing') {
        return
      }

      const touch = event.touches[0]
      if (!touch) {
        return
      }

      const target = event.target
      ignoredRef.current =
        target instanceof Element && Boolean(target.closest(IGNORE_GESTURE_SELECTOR))
      trackingRef.current = !ignoredRef.current && window.scrollY === 0
      startRef.current = { x: touch.clientX, y: touch.clientY }
    }

    function handleTouchMove(event: TouchEvent) {
      if (!trackingRef.current) {
        return
      }

      const touch = event.touches[0]
      if (!touch) {
        return
      }

      const deltaX = touch.clientX - startRef.current.x
      const deltaY = touch.clientY - startRef.current.y

      if (window.scrollY > 0 || deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY)) {
        reset()
        return
      }

      event.preventDefault()
      setAnimated(false)
      const distance = Math.min(deltaY * PULL_RESISTANCE, MAX_PULL_DISTANCE)
      setPullDistance(distance)
      setPhaseState(distance >= PULL_TRIGGER_DISTANCE ? 'ready' : 'pulling')
    }

    function handleTouchEnd() {
      if (!trackingRef.current) {
        return
      }
      trackingRef.current = false
      setAnimated(true)

      if (phaseRef.current === 'ready') {
        setPhaseState('refreshing')
        setPullDistance(INDICATOR_HEIGHT)
        window.location.reload()
        return
      }

      setPullDistance(0)
      setPhaseState('idle')
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      root.style.overscrollBehaviorY = previousOverscroll
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled])

  if (!enabled) {
    return <>{children}</>
  }

  const rotation = Math.min((pullDistance / PULL_TRIGGER_DISTANCE) * 180, 180)

  return (
    <div
      className={cn(animated && 'transition-transform duration-200 ease-out')}
      style={pullDistance > 0 ? { transform: `translateY(${pullDistance}px)` } : undefined}
    >
      <div
        aria-hidden="true"
        className="flex items-center justify-center"
        style={{ height: INDICATOR_HEIGHT, marginTop: -INDICATOR_HEIGHT }}
      >
        <span
          className={cn(
            'grid size-9 place-items-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors',
            phase === 'ready' && 'text-primary',
          )}
        >
          <RefreshCw
            className={cn('size-4', phase === 'refreshing' && 'animate-spin')}
            style={phase === 'refreshing' ? undefined : { transform: `rotate(${rotation}deg)` }}
          />
        </span>
      </div>
      {children}
    </div>
  )
}
