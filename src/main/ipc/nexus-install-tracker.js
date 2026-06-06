// Persistent "installed via Nexus" tracking. Writes receipts to configStore
// so the browse UI can mark mods as installed across sessions, and
// cross-checks those receipts against scanMods() so the badge auto-clears
// when the user removes the mod via the Modules tab.
//
// Pure logic — IPC handlers live in nexus.js and thin-wrap these functions.
//
// Split out of nexus.js as part of the 470-line refactor.

import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { scanMods } from './mods-scan.js'

// Persist an install receipt. Upsert by modId — reinstalling / installing a
// different file from the same mod just updates the entry in place.
//
// `localMods` is an array of { name, modType } describing what actually
// landed on disk for this install. Used later by getInstalledMods to
// reconcile the persisted list against scanMods() — so if the user deletes
// the mod via the Modules tab, the badge auto-clears.
export function recordInstall(modId, fileId, localMods) {
  const list = configStore.get('nexusInstalledMods', [])
  const safe = Array.isArray(list) ? list.filter(e => e && e.modId !== modId) : []
  safe.push({
    modId,
    fileId: fileId || null,
    installedAt: Date.now(),
    localMods: Array.isArray(localMods) ? localMods : [],
  })
  configStore.set('nexusInstalledMods', safe)
}

// Flatten installMods / downloadAndInstallFromUrl result into the flat
// {name, modType}[] shape recordInstall wants. The install result nests
// `mods` arrays inside one top-level entry per source archive.
export function flattenLandedMods(installResult) {
  if (!Array.isArray(installResult)) return []
  const out = []
  for (const entry of installResult) {
    if (entry && Array.isArray(entry.mods)) {
      for (const m of entry.mods) {
        if (m && m.name && m.modType) out.push({ name: m.name, modType: m.modType })
      }
    }
  }
  return out
}

// Normalize a scanMods() entry to the same key form that recordInstall's
// localMods uses. scanMods() returns `filename` (with extension / `_P` /
// `.disabled` suffixes) and `type` (uppercased); the archive analyzer that
// feeds recordInstall uses `name` (already stripped) and `modType`. Without
// this normalization the cross-check below would get zero matches and
// prune every receipt on first read — badges would disappear right after
// install.
export function localModKey(m) {
  if (!m) return null
  if (m.type === 'PAK') {
    const base = String(m.filename || '')
      .replace(/\.(pak|ucas|utoc)(\.disabled)?$/i, '')
      .replace(/_P$/, '')
    return base ? `PAK:${base}` : null
  }
  if (m.type === 'UE4SS') {
    return m.filename ? `UE4SS:${m.filename}` : null
  }
  return null
}

// Returns [{modId, fileId, installedAt, localMods}] — but filtered against
// what's actually still on disk. Entries whose recorded localMods are all
// gone get pruned (and the pruned list is persisted so subsequent reads
// are cheap). Legacy entries without localMods (written before this field
// existed) are preserved as-is — we can't verify them, so don't drop them.
export function getInstalledMods() {
  const raw = configStore.get('nexusInstalledMods', [])
  if (!Array.isArray(raw) || raw.length === 0) return []

  let localMods = []
  try {
    localMods = scanMods() || []
  } catch (err) {
    logger.warn(`nexus getInstalledMods scanMods failed: ${err.message}`)
    return raw
  }
  const presentKeys = new Set(
    localMods.map(localModKey).filter(Boolean)
  )

  const filtered = raw.filter(entry => {
    if (!entry) return false
    // Legacy entry without localMods — can't verify, keep it.
    if (!Array.isArray(entry.localMods) || entry.localMods.length === 0) return true
    // Keep if any recorded local mod is still on disk.
    return entry.localMods.some(lm => lm && presentKeys.has(`${lm.modType}:${lm.name}`))
  })

  if (filtered.length !== raw.length) {
    configStore.set('nexusInstalledMods', filtered)
  }
  return filtered
}

// Manually "forget" a Nexus install (e.g. after the user removed the mod
// through the Modules tab and wants the browse UI to stop showing the
// "installed" badge — only relevant for legacy entries without localMods,
// since modern entries prune automatically).
export function forgetInstalled(modId) {
  if (!Number.isInteger(modId)) return { ok: false, reason: 'invalid-id' }
  const list = configStore.get('nexusInstalledMods', [])
  const filtered = (Array.isArray(list) ? list : []).filter(e => e && e.modId !== modId)
  configStore.set('nexusInstalledMods', filtered)
  return { ok: true }
}
