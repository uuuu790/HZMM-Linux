import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getPaksPath, getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'
import { extractZip, extractRar, copyFile } from '../services/archive.js'
import logger from '../services/logger.js'
import { normalizeReadme } from '../services/readme-utils.js'
import { invalidateCache } from './mods-scan.js'
import { syncUe4ssModRegistry } from './mods-registry.js'

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src)
  for (const entry of entries) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    const stat = fs.statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// renameSync throws EXDEV across volumes (e.g. game on D:, %APPDATA% on C:).
// Fall back to copy + remove so the rotate-on-overwrite flow works regardless
// of which drive the user installs HumanitZ on.
function moveAcrossVolume(src, dest) {
  try {
    fs.renameSync(src, dest)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    if (fs.statSync(src).isDirectory()) {
      copyDirSync(src, dest)
      fs.rmSync(src, { recursive: true, force: true })
    } else {
      fs.copyFileSync(src, dest)
      fs.unlinkSync(src)
    }
  }
}

// Recursively find UE4SS mod folders (those containing Scripts/main.lua, main.lua, or .dll)
function findUe4ssFolders(dir) {
  const results = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (!fs.statSync(full).isDirectory()) continue
    const hasScripts = fs.existsSync(path.join(full, 'Scripts', 'main.lua'))
    const hasMain = fs.existsSync(path.join(full, 'main.lua'))
    // UE4SS cppmod entry point is `<Mod>/dlls/main.dll`; first-level .dll
    // is a fallback in case the zip was packed unusually.
    const hasDll = fs.existsSync(path.join(full, 'dlls', 'main.dll'))
      || fs.readdirSync(full).some(f => f.endsWith('.dll'))
    if (hasScripts || hasMain || hasDll) {
      results.push({ name: entry, path: full })
    } else {
      // Recurse into subdirectories (zip may have a wrapper folder)
      results.push(...findUe4ssFolders(full))
    }
  }
  return results
}

// Move (not delete) existing mod files into a backup folder so a failed
// install can restore them. Returns a list of { from, to } entries.
function rotateModsToBackup(gamePath, mods, backupRoot) {
  const moved = []
  const allPaksPaths = getAllPaksPaths(gamePath)
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  let counter = 0

  for (const mod of mods) {
    if (mod.modType === 'PAK') {
      const candidates = [mod.name + '_P.pak', mod.name + '.pak']
      for (const pp of allPaksPaths) {
        for (const pakName of candidates) {
          for (const suffix of ['', '.disabled']) {
            const fp = path.join(pp, pakName + suffix)
            if (fs.existsSync(fp)) {
              const bp = path.join(backupRoot, `${counter++}_${pakName}${suffix}`)
              moveAcrossVolume(fp, bp)
              moved.push({ from: fp, to: bp })
            }
          }
        }
      }
      const readmePath = path.join(configStore.getConfigDir(), 'readmes', `${mod.name}.txt`)
      if (fs.existsSync(readmePath)) {
        const bp = path.join(backupRoot, `${counter++}_readme_${mod.name}.txt`)
        try { moveAcrossVolume(readmePath, bp); moved.push({ from: readmePath, to: bp }) } catch { /* best-effort */ }
      }
    } else if (mod.modType === 'UE4SS' && ue4ssModsPath) {
      const modDir = path.join(ue4ssModsPath, mod.name)
      if (fs.existsSync(modDir)) {
        const bp = path.join(backupRoot, `${counter++}_ue4ss_${mod.name}`)
        moveAcrossVolume(modDir, bp)
        moved.push({ from: modDir, to: bp })
      }
    }
  }
  return moved
}

// Put backed-up files back where they were. Removes anything currently at
// the destination first (partial extract leftovers from the failed install).
function restoreFromBackup(moved) {
  for (const { from, to } of moved) {
    try {
      if (fs.existsSync(from)) {
        if (fs.statSync(from).isDirectory()) fs.rmSync(from, { recursive: true, force: true })
        else fs.unlinkSync(from)
      }
      moveAcrossVolume(to, from)
    } catch (err) {
      logger.error(`Rollback failed for ${from}: ${err.message}`)
    }
  }
}

