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
import { nexusApiRequest, resolveNexusDownloadUrl, downloadAndInstallFromUrl } from './mods-download.js'
import { installMods } from './mods-install.js'
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
} from './nexus-install-tracker.js'

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

  ipcMain.handle('nexus:list-mods', async (_, sort) => {
    try {
      const key = `list:${sort || 'trending'}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, ...hit }
      const page = await v2ListMods({ sort })
      const payload = { mods: page.nodes, totalCount: page.totalCount }
      cacheSet(key, payload, CACHE_TTL.list)
      return { ok: true, ...payload }
    } catch (err) {
      logger.warn(`V2 list mods failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // V2 — real keyword search. Nexus stems the query server-side.
  ipcMain.handle('nexus:search-mods', async (_, keyword) => {
    if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
      return { ok: true, mods: [], totalCount: 0 }
    }
    const q = keyword.trim().slice(0, 100)
    try {
      const key = `search:${q.toLowerCase()}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, ...hit }
      const page = await v2SearchMods({ keyword: q })
      const payload = { mods: page.nodes, totalCount: page.totalCount }
      cacheSet(key, payload, CACHE_TTL.search)
      return { ok: true, ...payload }
    } catch (err) {
      logger.warn(`V2 search failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  ipcMain.handle('nexus:get-mod-detail', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    try {
      const key = `detail:${modId}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, mod: hit }
      const mod = await v2GetMod(modId)
      cacheSet(key, mod, CACHE_TTL.detail)
      return { ok: true, mod }
    } catch (err) {
      logger.warn(`V2 mod detail ${modId} failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // V2 — files for a mod.
  ipcMain.handle('nexus:get-mod-files', async (_, modId) => {
    if (!Number.isInteger(modId) || modId <= 0) return { ok: false, reason: 'invalid-id' }
    try {
      const key = `files:${modId}`
      const hit = cacheGet(key)
      if (hit) return { ok: true, files: hit }
      const files = await v2GetModFiles(modId)
      cacheSet(key, files, CACHE_TTL.files)
      return { ok: true, files }
    } catch (err) {
      logger.warn(`V2 mod files ${modId} failed: ${err.message}`)
      return { ok: false, reason: 'network', error: err.message }
    }
  })

  // Installed-mods tracking — thin IPC wrappers around nexus-install-tracker.
  ipcMain.handle('nexus:get-installed-mods', () => getInstalledMods())
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
  // file — without it two concurrent downloads write the same tempPath and
  // corrupt each other's zip stream.
  const installInFlight = new Set()
  ipcMain.handle('nexus:install-file', async (_, modId, fileId) => {
    if (!Number.isInteger(modId) || modId <= 0) throw new Error('Invalid mod id')
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('Invalid file id')
    const lockKey = `${modId}:${fileId}`
    if (installInFlight.has(lockKey)) throw new Error('Install already in progress for this file')
    installInFlight.add(lockKey)
    try {
      const apiKey = configStore.get('nexusApiKey')
      if (!apiKey) throw new Error('NEXUS_API_KEY_REQUIRED')

      const resolved = await resolveNexusDownloadUrl({ game: GAME_DOMAIN, modId, fileId }, apiKey)
      const urlObj = new URL(resolved.url)
      let filename = path.basename(urlObj.pathname)
      if (!filename || !filename.match(/\.(zip|rar|pak)$/i)) {
        // Nexus is a trusted source but defense-in-depth: basename + strip
        // anything outside `[A-Za-z0-9._-]` so a surprise upstream name can't
        // escape the temp dir via traversal or shell metachars.
        const safe = path.basename(resolved.name || '').replace(/[^\w.-]/g, '_')
        filename = `${safe || `nexus_mod_${modId}_${fileId}`}.zip`
      }
      const tempPath = path.join(configStore.getConfigDir(), 'temp', filename)
      fs.mkdirSync(path.dirname(tempPath), { recursive: true })

      try {
        await downloadFile(resolved.url, tempPath, (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mods:download-progress', progress)
          }
        })
        const result = await installMods([tempPath], mainWindow)
        try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
        recordInstall(modId, fileId, flattenLandedMods(result))
        return result
      } catch (err) {
        try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
        throw err
      }
    } finally {
      installInFlight.delete(lockKey)
    }
  })

  ipcMain.handle('nexus:clear-cache', (_, prefix) => { cacheClear(prefix); return { ok: true } })
}

export { registerNexusIpc }
