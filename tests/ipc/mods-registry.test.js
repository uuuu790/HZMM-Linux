import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { syncUe4ssModRegistry, removeFromUe4ssModRegistry } from '../../src/main/ipc/mods-registry.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tempDir

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('syncUe4ssModRegistry — mods.txt', () => {
  it('adds enabled mod to mods.txt', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'ExistingMod : 1\n')
    syncUe4ssModRegistry(tempDir, 'NewMod', true)
    const content = fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')
    expect(content).toContain('NewMod : 1')
    expect(content).toContain('ExistingMod : 1')
  })

  it('updates existing mod entry to disabled', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'MyMod : 1\n')
    syncUe4ssModRegistry(tempDir, 'MyMod', false)
    const content = fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')
    expect(content).toContain('MyMod : 0')
    expect(content).not.toContain('MyMod : 1')
  })

  it('updates existing mod entry to enabled', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'MyMod : 0\n')
    syncUe4ssModRegistry(tempDir, 'MyMod', true)
    const content = fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')
    expect(content).toContain('MyMod : 1')
  })

  it('does not add disabled mod if not already in file', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'OtherMod : 1\n')
    syncUe4ssModRegistry(tempDir, 'NewMod', false)
    const content = fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')
    expect(content).not.toContain('NewMod')
  })

  it('inserts before keybinds comment if present', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'ExistingMod : 1\n; shared keybinds\nKeybindMod : 1\n')
    syncUe4ssModRegistry(tempDir, 'NewMod', true)
    const content = fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')
    const newModPos = content.indexOf('NewMod : 1')
    const keybindPos = content.indexOf('; shared keybinds')
    expect(newModPos).toBeLessThan(keybindPos)
  })

  it('does nothing if mods.txt does not exist', () => {
    // Should not throw
    syncUe4ssModRegistry(tempDir, 'MyMod', true)
    expect(fs.existsSync(path.join(tempDir, 'mods.txt'))).toBe(false)
  })

  it('handles mod names with special regex characters', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'Mod(v1.0) : 1\n')
    syncUe4ssModRegistry(tempDir, 'Mod(v1.0)', false)
    const content = fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')
    expect(content).toContain('Mod(v1.0) : 0')
  })
})

describe('syncUe4ssModRegistry — mods.json', () => {
  it('adds enabled mod to mods.json', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.json'), '[]')
    syncUe4ssModRegistry(tempDir, 'NewMod', true)
    const mods = JSON.parse(fs.readFileSync(path.join(tempDir, 'mods.json'), 'utf-8'))
    expect(mods).toContainEqual({ mod_name: 'NewMod', mod_enabled: true })
  })

  it('updates existing mod in mods.json', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.json'), '[{"mod_name":"MyMod","mod_enabled":true}]')
    syncUe4ssModRegistry(tempDir, 'MyMod', false)
    const mods = JSON.parse(fs.readFileSync(path.join(tempDir, 'mods.json'), 'utf-8'))
    expect(mods[0].mod_enabled).toBe(false)
  })

  it('does not add disabled mod if not already present', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.json'), '[]')
    syncUe4ssModRegistry(tempDir, 'MyMod', false)
    const mods = JSON.parse(fs.readFileSync(path.join(tempDir, 'mods.json'), 'utf-8'))
    expect(mods).toEqual([])
  })
})

describe('removeFromUe4ssModRegistry', () => {
  it('removes mod line from mods.txt', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'KeepMod : 1\nRemoveMod : 1\nOtherMod : 0\n')
    removeFromUe4ssModRegistry(tempDir, 'RemoveMod')
    const content = fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')
    expect(content).not.toContain('RemoveMod')
    expect(content).toContain('KeepMod : 1')
    expect(content).toContain('OtherMod : 0')
  })

  it('removes mod from mods.json', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.json'), '[{"mod_name":"Keep","mod_enabled":true},{"mod_name":"Remove","mod_enabled":false}]')
    removeFromUe4ssModRegistry(tempDir, 'Remove')
    const mods = JSON.parse(fs.readFileSync(path.join(tempDir, 'mods.json'), 'utf-8'))
    expect(mods).toHaveLength(1)
    expect(mods[0].mod_name).toBe('Keep')
  })

  it('does nothing if mod not found', () => {
    fs.writeFileSync(path.join(tempDir, 'mods.txt'), 'OnlyMod : 1\n')
    fs.writeFileSync(path.join(tempDir, 'mods.json'), '[{"mod_name":"OnlyMod","mod_enabled":true}]')
    removeFromUe4ssModRegistry(tempDir, 'NonExistent')
    expect(fs.readFileSync(path.join(tempDir, 'mods.txt'), 'utf-8')).toContain('OnlyMod : 1')
    const mods = JSON.parse(fs.readFileSync(path.join(tempDir, 'mods.json'), 'utf-8'))
    expect(mods).toHaveLength(1)
  })
})