// Run `work` with all of `mods`' existing on-disk artifacts moved aside.
// On success: drop the backup. On throw: restore the originals (after
// cleaning any partial new files) and rethrow. Use instead of
// cleanExistingMod so a mid-extract failure doesn't leave the user with
// no old version AND no working new version.
async function withRollback(gamePath, mods, work) {
  if (!mods || mods.length === 0) return work()
  const backupRoot = path.join(configStore.getConfigDir(), 'install-rollback', String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8))
  fs.mkdirSync(backupRoot, { recursive: true })
  let moved = []
  try {
    moved = rotateModsToBackup(gamePath, mods, backupRoot)
    const result = await work()
    fs.rmSync(backupRoot, { recursive: true, force: true })
    return result
  } catch (err) {
    restoreFromBackup(moved)
    try { fs.rmSync(backupRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
    throw err
  }
}

async function installMods(filePaths, mainWindow) {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) throw new Error('Game path not set')

  const paksPath = getPaksPath(gamePath)
  const installed = []
  let thrown = null

  try {
  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase()

    if (ext === '.pak') {
      const name = path.basename(filePath).replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
      const pakMods = [{ name, modType: 'PAK' }]
      await withRollback(gamePath, pakMods, () => {
        copyFile(filePath, paksPath)
      })
      // `mods` carries the actual landed identifiers so Nexus tracking can
      // reconcile its install list against what's currently on disk (lets
      // the "已安裝" badge auto-clear when the user removes the mod).
      installed.push({ name: path.basename(filePath), type: 'pak-only', mods: pakMods })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: pak-only)`)
    } else if (ext === '.zip' || ext === '.rar') {
      const extractFn = ext === '.zip' ? extractZip : extractRar

      const analysis = await extractFn(filePath, null, true)
      const { type, hasGameStructure } = analysis

      await withRollback(gamePath, analysis.mods || [], async () => {
        if (type === 'pak-only') {
          await extractFn(filePath, paksPath)
        } else if (type === 'hybrid') {
          const ue4ssModsPath = getUe4ssModsPath(gamePath)
          if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')
          const pakNames = analysis.pakFiles.map(p => path.basename(p))

          if (hasGameStructure) {
            await extractFn(filePath, gamePath)
          } else {
            const tempDir = path.join(gamePath, '_hzmm_hybrid_temp')
            try {
              // Stale leftovers from a previous crashed install would otherwise
              // get walked into the game alongside the new mod's files.
              fs.rmSync(tempDir, { recursive: true, force: true })
              await extractFn(filePath, tempDir)
              const walkFiles = (dir) => {
                const results = []
                for (const entry of fs.readdirSync(dir)) {
                  const full = path.join(dir, entry)
                  if (fs.statSync(full).isDirectory()) results.push(...walkFiles(full))
                  else results.push(full)
                }
                return results
              }
              for (const f of walkFiles(tempDir)) {
                if (f.endsWith('.pak') || f.endsWith('.ucas') || f.endsWith('.utoc')) {
                  fs.copyFileSync(f, path.join(paksPath, path.basename(f)))
                }
              }
              for (const folder of findUe4ssFolders(tempDir)) {
                copyDirSync(folder.path, path.join(ue4ssModsPath, folder.name))
              }
            } finally {
              fs.rmSync(tempDir, { recursive: true, force: true })
            }
          }

          // Walk `analysis.mods` (covers lua and cppmod folders) so cppmod-only
          // hybrid packs also get the link written, letting remove/toggle on
          // the UE4SS side carry the paired PAK along.
          for (const mod of (analysis.mods || [])) {
            if (mod.modType !== 'UE4SS') continue
            const destDir = path.join(ue4ssModsPath, mod.name)
            if (fs.existsSync(destDir)) {
              fs.writeFileSync(path.join(destDir, '_hzmm_link.json'), JSON.stringify({ pakFiles: pakNames }), 'utf-8')
              logger.info(`Hybrid link saved: ${mod.name} ↔ ${pakNames.join(', ')}`)
            }
          }
        } else if (type === 'ue4ss-mod' && !hasGameStructure) {
          const ue4ssModsPath = getUe4ssModsPath(gamePath)
          if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')

          const tempDir = path.join(gamePath, '_hzmm_ue4ss_temp')
          try {
            // Stale leftovers from a previous crashed install would otherwise
            // get copied into the UE4SS Mods folder alongside the new mod.
            fs.rmSync(tempDir, { recursive: true, force: true })
            await extractFn(filePath, tempDir)
            const folders = findUe4ssFolders(tempDir)
            for (const folder of folders) {
              copyDirSync(folder.path, path.join(ue4ssModsPath, folder.name))
            }
          } finally {
            fs.rmSync(tempDir, { recursive: true, force: true })
          }
        } else {
          // game-structure / ue4ss-mod with game structure / complex → 解壓到遊戲根目錄
          await extractFn(filePath, gamePath)
        }
      })

      // Extract readme from archive and save for PAK mods
      if (analysis.readmeFiles && analysis.readmeFiles.length > 0 && analysis.mods) {
        try {
          const readmesDir = path.join(configStore.getConfigDir(), 'readmes')
          fs.mkdirSync(readmesDir, { recursive: true })
          const normalizedReadme = analysis.readmeFiles[0]
          if (ext === '.zip') {
            const StreamZip = (await import('node-stream-zip')).default
            const zip = new StreamZip.async({ file: filePath, skipEntryNameValidation: true })
            try {
              const entries = await zip.entries()
              const match = Object.values(entries).find(e => e.name.replace(/\\/g, '/') === normalizedReadme)
              if (match) {
                const buf = await zip.entryData(match)
                const content = normalizeReadme(buf)
                for (const mod of analysis.mods) {
                  fs.writeFileSync(path.join(readmesDir, `${mod.name}.txt`), content, 'utf-8')
                  logger.info(`Readme saved for mod: ${mod.name}`)
                }
              }
            } finally { await zip.close() }
          } else {
            logger.info(`Readme found in rar but extraction not yet supported`)
          }
        } catch (err) { logger.warn(`Failed to extract readme: ${err.message}`) }
      }

      // Sync mods.txt / mods.json for installed UE4SS mods
      if (analysis.mods) {
        const ue4ssModsPath = getUe4ssModsPath(gamePath)
        if (ue4ssModsPath) {
          for (const mod of analysis.mods) {
            if (mod.modType === 'UE4SS') {
              syncUe4ssModRegistry(ue4ssModsPath, mod.name, true)
            }
          }
        }
      }

      // `mods` echoes the archive analysis so downstream consumers (e.g.
      // Nexus tracking) know which local mod names actually landed, which
      // lets them later cross-check against scanMods() to auto-clear the
      // install badge when the user removes a mod via the Modules tab.
      installed.push({ name: path.basename(filePath), type, mods: analysis.mods || [] })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: ${type})`)
    }
  }
  } catch (err) {
    thrown = err
  } finally {
    // Always refresh cache + notify renderer, even on partial failure,
    // so the UI reflects what actually landed on disk.
    invalidateCache()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mods:updated')
    }
  }

  if (thrown) {
    // Attach partial success info so caller can surface "X of Y installed"
    thrown.installed = installed
    throw thrown
  }

  return installed
}

export { installMods, copyDirSync, withRollback }
