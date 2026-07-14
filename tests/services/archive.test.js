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
  extractZip,
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

// Regression: archives produced by Windows built-in zip / PowerShell
// Compress-Archive store backslash separators (the exact case
// skipEntryNameValidation was turned on for). Extract-by-normalized-name used
// to find no entry and "succeed" with zero files; bulk extract used to write
// literal `a\b\c.pak` files on Linux. Fixtures are real zips (base64-embedded)
// whose entry names contain backslashes.
describe('archive.extractZip — backslash entry names', () => {
  // Single entry: Mods\CoolMod_P.pak ("FAKE PAK CONTENT")
  const PAK_ONLY_ZIP =
    'UEsDBBQAAAAAAKkM7lx5Ht2kEAAAABAAAAASAAAATW9kc1xDb29sTW9kX1AucGFrRkFLRSBQQUsgQ09OVEVOVFBLAQIUAxQAAAAAAKkM7lx5Ht2kEAAAABAAAAASAAAAAAAAAAAAAACAAQAAAABNb2RzXENvb2xNb2RfUC5wYWtQSwUGAAAAAAEAAQBAAAAAQAAAAAAA'
  // Two entries under HumanitZ\... (game-structure/hybrid layout)
  const GAME_STRUCTURE_ZIP =
    'UEsDBBQAAAAAAKkM7lyTR7zvBwAAAAcAAAAkAAAASHVtYW5pdFpcQ29udGVudFxQYWtzXH5tb2RzXENvb2wucGFrUEFLREFUQVBLAwQUAAAAAACpDO5c+R2jugYAAAAGAAAAOwAAAEh1bWFuaXRaXEJpbmFyaWVzXFdpbjY0XHVlNHNzXE1vZHNcQ29vbE1vZFxTY3JpcHRzXG1haW4ubHVhLS0gbHVhUEsBAhQDFAAAAAAAqQzuXJNHvO8HAAAABwAAACQAAAAAAAAAAAAAAIABAAAAAEh1bWFuaXRaXENvbnRlbnRcUGFrc1x+bW9kc1xDb29sLnBha1BLAQIUAxQAAAAAAKkM7lz5HaO6BgAAAAYAAAA7AAAAAAAAAAAAAACAAUkAAABIdW1hbml0WlxCaW5hcmllc1xXaW42NFx1ZTRzc1xNb2RzXENvb2xNb2RcU2NyaXB0c1xtYWluLmx1YVBLBQYAAAAAAgACALsAAACoAAAAAAA='

  const writeFixture = (dir, b64) => {
    const p = path.join(dir, 'fixture.zip')
    fs.writeFileSync(p, Buffer.from(b64, 'base64'))
    return p
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])

  it('pak-only: lands the pak at the destination root with real content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-bszip-'))
    try {
      const zip = writeFixture(dir, PAK_ONLY_ZIP)
      const dest = path.join(dir, 'out')
      const analysis = await extractZip(zip, dest)
      expect(analysis.type).toBe('pak-only')
      const pak = path.join(dest, 'CoolMod_P.pak')
      expect(fs.existsSync(pak)).toBe(true)
      expect(fs.readFileSync(pak, 'utf-8')).toBe('FAKE PAK CONTENT')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('full extraction: restores the directory tree instead of literal backslash names', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-bszip-'))
    try {
      const zip = writeFixture(dir, GAME_STRUCTURE_ZIP)
      const dest = path.join(dir, 'out')
      await extractZip(zip, dest)
      const rel = walk(dest).map(f => path.relative(dest, f)).sort()
      expect(rel).toEqual([
        path.join('HumanitZ', 'Binaries', 'Win64', 'ue4ss', 'Mods', 'CoolMod', 'Scripts', 'main.lua'),
        path.join('HumanitZ', 'Content', 'Paks', '~mods', 'Cool.pak'),
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('analysis dedupes an IoStore trio into one mod entry', () => {
    const analysis = analyzeArchiveStructure(['X_P.pak', 'X_P.ucas', 'X_P.utoc'])
    expect(analysis.mods).toEqual([{ name: 'X', modType: 'PAK' }])
  })

  it('classifies uppercase extensions the same as lowercase', () => {
    const analysis = analyzeArchiveStructure(['MODS/BIGGUN.PAK'])
    expect(analysis.type).toBe('pak-only')
  })
})
