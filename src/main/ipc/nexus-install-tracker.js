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
export function recordInstall(modId, fileId, localMods, version = null) {
  const list = configStore.get('nexusInstalledMods', [])
  const safe = Array.isArray(list) ? list.filter(e => e && e.modId !== modId) : []
  safe.push({
    modId,
    fileId: fileId || null,
    installedAt: Date.now(),
    // Installed version string, when known (the update flow passes it through).
    // Lets the update badge show "v1.2 -> v1.5"; absent on older receipts.
    version: version || null,
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

// Strip a trailing `.disabled` so a toggled PAK matches its enabled name.
// (Mirrors renderer profile-utils.normalizeFilename — kept inline so the
// main process doesn't import renderer code.)
function stripDisabled(filename) {
  return typeof filename === 'string' ? filename.replace(/\.disabled$/i, '') : ''
}

// Pure reverse lookup: for each wanted (enabled) filename, find the Nexus
// install receipt whose landed localMods include the matching on-disk mod, and
// emit its source. Mods with no receipt (manual installs) are omitted.
//
// receipts: nexusInstalledMods entries. mods: scanMods() result. wantedFilenames:
// a profile's enabledModFilenames. Returns one entry per matched filename.
export function matchSourcesToMods(receipts, mods, wantedFilenames) {
  if (!Array.isArray(receipts) || !Array.isArray(mods) || !Array.isArray(wantedFilenames)) return []
  if (receipts.length === 0 || wantedFilenames.length === 0) return []

  // receipt localMod key (`${modType}:${name}`) → receipt
  const keyToReceipt = new Map()
  for (const r of receipts) {
    if (!r || !r.modId || !Array.isArray(r.localMods)) continue
    for (const lm of r.localMods) {
      if (lm && lm.name && lm.modType) keyToReceipt.set(`${lm.modType}:${lm.name}`, r)
    }
  }

  const wanted = new Set(wantedFilenames.map(stripDisabled).filter(Boolean))
  const out = []
  const seen = new Set()
  for (const m of mods) {
    const fn = stripDisabled(m.filename)
    if (!wanted.has(fn)) continue
    const key = localModKey(m) // `PAK:base` / `UE4SS:folder`
    if (!key) continue
    const r = keyToReceipt.get(key)
    if (!r) continue
    if (seen.has(fn)) continue
    seen.add(fn)
    out.push({
      filename: fn,
      modId: r.modId,
      fileId: r.fileId != null ? r.fileId : null,
      version: r.version != null ? r.version : null,
      displayName: m.title || m.filename,
    })
  }
  return out
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
    // Legacy entry (written before the localMods field existed) — the field is
    // absent, so we genuinely can't verify it; keep it.
    if (entry.localMods === undefined) return true
    // Modern entry whose install landed nothing trackable (empty array) is NOT
    // unverifiable legacy — drop it so a phantom "installed" badge for a mod
    // with no identifiable on-disk files doesn't persist forever.
    if (!Array.isArray(entry.localMods) || entry.localMods.length === 0) return false
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
