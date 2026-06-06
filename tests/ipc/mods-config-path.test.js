import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveModConfigPath } from '../../src/main/ipc/mods.js'

// NOTE: importing mods.js pulls in electron (which isn't available outside
// Electron). That would blow up this test. To avoid that, we test the pure
// resolveModConfigPath export only — the electron import in mods.js is
// top-level but the helper doesn't depend on it. If this test ever fails to
// import, move resolveModConfigPath out of mods.js into path-safety.js.

const IS_WINDOWS = process.platform === 'win32'
const MODS_ROOT = IS_WINDOWS
  ? 'C:\\Game\\HumanitZ\\HumanitZ\\Binaries\\Win64\\Mods'
  : '/game/HumanitZ/HumanitZ/Binaries/Win64/Mods'

describe('resolveModConfigPath — happy path', () => {
  it('resolves a simple mod config path', () => {
    const result = resolveModConfigPath(MODS_ROOT, 'MyMod', 'config.ini')
    expect(result).toBe(path.resolve(MODS_ROOT, 'MyMod', 'config.ini'))
  })

  it('allows nested relative paths inside the mod folder', () => {
    const result = resolveModConfigPath(MODS_ROOT, 'MyMod', 'Scripts/settings.json')
    expect(result).toBe(path.resolve(MODS_ROOT, 'MyMod', 'Scripts', 'settings.json'))
  })
})

describe('resolveModConfigPath — attack vectors (must all throw)', () => {
  // Attack 1: modFilename contains .. to escape the Mods root entirely.
  // Before the fix, the old code only validated relativePath against modDir,
  // so modFilename='../../../Windows/System32' would happily resolve.
  it('blocks modFilename ../../../ escape', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, '../../../../../../Windows/System32', 'config.ini')
    ).toThrow(/traversal|invalid/i)
  })

  it('blocks modFilename with backslash escape on Windows', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, '..\\..\\..\\Windows\\System32', 'hosts')
    ).toThrow(/traversal|invalid/i)
  })

  // Attack 2: relativePath contains .. to escape the mod subfolder.
  it('blocks relativePath .. escape', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, 'MyMod', '../../../../etc/passwd')
    ).toThrow(/traversal|invalid/i)
  })

  // Attack 3: both segments collaborate to escape.
  it('blocks combined modFilename + relativePath escape', () => {
    expect(() =>
      resolveModConfigPath(MODS_ROOT, '..', '..\\..\\Windows\\win.ini')
    ).toThrow(/traversal|invalid/i)
  })

  // Attack 4: empty / null / non-string inputs.
  it('throws on empty modFilename', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, '', 'config.ini')).toThrow()
  })

  it('throws on empty relativePath', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, 'MyMod', '')).toThrow()
  })

  it('throws on null modFilename', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, null, 'config.ini')).toThrow()
  })

  it('throws on non-string relativePath', () => {
    expect(() => resolveModConfigPath(MODS_ROOT, 'MyMod', 42)).toThrow()
  })

  it('throws on empty mods root', () => {
    expect(() => resolveModConfigPath('', 'MyMod', 'config.ini')).toThrow()
  })
})

describe('resolveModConfigPath — edge cases', () => {
  it('allows a safe subpath even when it contains a harmless ..', () => {
    // "Scripts/../Config/mod.ini" normalizes to "Config/mod.ini", still inside.
    const result = resolveModConfigPath(MODS_ROOT, 'MyMod', 'Scripts/../Config/mod.ini')
    expect(result).toBe(path.resolve(MODS_ROOT, 'MyMod', 'Config', 'mod.ini'))
  })

  it('does not treat a mod name with dots as traversal', () => {
    // "my.mod.v1" is a legitimate name; dots are only dangerous as ".." segments.
    const result = resolveModConfigPath(MODS_ROOT, 'my.mod.v1', 'config.ini')
    expect(result).toBe(path.resolve(MODS_ROOT, 'my.mod.v1', 'config.ini'))
  })
})
