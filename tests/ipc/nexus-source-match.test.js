import { describe, it, expect } from 'vitest'
import { matchSourcesToMods } from '../../src/main/ipc/nexus-install-tracker.js'

const receipts = [
  { modId: 10, fileId: 100, version: '1.2', localMods: [{ name: 'CoolPak', modType: 'PAK' }] },
  { modId: 20, fileId: 200, version: null, localMods: [{ name: 'ScriptMod', modType: 'UE4SS' }] },
]
const mods = [
  { filename: 'CoolPak.pak', type: 'PAK', title: 'Cool Pak' },
  { filename: 'ScriptMod', type: 'UE4SS', title: 'Script Mod' },
  { filename: 'HandMade.pak', type: 'PAK', title: 'Hand Made' }, // no receipt
]

describe('matchSourcesToMods', () => {
  it('maps enabled filenames to their Nexus receipt source', () => {
    const out = matchSourcesToMods(receipts, mods, ['CoolPak.pak', 'ScriptMod'])
    expect(out).toEqual([
      { filename: 'CoolPak.pak', modId: 10, fileId: 100, version: '1.2', displayName: 'Cool Pak' },
      { filename: 'ScriptMod', modId: 20, fileId: 200, version: null, displayName: 'Script Mod' },
    ])
  })

  it('omits mods with no matching receipt (manual installs)', () => {
    const out = matchSourcesToMods(receipts, mods, ['HandMade.pak'])
    expect(out).toEqual([])
  })

  it('normalizes a .disabled wanted filename before matching', () => {
    const out = matchSourcesToMods(receipts, mods, ['CoolPak.pak.disabled'])
    expect(out).toEqual([{ filename: 'CoolPak.pak', modId: 10, fileId: 100, version: '1.2', displayName: 'Cool Pak' }])
  })

  it('returns [] for empty/invalid input', () => {
    expect(matchSourcesToMods([], mods, ['x'])).toEqual([])
    expect(matchSourcesToMods(receipts, mods, [])).toEqual([])
  })
})
