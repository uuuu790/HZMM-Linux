// @vitest-environment happy-dom
// Shared Toggle switch + the ambient-motion pause that keeps the decorative
// infinite animations from burning CPU while nobody is looking at the app.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import Toggle from '../../src/renderer/src/components/common/Toggle.jsx'
import { useAmbientMotion } from '../../src/renderer/src/hooks/useAmbientMotion.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function mount(node) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  mounted.push({ root, el })
  return el
}
afterEach(() => {
  for (const { root, el } of mounted.splice(0)) {
    act(() => root.unmount())
    el.remove()
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Toggle', () => {
  it('exposes switch semantics and reports the next value', () => {
    const onChange = vi.fn()
    const el = mount(<Toggle checked={false} onChange={onChange} label="Minimize to tray" />)
    const sw = el.querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-label')).toBe('Minimize to tray')
    act(() => sw.click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does not let the click bubble to a clickable row behind it', () => {
    const onRow = vi.fn()
    const onChange = vi.fn()
    const el = mount(<div onClick={onRow}><Toggle checked onChange={onChange} size="sm" /></div>)
    act(() => el.querySelector('[role="switch"]').click())
    expect(onChange).toHaveBeenCalledWith(false)
    expect(onRow).not.toHaveBeenCalled()
  })
})

function AmbientHost() {
  useAmbientMotion()
  return null
}

describe('useAmbientMotion', () => {
  const paused = () => document.documentElement.classList.contains('ambient-paused')

  it('pauses after 8s without input and wakes on activity', () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    mount(<AmbientHost />)
    expect(paused()).toBe(false)
    act(() => { vi.advanceTimersByTime(8100) })
    expect(paused()).toBe(true)
    act(() => { window.dispatchEvent(new Event('pointermove')) })
    expect(paused()).toBe(false)
  })

  it('pauses immediately when the window loses focus and resumes on focus', () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    mount(<AmbientHost />)
    focus.mockReturnValue(false)
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(paused()).toBe(true)
    // Hovering an unfocused window must not wake the loops up.
    act(() => { window.dispatchEvent(new Event('pointermove')) })
    expect(paused()).toBe(true)
    focus.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(paused()).toBe(false)
  })

  it('clears the class on unmount', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const el = mount(<AmbientHost />)
    expect(paused()).toBe(true)
    const entry = mounted.find(m => m.el === el)
    act(() => entry.root.unmount())
    mounted.splice(mounted.indexOf(entry), 1)
    el.remove()
    expect(paused()).toBe(false)
  })
})
