// Nexus Mods IPC registration — just the glue wiring handlers to the
// underlying modules:
//   - nexus-v2-client.js : GraphQL queries (list/search/detail/files)
//   - nexus-cache.js     : in-memory TTL cache
//   - nexus-install-tracker.js : persistent "installed" receipts
//   - mods-download.js   : V1 download_link endpoint + URL install orchestration
//   - mods-install.js    : actual zip/rar/pak installer
//
// V1 vs V2 split:
// - V2 is used for anything public-read. No auth, richer data, full
//   catalogue instead of V1's 10-per-endpoint cap.
// - V1 is kept for the bits V2 doesn't expose: `users/validate.json`
//   (to check `is_premium`) and `download_link.json` (Premium-only,
//   resolves the temporary CDN URL we actually download from).

import { ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { assertSafeSegment, isPathWithin } from '../services/path-safety.js'
import { nexusApiRequest, resolveNexusDownloadUrl, downloadAndInstallFromUrl, downloadAndInstallResolvedFile } from './mods-download.js'
import { serializeModWrite } from './mods-install.js'
import {
  GAME_DOMAIN,
  v2ListMods,
  v2SearchMods,
  v2GetMod,
  v2GetModFiles,
} from './nexus-v2-client.js'
import { cacheGet, cacheSet, cacheClear, CACHE_TTL } from './nexus-cache.js'
import {
  recordInstall,
  flattenLandedMods,
  getInstalledMods,
  forgetInstalled,
  matchSourcesToMods,
  mergeLinkIntoReceipts,
} from './nexus-install-tracker.js'
import { archiveModVersion, listModVersions, restoreArchivedVersion, removePakVariants } from './mod-versions.js'
import { checkUpdates } from './nexus-update-checker.js'
import { captureModState, restoreModState } from './mods-update-state.js'
import { renamePakEverywhere } from './mods-order.js'
import { getAllPaksPaths, getUe4ssModsPath, getPaksPath } from '../services/steam-detector.js'
import { scanMods, invalidateCache } from './mods-scan.js'

// Shared skeleton for the read-only V2 handlers: cache-get -> fetch -> cache-set
// with a uniform network-error envelope. `fetch()` returns the value to cache;
// `shape(value)` maps it into the handler's response fields.
async function cachedFetch({ key, ttl, label, fetch, shape }) {
  try {
    const hit = cacheGet(key)
    if (hit) return { ok: true, ...shape(hit) }
    const data = await fetch()
    cacheSet(key, data, ttl)
    return { ok: true, ...shape(data) }
  } catch (err) {
    logger.warn(`${label} failed: ${err.message}`)
    return { ok: false, reason: 'network', error: err.message }
  }
}

function registerNexusIpc(mainWindow) {
  // V1 — still used to check Premium status (V2 auth is different / not wired).
  ipcMain.handle('nexus:validate', async () => {
    const apiKey = configStore.get('nexusApiKey')
    if (!apiKey) return { ok: false, reason: 'no-key' }
    try {
      // The cache key carries a fingerprint of the API key: a bare 'validate'
      // key kept serving the PREVIOUS key's identity/premium verdict for the
      // whole TTL after the user pasted a new key in Settings.
      const cacheKey = `validate:${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`
      const hit = cacheGet(cacheKey)
      const data = hit || await nexusApiRequest('/users/validate.json', apiKey)
      if (!hit) cacheSet(cacheKey, data, CACHE_TTL.validate)
      if (!data.is_premium) {
        return { ok: false, reason: 'not-premium', name: data.name }
      }
      return { ok: true, name: data.name, profileUrl: data.profile_url }
    } catch (err) {
      logger.warn(`nexus:validate failed: ${err.message}`)
      const msg = String(err.message || '')
      if (msg.includes('401') || msg.includes('403')) {
        return { ok: false, reason: 'invalid', error: msg }
      }
      return { ok: false, reason: 'network', error: msg }
    }
  })

  ipcMain.handle('nexus:list-mods', (_, sort) => cachedFetch({
    key: `list:${sort || 'trending'}`,
    ttl: CACHE_TTL.list,
    label: 'V2 list mods',
    fetch: async () => { const page = await v2ListMods({ sort }); return { mods: page.nodes, totalCount: page.totalCount } },
    shape: (d) => d,
  }))

  // V2 — real keyword search. Nexus stems the query server-side.
  ipcMain.handle('nexus:search-mods', (_, keyword) => {
    if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
      return { ok: true, mods: [], totalCount: 0 }
    }
    const q = keyword.trim().slice(0, 100)
    return cachedFetch({
      key: `search:${q.toLowerCase()}`,
      ttl: CACHE_TTL.search,
      label: 'V2 search',
      fetch: async () => { const page = await v2SearchMods({ keyword: q }); return { mods: page.nodes, totalCount: page.totalCount } },
      shape: (d) => d,
    })
  })

  ipcMain.handle('nexus:get-mod-detail', (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    return cachedFetch({
      key: `detail:${modId}`,
      ttl: CACHE_TTL.detail,
      label: `V2 mod detail ${modId}`,
      fetch: () => v2GetMod(modId),
      shape: (mod) => ({ mod }),
    })
  })

  // V2 — files for a mod.
  ipcMain.handle('nexus:get-mod-files', (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    return cachedFetch({
      key: `files:${modId}`,
      ttl: CACHE_TTL.files,
      label: `V2 mod files ${modId}`,
      fetch: () => v2GetModFiles(modId),
      shape: (files) => ({ files }),
    })
  })

  // Installed-mods tracking — thin IPC wrappers around nexus-install-tracker.
  // get-installed runs inside the shared write mutex so its scanMods() cross-
  // check reads a settled on-disk state — never a half-finished install (rotate
  // done, extract pending), which would otherwise prune still-installed receipts.
  ipcMain.handle('nexus:get-installed-mods', () => serializeModWrite(() => getInstalledMods()))
  ipcMain.handle('nexus:forget-installed', (_, modId) => forgetInstalled(modId))

  // V1 (kept) — install the latest main file for a mod.
  // Per-modId in-flight guard so a double-click doesn't download+install the
  // same mod twice (mirrors install-file's guard below).
  const installModInFlight = new Set()
  ipcMain.handle('nexus:install-mod', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    if (installModInFlight.has(modId)) throw new Error('Install already in progress for this mod')
    installModInFlight.add(modId)
    try {
      const url = `https://www.nexusmods.com/${GAME_DOMAIN}/mods/${modId}`
      const result = await downloadAndInstallFromUrl(url, mainWindow)
      recordInstall(modId, null, flattenLandedMods(result))
      return result
    } finally {
      installModInFlight.delete(modId)
    }
  })

  // V1 (kept) — install a specific file. Uses the V1 download_link endpoint,
  // which is the Premium-only bit that V2 doesn't expose.
  // `installInFlight` keys (modId:fileId) reject a second invoke for the same
  // file while one is already running. (Temp paths are now unique per download,
  // so this guards against redundant concurrent installs of the same file.)
  const installInFlight = new Set()

  // Shared download+install core for install-file and update-file below.
  // Resolves the CDN URL (optionally falling back to the latest main file),
  // downloads to a unique temp subdir, installs, and records the receipt.
  // Callers hold the installInFlight lock for their modId:fileId.
  async function performInstallFile(modId, fileId, version, fallbackToLatest) {
    const apiKey = configStore.get('nexusApiKey')
    if (!apiKey) throw new Error('NEXUS_API_KEY_REQUIRED')

    let resolved
    // Tracks whether the pinned fileId was gone and we substituted the mod's
    // latest main file — surfaced to the renderer so it can warn about drift.
    let fellBackToLatest = false
    try {
      resolved = await resolveNexusDownloadUrl({ game: GAME_DOMAIN, modId, fileId }, apiKey)
    } catch (err) {
      // The pinned file may have been delisted. When the caller opted in
      // (profile auto-install), retry with the mod's latest main file.
      if (!fallbackToLatest) throw err
      logger.warn(`install-file ${modId}:${fileId} resolve failed, falling back to latest: ${err.message}`)
      resolved = await resolveNexusDownloadUrl({ game: GAME_DOMAIN, modId, fileId: null }, apiKey)
      fellBackToLatest = true
    }
    // Shared tail (mods-download.js): host allowlist re-check, filename
    // resolution, unique temp dir, download, install.
    const result = await downloadAndInstallResolvedFile(resolved, { modId, fileId: fileId ?? 'latest' }, mainWindow)
    const landed = flattenLandedMods(result)
    // Record what actually LANDED, not what was asked for. After a fallback
    // (pinned file delisted) the download is a different file — recording the
    // dead pin would make evaluateOutdated() come up empty for this mod
    // forever, and profiles re-exported from the receipt would re-pin the
    // dead file. resolveNexusDownloadUrl reports the concrete fileId (and
    // version when it resolved "latest") it served.
    const landedFileId = resolved.fileId ?? fileId
    const landedVersion = resolved.version ?? (typeof version === 'string' ? version : null)
    recordInstall(modId, landedFileId, landed, landedVersion)
    // Return an object, not the bare install array: structured clone drops
    // custom props off arrays over IPC, and the renderer needs fellBackToLatest
    // to warn when a profile auto-download grabbed a different version.
    return { ok: true, fellBackToLatest, mods: landed }
  }

  ipcMain.handle('nexus:install-file', async (_, modId, fileId, version, fallbackToLatest = false) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    // fileId may legitimately be null: receipts written by nexus:install-mod
    // carry fileId=null ("latest main file"), and profile auto-download replays
    // them through this handler. resolveNexusDownloadUrl treats null as
    // "resolve the latest main file".
    if (fileId != null && (!Number.isInteger(fileId) || fileId <= 0)) throw new Error('Invalid file id')
    const lockKey = `${modId}:${fileId ?? 'latest'}`
    if (installInFlight.has(lockKey)) throw new Error('Install already in progress for this file')
    installInFlight.add(lockKey)
    try {
      return await performInstallFile(modId, fileId, version, fallbackToLatest)
    } finally {
      installInFlight.delete(lockKey)
    }
  })

  // Update an installed mod IN PLACE: snapshot the user-local state the
  // reinstall would otherwise wipe (enabled/disabled + edited UE4SS configs),
  // install the new file, then re-apply the snapshot. The snapshot reads the
  // PRE-update receipt's localMods (that's what is on disk right now); a new
  // version that renames its files simply finds nothing to re-apply onto.
  // Shares the in-flight guard with install-file.
  ipcMain.handle('nexus:update-file', async (_, modId, fileId, version) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('Invalid file id')
    const lockKey = `${modId}:${fileId}`
    if (installInFlight.has(lockKey)) throw new Error('Install already in progress for this file')
    installInFlight.add(lockKey)
    try {
      const gamePath = configStore.get('gamePath')
      if (!gamePath) throw new Error('Game path not set')
      const receipts = configStore.get('nexusInstalledMods', [])
      const receipt = (Array.isArray(receipts) ? receipts : []).find(r => r && r.modId === modId)
      const modPaths = { paksPaths: getAllPaksPaths(gamePath), ue4ssModsPath: getUe4ssModsPath(gamePath) }
      // Capture inside the write mutex so the snapshot sees a settled disk
      // state (never mid-toggle / mid-install).
      const prevState = await serializeModWrite(() => {
        // Retain the outgoing version for one-click rollback (newest 2 kept
        // per mod) BEFORE the install rotates the old files away.
        if (receipt) {
          try {
            archiveModVersion(modPaths, path.join(configStore.getConfigDir(), 'mod-versions'), receipt)
          } catch (err) {
            logger.warn(`nexus:update-file version archive failed: ${err.message}`)
          }
        }
        return captureModState(modPaths, receipt?.localMods || [])
      })
      const result = await performInstallFile(modId, fileId, version, false)
      // Restore is best-effort — the update itself succeeded; a partial
      // restore logs per entry and must not fail the whole operation.
      let restored = null
      try {
        restored = await serializeModWrite(() => restoreModState(modPaths, prevState, {
          // Re-applies a load-order prefix the reinstall dropped, migrating
          // the filename-keyed stores along with the on-disk rename.
          renamePak: (oldName, newName) => renamePakEverywhere(modPaths, oldName, newName),
        }))
        invalidateCache()
      } catch (err) {
        logger.warn(`nexus:update-file state restore failed: ${err.message}`)
      }
      return { ...result, restored }
    } finally {
      installInFlight.delete(lockKey)
    }
  })

  // Manually associate a hand-installed local mod with a Nexus mod page so
  // the update checker covers it. fileId/version are optional — a "not sure
  // which file" link still gets notified about FUTURE uploads (installedAt).
  ipcMain.handle('nexus:link-mod', (_, modId, filename, fileId = null, version = null) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    assertSafeSegment('filename', filename)
    if (fileId !== null && (!Number.isInteger(fileId) || fileId <= 0)) throw new Error('Invalid file id')
    const isPak = /\.pak(\.disabled)?$/i.test(filename)
    // Same normalization as localModKey: receipts store the base name.
    const localMod = isPak
      ? { modType: 'PAK', name: filename.replace(/\.(pak|ucas|utoc)(\.disabled)?$/i, '').replace(/_P$/, '') }
      : { modType: 'UE4SS', name: filename }
    const receipts = configStore.get('nexusInstalledMods', [])
    configStore.set('nexusInstalledMods', mergeLinkIntoReceipts(receipts, modId, localMod, {
      fileId,
      version: typeof version === 'string' ? version : null,
      now: Date.now(),
    }))
    logger.info(`Nexus link: ${filename} → mod ${modId}${fileId ? ` (file ${fileId})` : ''}`)
    return { ok: true }
  })

  // Retained snapshots for the rollback UI: { [modId]: [{dir, version,
  // fileId, savedAt}] } newest first (object keys arrive as strings).
  ipcMain.handle('nexus:list-mod-versions', () =>
    listModVersions(path.join(configStore.getConfigDir(), 'mod-versions')))

  // Replace a mod's current files with an archived snapshot. The receipt is
  // rewritten to the archived fileId/version, so the update badge reappears —
  // correct, the newer version IS available again. The consumed snapshot is
  // deleted on success (updating re-archives whatever it replaces).
  ipcMain.handle('nexus:rollback-mod', (_, modId, snapshotDir) => serializeModWrite(() => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    if (typeof snapshotDir !== 'string' || !snapshotDir) throw new Error('Invalid snapshot')
    const retentionRoot = path.join(configStore.getConfigDir(), 'mod-versions')
    const resolved = path.resolve(snapshotDir)
    if (!isPathWithin(path.join(retentionRoot, String(modId)), resolved)) throw new Error('Invalid snapshot path')
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')
    const modPaths = {
      paksPaths: getAllPaksPaths(gamePath),
      ue4ssModsPath: getUe4ssModsPath(gamePath),
      primaryPaksPath: getPaksPath(gamePath),
    }
    // Clear the CURRENT version's paks first — an intervening load-order
    // rename may have given them names the archived entries don't cover.
    const receipts = configStore.get('nexusInstalledMods', [])
    const current = (Array.isArray(receipts) ? receipts : []).find(r => r && r.modId === modId)
    for (const lm of Array.isArray(current?.localMods) ? current.localMods : []) {
      if (lm && lm.modType === 'PAK' && lm.name) {
        try {
          assertSafeSegment('modName', lm.name)
          removePakVariants(modPaths.paksPaths, lm.name)
        } catch { /* skip unsafe receipt name */ }
      }
    }
    const restored = restoreArchivedVersion(modPaths, resolved)
    recordInstall(modId, restored.fileId, restored.localMods, restored.version)
    try { fs.rmSync(resolved, { recursive: true, force: true }) } catch { /* consumed — cleanup is best-effort */ }
    invalidateCache()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:updated')
    logger.info(`Nexus rollback: mod ${modId} → v${restored.version || '?'}`)
    return { ok: true, version: restored.version }
  }))

  // Installed-mod update checks (V2, keyless). Throttled + cached in the
  // checker; not wrapped in the write mutex since it only reads + hits network.
  ipcMain.handle('nexus:check-updates', () => checkUpdates(false))
  ipcMain.handle('nexus:check-updates-force', () => checkUpdates(true))

  // Reverse-look-up Nexus sources for a profile's enabled filenames, so an
  // exported profile can carry where each mod came from. Reads receipts +
  // scanMods; pure matching lives in matchSourcesToMods.
  ipcMain.handle('profiles:resolve-nexus-sources', (_, enabledModFilenames) => {
    try {
      const receipts = configStore.get('nexusInstalledMods', [])
      const mods = scanMods()
      return matchSourcesToMods(receipts, mods, Array.isArray(enabledModFilenames) ? enabledModFilenames : [])
    } catch (err) {
      logger.warn(`profiles:resolve-nexus-sources failed: ${err.message}`)
      return []
    }
  })

  ipcMain.handle('nexus:clear-cache', (_, prefix) => { cacheClear(prefix); return { ok: true } })
}

export { registerNexusIpc }
