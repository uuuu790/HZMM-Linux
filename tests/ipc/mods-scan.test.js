import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { isUe4ssMod, classifyUe4ssMod } from '../../src/main/ipc/mods-scan.js'

// Real-fs fixtures (no mock-fs) so the predicate is exercised against the
// same Node fs semantics it sees in production. The detection contract:
//   - UE4SS Lua mod  → Scripts/main.lua OR main.lua at root
//   - UE4SS cppmod   → dlls/main.dll (canonical UE4SS layout)
//   - Fallback       → any first-level *.dll (defensive against odd zips)
//   - Otherwise      → not recognized as a UE4SS mod
//
// The dlls/main.dll path was missing before 1.3.6, which silently hid every
// cppmod from HZMM (HZDamageDisplay was the report case).

let tempDir
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-mods-scan-test-'))
})
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function makeMod(structure) {
  const modDir = path.join(tempDir, 'TestMod')
  fs.mkdirSync(modDir, { recursive: true })
  for (const [rel, contents] of Object.entries(structure)) {
    const full = path.join(modDir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents)
  }
  return modDir
}

describe('isUe4ssMod', () => {
  it('returns false for an empty directory', () => {
    const modDir = path.join(tempDir, 'Empty')
    fs.mkdirSync(modDir)
    expect(isUe4ssMod(modDir)).toBe(false)
  })

  it('recognizes a Scripts/main.lua mod (standard UE4SS layout)', () => {
    const modDir = makeMod({ 'Scripts/main.lua': '-- entry' })
    expect(isUe4ssMod(modDir)).toBe(true)
  })

  it('recognizes a flat main.lua mod', () => {
    const modDir = makeMod({ 'main.lua': '-- flat entry' })
    expect(isUe4ssMod(modDir)).toBe(true)
  })

  it('recognizes a cppmod with dlls/main.dll (the 1.3.6 fix)', () => {
    const modDir = makeMod({ 'dlls/main.dll': 'binary', 'enabled.txt': '' })
    expect(isUe4ssMod(modDir)).toBe(true)
  })

  it('recognizes a first-level .dll as fallback (unusual layout)', () => {
    const modDir = makeMod({ 'rogue.dll': 'binary' })
    expect(isUe4ssMod(modDir)).toBe(true)
  })

  it('does NOT match when dlls/ subdir exists but holds no main.dll', () => {
    // dlls/ is not a `.dll`-suffixed file, so the fallback readdirSync check
    // sees nothing matching `endsWith('.dll')` at the root. Correct: the
    // canonical cppmod entry has to be `dlls/main.dll`, not `dlls/foo.bar`.
    const modDir = makeMod({ 'dlls/foo.bar': 'binary' })
    expect(isUe4ssMod(modDir)).toBe(false)
  })

  it('returns true when several markers coexist (any one wins)', () => {
    const modDir = makeMod({
      'Scripts/main.lua': '-- lua',
      'dlls/main.dll': 'binary',
      'enabled.txt': '',
    })
    expect(isUe4ssMod(modDir)).toBe(true)
  })

  it('ignores non-marker files (README, license, config)', () => {
    const modDir = makeMod({
      'README.md': '# nothing',
      'LICENSE': 'MIT',
      'config.lua': '-- config',
    })
    expect(isUe4ssMod(modDir)).toBe(false)
  })

  it('does not throw on a non-existent directory (returns false)', () => {
    const ghost = path.join(tempDir, 'does-not-exist')
    expect(() => isUe4ssMod(ghost)).not.toThrow()
    expect(isUe4ssMod(ghost)).toBe(false)
  })

  it('is case-sensitive on POSIX, but accepts lowercase main.lua either way (sanity)', () => {
    // We don't pretend to handle Windows NTFS case-insensitivity here —
    // the predicate just calls fs.existsSync which inherits the OS's
    // own behavior. This test just pins that lowercase main.lua works.
    const modDir = makeMod({ 'main.lua': '-- ok' })
    expect(isUe4ssMod(modDir)).toBe(true)
  })
})

describe('classifyUe4ssMod', () => {
  it('classifies a Scripts/main.lua mod as lua', () => {
    const modDir = makeMod({ 'Scripts/main.lua': '-- entry' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })

  it('classifies a flat main.lua mod as lua', () => {
    const modDir = makeMod({ 'main.lua': '-- flat' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })

  it('classifies a dlls/main.dll cppmod as cpp', () => {
    const modDir = makeMod({ 'dlls/main.dll': 'binary' })
    expect(classifyUe4ssMod(modDir)).toBe('cpp')
  })

  it('classifies a first-level .dll (unusual layout) as cpp', () => {
    const modDir = makeMod({ 'rogue.dll': 'binary' })
    expect(classifyUe4ssMod(modDir)).toBe('cpp')
  })

  it('prefers lua when a mod has BOTH a lua entry and a dll', () => {
    const modDir = makeMod({ 'Scripts/main.lua': '-- lua', 'dlls/main.dll': 'binary' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })

  it('defaults to lua for a directory with no recognizable markers', () => {
    const modDir = makeMod({ 'README.md': '# nothing' })
    expect(classifyUe4ssMod(modDir)).toBe('lua')
  })
})
