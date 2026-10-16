// Mod config-related IPC: schema lookup, config file enumeration, read/save,
// and the openPath jump-to-file helper declared by hzmm.config.json.
//
// Split out of mods.js as part of the 651-line refactor. Exports the two
// shared helpers (scanConfigDir, resolveModConfigPath) so that mods-profiles.ts
// can reuse them without re-implementing the safety checks.

import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { Stats } from 'fs'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import { getUe4ssModsPath } from '../services/steam-detector'
import { resolveWithin, assertSafeSegment, isExecutableExt } from '../services/path-safety'
import logger from '../services/logger'
import { assertLuaConfigSaveable } from '../services/lua-syntax'
import { CONFIG_EXTENSIONS } from './constants'

// Resolve a UE4SS mod config file path from renderer-supplied inputs.
// Blocks traversal in BOTH modFilename and relativePath — neither may escape
// the mods root. Throws on any escape attempt or invalid input.
export function resolveModConfigPath(ue4ssModsPath: unknown, modFilename: unknown, relativePath: unknown): string {
  if (typeof ue4ssModsPath !== 'string' || !ue4ssModsPath) {
    throw new Error('Invalid mods root')
  }
  if (typeof modFilename !== 'string' || !modFilename) {
    throw new Error('Invalid mod filename')
  }
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('Invalid relative path')
  }
  // Re-root under the SPECIFIC mod folder (not the shared mods root) so a
  // relativePath like "../OtherMod/Scripts/main.lua" can't cross into a sibling
  // mod and overwrite its runtime script. modFilename must be a flat segment
  // (the IPC handlers assert this too; re-check for the mods-profiles.ts reuse).
  assertSafeSegment('modFilename', modFilename)
  return resolveWithin(path.join(ue4ssModsPath, modFilename), relativePath)
}

// Shared: recursively scan a directory for config files.
// Callers provide a collector closure that sees each matching file.
export type ConfigFileCollector = (relativePath: string, fullPath: string, stat: Stats) => void

export function scanConfigDir(
  dir: string,
  relativeBase: string,
  configExts: ReadonlySet<string>,
  excludeFiles: ReadonlySet<string>,
  collector: ConfigFileCollector,
): void {
  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const relativePath = relativeBase ? path.join(relativeBase, entry) : entry
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      scanConfigDir(fullPath, relativePath, configExts, excludeFiles, collector)
    } else if (stat.isFile()) {
      const ext = path.extname(entry).toLowerCase()
      if (configExts.has(ext) && !excludeFiles.has(entry.toLowerCase())) {
        // .lua / .txt 只抓檔名含 "config" 的
        if ((ext === '.lua' || ext === '.txt') && !entry.toLowerCase().includes('config')) continue
        collector(relativePath.replace(/\\/g, '/'), fullPath, stat)
      }
    }
  }
}

