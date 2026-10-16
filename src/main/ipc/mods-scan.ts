import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import { getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector'
import logger from '../services/logger'
import { BUILTIN_MODS } from './constants'
import { stripOrderPrefix } from './mods-order'
import { readUe4ssEnabledNames } from './mods-registry'
import type { ScannedMod } from './types'

// --- Mod scan cache ---
interface ModCache {
  pakDirMtimes: Record<string, number | null>
  ue4ssDirMtime: number | null
  mods: ScannedMod[]
  valid: boolean
}

let modCache: ModCache = {
  pakDirMtimes: {},
  ue4ssDirMtime: null,
  mods: [],
  valid: false
}

function getDirMtime(dirPath: string): number | null {
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
export function isUe4ssMod(modDir: string): boolean {
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

// Classify a recognized UE4SS mod into its subtype for UI grouping.
// Lua-priority: if a Lua entry exists, it's a Lua mod even when a DLL is also
// present (the DLL is treated as an auxiliary resource). Only when there's no
// Lua entry do we look at dlls/main.dll or any first-level *.dll → cpp.
// Mirrors isUe4ssMod's detection signals so the two never disagree.
export function classifyUe4ssMod(modDir: string): 'lua' | 'cpp' {
  const hasScripts = fs.existsSync(path.join(modDir, 'Scripts', 'main.lua'))
  const hasMainLua = fs.existsSync(path.join(modDir, 'main.lua'))
  if (hasScripts || hasMainLua) return 'lua'
  const hasCppMod = fs.existsSync(path.join(modDir, 'dlls', 'main.dll'))
  if (hasCppMod) return 'cpp'
  try {
    if (fs.readdirSync(modDir).some(f => f.endsWith('.dll'))) return 'cpp'
  } catch { /* unreadable dir — fall through to default */ }
  return 'lua' // callers should pre-gate with isUe4ssMod; default to lua otherwise
}

function isCacheValid(): boolean {
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

function updateCacheState(mods: ScannedMod[]): void {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return

  const paksPaths = getAllPaksPaths(gamePath)
  const pakDirMtimes: Record<string, number | null> = {}
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

function invalidateCache(): void {
  modCache.valid = false
}

function getCachedMods(): ScannedMod[] {
  return modCache.mods
}

// Set true when a paks directory can't be read during a scan, so a caller that
// makes destructive decisions from the result (getInstalledMods pruning) can
// tell a genuinely-empty scan from a partial one. Safe as a module var: scanMods
// is synchronous, so a caller reads it immediately after scanMods() returns with
// no interleaving scan.
let lastScanPartial = false

function wasLastScanPartial(): boolean {
  return lastScanPartial
}

function scanMods(): ScannedMod[] {
  lastScanPartial = false
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return []

  const mods: ScannedMod[] = []
  const seenPakIds = new Set<string>()

  // --- 先掃描 UE4SS Lua mods（收集 hybrid 連結）---
  const hybridPakMap = new Map<string, string>() // pakBaseName → ue4ss mod folder name
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  if (ue4ssModsPath && fs.existsSync(ue4ssModsPath)) {
    // readdir can throw (EACCES, or the dir removed between existsSync and here).
    // A throw would propagate out of scanMods → through the renderer's startup
    // init() Promise.all → leave the splash screen up forever. Degrade to "no
    // UE4SS mods" instead of aborting.
    let dirs: string[] = []
    try {
      dirs = fs.readdirSync(ue4ssModsPath)
    } catch (err) {
      logger.warn(`Failed to read UE4SS Mods dir: ${(err as Error).message}`)
      dirs = []
    }

    // A UE4SS mod can be enabled via the registry (mods.json / mods.txt) without
    // an enabled.txt marker — read that set once so display state matches what
    // UE4SS actually loads. enabled.txt still takes precedence when present.
    const registryEnabled = readUe4ssEnabledNames(ue4ssModsPath)

    for (const dir of dirs) {
      if (BUILTIN_MODS.has(dir) || dir.startsWith('.')) continue

      const modDir = path.join(ue4ssModsPath, dir)
      // statSync can ENOENT if a concurrent install/remove deletes this entry
      // between readdir and here — skip it rather than aborting the whole scan
      // (a half-scan would make getInstalledMods prune still-installed receipts).
      let stat: fs.Stats
      try { stat = fs.statSync(modDir) } catch { continue }
      if (!stat.isDirectory()) continue

      if (!isUe4ssMod(modDir)) continue

      const enabledFile = path.join(modDir, 'enabled.txt')
      const ue4ssEnabled = fs.existsSync(enabledFile) || registryEnabled.has(dir)

      // 檢查 hybrid 連結
      const linkFile = path.join(modDir, '_hzmm_link.json')
      let linkedPaks: string[] | null = null
      if (fs.existsSync(linkFile)) {
        try {
          linkedPaks = (JSON.parse(fs.readFileSync(linkFile, 'utf-8')).pakFiles || []) as string[]
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
        subtype: classifyUe4ssMod(modDir),
        hybrid: isHybrid,
        linkedPaks: isHybrid ? linkedPaks! : undefined, // isHybrid ⇒ linkedPaks is set
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
        // Skip entries that vanish mid-scan (concurrent install/remove) instead
        // of letting one ENOENT abort the whole directory's scan.
        let stat: fs.Stats
        try { stat = fs.statSync(filePath) } catch { continue }
        if (!stat.isFile()) continue

        // Case-insensitive: a `FOO.PAK` copied in by hand (or by an archive
        // with uppercase names) must still show up in the mod list on Linux.
        const baseLower = file.toLowerCase()
        const isDisabled = baseLower.endsWith('.pak.disabled')
        const isPak = baseLower.endsWith('.pak')
        if (baseLower.startsWith('pakchunk') || baseLower.startsWith('global')) continue

        if (isPak || isDisabled) {
          const baseName = file.replace('.disabled', '')
          if (seenPakIds.has(baseName)) continue
          seenPakIds.add(baseName)
          const linkedUe4ss = hybridPakMap.get(baseName) || null

          mods.push({
            id: baseName,
            filename: file,
            // stripOrderPrefix: a load-order rename (z1_Foo_P.pak) must not
            // leak "z1" into the display title — the filename stays the truth.
            title: stripOrderPrefix(baseName).replace('.pak', '').replace(/_P$/, '').replace(/_/g, ' ').replace(/-/g, ' '),
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
      // Mark the scan partial so getInstalledMods won't prune receipts against
      // an incomplete list (a locked/rebuilding paks dir would otherwise look
      // like the mods were uninstalled).
      lastScanPartial = true
      logger.warn(`Failed to scan PAK directory ${paksPath}: ${(err as Error).message}`)
    }
  }

  return mods
}

export { scanMods, wasLastScanPartial, isCacheValid, updateCacheState, invalidateCache, getCachedMods }
