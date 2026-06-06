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

// Remove existing mod files before reinstall to avoid leftover artifacts
function cleanExistingMod(gamePath, mods) {
  const allPaksPaths = getAllPaksPaths(gamePath)
  const ue4ssModsPath = getUe4ssModsPath(gamePath)

  for (const mod of mods) {
    if (mod.modType === 'PAK') {
      // Remove existing PAK (enabled or disabled) from all paks paths.
      // Analyzer strips `_P` from the mod name, but packages don't always use
      // the `_P` suffix — also check the plain name so we don't leak the old
      // file alongside the fresh install.
      const candidates = [mod.name + '_P.pak', mod.name + '.pak']
      for (const pp of allPaksPaths) {
        for (const pakName of candidates) {
          for (const suffix of ['', '.disabled']) {
            const fp = path.join(pp, pakName + suffix)
            if (fs.existsSync(fp)) {
              fs.unlinkSync(fp)
              logger.info(`Pre-install cleanup: removed ${pakName}${suffix}`)
            }
          }
        }
      }
      // Remove saved readme
      const readmePath = path.join(configStore.getConfigDir(), 'readmes', `${mod.name}.txt`)
      if (fs.existsSync(readmePath)) { try { fs.unlinkSync(readmePath) } catch { /* readme cleanup is best-effort */ } }
    } else if (mod.modType === 'UE4SS' && ue4ssModsPath) {
      const modDir = path.join(ue4ssModsPath, mod.name)
      if (fs.existsSync(modDir)) {
        fs.rmSync(modDir, { recursive: true, force: true })
        logger.info(`Pre-install cleanup: removed UE4SS folder ${mod.name}`)
      }
    }
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
      // Clean existing before install
      const name = path.basename(filePath).replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
      cleanExistingMod(gamePath, [{ name, modType: 'PAK' }])
      copyFile(filePath, paksPath)
      // `mods` carries the actual landed identifiers so Nexus tracking can
      // reconcile its install list against what's currently on disk (lets
      // the "已安裝" badge auto-clear when the user removes the mod).
      installed.push({ name: path.basename(filePath), type: 'pak-only', mods: [{ name, modType: 'PAK' }] })
      logger.info(`Mod installed: ${path.basename(filePath)} (type: pak-only)`)
    } else if (ext === '.zip' || ext === '.rar') {
      const extractFn = ext === '.zip' ? extractZip : extractRar

      const analysis = await extractFn(filePath, null, true)
      const { type, hasGameStructure } = analysis

      // Clean existing mods before install
      if (analysis.mods && analysis.mods.length > 0) {
        cleanExistingMod(gamePath, analysis.mods)
      }

      if (type === 'pak-only') {
        await extractFn(filePath, paksPath)
      } else if (type === 'hybrid') {
        // 混合型：PAK 和 UE4SS 分開處理，存連結檔做配套
        const ue4ssModsPath = getUe4ssModsPath(gamePath)
        if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')
        const pakNames = analysis.pakFiles.map(p => path.basename(p))

        if (hasGameStructure) {
          await extractFn(filePath, gamePath)
        } else {
          const tempDir = path.join(gamePath, '_hzmm_hybrid_temp')
          try {
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

        // 存連結檔到每個 UE4SS mod 資料夾
        const ue4ssFolderNames = new Set()
        for (const luaFile of (analysis.luaFiles || [])) {
          const parts = luaFile.replace(/\\/g, '/').split('/')
          const idx = parts.findIndex(p => p.toLowerCase() === 'scripts')
          if (idx > 0) ue4ssFolderNames.add(parts[idx - 1])
        }
        for (const folder of ue4ssFolderNames) {
          const destDir = path.join(ue4ssModsPath, folder)
          if (fs.existsSync(destDir)) {
            fs.writeFileSync(path.join(destDir, '_hzmm_link.json'), JSON.stringify({ pakFiles: pakNames }), 'utf-8')
            logger.info(`Hybrid link saved: ${folder} ↔ ${pakNames.join(', ')}`)
          }
        }
      } else if (type === 'ue4ss-mod' && !hasGameStructure) {
        // UE4SS mod（無遊戲目錄結構）→ 解壓到 UE4SS Mods 資料夾
        const ue4ssModsPath = getUe4ssModsPath(gamePath)
        if (!ue4ssModsPath) throw new Error('UE4SS Mods folder not found. Please install UE4SS first.')

        const tempDir = path.join(gamePath, '_hzmm_ue4ss_temp')
        try {
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

export { installMods, cleanExistingMod, copyDirSync }
