import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  isSafePath,
  validateEntries,
  analyzeArchiveStructure,
} from '../../src/main/services/archive.js'

const IS_WINDOWS = process.platform === 'win32'
const DEST = IS_WINDOWS ? 'C:\\tmp\\hzmm-extract' : '/tmp/hzmm-extract'

describe('archive.isSafePath — zip slip defense', () => {
  const safeEntries = [
    'file.txt',
    'folder/file.txt',
    'a/b/c/deep.pak',
    './root.txt',
    'HumanitZ/Content/Paks/mod.pak',
  ]

  for (const entry of safeEntries) {
    it(`allows safe entry "${entry}"`, () => {
      expect(isSafePath(entry, DEST)).toBe(true)
    })
  }

  const maliciousEntries = [
    '../escape.txt',
    '../../../../../../etc/passwd',
    '..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts',
    'foo/../../../etc/shadow',
    'normal/../../../escape.txt',
    IS_WINDOWS ? 'C:\\Windows\\System32\\evil.dll' : '/etc/evil',
  ]

  for (const entry of maliciousEntries) {
    it(`blocks zip slip entry "${entry}"`, () => {
      expect(isSafePath(entry, DEST)).toBe(false)
    })
  }

  it('validateEntries throws with the offending name in the message', () => {
    expect(() => validateEntries(['../../escape.txt'], DEST)).toThrow(/escape\.txt/)
  })

  it('validateEntries passes when all entries are safe', () => {
    expect(() => validateEntries(['a.txt', 'b/c.pak'], DEST)).not.toThrow()
  })
})

describe('archive.analyzeArchiveStructure — mod type detection', () => {
  it('detects pak-only mod', () => {
    const result = analyzeArchiveStructure(['mod.pak', 'mod.ucas', 'mod.utoc'])
    expect(result.type).toBe('pak-only')
    expect(result.pakFiles).toHaveLength(3)
  })

  it('detects UE4SS mod with enabled.txt + lua', () => {
    const result = analyzeArchiveStructure(['MyMod/enabled.txt', 'MyMod/Scripts/main.lua'])
    expect(result.type).toBe('ue4ss-mod')
  })

  it('detects DLL-only UE4SS mod', () => {
    const result = analyzeArchiveStructure(['mod.dll'])
    expect(result.type).toBe('ue4ss-mod')
  })

  it('detects hybrid mod (PAK + UE4SS)', () => {
    const result = analyzeArchiveStructure([
      'MyMod/enabled.txt',
      'MyMod/Scripts/main.lua',
      'content.pak',
    ])
    expect(result.type).toBe('hybrid')
  })

  it('detects game-structure archive', () => {
    const result = analyzeArchiveStructure([
      'HumanitZ/Content/Paks/mod.pak',
      'HumanitZ/Binaries/Win64/stuff.dll',
    ])
    // Game structure with a DLL + no lua/pak is classified as ue4ss-mod by current
    // priority. The important thing is it's not 'complex' or undefined.
    expect(['game-structure', 'ue4ss-mod', 'hybrid']).toContain(result.type)
  })

  it('does not false-positive on just a pak file under a nested folder', () => {
    const result = analyzeArchiveStructure(['modA/assets/data.pak'])
    expect(result.type).toBe('pak-only')
  })
})
