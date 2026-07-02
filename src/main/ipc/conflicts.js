import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getAllPaksPaths } from '../services/steam-detector.js'
import { readPakIndex } from '../services/pak-parser.js'
import logger from '../services/logger.js'

// Pure conflict detection: walk paksPaths, collect every PAK's resource list,
// flag resources that appear in more than one PAK. Skips engine packs
// (`pakchunk*` / `global*`) and disabled `.pak.disabled` files.
//
// `readIndex` is injectable so unit tests can stub the binary PAK parser —
// the conflict-collection logic itself doesn't depend on file format.
//
// Returns: `[{ resource: string, mods: string[] }]` (only entries with >1 mod).
//
// readPakIndex does a synchronous footer read + full index parse on the main
// thread, so unchanged paks are cached by path+mtime+size to keep repeat scans
// cheap.
//
// The cache value is a PAK's full resource-path list (up to 1M strings — see
// pak-parser.js), so it's bounded two ways to stay flat over a long
// tray-resident session: (1) a per-path sweep drops a PAK's stale entries when
// it's rebuilt in place (new mtime/size → new key), keeping at most one entry
// per path; (2) an LRU cap evicts the oldest once distinct paths pile up.
// Mirrors the bounded-cache pattern in nexus-cache.js.
//
// Exposed as a factory with an injectable `read` so the bounding logic is
// unit-testable without real PAK binaries; production uses one shared instance
// backed by the real synchronous parser.
export const MAX_PAK_CACHE = 256

export function createPakIndexCache(read = readPakIndex) {
  const cache = new Map()
  return function readCached(filePath, stat) {
    const key = `${filePath}:${stat.mtimeMs}:${stat.size}`
    const hit = cache.get(key)
    if (hit) return hit

    const entries = read(filePath)

    // Same PAK, changed on disk → its previous index is dead weight. Drop any
    // entry sharing this path before inserting the fresh one.
    const prefix = `${filePath}:`
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k)
    }
    // LRU cap: Map preserves insertion order, so the first key is the oldest.
    if (cache.size >= MAX_PAK_CACHE) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }

    cache.set(key, entries)
    return entries
  }
}

const defaultPakIndexCache = createPakIndexCache()

export function findConflicts(paksPaths, readIndex = readPakIndex) {
  const modResources = new Map()

  for (const paksDir of paksPaths) {
    if (!fs.existsSync(paksDir)) continue

    const files = fs.readdirSync(paksDir)
    for (const file of files) {
      if (!file.endsWith('.pak')) continue
      const lower = file.toLowerCase()
      if (lower.startsWith('pakchunk') || lower.startsWith('global')) continue

      const filePath = path.join(paksDir, file)
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue

      const entries = readIndex === readPakIndex
        ? defaultPakIndexCache(filePath, stat)
        : readIndex(filePath)
      for (const entry of entries) {
        if (!modResources.has(entry)) {
          modResources.set(entry, [])
        }
        modResources.get(entry).push(file)
      }
    }
  }

  const conflicts = []
  for (const [resource, mods] of modResources) {
    if (mods.length > 1) {
      conflicts.push({ resource, mods })
    }
  }
  return conflicts
}

function registerConflictsIpc() {
  ipcMain.handle('conflicts:scan', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return []
    const paksPaths = getAllPaksPaths(gamePath)
    const conflicts = findConflicts(paksPaths)
    logger.info(`Conflict scan complete: ${conflicts.length} conflicts found across ${paksPaths.length} directories`)
    return conflicts
  })
}

export { registerConflictsIpc }
