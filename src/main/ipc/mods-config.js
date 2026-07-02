// Mod config-related IPC: schema lookup, config file enumeration, read/save,
// and the openPath jump-to-file helper declared by hzmm.config.json.
//
// Split out of mods.js as part of the 651-line refactor. Exports the two
// shared helpers (scanConfigDir, resolveModConfigPath) so that mods-profiles.js
// can reuse them without re-implementing the safety checks.

import { ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getUe4ssModsPath } from '../services/steam-detector.js'
import { resolveWithin, assertSafeSegment, isExecutableExt } from '../services/path-safety.js'
import logger from '../services/logger.js'
import { CONFIG_EXTENSIONS } from './constants.js'

// Resolve a UE4SS mod config file path from renderer-supplied inputs.
// Blocks traversal in BOTH modFilename and relativePath — neither may escape
// the mods root. Throws on any escape attempt or invalid input.
export function resolveModConfigPath(ue4ssModsPath, modFilename, relativePath) {
  if (typeof ue4ssModsPath !== 'string' || !ue4ssModsPath) {
    throw new Error('Invalid mods root')
  }
  if (typeof modFilename !== 'string' || !modFilename) {
    throw new Error('Invalid mod filename')
  }
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('Invalid relative path')
  }
  return resolveWithin(ue4ssModsPath, modFilename, relativePath)
}

// Shared: recursively scan a directory for config files.
// Callers provide a collector closure that sees each matching file.
export function scanConfigDir(dir, relativeBase, configExts, excludeFiles, collector) {
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

export function registerModsConfigIpc() {
  // Schema lookup — returns the parsed hzmm.config.json for a UE4SS mod,
  // or null if absent / PAK mod / unreadable. Renderer uses this to decide
  // between schema-driven and comment-driven config UI.
  ipcMain.handle('mods:get-config-schema', (_, modFilename) => {
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
      return JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))
    } catch (err) {
      logger.warn(`Failed to parse hzmm.config.json for ${modFilename}: ${err.message}`)
      return null
    }
  })

  ipcMain.handle('mods:get-config-files', (_, modFilename) => {
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
    const results = []

    scanConfigDir(modDir, '', configExts, excludeFiles, (relPath, fullPath, stat) => {
      results.push({ name: path.basename(fullPath), relativePath: relPath, size: stat.size })
    })
    return results
  })

  ipcMain.handle('mods:read-config', (_, modFilename, relativePath) => {
    assertSafeSegment('modFilename', modFilename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const resolved = resolveModConfigPath(ue4ssModsPath, modFilename, relativePath)

    if (!fs.existsSync(resolved)) throw new Error('File not found')
    return fs.readFileSync(resolved, 'utf-8')
  })

  ipcMain.handle('mods:save-config', (_, modFilename, relativePath, content) => {
    assertSafeSegment('modFilename', modFilename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    const resolved = resolveModConfigPath(ue4ssModsPath, modFilename, relativePath)

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
  ipcMain.handle('mods:open-schema-path', (_, modFilename, spec) => {
    if (!spec || typeof spec !== 'object') return { ok: false, reason: 'invalid-spec' }
    if (typeof spec.path !== 'string' || !spec.path) return { ok: false, reason: 'invalid-path' }

    const gamePath = configStore.get('gamePath')
    if (!gamePath) return { ok: false, reason: 'no-game-path' }

    const relativeTo = spec.relativeTo === 'mod' ? 'mod' : 'game'
    const action = spec.action === 'reveal' ? 'reveal' : 'open'

    let base
    if (relativeTo === 'mod') {
      try { assertSafeSegment('modFilename', modFilename) } catch { return { ok: false, reason: 'invalid-mod' } }
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (!ue4ssModsPath) return { ok: false, reason: 'no-ue4ss-mods' }
      base = path.join(ue4ssModsPath, modFilename)
    } else {
      base = gamePath
    }

    let resolved
    try {
      resolved = resolveWithin(base, spec.path)
    } catch {
      return { ok: false, reason: 'traversal-blocked' }
    }

    if (!fs.existsSync(resolved)) return { ok: false, reason: 'not-found', resolved }

    // openPath uses the OS default association — refuse to "open" executable
    // types (a malicious mod could ship a payload alongside a config whose
    // jump-to-file button targets it). Reveal those in the folder instead.
    // EXECUTABLE_EXTS lives in path-safety.js as the shared source of truth.
    if (action === 'reveal' || isExecutableExt(resolved)) {
      shell.showItemInFolder(resolved)
    } else {
      const result = shell.openPath(resolved)
      if (result && typeof result.then === 'function') {
        result.then(msg => { if (msg) logger.warn(`openPath warning: ${msg}`) })
      } else if (typeof result === 'string' && result) {
        logger.warn(`openPath warning: ${result}`)
      }
    }
    return { ok: true, resolved }
  })
}
