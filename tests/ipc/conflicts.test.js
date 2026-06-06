import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { findConflicts } from '../../src/main/ipc/conflicts.js'

// findConflicts walks one or more paks directories, calls a PAK index reader
// per file, and reports any resource path that ≥2 mods both ship. The unit
// test stubs the index reader so we don't need real PAK binaries — we only
// validate the collision-detection / engine-pack-skipping logic.

let tempDir
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-conflicts-test-'))
})
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function makePak(name, dir = tempDir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), 'fake-pak-bytes')
}

// Build a stub readIndex that maps filename → resource list.
function stubReader(map) {
  return (filePath) => map[path.basename(filePath)] || []
}

describe('findConflicts', () => {
  it('returns [] when no PAK files exist', () => {
    expect(findConflicts([tempDir], stubReader({}))).toEqual([])
  })

  it('returns [] when each resource appears in only one mod', () => {
    makePak('A.pak'); makePak('B.pak')
    const reader = stubReader({
      'A.pak': ['Game/Content/A.uasset'],
      'B.pak': ['Game/Content/B.uasset'],
    })
    expect(findConflicts([tempDir], reader)).toEqual([])
  })

  it('flags a resource shared by two PAK files', () => {
    makePak('A.pak'); makePak('B.pak')
    const reader = stubReader({
      'A.pak': ['Game/Content/Shared.uasset'],
      'B.pak': ['Game/Content/Shared.uasset'],
    })
    const out = findConflicts([tempDir], reader)
    expect(out).toEqual([{ resource: 'Game/Content/Shared.uasset', mods: ['A.pak', 'B.pak'] }])
  })

  it('reports multiple conflicts independently', () => {
    makePak('A.pak'); makePak('B.pak'); makePak('C.pak')
    const reader = stubReader({
      'A.pak': ['x.uasset', 'y.uasset'],
      'B.pak': ['x.uasset', 'z.uasset'],
      'C.pak': ['y.uasset'],
    })
    const out = findConflicts([tempDir], reader).sort((a, b) => a.resource.localeCompare(b.resource))
    expect(out).toEqual([
      { resource: 'x.uasset', mods: ['A.pak', 'B.pak'] },
      { resource: 'y.uasset', mods: ['A.pak', 'C.pak'] },
    ])
  })

  it('skips engine pakchunk* files', () => {
    makePak('pakchunk0-WindowsNoEditor.pak')
    makePak('MyMod.pak')
    const reader = stubReader({
      'pakchunk0-WindowsNoEditor.pak': ['Game/Content/Shared.uasset'],
      'MyMod.pak': ['Game/Content/Shared.uasset'],
    })
    expect(findConflicts([tempDir], reader)).toEqual([])
  })

  it('skips engine global* files (case-insensitive)', () => {
    makePak('global.pak')
    makePak('Global.pak') // already covered by lowercase compare
    makePak('Mod.pak')
    const reader = stubReader({
      'global.pak': ['x.uasset'],
      'Global.pak': ['x.uasset'],
      'Mod.pak': ['x.uasset'],
    })
    // Only Mod.pak counts; engine packs are skipped → no collision
    expect(findConflicts([tempDir], reader)).toEqual([])
  })

  it('skips .pak.disabled files (no .pak suffix to match)', () => {
    makePak('A.pak.disabled')
    makePak('B.pak')
    const reader = stubReader({
      'A.pak.disabled': ['Shared.uasset'],
      'B.pak': ['Shared.uasset'],
    })
    expect(findConflicts([tempDir], reader)).toEqual([])
  })

  it('searches across multiple paks directories', () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-conflicts-test2-'))
    try {
      makePak('A.pak', tempDir)
      makePak('B.pak', dir2)
      const reader = stubReader({
        'A.pak': ['x.uasset'],
        'B.pak': ['x.uasset'],
      })
      const out = findConflicts([tempDir, dir2], reader)
      expect(out).toEqual([{ resource: 'x.uasset', mods: ['A.pak', 'B.pak'] }])
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('skips a paks directory that does not exist (defensive)', () => {
    makePak('A.pak')
    const reader = stubReader({ 'A.pak': ['x.uasset'] })
    const ghost = path.join(tempDir, 'no-such-dir')
    expect(findConflicts([ghost, tempDir], reader)).toEqual([])
  })
})
