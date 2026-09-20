import { describe, expect, it } from 'vitest'
import { constrainPhoto, fitPhoto, photoWindow, zoomPhoto } from './photo-gestures'

describe('photo navigation and zoom', () => {
  it('zooms around the touched point instead of jumping to the center', () => {
    expect(zoomPhoto(fitPhoto, 2, { x: 100, y: -50 })).toEqual({ scale: 2, x: -100, y: 50 })
  })

  it('keeps a fitted portrait centered horizontally while allowing vertical panning', () => {
    expect(constrainPhoto({ scale: 2, x: 500, y: -500 }, { width: 800, height: 600 }, { width: 400, height: 800 }))
      .toEqual({ scale: 2, x: 0, y: -300 })
  })

  it('resets panning when returning to fit and bounds maximum zoom', () => {
    expect(constrainPhoto({ scale: 0.5, x: 300, y: 500 }, { width: 400, height: 800 }, { width: 1200, height: 800 })).toEqual(fitPhoto)
    expect(zoomPhoto(fitPhoto, 20, { x: 0, y: 0 }).scale).toBe(5)
  })

  it('keeps both wraparound neighbors and bounds the decoded working set', () => {
    expect(photoWindow([6, 5, 4, 3, 2], 0, 8)).toEqual([0, 1, 7, 6, 5])
    expect(photoWindow([6, 5, 4], 0, 1)).toEqual([0])
    expect(photoWindow([], 0, 0)).toEqual([])
  })
})
