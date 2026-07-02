// Whole-UI zoom bounds. webFrame.setZoomFactor takes a multiplier (1 = 100%).
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.0
export const ZOOM_STEP = 0.1

export function clampZoom(z) {
  const n = Number(z)
  if (!Number.isFinite(n)) return 1
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n))
}

// Add `delta`, round to one decimal (kills 0.1+0.2 float drift), then clamp.
export function stepZoom(z, delta) {
  return clampZoom(Math.round((clampZoom(z) + delta) * 10) / 10)
}
