// Installed-mod update checking. For every Nexus install receipt we hold
// ({ modId, fileId, installedAt, version? }), ask the keyless V2 GraphQL API
// for that mod's files and decide whether a newer MAIN file exists. Results
// are throttled + cached in configStore so a startup check doesn't hammer the
// Nexus API on every launch.
//
// Pure verdict logic (evaluateOutdated) is split out so it can be unit-tested
// without network or disk.

import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { scanMods } from './mods-scan.js'
import { v2GetModFiles } from './nexus-v2-client.js'
import { localModKey } from './nexus-install-tracker.js'

// Only re-hit the API when the cached result is older than this. Startup checks
// inside the window reuse the cache; a manual re-check forces past it.
export const UPDATE_CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000 // 6 hours

// Normalize a Nexus file date / receipt timestamp to epoch milliseconds.
// V2 `date` arrives as an ISO string; receipt.installedAt is Date.now() (ms);
// a V1-style unix seconds value is also tolerated.
function toTime(v) {
  if (v == null) return 0
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v // seconds vs ms heuristic
  const t = Date.parse(v)
  return Number.isNaN(t) ? 0 : t
}

// Pick the "latest main file" from a mod's V2 file list — main category,
// newest upload date. Falls back to the whole list if no main file is tagged.
function latestMainFile(modFiles) {
  const all = Array.isArray(modFiles) ? modFiles : []
  if (all.length === 0) return null
  const main = all.filter(f => f.category_id === 1 || /main/i.test(f.category_name || ''))
  const pool = main.length ? main : all
  return pool.slice().sort((a, b) => toTime(b.uploaded_timestamp) - toTime(a.uploaded_timestamp))[0]
}

// PURE: given a receipt and that mod's V2 files, decide if it's outdated.
// Returns { outdated, latestFileId, latestVersion, currentVersion }.
export function evaluateOutdated(receipt, modFiles) {
  const latest = latestMainFile(modFiles)
  if (!latest) {
    return { outdated: false, latestFileId: null, latestVersion: null, currentVersion: receipt.version || null }
  }
  const latestDate = toTime(latest.uploaded_timestamp)
  const latestFileId = latest.file_id
  const latestVersion = latest.version || null

  if (receipt.fileId != null) {
    const current = (modFiles || []).find(f => f.file_id === receipt.fileId)
    const currentVersion = current?.version || receipt.version || null
    if (!current) {
      // The installed file isn't in the current list anymore (author delisted/
      // archived it). We can't identify its successor, so don't flag — this
      // avoids a false "update" for a file that was simply removed.
      return { outdated: false, latestFileId, latestVersion, currentVersion }
    }
    // A modId page can host many INDEPENDENT files (variants — e.g. a "backpack"
    // page with 50-slot / 2x / 3x / server builds). The update to THIS file is
    // the newest upload AMONG FILES SHARING ITS NAME — NOT the page's newest main
    // file, which is frequently a different variant entirely and would misfire.
    const sameName = (modFiles || []).filter(f => f.name === current.name)
    const mainSame = sameName.filter(f => f.category_id === 1 || /main/i.test(f.category_name || ''))
    const pool = mainSame.length ? mainSame : sameName
    const newest = pool.slice().sort((a, b) =>
      toTime(b.uploaded_timestamp) - toTime(a.uploaded_timestamp))[0] || current
    const outdated = newest.file_id !== receipt.fileId
      && toTime(newest.uploaded_timestamp) > toTime(current.uploaded_timestamp)
    return { outdated, latestFileId: newest.file_id, latestVersion: newest.version || null, currentVersion }
  }

  // Installed "latest main" at installedAt — outdated if a newer main file
  // has been uploaded since.
  const outdated = latestDate > toTime(receipt.installedAt)
  return { outdated, latestFileId, latestVersion, currentVersion: receipt.version || null }
}

// Map each receipt's recorded localMods to the on-disk filenames currently
// present, so the renderer can attach update info to the right mod card.
function buildKeyToFilenames(onDiskMods) {
  const map = new Map()
  for (const m of onDiskMods) {
    const k = localModKey(m)
    if (!k) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(m.filename)
  }
  return map
}

// Orchestrate: read receipts, throttle against the cache, query V2 per mod
// (serially, to avoid rate limits), and persist + return the verdict list.
// Returns { checkedAt, results: [{ modId, outdated, latestFileId,
// latestVersion, currentVersion, affectedFilenames, error? }] }.
export async function checkUpdates(force = false) {
  const receipts = configStore.get('nexusInstalledMods', [])
  if (!Array.isArray(receipts) || receipts.length === 0) {
    const empty = { checkedAt: Date.now(), results: [] }
    configStore.set('nexusUpdateCheck', empty)
    return empty
  }

  const cache = configStore.get('nexusUpdateCheck', null)
  if (!force && cache && cache.checkedAt && Date.now() - cache.checkedAt < UPDATE_CHECK_THROTTLE_MS) {
    return cache
  }

  let onDisk = []
  try { onDisk = scanMods() || [] } catch (err) { logger.warn(`Update check scanMods failed: ${err.message}`) }
  const keyToFilenames = buildKeyToFilenames(onDisk)

  const results = []
  for (const r of receipts) {
    if (!r || !Number.isInteger(r.modId)) continue
    const affected = []
    for (const lm of Array.isArray(r.localMods) ? r.localMods : []) {
      const fns = keyToFilenames.get(`${lm.modType}:${lm.name}`)
      if (fns) affected.push(...fns)
    }
    try {
      const files = await v2GetModFiles(r.modId)
      const verdict = evaluateOutdated(r, files)
      results.push({ modId: r.modId, ...verdict, affectedFilenames: affected })
    } catch (err) {
      logger.warn(`Update check failed for mod ${r.modId}: ${err.message}`)
      results.push({ modId: r.modId, outdated: false, error: err.message, affectedFilenames: affected })
    }
  }

  const payload = { checkedAt: Date.now(), results }
  configStore.set('nexusUpdateCheck', payload)
  return payload
}
