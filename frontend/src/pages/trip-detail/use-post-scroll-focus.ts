import { useEffect, useRef } from 'react'

type PostScrollElementsRef = {
  current: Map<string, HTMLElement>
}

export type PostScrollRootRef = {
  current: HTMLElement | null
}

type PostScrollAxis = 'x' | 'y'

export function setPostScrollElement(
  postElementsRef: PostScrollElementsRef,
  postId: string,
  element: HTMLElement | null,
) {
  if (!element) {
    postElementsRef.current.delete(postId)
    return
  }

  element.dataset.tripPostId = postId
  postElementsRef.current.set(postId, element)
}

export function usePostScrollFocus({
  axis,
  enabled,
  firstPostId,
  onFocusedPostChange,
  postElementsRef,
  postIds,
  rootRef,
}: {
  axis: PostScrollAxis
  enabled: boolean
  firstPostId: string | null
  onFocusedPostChange: (postId: string | null) => void
  postElementsRef: PostScrollElementsRef
  postIds: readonly string[]
  rootRef?: PostScrollRootRef
}) {
  const latestFocusedPostChangeRef = useRef(onFocusedPostChange)

  useEffect(() => {
    latestFocusedPostChangeRef.current = onFocusedPostChange
  }, [onFocusedPostChange])

  useEffect(() => {
    if (!enabled) {
      latestFocusedPostChangeRef.current(null)
      return undefined
    }

    if (typeof window === 'undefined') {
      return undefined
    }

    const elements = postIds
      .map((postId) => postElementsRef.current.get(postId) ?? null)
      .filter((element): element is HTMLElement => Boolean(element))
    const rootElement =
      rootRef?.current ?? getNearestScrollAncestor(elements[0] ?? null, axis)
    const scrollTarget: HTMLElement | Window = rootElement ?? window
    let animationFrameId: number | null = null

    function updateFocusedPost() {
      animationFrameId = null
      const nextPostId = getFocusedPostIdFromScrollPosition({
        axis,
        elements,
        postIds,
        rootElement,
      })

      latestFocusedPostChangeRef.current(
        nextPostId === firstPostId ? null : nextPostId,
      )
    }

    function scheduleFocusedPostUpdate() {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(updateFocusedPost)
    }

    scheduleFocusedPostUpdate()
    scrollTarget.addEventListener('scroll', scheduleFocusedPostUpdate, {
      passive: true,
    })
    window.addEventListener('resize', scheduleFocusedPostUpdate)

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleFocusedPostUpdate)
    if (resizeObserver) {
      for (const element of elements) {
        resizeObserver.observe(element)
      }
      if (rootElement) {
        resizeObserver.observe(rootElement)
      }
    }

    return () => {
      scrollTarget.removeEventListener('scroll', scheduleFocusedPostUpdate)
      window.removeEventListener('resize', scheduleFocusedPostUpdate)
      resizeObserver?.disconnect()
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
    }
  }, [axis, enabled, firstPostId, postElementsRef, postIds, rootRef])
}

function getFocusedPostIdFromScrollPosition({
  axis,
  elements,
  postIds,
  rootElement,
}: {
  axis: PostScrollAxis
  elements: readonly HTMLElement[]
  postIds: readonly string[]
  rootElement: HTMLElement | null
}) {
  if (elements.length === 0) {
    return null
  }

  const rootRange = getScrollRootRange(rootElement, axis)
  if (isScrollRootAtEnd(rootElement, axis)) {
    return postIds[postIds.length - 1] ?? null
  }

  const activationPoint = rootRange.start + rootRange.size * 0.5
  let nextPostId: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const element of elements) {
    const postId = element.dataset.tripPostId
    if (!postId) {
      continue
    }

    const elementRange = getElementRange(element, axis)
    const visibleSize =
      Math.min(rootRange.end, elementRange.end) -
      Math.max(rootRange.start, elementRange.start)
    if (visibleSize <= 0) {
      continue
    }

    const elementCenter = elementRange.start + elementRange.size * 0.5
    const distance = Math.abs(elementCenter - activationPoint)
    if (distance < bestDistance) {
      nextPostId = postId
      bestDistance = distance
    }
  }

  return nextPostId
}

function getScrollRootRange(
  rootElement: HTMLElement | null,
  axis: PostScrollAxis,
) {
  const rootRect = rootElement?.getBoundingClientRect()
  const start = axis === 'x' ? rootRect?.left ?? 0 : rootRect?.top ?? 0
  const end =
    axis === 'x'
      ? rootRect?.right ?? window.innerWidth
      : rootRect?.bottom ?? window.innerHeight

  return {
    end,
    size: end - start,
    start,
  }
}

function getElementRange(element: HTMLElement, axis: PostScrollAxis) {
  const rect = element.getBoundingClientRect()
  const start = axis === 'x' ? rect.left : rect.top
  const end = axis === 'x' ? rect.right : rect.bottom

  return {
    end,
    size: end - start,
    start,
  }
}

function isScrollRootAtEnd(
  rootElement: HTMLElement | null,
  axis: PostScrollAxis,
) {
  if (!rootElement) {
    return false
  }

  const scrollOffset = axis === 'x' ? rootElement.scrollLeft : rootElement.scrollTop
  const clientSize = axis === 'x' ? rootElement.clientWidth : rootElement.clientHeight
  const scrollSize = axis === 'x' ? rootElement.scrollWidth : rootElement.scrollHeight

  if (scrollSize <= clientSize + 2) {
    return false
  }

  return scrollOffset + clientSize >= scrollSize - 2
}

function getNearestScrollAncestor(
  element: HTMLElement | null,
  axis: PostScrollAxis,
) {
  let currentElement = element?.parentElement ?? null
  while (currentElement) {
    const style = window.getComputedStyle(currentElement)
    const overflow = axis === 'x' ? style.overflowX : style.overflowY
    const isScrollable =
      overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay'
    const hasScrollableContent =
      axis === 'x'
        ? currentElement.scrollWidth > currentElement.clientWidth
        : currentElement.scrollHeight > currentElement.clientHeight

    if (isScrollable && hasScrollableContent) {
      return currentElement
    }

    currentElement = currentElement.parentElement
  }

  return null
}
