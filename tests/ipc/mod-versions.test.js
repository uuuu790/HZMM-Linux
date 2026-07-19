import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mergeLinkIntoReceipts } from '../../src/main/ipc/nexus-install-tracker.js'
import {
  archiveModVersion,
  listModVersions,
  pruneModVersions,
  restoreArchivedVersion,
  removePakVariants,
} from '../../src/main/ipc/mod-versions.js'

describe('mergeLinkIntoReceipts', () => {
  it('creates a new receipt for an unknown mod', () => {
    const out = mergeLinkIntoReceipts([], 42, { modType: 'PAK', name: 'Cool' }, { fileId: 7, version: '1.2', now: 1000 })
    expect(out).toEqual([{ modId: 42, fileId: 7, installedAt: 1000, version: '1.2', localMods: [{ modType: 'PAK', name: 'Cool' }] }])
  })

  it('merges a new localMod into an existing receipt without duplicating', () => {
    const receipts = [{ modId: 42, fileId: 7, installedAt: 1, version: '1.0', localMods: [{ modType: 'PAK', name: 'Cool' }] }]
    const once = mergeLinkIntoReceipts(receipts, 42, { modType: 'UE4SS', name: 'CoolLua' }, { now: 2 })
    expect(once[0].localMods).toHaveLength(2)
    const twice = mergeLinkIntoReceipts(once, 42, { modType: 'UE4SS', name: 'CoolLua' }, { now: 3 })
    expect(twice[0].localMods).toHaveLength(2)
  })

  it('fills fileId/version only when the receipt had none — a real install outranks a link', () => {
    const noFile = [{ modId: 42, fileId: null, installedAt: 1, version: null, localMods: [] }]
    const filled = mergeLinkIntoReceipts(noFile, 42, { modType: 'PAK', name: 'X' }, { fileId: 9, version: '2.0' })
    expect(filled[0].fileId).toBe(9)
    expect(filled[0].version).toBe('2.0')

    const hasFile = [{ modId: 42, fileId: 7, installedAt: 1, version: '1.0', localMods: [] }]
    const kept = mergeLinkIntoReceipts(hasFile, 42, { modType: 'PAK', name: 'X' }, { fileId: 9, version: '2.0' })
    expect(kept[0].fileId).toBe(7)
    expect(kept[0].version).toBe('1.0')
  })
})

describe('mod-versions (fs)', () => {
  let root, paksA, ue4ss, retention

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-versions-'))
    paksA = path.join(root, 'Paks')
    ue4ss = path.join(root, 'Mods')
    retention = path.join(root, 'mod-versions')
    for (const d of [paksA, ue4ss, retention]) fs.mkdirSync(d, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const P = () => ({ paksPaths: [paksA], ue4ssModsPath: ue4ss, primaryPaksPath: paksA })

  function seedMod() {
    fs.writeFileSync(path.join(paksA, 'Cool_P.pak'), 'OLD-PAK')
    const dir = path.join(ue4ss, 'CoolLua')
    fs.mkdirSync(path.join(dir, 'Scripts'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Scripts', 'main.lua'), 'OLD-LUA')
    fs.writeFileSync(path.join(dir, 'enabled.txt'), '')
  }

  const RECEIPT = { modId: 42, fileId: 7, version: '1.0', localMods: [{ modType: 'PAK', name: 'Cool' }, { modType: 'UE4SS', name: 'CoolLua' }] }

  it('archives, lists, and restores a full snapshot (rollback roundtrip)', () => {
    seedMod()
    const archived = archiveModVersion(P(), retention, RECEIPT, 1000)
    expect(archived).not.toBeNull()
    expect(archived.entries).toBe(2)

    const listed = listModVersions(retention)
    expect(listed['42']).toHaveLength(1)
    expect(listed['42'][0]).toMatchObject({ version: '1.0', fileId: 7, savedAt: 1000 })

    // Simulate the update replacing everything with a new version
    fs.writeFileSync(path.join(paksA, 'Cool_P.pak'), 'NEW-PAK')
    fs.writeFileSync(path.join(ue4ss, 'CoolLua', 'Scripts', 'main.lua'), 'NEW-LUA')

    const restored = restoreArchivedVersion(P(), listed['42'][0].dir)
    expect(restored).toMatchObject({ modId: 42, fileId: 7, version: '1.0' })
    expect(restored.localMods).toHaveLength(2)
    expect(fs.readFileSync(path.join(paksA, 'Cool_P.pak'), 'utf-8')).toBe('OLD-PAK')
    expect(fs.readFileSync(path.join(ue4ss, 'CoolLua', 'Scripts', 'main.lua'), 'utf-8')).toBe('OLD-LUA')
  })

  it('preserves the disabled form through archive and restore', () => {
    fs.writeFileSync(path.join(paksA, 'Cool_P.pak.disabled'), 'OLD')
    const archived = archiveModVersion(P(), retention, { ...RECEIPT, localMods: [{ modType: 'PAK', name: 'Cool' }] }, 2000)
    expect(archived.entries).toBe(1)
    fs.rmSync(path.join(paksA, 'Cool_P.pak.disabled'))
    fs.writeFileSync(path.join(paksA, 'Cool_P.pak'), 'NEW')

    const listed = listModVersions(retention)
    restoreArchivedVersion(P(), listed['42'][0].dir)
    expect(fs.existsSync(path.join(paksA, 'Cool_P.pak.disabled'))).toBe(true)
    expect(fs.existsSync(path.join(paksA, 'Cool_P.pak'))).toBe(false)
  })

  it('keeps only the newest KEEP snapshots per mod', () => {
    seedMod()
    for (let i = 1; i <= 4; i++) archiveModVersion(P(), retention, RECEIPT, i * 1000)
    const snaps = fs.readdirSync(path.join(retention, '42')).sort()
    expect(snaps).toEqual(['3000', '4000'])
  })

  it('returns null when nothing from the receipt is on disk', () => {
    expect(archiveModVersion(P(), retention, RECEIPT, 5000)).toBeNull()
    expect(listModVersions(retention)).toEqual({})
  })

  it('restore skips traversal names planted in a tampered manifest', () => {
    seedMod()
    const archived = archiveModVersion(P(), retention, RECEIPT, 6000)
    const manifestPath = path.join(archived.dir, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    manifest.entries.push({ kind: 'UE4SS', name: '../evil' })
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))

    const restored = restoreArchivedVersion(P(), archived.dir)
    expect(restored.localMods.some(lm => lm.name.includes('..'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'evil'))).toBe(false)
  })

  it('removePakVariants clears every enabled/disabled form of a base name', () => {
    fs.writeFileSync(path.join(paksA, 'Cool_P.pak'), 'x')
    fs.writeFileSync(path.join(paksA, 'Cool.pak.disabled'), 'x')
    expect(removePakVariants([paksA], 'Cool')).toBe(2)
    expect(fs.readdirSync(paksA)).toEqual([])
  })

  it('pruneModVersions tolerates a missing dir', () => {
    expect(pruneModVersions(path.join(root, 'nope'))).toBe(0)
  })
})
