import { describe, it, expect } from 'vitest'
import { defaultToValueStr, typedDefaultSeed } from '../../src/renderer/src/utils/widget-helpers'
import { parseLuaArray } from '../../src/renderer/src/utils/config-parser'

describe('defaultToValueStr', () => {
  it('returns null when no default is declared', () => {
    expect(defaultToValueStr({})).toBe(null)
    expect(defaultToValueStr({ default: undefined })).toBe(null)
    expect(defaultToValueStr({ default: null })).toBe(null)
    expect(defaultToValueStr(null)).toBe(null)
  })

  it('serializes array defaults as a Lua array literal (not a bare CSV)', () => {
    // The bug: String(["Fire","Ice"]) === "Fire,Ice", which serializes as
    // broken Lua (`Key = Fire,Ice`). It MUST become a `{...}` literal.
    expect(defaultToValueStr({ type: 'multi-select', default: ['Fire', 'Ice'] }))
      .toBe('{"Fire", "Ice"}')
    expect(defaultToValueStr({ type: 'list', default: [] })).toBe('{}')
  })

  it('array default round-trips through parseLuaArray', () => {
    const arr = ['Fire', 'Ice', 'Poison']
    const str = defaultToValueStr({ type: 'multi-select', default: arr })
    expect(parseLuaArray(str)).toEqual(arr)
  })

  it('keeps floats with at least one decimal', () => {
    expect(defaultToValueStr({ type: 'float', default: 3 })).toBe('3.0')
    expect(defaultToValueStr({ type: 'float', default: 3.5 })).toBe('3.5')
  })

  it('stringifies scalar defaults', () => {
    expect(defaultToValueStr({ type: 'int', default: 42 })).toBe('42')
    expect(defaultToValueStr({ type: 'bool', default: true })).toBe('true')
    expect(defaultToValueStr({ type: 'string', default: 'hi' })).toBe('hi')
  })
})

describe('typedDefaultSeed', () => {
  it('seeds list / multi-select with an empty Lua array', () => {
    expect(typedDefaultSeed('list')).toBe('{}')
    expect(typedDefaultSeed('multi-select')).toBe('{}')
  })
})
