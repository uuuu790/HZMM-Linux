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
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { nexusApiRequest, resolveNexusDownloadUrl, downloadAndInstallFromUrl, isAllowedModUrl, ALLOWED_MOD_HOSTS } from './mods-download.js'
import { installMods, serializeModWrite } from './mods-install.js'
import { downloadFile } from '../services/archive.js'
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
} from './nexus-install-tracker.js'
import { checkUpdates } from './nexus-update-checker.js'
import { scanMods } from './mods-scan.js'

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
      const hit = cacheGet('validate')
      const data = hit || await nexusApiRequest('/users/validate.json', apiKey)
      if (!hit) cacheSet('validate', data, CACHE_TTL.validate)
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
  ipcMain.handle('nexus:install-mod', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    const url = `https://www.nexusmods.com/${GAME_DOMAIN}/mods/${modId}`
    const result = await downloadAndInstallFromUrl(url, mainWindow)
    recordInstall(modId, null, flattenLandedMods(result))
    return result
  })

  // V1 (kept) — install a specific file. Uses the V1 download_link endpoint,
  // which is the Premium-only bit that V2 doesn't expose.
  // `installInFlight` keys (modId:fileId) reject a second invoke for the same
  // file while one is already running. (Temp paths are now unique per download,
  // so this guards against redundant concurrent installs of the same file.)
  const installInFlight = new Set()
  ipcMain.handle('nexus:install-file', async (_, modId, fileId, version, fallbackToLatest = false) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('Invalid file id')
    const lockKey = `${modId}:${fileId}`
    if (installInFlight.has(lockKey)) throw new Error('Install already in progress for this file')
    installInFlight.add(lockKey)
    try {
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
      // Defense-in-depth: the resolved CDN URL comes from the Nexus API, but
      // validate it against the host allowlist (like the URL-install path) so a
      // poisoned/redirected link can't make us fetch from an arbitrary host.
      if (!isAllowedModUrl(resolved.url)) {
        throw new Error('Resolved download URL is not from an allowed Nexus CDN host')
      }
      const urlObj = new URL(resolved.url)
      let filename = path.basename(urlObj.pathname)
      if (!filename || !filename.match(/\.(zip|rar|pak)$/i)) {
        // Nexus is a trusted source but defense-in-depth: basename + strip
        // anything outside `[A-Za-z0-9._-]` so a surprise upstream name can't
        // escape the temp dir via traversal or shell metachars.
        const safe = path.basename(resolved.name || '').replace(/[^\w.-]/g, '_')
        filename = `${safe || `nexus_mod_${modId}_${fileId}`}.zip`
      }
      // Unique temp SUBDIR per download so concurrent installs never share a
      // path (and cleanup only removes its own dir), while preserving the real
      // filename — important for .pak mods whose _P suffix affects load order.
      const tempDir = path.join(configStore.getConfigDir(), 'temp', `dl_${modId}_${fileId}_${Date.now()}`)
      const tempPath = path.join(tempDir, filename)
      fs.mkdirSync(tempDir, { recursive: true })

      try {
        await downloadFile(resolved.url, tempPath, (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mods:download-progress', progress)
          }
        }, ALLOWED_MOD_HOSTS)
        const result = await installMods([tempPath], mainWindow)
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* temp already gone */ }
        const landed = flattenLandedMods(result)
        recordInstall(modId, fileId, landed, typeof version === 'string' ? version : null)
        // Return an object, not the bare install array: structured clone drops
        // custom props off arrays over IPC, and the renderer needs fellBackToLatest
        // to warn when a profile auto-download grabbed a different version.
        return { ok: true, fellBackToLatest, mods: landed }
      } catch (err) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* temp already gone */ }
        throw err
      }
    } finally {
      installInFlight.delete(lockKey)
    }
  })

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
