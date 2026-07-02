import { describe, it, expect } from 'vitest'
import { Binary } from 'lucide-react'
import { MOD_ICONS, getModIcon } from '../../src/renderer/src/constants/modIcons.js'

describe('getModIcon', () => {
  it('returns the PAK icon for a PAK mod', () => {
    expect(getModIcon({ type: 'PAK' })).toBe(MOD_ICONS.PAK)
  })

  it('returns the UE4SS icon for a lua-subtype UE4SS mod', () => {
    expect(getModIcon({ type: 'UE4SS', subtype: 'lua' })).toBe(MOD_ICONS.UE4SS)
  })

  it('returns the UE4SS icon for a UE4SS mod with no subtype (back-compat)', () => {
    expect(getModIcon({ type: 'UE4SS' })).toBe(MOD_ICONS.UE4SS)
  })

  it('returns the CPP icon for a cpp-subtype UE4SS mod', () => {
    expect(getModIcon({ type: 'UE4SS', subtype: 'cpp' })).toBe(MOD_ICONS.CPP)
  })

  it('CPP icon uses an amber accent distinct from PAK/UE4SS', () => {
    expect(MOD_ICONS.CPP.iconColor).toBe('text-amber-500')
    expect(MOD_ICONS.CPP.icon).toBe(Binary)
  })

  it('returns the default icon for an unknown mod type', () => {
    expect(getModIcon({ type: 'SOMETHING_ELSE' })).toBe(MOD_ICONS.default)
  })
})
