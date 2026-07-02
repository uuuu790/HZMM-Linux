import { describe, it, expect } from 'vitest'
import { clampZoom, stepZoom, ZOOM_MIN, ZOOM_MAX } from '../../src/renderer/src/utils/zoom.js'

describe('clampZoom', () => {
  it('clamps below/above the range', () => {
    expect(clampZoom(0.3)).toBe(ZOOM_MIN)
    expect(clampZoom(5)).toBe(ZOOM_MAX)
  })
  it('passes through an in-range value', () => {
    expect(clampZoom(1.3)).toBe(1.3)
  })
  it('returns 1 for non-finite / garbage input', () => {
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom('x')).toBe(1)
    expect(clampZoom(undefined)).toBe(1)
  })
})

describe('stepZoom', () => {
  it('steps by delta then clamps', () => {
    expect(stepZoom(1, 0.1)).toBe(1.1)
    expect(stepZoom(1, -0.1)).toBe(0.9)
    expect(stepZoom(ZOOM_MAX, 0.1)).toBe(ZOOM_MAX)
    expect(stepZoom(ZOOM_MIN, -0.1)).toBe(ZOOM_MIN)
  })
  it('avoids floating-point drift', () => {
    expect(stepZoom(1.1, 0.1)).toBe(1.2)
  })
})
