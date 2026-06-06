// Profile snapshot / restore IPC. Uses the same scanConfigDir / resolve
// helpers as mods-config.js so that "take a snapshot of every UE4SS mod's
// config" and "replay a snapshot" share the same traversal-safe path
// resolution logic.
//
// Split out of mods.js as part of the 651-line refactor.

import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getUe4ssModsPath } from '../services/steam-detector.js'
import { assertSafeSegment } from '../services/path-safety.js'
import logger from '../services/logger.js'
import { BUILTIN_MODS, CONFIG_EXTENSIONS } from './constants.js'
import { invalidateCache } from './mods-scan.js'
import { scanConfigDir, resolveModConfigPath } from './mods-config.js'

export function registerModsProfilesIpc() {
  ipcMain.handle('profiles:snapshot-configs', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return {}

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) return {}

    const configExts = new Set(CONFIG_EXTENSIONS)
    const excludeFiles = new Set(['enabled.txt', '_hzmm_link.json'])
    const snapshot = {}

    const dirs = fs.readdirSync(ue4ssModsPath)
    for (const dir of dirs) {
      if (BUILTIN_MODS.has(dir)) continue
      const modDir = path.join(ue4ssModsPath, dir)
      if (!fs.statSync(modDir).isDirectory()) continue

      const modConfigs = {}

      scanConfigDir(modDir, '', configExts, excludeFiles, (relPath, fullPath) => {
        try {
          modConfigs[relPath] = fs.readFileSync(fullPath, 'utf-8')
        } catch {
          // 讀不到就跳過
        }
      })
      if (Object.keys(modConfigs).length > 0) {
        snapshot[dir] = modConfigs
      }
    }

    return snapshot
  })

  ipcMain.handle('profiles:restore-configs', (_, configSnapshot) => {
    if (!configSnapshot || typeof configSnapshot !== 'object') return false

    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

    for (const [modName, configs] of Object.entries(configSnapshot)) {
      if (typeof modName !== 'string' || !modName) continue
      try {
        assertSafeSegment('modName', modName)
      } catch (err) {
        logger.warn(`Skipping unsafe mod name in profile restore: ${modName} — ${err.message}`)
        continue
      }
      const modDir = path.join(ue4ssModsPath, modName)
      if (!fs.existsSync(modDir)) continue

      for (const [relativePath, content] of Object.entries(configs)) {
        let resolved
        try {
          resolved = resolveModConfigPath(ue4ssModsPath, modName, relativePath)
        } catch (err) {
          logger.warn(`Skipping traversal attempt in profile restore: ${modName}/${relativePath} — ${err.message}`)
          continue
        }

        const dir = path.dirname(resolved)
        fs.mkdirSync(dir, { recursive: true })

        fs.writeFileSync(resolved, content, 'utf-8')
      }
    }

    invalidateCache()
    return true
  })
}
