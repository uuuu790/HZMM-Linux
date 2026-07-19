import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { disableModsOnDisk, restoreModsOnDisk } from '../../src/main/ipc/game.js'
import { pruneAutoBackups } from '../../src/main/ipc/saves.js'

let root, paksA, paksB, ue4ss

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-vanilla-'))
  paksA = path.join(root, 'PaksA')
  paksB = path.join(root, 'PaksB')
  ue4ss = path.join(root, 'Mods')
  for (const d of [paksA, paksB, ue4ss]) fs.mkdirSync(d, { recursive: true })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const P = () => ({ paksPaths: [paksA, paksB], ue4ssModsPath: ue4ss })

function makeUe4ssMod(name, enabled) {
  const dir = path.join(ue4ss, name)
  fs.mkdirSync(dir, { recursive: true })
  if (enabled) fs.writeFileSync(path.join(dir, 'enabled.txt'), '', 'utf-8')
  return dir
}

describe('disableModsOnDisk', () => {
  it('disables enabled PAK and UE4SS mods and returns the restore entries', () => {
    fs.writeFileSync(path.join(paksB, 'CoolMod_P.pak'), 'x')
    makeUe4ssMod('CoolLua', true)
    fs.writeFileSync(path.join(ue4ss, 'mods.txt'), 'CoolLua : 1\n', 'utf-8')

    const disabled = disableModsOnDisk(P(), [
      { type: 'PAK', filename: 'CoolMod_P.pak', enabled: true },
      { type: 'UE4SS', filename: 'CoolLua', enabled: true },
    ])

    expect(disabled).toEqual([
      { type: 'PAK', filename: 'CoolMod_P.pak' },
      { type: 'UE4SS', filename: 'CoolLua' },
    ])
    expect(fs.existsSync(path.join(paksB, 'CoolMod_P.pak.disabled'))).toBe(true)
    expect(fs.existsSync(path.join(paksB, 'CoolMod_P.pak'))).toBe(false)
    expect(fs.existsSync(path.join(ue4ss, 'CoolLua', 'enabled.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(ue4ss, 'mods.txt'), 'utf-8')).toContain('CoolLua : 0')
  })

  it('skips already-disabled, missing, and unsafe entries', () => {
    fs.writeFileSync(path.join(paksA, 'Off.pak.disabled'), 'x')
    const disabled = disableModsOnDisk(P(), [
      { type: 'PAK', filename: 'Off.pak.disabled', enabled: false },
      { type: 'PAK', filename: 'Ghost.pak', enabled: true },
      { type: 'PAK', filename: '../evil.pak', enabled: true },
      null,
    ])
    expect(disabled).toEqual([])
    expect(fs.existsSync(path.join(paksA, 'Off.pak.disabled'))).toBe(true)
  })
})

describe('restoreModsOnDisk', () => {
  it('round-trips a disable → restore back to the original state', () => {
    fs.writeFileSync(path.join(paksA, 'CoolMod_P.pak'), 'x')
    makeUe4ssMod('CoolLua', true)
    fs.writeFileSync(path.join(ue4ss, 'mods.txt'), 'CoolLua : 1\n', 'utf-8')

    const entries = disableModsOnDisk(P(), [
      { type: 'PAK', filename: 'CoolMod_P.pak', enabled: true },
      { type: 'UE4SS', filename: 'CoolLua', enabled: true },
    ])
    const restored = restoreModsOnDisk(P(), entries)

    expect(restored).toBe(2)
    expect(fs.existsSync(path.join(paksA, 'CoolMod_P.pak'))).toBe(true)
    expect(fs.existsSync(path.join(paksA, 'CoolMod_P.pak.disabled'))).toBe(false)
    expect(fs.existsSync(path.join(ue4ss, 'CoolLua', 'enabled.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(ue4ss, 'mods.txt'), 'utf-8')).toContain('CoolLua : 1')
  })

  it('tolerates entries whose files vanished (mod removed while playing)', () => {
    makeUe4ssMod('StillHere', false)
    const restored = restoreModsOnDisk(P(), [
      { type: 'PAK', filename: 'Gone.pak' },
      { type: 'UE4SS', filename: 'AlsoGone' },
      { type: 'UE4SS', filename: 'StillHere' },
    ])
    expect(restored).toBe(1)
    expect(fs.existsSync(path.join(ue4ss, 'StillHere', 'enabled.txt'))).toBe(true)
  })
})

describe('pruneAutoBackups', () => {
  it('keeps the newest N auto-backups and never touches manual ones', () => {
    const backupDir = path.join(root, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    for (let i = 1; i <= 7; i++) {
      fs.mkdirSync(path.join(backupDir, `save_backup_auto_2026-07-0${i}T00-00-00`), { recursive: true })
    }
    fs.mkdirSync(path.join(backupDir, 'save_backup_2026-07-01T00-00-00'), { recursive: true })

    const pruned = pruneAutoBackups(backupDir, 5)

    expect(pruned).toBe(2)
    const left = fs.readdirSync(backupDir).sort()
    expect(left).toContain('save_backup_2026-07-01T00-00-00')
    expect(left.filter(d => d.startsWith('save_backup_auto_'))).toHaveLength(5)
    // the two OLDEST auto dirs are the ones that went
    expect(left).not.toContain('save_backup_auto_2026-07-01T00-00-00')
    expect(left).not.toContain('save_backup_auto_2026-07-02T00-00-00')
  })

  it('returns 0 when the backup dir does not exist', () => {
    expect(pruneAutoBackups(path.join(root, 'nope'), 5)).toBe(0)
  })
})
