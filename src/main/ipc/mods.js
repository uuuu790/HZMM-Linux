import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'
import { extractZip, extractRar } from '../services/archive.js'
import { assertSafeSegment } from '../services/path-safety.js'
import logger from '../services/logger.js'
import { scanMods, isCacheValid, updateCacheState, invalidateCache, getCachedMods } from './mods-scan.js'
import { syncUe4ssModRegistry, removeFromUe4ssModRegistry } from './mods-registry.js'
import { installMods, serializeModWrite } from './mods-install.js'
import { ALLOWED_MOD_HOSTS, isAllowedModUrl } from './mods-download.js'

// Re-export for external consumers (tests, etc.)
export { ALLOWED_MOD_HOSTS, isAllowedModUrl }
// Back-compat re-export: resolveModConfigPath moved to mods-config.js but
// tests/ipc/mods-config-path.test.js imports from mods.js by path. Keep the
// re-export so the test suite doesn't break.
export { resolveModConfigPath } from './mods-config.js'

// serializeModWrite (the shared write mutex) is imported from mods-install.js
// so toggle/remove here share ONE chain with every install path — preventing a
// Nexus/URL install from interleaving with a toggle on the same files.
//
// Core mod IPC: scan / toggle / install / remove / preview / URL-install.
// Config / profile snapshot / readme handlers live in sibling modules
// (mods-config.js, mods-profiles.js, mods-readme.js) — see main/index.js
// for the wiring.
function registerModsIpc(mainWindow) {
  // --- Scan ---
  ipcMain.handle('mods:scan', () => {
    let cached
    if (isCacheValid()) {
      cached = getCachedMods()
    } else {
      cached = scanMods()
      updateCacheState(cached)
    }
    // Shallow-copy each mod before merging custom names so we never mutate the
    // long-lived cache (which would leave stale customName on cleared mods).
    const customNames = configStore.get('modCustomNames', {})
    return cached.map(mod => {
      const copy = { ...mod }
      if (customNames[mod.id]) copy.customName = customNames[mod.id]
      else delete copy.customName
      return copy
    })
  })

  ipcMain.handle('mods:invalidate-cache', () => {
    invalidateCache()
  })

  // --- Custom Name ---
  ipcMain.handle('mods:set-custom-name', (_, modId, customName) => {
    if (typeof modId !== 'string' || !modId) throw new Error('Invalid mod ID')
    if (modId.length > 260) throw new Error('Mod ID too long')
    const names = configStore.get('modCustomNames', {})
    if (customName && typeof customName === 'string' && customName.trim()) {
      // Cap at 200 chars — well beyond any reasonable mod title but keeps
      // a malicious renderer from ballooning config.json to MBs.
      const trimmed = customName.trim().slice(0, 200)
      names[modId] = trimmed
    } else {
      delete names[modId]
    }
    configStore.set('modCustomNames', names)
  })

  // --- Toggle ---
  // Serialized with install/remove so concurrent operations on the same
  // mod's enabled.txt / pak rename / mods.txt don't interleave.
  ipcMain.handle('mods:toggle', (_, filename) => serializeModWrite(() => {
    assertSafeSegment('filename', filename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const isPakMod = filename.endsWith('.pak') || filename.endsWith('.pak.disabled')

    if (!isPakMod) {
      // UE4SS / Hybrid mod toggle — filename 是資料夾名
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

      const modDir = path.join(ue4ssModsPath, filename)
      if (!fs.existsSync(modDir)) throw new Error(`Mod folder not found: ${filename}`)

      const enabledFile = path.join(modDir, 'enabled.txt')
      const isEnabled = fs.existsSync(enabledFile)

      if (isEnabled) {
        fs.unlinkSync(enabledFile)
      } else {
        fs.writeFileSync(enabledFile, '', 'utf-8')
      }

      // Sync mods.txt / mods.json
      syncUe4ssModRegistry(ue4ssModsPath, filename, !isEnabled)

      // Hybrid 連動：一起切換關聯的 PAK
      const linkFile = path.join(modDir, '_hzmm_link.json')
      if (fs.existsSync(linkFile)) {
        try {
          const { pakFiles: linkedPaks } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          const allPaksPaths = getAllPaksPaths(gamePath)
          for (const pakName of (linkedPaks || [])) {
            const baseName = pakName.replace('.disabled', '')
            // _hzmm_link.json is attacker-authorable (shipped inside a mod) —
            // keep linked pak names a flat in-dir segment before touching fs.
            try { assertSafeSegment('linkedPak', baseName) } catch { continue }
            for (const pp of allPaksPaths) {
              const enabledPath = path.join(pp, baseName)
              const disabledPath = path.join(pp, baseName + '.disabled')
              if (isEnabled && fs.existsSync(enabledPath)) {
                // 要禁用 → .pak → .pak.disabled
                fs.renameSync(enabledPath, disabledPath)
                logger.info(`Hybrid PAK toggled: ${baseName} → disabled`)
              } else if (!isEnabled && fs.existsSync(disabledPath)) {
                // 要啟用 → .pak.disabled → .pak
                fs.renameSync(disabledPath, enabledPath)
                logger.info(`Hybrid PAK toggled: ${baseName} → enabled`)
              }
            }
          }
        } catch (err) {
          logger.warn(`Failed to toggle hybrid PAK: ${err.message}`)
        }
      }

      invalidateCache()
      logger.info(`Mod toggled: ${filename} → ${!isEnabled ? 'enabled' : 'disabled'}`)
      return {
        id: `ue4ss:${filename}`,
        filename,
        enabled: !isEnabled,
        path: modDir
      }
    }

    // PAK mod toggle — search across ALL paks paths
    const paksPaths = getAllPaksPaths(gamePath)
    let filePath = null
    for (const paksPath of paksPaths) {
      const candidate = path.join(paksPath, filename)
      if (fs.existsSync(candidate)) {
        filePath = candidate
        break
      }
    }

    if (!filePath) throw new Error(`File not found: ${filename}`)

    let newPath
    if (filename.endsWith('.pak.disabled')) {
      newPath = filePath.replace('.disabled', '')
    } else {
      newPath = filePath + '.disabled'
    }

    fs.renameSync(filePath, newPath)
    const pakNowEnabled = newPath.endsWith('.pak')

    // Hybrid 反向連動：toggle PAK 時也 toggle 關聯的 UE4SS
    const ue4ssModsPath2 = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath2) {
      const baseName = filename.replace('.disabled', '')
      try {
        // Visit ALL matching link files — multiple UE4SS mods can legitimately
        // reference the same PAK (e.g. after a manual edit or reinstall that
        // duplicated a link). Previous code only toggled the first match and
        // silently left the rest out of sync.
        for (const dir of fs.readdirSync(ue4ssModsPath2)) {
          const linkFile = path.join(ue4ssModsPath2, dir, '_hzmm_link.json')
          if (!fs.existsSync(linkFile)) continue
          const { pakFiles } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          if (!(pakFiles || []).some(p => p.replace('.disabled', '') === baseName)) continue
          const enabledFile = path.join(ue4ssModsPath2, dir, 'enabled.txt')
          if (pakNowEnabled && !fs.existsSync(enabledFile)) {
            fs.writeFileSync(enabledFile, '', 'utf-8')
            logger.info(`Hybrid UE4SS toggled: ${dir} → enabled`)
          } else if (!pakNowEnabled && fs.existsSync(enabledFile)) {
            fs.unlinkSync(enabledFile)
            logger.info(`Hybrid UE4SS toggled: ${dir} → disabled`)
          }
        }
      } catch (err) {
        logger.warn(`Failed to toggle hybrid UE4SS: ${err.message}`)
      }
    }

    invalidateCache()
    logger.info(`Mod toggled: ${filename} → ${pakNowEnabled ? 'enabled' : 'disabled'}`)
    return {
      id: path.basename(newPath).replace('.disabled', ''),
      filename: path.basename(newPath),
      enabled: pakNowEnabled,
      path: newPath
    }
  }))

  // --- Install ---
  // installMods serializes its own write phase internally (and validates
  // filePaths), so we must NOT wrap it in serializeModWrite again here —
  // double-wrapping deadlocks (outer task awaits inner, inner queued behind it).
  ipcMain.handle('mods:install', (_, filePaths) => installMods(filePaths, mainWindow))

  // --- Remove ---
  // Serialized with install/toggle so concurrent operations don't
  // interleave on the same hybrid link files / mods.txt.
  ipcMain.handle('mods:remove', (_, filename) => serializeModWrite(() => {
    assertSafeSegment('filename', filename)
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')

    const isPakMod = filename.endsWith('.pak') || filename.endsWith('.pak.disabled')

    if (!isPakMod) {
      // UE4SS mod removal — filename 是資料夾名
      const ue4ssModsPath = getUe4ssModsPath(gamePath)
      if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found')

      const modDir = path.join(ue4ssModsPath, filename)

      // Hybrid 連動：一起刪除關聯的 PAK
      const linkFile = path.join(modDir, '_hzmm_link.json')
      if (fs.existsSync(linkFile)) {
        try {
          const { pakFiles: linkedPaks } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          const allPaksPaths = getAllPaksPaths(gamePath)
          for (const pakName of (linkedPaks || [])) {
            const baseName = pakName.replace('.disabled', '')
            try { assertSafeSegment('linkedPak', baseName) } catch { continue }
            for (const pp of allPaksPaths) {
              const ep = path.join(pp, baseName)
              const dp = path.join(pp, baseName + '.disabled')
              if (fs.existsSync(ep)) { fs.unlinkSync(ep); logger.info(`Hybrid PAK removed: ${baseName}`); break }
              if (fs.existsSync(dp)) { fs.unlinkSync(dp); logger.info(`Hybrid PAK removed: ${baseName}.disabled`); break }
            }
          }
        } catch (err) { logger.warn(`Failed to remove hybrid PAK: ${err.message}`) }
      }

      if (fs.existsSync(modDir)) {
        fs.rmSync(modDir, { recursive: true, force: true })
      }
      // Remove from mods.txt / mods.json
      removeFromUe4ssModRegistry(ue4ssModsPath, filename)
      invalidateCache()
      // Notify renderer so downstream consumers (Nexus installed-badge tracker)
      // can reconcile their state against the now-shrunk local mod inventory.
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:updated')
      logger.info(`Mod removed: ${filename}`)
      return true
    }

    // PAK mod removal — search across ALL paks paths
    const paksPaths = getAllPaksPaths(gamePath)
    let found = false
    for (const paksPath of paksPaths) {
      const filePath = path.join(paksPath, filename)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        found = true
        break
      }
    }

    if (!found) throw new Error(`PAK file not found: ${filename}`)

    // Clean up saved readme for PAK mod
    const modName = filename.replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
    const readmePath = path.join(configStore.getConfigDir(), 'readmes', `${modName}.txt`)
    if (fs.existsSync(readmePath)) { try { fs.unlinkSync(readmePath) } catch { /* readme cleanup is best-effort */ } }

    // Hybrid 反向連動：刪 PAK 時也刪關聯的 UE4SS
    const ue4ssModsPath2 = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath2) {
      const baseName = filename.replace('.disabled', '')
      try {
        for (const dir of fs.readdirSync(ue4ssModsPath2)) {
          const linkFile = path.join(ue4ssModsPath2, dir, '_hzmm_link.json')
          if (!fs.existsSync(linkFile)) continue
          const { pakFiles } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
          if (!(pakFiles || []).some(p => p.replace('.disabled', '') === baseName)) continue
          fs.rmSync(path.join(ue4ssModsPath2, dir), { recursive: true, force: true })
          removeFromUe4ssModRegistry(ue4ssModsPath2, dir)
          logger.info(`Hybrid UE4SS removed: ${dir}`)
          break
        }
      } catch (err) { logger.warn(`Failed to remove hybrid UE4SS: ${err.message}`) }
    }

    invalidateCache()
    // Notify renderer so downstream consumers (Nexus installed-badge tracker)
    // can reconcile their state against the now-shrunk local mod inventory.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:updated')
    logger.info(`Mod removed: ${filename}`)
    return true
  }))

  // --- Install Preview ---
  ipcMain.handle('mods:preview', async (_, filePaths) => {
    // Same trust-boundary validation as installMods — preview reads / extracts
    // the given archives, so reject non-absolute or non-.zip/.rar/.pak inputs.
    if (!Array.isArray(filePaths)) throw new Error('Invalid file list')
    for (const fp of filePaths) {
      if (typeof fp !== 'string' || !path.isAbsolute(fp)) throw new Error(`Invalid file path: ${String(fp)}`)
      const ext = path.extname(fp).toLowerCase()
      if (ext !== '.zip' && ext !== '.rar' && ext !== '.pak') throw new Error(`Unsupported file type: ${path.basename(fp)}`)
    }
    const gamePath = configStore.get('gamePath')
    const allPaksPaths = gamePath ? getAllPaksPaths(gamePath) : []
    const ue4ssModsPath = gamePath ? getUe4ssModsPath(gamePath) : null

    // Build set of existing mod names for conflict detection
    const existingPaks = new Set()
    for (const pp of allPaksPaths) {
      try {
        for (const f of fs.readdirSync(pp)) {
          if (f.endsWith('.pak') || f.endsWith('.pak.disabled')) {
            // Strip .pak unconditionally then the _P suffix, mirroring the
            // archive-side mod-name normalization (archive.js). Using /_P\.pak$/
            // alone left the extension on plain non-_P paks, so they never matched.
            existingPaks.add(f.replace('.disabled', '').replace(/\.pak$/i, '').replace(/_P$/i, '').toLowerCase())
          }
        }
      } catch { /* directory may not exist yet — skip */ }
    }
    const existingUe4ss = new Set()
    if (ue4ssModsPath && fs.existsSync(ue4ssModsPath)) {
      try {
        for (const d of fs.readdirSync(ue4ssModsPath)) {
          if (fs.statSync(path.join(ue4ssModsPath, d)).isDirectory()) {
            existingUe4ss.add(d.toLowerCase())
          }
        }
      } catch { /* directory may not exist yet — skip */ }
    }

    const results = []
    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase()
      try {
        let mods = []
        let type = 'unknown'
        let totalFiles = 0

        if (ext === '.pak') {
          const name = path.basename(filePath).replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
          mods = [{ name, modType: 'PAK' }]
          type = 'pak-only'
          totalFiles = 1
        } else if (ext === '.zip') {
          const analysis = await extractZip(filePath, null, true)
          mods = analysis.mods || []
          type = analysis.type
          totalFiles = (analysis.entryNames || []).filter(n => !n.endsWith('/')).length
        } else if (ext === '.rar') {
          const analysis = await extractRar(filePath, null, true)
          mods = analysis.mods || []
          type = analysis.type
          totalFiles = (analysis.entryNames || []).filter(n => !n.endsWith('/')).length
        }

        // Check each mod for existing conflicts
        for (const mod of mods) {
          if (mod.modType === 'PAK' && existingPaks.has(mod.name.toLowerCase())) {
            mod.existing = true
          } else if (mod.modType === 'UE4SS' && existingUe4ss.has(mod.name.toLowerCase())) {
            mod.existing = true
          }
        }

        results.push({ filePath, fileName: path.basename(filePath), type, mods, totalFiles })
      } catch (err) {
        logger.error(`Preview failed for ${filePath}: ${err.message}`)
        results.push({ filePath, fileName: path.basename(filePath), type: 'unknown', mods: [], totalFiles: 0, error: err.message })
      }
    }
    return results
  })

}

export { registerModsIpc, scanMods }
