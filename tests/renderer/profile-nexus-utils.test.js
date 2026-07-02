import { describe, it, expect } from 'vitest'
import { classifyProfileMods } from '../../src/renderer/src/hooks/profile-nexus-utils.js'

const profile = {
  enabledModFilenames: ['A.pak', 'B', 'C.pak', 'D'],
  nexusSources: [
    { filename: 'C.pak', modId: 1, fileId: 11, version: '1.0', displayName: 'C Mod' },
    { filename: 'D', modId: 2, fileId: 22, version: null, displayName: 'D Mod' },
  ],
}
const modules = [{ filename: 'A.pak' }, { filename: 'B' }] // C and D are missing

describe('classifyProfileMods', () => {
  it('splits missing mods into auto (has source + premium) and manual', () => {
    const r = classifyProfileMods(profile, modules, true)
    expect(r.missing.sort()).toEqual(['C.pak', 'D'])
    expect(r.auto.map(s => s.modId).sort()).toEqual([1, 2])
    expect(r.manual).toEqual([])
  })

  it('without premium key, sourced mods go to manual', () => {
    const r = classifyProfileMods(profile, modules, false)
    expect(r.auto).toEqual([])
    expect(r.manual.map(s => s.filename).sort()).toEqual(['C.pak', 'D'])
  })

  it('a missing mod with no source is always manual (name only)', () => {
    const p = { enabledModFilenames: ['Z.pak'], nexusSources: [] }
    const r = classifyProfileMods(p, [], true)
    expect(r.manual).toEqual([{ filename: 'Z.pak', displayName: 'Z.pak' }])
  })

  it('nothing missing → empty buckets', () => {
    const r = classifyProfileMods(profile, [{ filename: 'A.pak' }, { filename: 'B' }, { filename: 'C.pak' }, { filename: 'D' }], true)
    expect(r.missing).toEqual([])
    expect(r.auto).toEqual([])
    expect(r.manual).toEqual([])
  })
})
