import { describe, it, expect } from 'vitest'
import {
  normalizeFilename,
  normalizeProfileFilenames,
  modIsInProfile,
} from '../../src/renderer/src/hooks/profile-utils.js'

describe('normalizeFilename', () => {
  it('strips .disabled suffix from PAK', () => {
    expect(normalizeFilename('mymod.pak.disabled')).toBe('mymod.pak')
  })

  it('is case-insensitive for the suffix', () => {
    expect(normalizeFilename('mymod.pak.DISABLED')).toBe('mymod.pak')
    expect(normalizeFilename('mymod.pak.Disabled')).toBe('mymod.pak')
  })

  it('leaves enabled PAK filenames untouched', () => {
    expect(normalizeFilename('mymod.pak')).toBe('mymod.pak')
  })

  it('leaves UE4SS folder names untouched', () => {
    expect(normalizeFilename('MyUe4ssMod')).toBe('MyUe4ssMod')
    expect(normalizeFilename('folder_with_disabled_in_name')).toBe('folder_with_disabled_in_name')
  })

  it('only strips a trailing .disabled, not one in the middle', () => {
    expect(normalizeFilename('mod.disabled.pak')).toBe('mod.disabled.pak')
  })

  it('handles non-string input safely', () => {
    expect(normalizeFilename(null)).toBe('')
    expect(normalizeFilename(undefined)).toBe('')
    expect(normalizeFilename(42)).toBe('')
  })
})

describe('normalizeProfileFilenames', () => {
  it('returns a Set of normalized filenames', () => {
    const set = normalizeProfileFilenames(['a.pak', 'b.pak.disabled', 'CMod'])
    expect(set.has('a.pak')).toBe(true)
    expect(set.has('b.pak')).toBe(true)
    expect(set.has('CMod')).toBe(true)
    expect(set.size).toBe(3)
  })

  it('deduplicates entries that normalize to the same key', () => {
    const set = normalizeProfileFilenames(['dup.pak', 'dup.pak.disabled'])
    expect(set.size).toBe(1)
    expect(set.has('dup.pak')).toBe(true)
  })

  it('returns empty set for non-array input', () => {
    expect(normalizeProfileFilenames(null).size).toBe(0)
    expect(normalizeProfileFilenames(undefined).size).toBe(0)
    expect(normalizeProfileFilenames('not an array').size).toBe(0)
  })
})

describe('modIsInProfile — the actual bug scenarios', () => {
  it('MATCHES enabled PAK when profile has the same .pak', () => {
    const set = normalizeProfileFilenames(['mymod.pak'])
    const mod = { filename: 'mymod.pak', enabled: true, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('MATCHES currently-disabled PAK when profile has the .pak form — the bug case', () => {
    // This is the regression that prompted the fix:
    // Profile was saved with ['mymod.pak'] (enabled state).
    // User later disabled the PAK — on-disk name is now mymod.pak.disabled.
    // Applying the profile must re-enable this mod.
    const set = normalizeProfileFilenames(['mymod.pak'])
    const mod = { filename: 'mymod.pak.disabled', enabled: false, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('DOES NOT MATCH a PAK not in the profile', () => {
    const set = normalizeProfileFilenames(['mymod.pak'])
    const mod = { filename: 'othermod.pak', enabled: true, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(false)
  })

  it('MATCHES UE4SS mod by folder name', () => {
    const set = normalizeProfileFilenames(['MyUe4ssMod'])
    const mod = { filename: 'MyUe4ssMod', enabled: false, type: 'UE4SS' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('handles an old profile that accidentally stored a .disabled entry', () => {
    // Defensive — shouldn't happen since handleCreateProfile only stores
    // enabled mods, but normalize-on-read means an import from an older
    // version still works.
    const set = normalizeProfileFilenames(['mymod.pak.disabled'])
    const mod = { filename: 'mymod.pak', enabled: true, type: 'PAK' }
    expect(modIsInProfile(set, mod)).toBe(true)
  })

  it('safely returns false for invalid mod object', () => {
    const set = normalizeProfileFilenames(['mymod.pak'])
    expect(modIsInProfile(set, null)).toBe(false)
    expect(modIsInProfile(set, {})).toBe(false)
    expect(modIsInProfile(set, { filename: null })).toBe(false)
  })

  it('safely returns false for invalid profile set', () => {
    const mod = { filename: 'mymod.pak' }
    expect(modIsInProfile(null, mod)).toBe(false)
  })
})
