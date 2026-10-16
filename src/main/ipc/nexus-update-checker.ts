// Installed-mod update checking. For every Nexus install receipt we hold
// ({ modId, fileId, installedAt, version? }), ask the keyless V2 GraphQL API
// for that mod's files and decide whether a newer MAIN file exists. Results
// are throttled + cached in configStore so a startup check doesn't hammer the
// Nexus API on every launch.
//
// Pure verdict logic (evaluateOutdated) is split out so it can be unit-tested
// without network or disk.

import configStore from '../services/config-store'
import logger from '../services/logger'
import { scanMods } from './mods-scan'
import { v2GetModFiles } from './nexus-v2-client'
import { localModKey, supersedeReceiptIn } from './nexus-install-tracker'
import type { NexusInstallReceipt, NexusModFile, OutdatedVerdict, ScannedMod, UpdateCheckPayload, UpdateCheckResult } from './types'

// Only re-hit the API when the cached result is older than this. Startup checks
// inside the window reuse the cache; a manual re-check forces past it.
export const UPDATE_CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000 // 6 hours

// Normalize a Nexus file date / receipt timestamp to epoch milliseconds.
// V2 `date` arrives as an ISO string; receipt.installedAt is Date.now() (ms);
// a V1-style unix seconds value is also tolerated.
function toTime(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v // seconds vs ms heuristic
  const t = Date.parse(String(v)) // Date.parse stringifies anyway
  return Number.isNaN(t) ? 0 : t
}

// Pick the "latest main file" from a mod's V2 file list — main category,
// newest upload date. Falls back to the whole list if no main file is tagged.
function latestMainFile(modFiles: NexusModFile[] | null | undefined): NexusModFile | null {
  const all = Array.isArray(modFiles) ? modFiles : []
  if (all.length === 0) return null
  const main = all.filter(f => f.category_id === 1 || /main/i.test(f.category_name || ''))
  const pool = main.length ? main : all
  return pool.slice().sort((a, b) => toTime(b.uploaded_timestamp) - toTime(a.uploaded_timestamp))[0]
}

// PURE: given a receipt and that mod's V2 files, decide if it's outdated.
// Returns { outdated, latestFileId, latestVersion, currentVersion }.
export function evaluateOutdated(
  receipt: Pick<NexusInstallReceipt, 'fileId' | 'installedAt' | 'version'>,
  modFiles: NexusModFile[] | null | undefined,
): OutdatedVerdict {
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
function buildKeyToFilenames(onDiskMods: ScannedMod[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const m of onDiskMods) {
    const k = localModKey(m)
    if (!k) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(m.filename) // set just above
  }
  return map
}

// Orchestrate: read receipts, throttle against the cache, query V2 per mod
// (serially, to avoid rate limits), and persist + return the verdict list.
// Returns { checkedAt, results: [{ modId, outdated, latestFileId,
// latestVersion, currentVersion, affectedFilenames, error? }] }.
export async function checkUpdates(force = false): Promise<UpdateCheckPayload> {
  const receipts: NexusInstallReceipt[] = configStore.get('nexusInstalledMods', [])
  if (!Array.isArray(receipts) || receipts.length === 0) {
    const empty = { checkedAt: Date.now(), results: [] }
    configStore.set('nexusUpdateCheck', empty)
    return empty
  }

  const cache: UpdateCheckPayload | null = configStore.get('nexusUpdateCheck', null)
  if (!force && cache && cache.checkedAt && Date.now() - cache.checkedAt < UPDATE_CHECK_THROTTLE_MS) {
    return cache
  }

  let onDisk: ScannedMod[] = []
  try { onDisk = scanMods() || [] } catch (err) { logger.warn(`Update check scanMods failed: ${(err as Error).message}`) }
  const keyToFilenames = buildKeyToFilenames(onDisk)

  const results: UpdateCheckResult[] = []
  // Stale-successor sweep: a receipt flagged outdated whose "update to" file
  // is ALREADY covered by another receipt is a leftover from an update that
  // couldn't retire it at the time (metadata outage, pre-fix versions). Its
  // update is installed — retiring it here (claims carried over) is what
  // finally clears the badge instead of reporting a phantom update forever.
  const stale: Array<{ modId: number; oldFileId: number | null; newFileId: number | null }> = []
  for (const r of receipts) {
    if (!r || !Number.isInteger(r.modId)) continue
    const affected: string[] = []
    for (const lm of Array.isArray(r.localMods) ? r.localMods : []) {
      const fns = keyToFilenames.get(`${lm.modType}:${lm.name}`)
      if (fns) affected.push(...fns)
    }
    try {
      const files = await v2GetModFiles(r.modId)
      const verdict = evaluateOutdated(r, files)
      const successor = verdict.outdated && verdict.latestFileId != null
        && receipts.find(o => o && o !== r && o.modId === r.modId && (o.fileId ?? null) === verdict.latestFileId)
      if (successor) {
        stale.push({ modId: r.modId, oldFileId: r.fileId ?? null, newFileId: verdict.latestFileId })
        continue
      }
      results.push({ modId: r.modId, ...verdict, affectedFilenames: affected })
    } catch (err) {
      logger.warn(`Update check failed for mod ${r.modId}: ${(err as Error).message}`)
      results.push({ modId: r.modId, outdated: false, error: (err as Error).message, affectedFilenames: affected })
    }
  }
  if (stale.length > 0) {
    // Re-read at write time — installs may have landed while the serial
    // API loop above was awaiting; supersedeReceiptIn no-ops on entries
    // that no longer match.
    let next = configStore.get('nexusInstalledMods', [])
    for (const s of stale) next = supersedeReceiptIn(next, s.modId, s.oldFileId, s.newFileId)
    configStore.set('nexusInstalledMods', next)
    logger.info(`Update check: retired ${stale.length} superseded receipt(s)`)
  }

  // If every per-mod lookup errored (e.g. a transient network outage during a
  // startup check) and we still hold a prior good result, don't overwrite it
  // with an all-error payload — the 6h throttle would then serve those errors
  // and hide real updates. Keep the cache (so the next check retries once it
  // expires) and return the last good data instead of a wall of errors.
  const anySuccess = results.some(r => !r.error)
  if (!anySuccess && cache) {
    return cache
  }

  // No prior good result to fall back on: still never refresh the throttle
  // stamp on an all-error round (offline launch) — checkedAt: 0 keeps the
  // results available to the UI but lets the next check run immediately.
  const allFailed = results.length > 0 && results.every(r => r.error)
  const payload = { checkedAt: allFailed ? 0 : Date.now(), results }
  configStore.set('nexusUpdateCheck', payload)
  return payload
}
