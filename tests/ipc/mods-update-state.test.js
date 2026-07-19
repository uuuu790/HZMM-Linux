import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { captureModState, restoreModState } from '../../src/main/ipc/mods-update-state.js'

// Real-fs tests against temp dirs — both functions are pure fs + injected
// paths, mirroring how nexus:update-file drives them around a reinstall.

let root, paksA, paksB, ue4ss

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-update-state-'))
  paksA = path.join(root, 'PaksA')
  paksB = path.join(root, 'PaksB')
  ue4ss = path.join(root, 'Mods')
  for (const d of [paksA, paksB, ue4ss]) fs.mkdirSync(d, { recursive: true })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const P = () => ({ paksPaths: [paksA, paksB], ue4ssModsPath: ue4ss })

function makeUe4ssMod(name, { enabled = true, files = {} } = {}) {
  const dir = path.join(ue4ss, name)
  fs.mkdirSync(dir, { recursive: true })
  if (enabled) fs.writeFileSync(path.join(dir, 'enabled.txt'), '', 'utf-8')
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
  }
  return dir
}

describe('captureModState', () => {
  it('captures an enabled PAK found in a secondary paks dir', () => {
    fs.writeFileSync(path.join(paksB, 'CoolMod_P.pak'), 'x')
    const state = captureModState(P(), [{ name: 'CoolMod', modType: 'PAK' }])
    expect(state).toEqual([{ modType: 'PAK', name: 'CoolMod', coreName: 'CoolMod', enabled: true }])
  })

  it('captures a disabled PAK (.pak.disabled form, no _P suffix)', () => {
    fs.writeFileSync(path.join(paksA, 'CoolMod.pak.disabled'), 'x')
    const state = captureModState(P(), [{ name: 'CoolMod', modType: 'PAK' }])
    expect(state).toEqual([{ modType: 'PAK', name: 'CoolMod', coreName: 'CoolMod', enabled: false }])
  })

  it('records the stripped coreName for a load-order-prefixed PAK', () => {
    fs.writeFileSync(path.join(paksA, 'z1_CoolMod_P.pak'), 'x')
    const state = captureModState(P(), [{ name: 'z1_CoolMod', modType: 'PAK' }])
    expect(state).toEqual([{ modType: 'PAK', name: 'z1_CoolMod', coreName: 'CoolMod', enabled: true }])
  })

  it('captures UE4SS enabled flag and config files, excluding meta files and non-config lua', () => {
    makeUe4ssMod('CoolLua', {
      enabled: true,
      files: {
        'main.lua': 'print("code")',
        'config.lua': 'return { user = true }',
        [path.join('Scripts', 'settings.json')]: '{"a":1}',
        '_hzmm_link.json': '{"pakFiles":["CoolMod_P.pak"]}',
        'hzmm.config.json': '{"schema":true}',
        'modManifest.json': '{"manifest":true}',
      },
    })
    const state = captureModState(P(), [{ name: 'CoolLua', modType: 'UE4SS' }])
    expect(state).toHaveLength(1)
    expect(state[0].enabled).toBe(true)
    // scanConfigDir normalizes rel paths to forward slashes
    expect(Object.keys(state[0].configs).sort()).toEqual(['Scripts/settings.json', 'config.lua'])
  })

  it('skips receipts whose mods are no longer on disk and unsafe names', () => {
    const state = captureModState(P(), [
      { name: 'Ghost', modType: 'PAK' },
      { name: '../evil', modType: 'UE4SS' },
      { name: 'x/y', modType: 'PAK' },
      null,
    ])
    expect(state).toEqual([])
  })
})

