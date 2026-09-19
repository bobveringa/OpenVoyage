import { describe, expect, it, vi } from 'vitest'

import { scrollPostElementToCenter } from './use-post-scroll-focus'

function setRect(
  element: HTMLElement,
  rect: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>,
) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom: rect.top + rect.height,
    height: rect.height,
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
    width: rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  })
}

describe('scrollPostElementToCenter', () => {
  it('centers a post vertically inside its scroll container', () => {
    const rootElement = document.createElement('div')
    const postElement = document.createElement('article')
    const scrollTo = vi.fn()
    rootElement.scrollTo = scrollTo
    rootElement.scrollTop = 120
    setRect(rootElement, { height: 600, left: 0, top: 100, width: 400 })
    setRect(postElement, { height: 200, left: 0, top: 700, width: 400 })

    scrollPostElementToCenter({
      axis: 'y',
      behavior: 'smooth',
      element: postElement,
      rootElement,
    })

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 520 })
  })

  it('centers a post horizontally inside its scroll container', () => {
    const rootElement = document.createElement('div')
    const postElement = document.createElement('article')
    const scrollTo = vi.fn()
    rootElement.scrollTo = scrollTo
    rootElement.scrollLeft = 80
    setRect(rootElement, { height: 300, left: 20, top: 0, width: 400 })
    setRect(postElement, { height: 200, left: 520, top: 0, width: 200 })

    scrollPostElementToCenter({
      axis: 'x',
      behavior: 'auto',
      element: postElement,
      rootElement,
    })

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', left: 480 })
  })
})
