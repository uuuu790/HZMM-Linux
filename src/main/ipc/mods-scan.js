import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector.js'
import logger from '../services/logger.js'
import { BUILTIN_MODS } from './constants.js'

// --- Mod scan cache ---
let modCache = {
  pakDirMtimes: {},
  ue4ssDirMtime: null,
  mods: [],
  valid: false
}

function getDirMtime(dirPath) {
  try {
    return fs.statSync(dirPath).mtimeMs
  } catch {
    return null
  }
}

// Recognize a directory as a UE4SS mod via its entry-point shape:
//   - Scripts/main.lua  → standard Lua mod (UE4SS docs default)
//   - main.lua          → flat-layout Lua mod (some authors omit Scripts/)
//   - dlls/main.dll     → C++ cppmod (UE4SS cppmod spec)
//   - any first-level *.dll → fallback for unusual zip layouts
//
// Exported so unit tests can pin the detection rules — the cppmod path was
// missing before 1.3.6 (`dlls/main.dll`), which made HZDamageDisplay invisible.
export function isUe4ssMod(modDir) {
  const hasScripts = fs.existsSync(path.join(modDir, 'Scripts', 'main.lua'))
  const hasMainLua = fs.existsSync(path.join(modDir, 'main.lua'))
  const hasCppMod = fs.existsSync(path.join(modDir, 'dlls', 'main.dll'))
  if (hasScripts || hasMainLua || hasCppMod) return true
  // Last resort: any first-level .dll (defensive against odd packaging).
  try {
    return fs.readdirSync(modDir).some(f => f.endsWith('.dll'))
  } catch {
    return false
  }
}

function isCacheValid() {
  if (!modCache.valid) return false

  const gamePath = configStore.get('gamePath')
  if (!gamePath) return false

  const paksPaths = getAllPaksPaths(gamePath)
  for (const p of paksPaths) {
    const current = getDirMtime(p)
    if (current !== modCache.pakDirMtimes[p]) return false
  }

  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  if (ue4ssModsPath) {
    const current = getDirMtime(ue4ssModsPath)
    if (current !== modCache.ue4ssDirMtime) return false
  }

  return true
}

function updateCacheState(mods) {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return

  const paksPaths = getAllPaksPaths(gamePath)
  const pakDirMtimes = {}
  for (const p of paksPaths) {
    pakDirMtimes[p] = getDirMtime(p)
  }

  const ue4ssModsPath = getUe4ssModsPath(gamePath)

  modCache = {
    pakDirMtimes,
    ue4ssDirMtime: ue4ssModsPath ? getDirMtime(ue4ssModsPath) : null,
    mods,
    valid: true
  }
}

function invalidateCache() {
  modCache.valid = false
}

function getCachedMods() {
  return modCache.mods
}

function scanMods() {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return []

  const mods = []
  const seenPakIds = new Set()

  // --- 先掃描 UE4SS Lua mods（收集 hybrid 連結）---
  const hybridPakMap = new Map() // pakBaseName → ue4ss mod folder name
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  if (ue4ssModsPath && fs.existsSync(ue4ssModsPath)) {
    const dirs = fs.readdirSync(ue4ssModsPath)

    for (const dir of dirs) {
      if (BUILTIN_MODS.has(dir) || dir.startsWith('.')) continue

      const modDir = path.join(ue4ssModsPath, dir)
      const stat = fs.statSync(modDir)
      if (!stat.isDirectory()) continue

      if (!isUe4ssMod(modDir)) continue

      const enabledFile = path.join(modDir, 'enabled.txt')
      const ue4ssEnabled = fs.existsSync(enabledFile)

      // 檢查 hybrid 連結
      const linkFile = path.join(modDir, '_hzmm_link.json')
      let linkedPaks = null
      if (fs.existsSync(linkFile)) {
        try {
          linkedPaks = JSON.parse(fs.readFileSync(linkFile, 'utf-8')).pakFiles || []
          linkedPaks.forEach(p => hybridPakMap.set(p.replace('.disabled', ''), dir))
        } catch { linkedPaks = null }
      }

      const isHybrid = linkedPaks && linkedPaks.length > 0
      mods.push({
        id: `ue4ss:${dir}`,
        filename: dir,
        title: dir.replace(/_/g, ' ').replace(/-/g, ' '),
        enabled: ue4ssEnabled,
        size: 0,
        modified: stat.mtime.toISOString(),
        type: 'UE4SS',
        hybrid: isHybrid,
        linkedPaks: isHybrid ? linkedPaks : undefined,
        path: modDir
      })
    }
  }

  // --- 掃描 PAK mods（hybrid 標記但不隱藏）---
  const paksPaths = getAllPaksPaths(gamePath)
  for (const paksPath of paksPaths) {
    try {
      const files = fs.readdirSync(paksPath)

      for (const file of files) {
        const filePath = path.join(paksPath, file)
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) continue

        const isPak = file.endsWith('.pak')
        const isDisabled = file.endsWith('.pak.disabled')

        const baseLower = file.toLowerCase()
        if (baseLower.startsWith('pakchunk') || baseLower.startsWith('global')) continue

        if (isPak || isDisabled) {
          const baseName = file.replace('.disabled', '')
          if (seenPakIds.has(baseName)) continue
          seenPakIds.add(baseName)
          const linkedUe4ss = hybridPakMap.get(baseName) || null

          mods.push({
            id: baseName,
            filename: file,
            title: baseName.replace('.pak', '').replace(/_P$/, '').replace(/_/g, ' ').replace(/-/g, ' '),
            enabled: isPak,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            type: 'PAK',
            hybrid: !!linkedUe4ss,
            linkedUe4ss: linkedUe4ss || undefined,
            path: filePath
          })
        }
      }
    } catch (err) {
      logger.warn(`Failed to scan PAK directory ${paksPath}: ${err.message}`)
    }
  }

  return mods
}

export { scanMods, isCacheValid, updateCacheState, invalidateCache, getCachedMods }