describe('restoreModState', () => {
  it('re-disables a PAK that the reinstall landed enabled', () => {
    fs.writeFileSync(path.join(paksA, 'CoolMod_P.pak'), 'new')
    const summary = restoreModState(P(), [{ modType: 'PAK', name: 'CoolMod', enabled: false }])
    expect(summary.enabledRestored).toBe(1)
    expect(fs.existsSync(path.join(paksA, 'CoolMod_P.pak'))).toBe(false)
    expect(fs.existsSync(path.join(paksA, 'CoolMod_P.pak.disabled'))).toBe(true)
  })

  it('re-enables a PAK that landed disabled when the capture said enabled', () => {
    fs.writeFileSync(path.join(paksB, 'CoolMod.pak.disabled'), 'new')
    const summary = restoreModState(P(), [{ modType: 'PAK', name: 'CoolMod', enabled: true }])
    expect(summary.enabledRestored).toBe(1)
    expect(fs.existsSync(path.join(paksB, 'CoolMod.pak'))).toBe(true)
  })

  it('leaves a PAK alone when the landed state already matches', () => {
    fs.writeFileSync(path.join(paksA, 'CoolMod_P.pak'), 'new')
    const summary = restoreModState(P(), [{ modType: 'PAK', name: 'CoolMod', enabled: true }])
    expect(summary.enabledRestored).toBe(0)
    expect(fs.existsSync(path.join(paksA, 'CoolMod_P.pak'))).toBe(true)
  })

  it('re-disables a UE4SS mod and keeps mods.txt in sync', () => {
    makeUe4ssMod('CoolLua', { enabled: true })
    fs.writeFileSync(path.join(ue4ss, 'mods.txt'), 'CoolLua : 1\n', 'utf-8')
    const summary = restoreModState(P(), [{ modType: 'UE4SS', name: 'CoolLua', enabled: false, configs: {} }])
    expect(summary.enabledRestored).toBe(1)
    expect(fs.existsSync(path.join(ue4ss, 'CoolLua', 'enabled.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(ue4ss, 'mods.txt'), 'utf-8')).toContain('CoolLua : 0')
  })

  it('re-enables a UE4SS mod that landed disabled', () => {
    makeUe4ssMod('CoolLua', { enabled: false })
    const summary = restoreModState(P(), [{ modType: 'UE4SS', name: 'CoolLua', enabled: true, configs: {} }])
    expect(summary.enabledRestored).toBe(1)
    expect(fs.existsSync(path.join(ue4ss, 'CoolLua', 'enabled.txt'))).toBe(true)
  })

  it('writes captured configs back over the new version defaults', () => {
    makeUe4ssMod('CoolLua', {
      enabled: true,
      files: { 'config.lua': 'return { user = false }', [path.join('Scripts', 'settings.json')]: '{"a":0}' },
    })
    const summary = restoreModState(P(), [{
      modType: 'UE4SS', name: 'CoolLua', enabled: true,
      configs: { 'config.lua': 'return { user = true }', 'Scripts/settings.json': '{"a":1}' },
    }])
    expect(summary.configsRestored).toBe(2)
    expect(fs.readFileSync(path.join(ue4ss, 'CoolLua', 'config.lua'), 'utf-8')).toBe('return { user = true }')
    expect(fs.readFileSync(path.join(ue4ss, 'CoolLua', 'Scripts', 'settings.json'), 'utf-8')).toBe('{"a":1}')
  })

  it('blocks traversal in captured config paths (defense against tampered snapshots)', () => {
    makeUe4ssMod('CoolLua', { enabled: true })
    const summary = restoreModState(P(), [{
      modType: 'UE4SS', name: 'CoolLua', enabled: true,
      configs: { '../Other/evil.ini': 'pwned', '..\\..\\evil2.ini': 'pwned' },
    }])
    expect(summary.configsRestored).toBe(0)
    expect(fs.existsSync(path.join(ue4ss, 'Other', 'evil.ini'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'evil2.ini'))).toBe(false)
  })

  it('re-applies a load-order prefix the reinstall dropped, then restores enabled state', () => {
    // Pre-update the user made this pak win a conflict (z1_ prefix) and had it
    // disabled; the reinstall landed the archive's plain name, enabled.
    fs.writeFileSync(path.join(paksA, 'CoolMod_P.pak'), 'new')
    const calls = []
    const renamePak = (from, to) => {
      calls.push([from, to])
      fs.renameSync(path.join(paksA, from), path.join(paksA, to))
    }
    const summary = restoreModState(P(), [
      { modType: 'PAK', name: 'z1_CoolMod', coreName: 'CoolMod', enabled: false },
    ], { renamePak })
    expect(calls).toEqual([['CoolMod_P.pak', 'z1_CoolMod_P.pak']])
    expect(summary.orderRestored).toBe(1)
    expect(summary.enabledRestored).toBe(1)
    expect(fs.existsSync(path.join(paksA, 'z1_CoolMod_P.pak.disabled'))).toBe(true)
    expect(fs.existsSync(path.join(paksA, 'CoolMod_P.pak'))).toBe(false)
  })

  it('skips entries the new version renamed away without failing the rest', () => {
    fs.writeFileSync(path.join(paksA, 'NewName_P.pak'), 'new')
    const summary = restoreModState(P(), [
      { modType: 'PAK', name: 'OldName', enabled: false },
      { modType: 'UE4SS', name: 'GoneMod', enabled: false, configs: { 'config.ini': 'x' } },
    ])
    expect(summary.enabledRestored).toBe(0)
    expect(summary.configsRestored).toBe(0)
    expect(fs.existsSync(path.join(paksA, 'NewName_P.pak'))).toBe(true)
  })
})

describe('capture → reinstall → restore round trip', () => {
  it('preserves a disabled hybrid pair and user config across a simulated update', () => {
    // Pre-update state: disabled UE4SS mod + disabled linked pak + edited config
    makeUe4ssMod('HybridMod', { enabled: false, files: { 'config.lua': 'config = "USER"' } })
    fs.writeFileSync(path.join(paksA, 'HybridMod_P.pak.disabled'), 'old')

    const localMods = [
      { name: 'HybridMod', modType: 'UE4SS' },
      { name: 'HybridMod', modType: 'PAK' },
    ]
    const state = captureModState(P(), localMods)
    expect(state).toHaveLength(2)

    // Simulate the reinstall: everything lands fresh and enabled with defaults
    fs.rmSync(path.join(ue4ss, 'HybridMod'), { recursive: true, force: true })
    fs.rmSync(path.join(paksA, 'HybridMod_P.pak.disabled'), { force: true })
    makeUe4ssMod('HybridMod', { enabled: true, files: { 'config.lua': 'config = "DEFAULT"' } })
    fs.writeFileSync(path.join(paksA, 'HybridMod_P.pak'), 'new')

    const summary = restoreModState(P(), state)
    expect(summary.enabledRestored).toBe(2)
    expect(summary.configsRestored).toBe(1)
    expect(fs.existsSync(path.join(paksA, 'HybridMod_P.pak.disabled'))).toBe(true)
    expect(fs.existsSync(path.join(ue4ss, 'HybridMod', 'enabled.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(ue4ss, 'HybridMod', 'config.lua'), 'utf-8')).toBe('config = "USER"')
  })
})
