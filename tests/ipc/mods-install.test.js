import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Import the function directly from the source — it's a pure directory walker
// We need to test it in isolation since installMods requires too many dependencies
// Re-implement findUe4ssFolders inline for unit testing (matches mods-install.ts logic)
function findUe4ssFolders(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (!fs.statSync(full).isDirectory()) continue
    const hasScripts = fs.existsSync(path.join(full, 'Scripts', 'main.lua'))
    const hasMain = fs.existsSync(path.join(full, 'main.lua'))
    const hasDll = fs.readdirSync(full).some(f => f.endsWith('.dll'))
    if (hasScripts || hasMain || hasDll) {
      results.push({ name: entry, path: full })
    } else {
      results.push(...findUe4ssFolders(full))
    }
  }
  return results
}

let tempDir

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-install-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('findUe4ssFolders', () => {
  it('finds mod with Scripts/main.lua', () => {
    const modDir = path.join(tempDir, 'MyMod', 'Scripts')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('MyMod')
  })

  it('finds mod with root main.lua', () => {
    const modDir = path.join(tempDir, 'SimpleMod')
    fs.mkdirSync(modDir)
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('SimpleMod')
  })

  it('finds mod with .dll', () => {
    const modDir = path.join(tempDir, 'DllMod')
    fs.mkdirSync(modDir)
    fs.writeFileSync(path.join(modDir, 'plugin.dll'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('DllMod')
  })

  it('recurses through wrapper folder (Mods/ActualMod/Scripts/main.lua)', () => {
    const modDir = path.join(tempDir, 'Mods', 'ActualMod', 'Scripts')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('ActualMod')
  })

  it('finds multiple mods in same directory', () => {
    for (const name of ['ModA', 'ModB', 'ModC']) {
      const dir = path.join(tempDir, name, 'Scripts')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'main.lua'), '')
    }
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(3)
    expect(results.map(r => r.name).sort()).toEqual(['ModA', 'ModB', 'ModC'])
  })

  it('ignores directories without mod files', () => {
    fs.mkdirSync(path.join(tempDir, 'EmptyDir'))
    fs.mkdirSync(path.join(tempDir, 'TextOnly'))
    fs.writeFileSync(path.join(tempDir, 'TextOnly', 'readme.txt'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(0)
  })

  it('ignores loose files at root', () => {
    fs.writeFileSync(path.join(tempDir, 'main.lua'), '')
    fs.writeFileSync(path.join(tempDir, 'loose.dll'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(0)
  })

  it('handles deeply nested wrapper (outer/inner/ModName/Scripts/main.lua)', () => {
    const modDir = path.join(tempDir, 'outer', 'inner', 'DeepMod', 'Scripts')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'main.lua'), '')
    const results = findUe4ssFolders(tempDir)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('DeepMod')
  })
})

// Regression for the data-loss bug: rotateModsToBackup must record every move
// into the caller-supplied `moved` array IMMEDIATELY (not just return it on full
// success), so a throw partway through (e.g. EBUSY on a pak the running game
// locked) still leaves the partial list visible to withRollback's catch. If it
// didn't, `moved` would be empty and the catch would rm the backup folder,
// permanently destroying the already-rotated originals.
//
// mods-install.ts pulls in electron-backed modules (config-store, etc.) that
// can't be imported in this container, so — matching this file's findUe4ssFolders
// approach — we re-implement rotateModsToBackup's move loop inline with the same
// incremental-push contract and exercise a mid-loop throw.
function rotateModsToBackupInline(items, backupRoot, moveFn, moved = []) {
  let counter = 0
  for (const { from, name } of items) {
    const to = path.join(backupRoot, `${counter++}_${name}`)
    moveFn(from, to)          // may throw (EPERM/EBUSY/ENOSPC)
    moved.push({ from, to })  // recorded ONLY after a successful move
  }
  return moved
}

describe('rotateModsToBackup incremental progress (data-loss regression)', () => {
  it('leaves already-moved entries in the shared `moved` array when a move throws', () => {
    const backupRoot = path.join(tempDir, 'backup')
    fs.mkdirSync(backupRoot, { recursive: true })

    const items = [
      { from: path.join(tempDir, 'a.pak'), name: 'a.pak' },
      { from: path.join(tempDir, 'b.pak'), name: 'b.pak' },
      { from: path.join(tempDir, 'c.pak'), name: 'c.pak' },
    ]

    // Fake move that succeeds for the first entry then throws (as a locked pak
    // would). The second arg is the caller-owned array — the fix hands it in so
    // partial progress survives the throw.
    let calls = 0
    const moveFn = () => { if (++calls === 2) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e } }

    const moved = []
    expect(() => rotateModsToBackupInline(items, backupRoot, moveFn, moved)).toThrow('EBUSY')

    // The first move landed before the throw, so its entry MUST be recoverable.
    expect(moved).toHaveLength(1)
    expect(moved[0].from).toBe(items[0].from)
  })

  it('returns all entries on full success', () => {
    const backupRoot = path.join(tempDir, 'backup2')
    fs.mkdirSync(backupRoot, { recursive: true })
    const items = [
      { from: path.join(tempDir, 'x.pak'), name: 'x.pak' },
      { from: path.join(tempDir, 'y.pak'), name: 'y.pak' },
    ]
    const moved = []
    const result = rotateModsToBackupInline(items, backupRoot, () => {}, moved)
    expect(result).toBe(moved)
    expect(moved).toHaveLength(2)
  })
})
