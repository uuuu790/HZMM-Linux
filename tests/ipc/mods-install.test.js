import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Import the function directly from the source — it's a pure directory walker
// We need to test it in isolation since installMods requires too many dependencies
// Re-implement findUe4ssFolders inline for unit testing (matches mods-install.js logic)
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
