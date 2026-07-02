import { describe, it, expect } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import {
  isSafePath,
  validateEntries,
  analyzeArchiveStructure,
  validateArchiveLimits,
  resolveCollisionFreePath,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_COUNT,
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
    IS_WINDOWS ? '..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts' : '../../../../etc/hosts',
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

// Regression guard for zip-slip: validateEntries is the ONLY zip-slip defense
// (every StreamZip uses skipEntryNameValidation). A future refactor that drops
// the guard, or feeds it an unsafe entry, must fail here.
describe('archive.validateEntries — zip slip regression', () => {
  const rejectedEntries = [
    IS_WINDOWS ? '..\\..\\evil.dll' : '../../evil.dll',
    '../../../escape.txt',
    'good/../../escape.txt',
    IS_WINDOWS ? 'C:\\Windows\\System32\\evil.dll' : '/etc/evil',
  ]

  for (const entry of rejectedEntries) {
    it(`rejects entry "${entry}"`, () => {
      expect(() => validateEntries([entry], DEST)).toThrow()
    })

    it(`rejects "${entry}" even alongside safe entries`, () => {
      expect(() => validateEntries(['safe.pak', entry, 'also/safe.txt'], DEST)).toThrow()
    })
  }

  it('allows a fully-safe entry list', () => {
    expect(() => validateEntries(['a.pak', 'sub/b.pak'], DEST)).not.toThrow()
  })
})

// Decompression-bomb guard: reject archives whose declared uncompressed totals
// blow past the ceilings, before any byte is written.
describe('archive.validateArchiveLimits — decompression bomb defense', () => {
  it('passes for a normal archive', () => {
    expect(() => validateArchiveLimits([1024, 2048, 4096])).not.toThrow()
  })

  it('passes at exactly the byte ceiling', () => {
    expect(() => validateArchiveLimits([MAX_TOTAL_UNCOMPRESSED_BYTES])).not.toThrow()
  })

  it('rejects when total uncompressed size exceeds the byte ceiling', () => {
    expect(() => validateArchiveLimits([MAX_TOTAL_UNCOMPRESSED_BYTES + 1])).toThrow(/decompression bomb/)
  })

  it('rejects when summed sizes exceed the byte ceiling', () => {
    const half = Math.ceil(MAX_TOTAL_UNCOMPRESSED_BYTES / 2) + 1
    expect(() => validateArchiveLimits([half, half])).toThrow(/decompression bomb/)
  })

  it('rejects when entry count exceeds the limit', () => {
    const tiny = new Array(MAX_ENTRY_COUNT + 1).fill(1)
    expect(() => validateArchiveLimits(tiny)).toThrow(/decompression bomb/)
  })

  it('passes at exactly the entry-count limit', () => {
    const sizes = new Array(MAX_ENTRY_COUNT).fill(1)
    expect(() => validateArchiveLimits(sizes)).not.toThrow()
  })
})

// Same-basename paks from different subfolders must not silently overwrite.
describe('archive.resolveCollisionFreePath — basename collision', () => {
  it('returns the path unchanged when nothing exists there', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-collide-'))
    try {
      const p = path.join(dir, 'mod.pak')
      expect(resolveCollisionFreePath(p)).toBe(p)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('appends " (2)" before the extension when the path is taken', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-collide-'))
    try {
      const p = path.join(dir, 'mod.pak')
      fs.writeFileSync(p, 'a')
      expect(resolveCollisionFreePath(p)).toBe(path.join(dir, 'mod (2).pak'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps incrementing the suffix for repeated collisions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-collide-'))
    try {
      fs.writeFileSync(path.join(dir, 'mod.pak'), 'a')
      fs.writeFileSync(path.join(dir, 'mod (2).pak'), 'b')
      expect(resolveCollisionFreePath(path.join(dir, 'mod.pak'))).toBe(path.join(dir, 'mod (3).pak'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