export function registerModsConfigIpc(): void {
  // Schema lookup — returns the parsed hzmm.config.json for a UE4SS mod,
  // or null if absent / PAK mod / unreadable. Renderer uses this to decide
  // between schema-driven and comment-driven config UI.
  ipcMain.handle('mods:get-config-schema', (_: IpcMainInvokeEvent, modFilename: unknown) => {
    assertSafeSegment('modFilename', modFilename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null

    const isPakMod = modFilename.endsWith('.pak') || modFilename.endsWith('.pak.disabled')
    if (isPakMod) return null

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return null

    const schemaPath = path.join(ue4ssModsPath, modFilename, 'hzmm.config.json')
    if (!fs.existsSync(schemaPath)) return null

    try {
      return JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as unknown
    } catch (err) {
      logger.warn(`Failed to parse hzmm.config.json for ${modFilename}: ${(err as Error).message}`)
      return null
    }
  })

  ipcMain.handle('mods:get-config-files', (_: IpcMainInvokeEvent, modFilename: unknown) => {
    assertSafeSegment('modFilename', modFilename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return []

    const isPakMod = modFilename.endsWith('.pak') || modFilename.endsWith('.pak.disabled')
    if (isPakMod) return [] // PAK mod 沒有 config 檔

    // UE4SS mod — 掃描資料夾內的 config 檔案
    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return []

    const modDir = path.join(ue4ssModsPath, modFilename)
    if (!fs.existsSync(modDir)) return []

    const configExts = new Set(CONFIG_EXTENSIONS)
    const excludeFiles = new Set(['enabled.txt', '_hzmm_link.json'])
    const results: Array<{ name: string; relativePath: string; size: number }> = []

    scanConfigDir(modDir, '', configExts, excludeFiles, (relPath, fullPath, stat) => {
      results.push({ name: path.basename(fullPath), relativePath: relPath, size: stat.size })
    })
    return results
  })

  ipcMain.handle('mods:read-config', (_: IpcMainInvokeEvent, modFilename: unknown, relativePath: unknown) => {
    assertSafeSegment('modFilename', modFilename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const resolved = resolveModConfigPath(ue4ssModsPath, modFilename, relativePath)

    if (!fs.existsSync(resolved)) throw new Error('File not found')
    return fs.readFileSync(resolved, 'utf-8')
  })

  // content: the editor's serialized file text.
  ipcMain.handle('mods:save-config', (_: IpcMainInvokeEvent, modFilename: unknown, relativePath: unknown, content: string) => {
    assertSafeSegment('modFilename', modFilename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const resolved = resolveModConfigPath(ue4ssModsPath, modFilename, relativePath)

    // Throws before anything (including the .tmp) is written. relativePath is a
    // string here: resolveModConfigPath above rejects anything else.
    assertLuaConfigSaveable(resolved, relativePath as string, content)

    // Atomic write: power loss / kill mid-write would otherwise leave the
    // user's mod config truncated to whatever bytes had flushed. .tmp +
    // rename keeps the previous content intact until the new file is fully on disk.
    const tmpPath = resolved + '.tmp'
    fs.writeFileSync(tmpPath, content, 'utf-8')
    fs.renameSync(tmpPath, resolved)
    return true
  })

  // Open a schema-declared file path. Renderer passes the raw spec from
  // hzmm.config.json:
  //   { modFilename, spec: { path, relativeTo?: 'game'|'mod', action?: 'reveal'|'open' } }
  // We resolve here (renderer never builds a filesystem target directly) and
  // validate the result stays within the allowed base (gamePath for 'game',
  // mod folder for 'mod'). Returns { ok, reason?, resolved? }.
  ipcMain.handle('mods:open-schema-path', (_: IpcMainInvokeEvent, modFilename: unknown, rawSpec: unknown) => {
    if (!rawSpec || typeof rawSpec !== 'object') return { ok: false, reason: 'invalid-spec' }
    const spec = rawSpec as { path?: unknown; relativeTo?: unknown; action?: unknown }
    if (typeof spec.path !== 'string' || !spec.path) return { ok: false, reason: 'invalid-path' }

    const gamePath = configStore.get('gamePath')
    if (!gamePath) return { ok: false, reason: 'no-game-path' }

    const relativeTo = spec.relativeTo === 'mod' ? 'mod' : 'game'
    const action = spec.action === 'reveal' ? 'reveal' : 'open'

    let base: string
    if (relativeTo === 'mod') {
      try { assertSafeSegment('modFilename', modFilename) } catch { return { ok: false, reason: 'invalid-mod' } }
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (!ue4ssModsPath) return { ok: false, reason: 'no-ue4ss-mods' }
      base = path.join(ue4ssModsPath, modFilename)
    } else {
      base = gamePath
    }

    let resolved: string
    try {
      resolved = resolveWithin(base, spec.path)
    } catch {
      return { ok: false, reason: 'traversal-blocked' }
    }

    if (!fs.existsSync(resolved)) return { ok: false, reason: 'not-found', resolved }

    // openPath uses the OS default association — refuse to "open" executable
    // types (a malicious mod could ship a payload alongside a config whose
    // jump-to-file button targets it). Reveal those in the folder instead.
    // EXECUTABLE_EXTS lives in path-safety.ts as the shared source of truth.
    if (action === 'reveal' || isExecutableExt(resolved)) {
      shell.showItemInFolder(resolved)
    } else {
      // shell.openPath resolves an error message ('' on success); the
      // synchronous-string branch is defensive, kept as it was.
      const result: Promise<string> | string = shell.openPath(resolved)
      if (result && typeof result !== 'string' && typeof result.then === 'function') {
        result.then(msg => { if (msg) logger.warn(`openPath warning: ${msg}`) })
      } else if (typeof result === 'string' && result) {
        logger.warn(`openPath warning: ${result}`)
      }
    }
    return { ok: true, resolved }
  })
}
