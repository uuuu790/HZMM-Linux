// Persistent "installed via Nexus" tracking. Writes receipts to configStore
// so the browse UI can mark mods as installed across sessions, and
// cross-checks those receipts against scanMods() so the badge auto-clears
// when the user removes the mod via the Modules tab.
//
// Pure logic — IPC handlers live in nexus.ts and thin-wrap these functions.
//
// Split out of nexus.js as part of the 470-line refactor.

import configStore from '../services/config-store'
import logger from '../services/logger'
import { scanMods, wasLastScanPartial } from './mods-scan'
import { stripOrderPrefix } from './mods-order'
import type { InstalledArchive, LocalModRef, ModSource, NexusInstallReceipt, NexusModFile, ScannedMod } from './types'

type Receipts = NexusInstallReceipt[] | null | undefined

// Two localMods entries referring to the same on-disk mod. PAK receipt names
// may carry a load-order prefix (migrateReceipts rewrites them on
// conflict-rename) while a fresh install's landed names never do — compare PAK
// entries on the prefix-stripped, case-insensitive core name, mirroring
// isPakFormOfMod's identity rule. UE4SS folder names have no prefix concept.
function sameLocalMod(a: Partial<LocalModRef> | null | undefined, b: Partial<LocalModRef> | null | undefined): boolean {
  if (!a || !b || a.modType !== b.modType) return false
  if (a.modType === 'PAK') {
    return stripOrderPrefix(String(a.name).toLowerCase()) === stripOrderPrefix(String(b.name).toLowerCase())
  }
  return a.name === b.name
}

// Persist an install receipt. `localMods` is an array of { name, modType }
// describing what actually landed on disk for this install. Used later by
// getInstalledMods to reconcile the persisted list against scanMods() — so if
// the user deletes the mod via the Modules tab, the badge auto-clears.
//
// PURE core of recordInstall — returns the new receipts array.
// Upsert by (modId, fileId), NOT modId alone. A single mod page can host
// several independent files (variants); installing file B must not erase the
// still-installed receipt for file A — that would clear A's badge and drop it
// from update checks. Reinstalling the same file still replaces its receipt.
export function mergeInstallReceipt(
  receipts: Receipts,
  modId: number,
  fileId: number | null | undefined,
  localMods: LocalModRef[] | null | undefined,
  version: string | null = null,
  now = 0,
): NexusInstallReceipt[] {
  const fid = fileId || null
  let safe = (Array.isArray(receipts) ? receipts : []).filter(e => e && !(e.modId === modId && (e.fileId || null) === fid))
  const lms = Array.isArray(localMods) ? [...localMods] : []
  if (fid != null) {
    // A concrete install supersedes a (modId, null) receipt that tracks any of
    // the SAME files (nexus:install-mod still writes fileId:null). Without
    // this the null receipt coexists with the concrete one forever: its
    // installedAt never advances, so the update checker flags it outdated on
    // every run while the update flow only ever touches concrete receipts —
    // the badge would never clear. Its extra entries (e.g. claim-linked files)
    // are carried over; a null receipt tracking DIFFERENT files is kept. A
    // pre-localMods legacy receipt (field undefined) has nothing to compare OR
    // carry — absorb it too: a concrete install of the page supersedes the
    // "installed something from here once" marker.
    const nullR = safe.find(e => e && e.modId === modId && (e.fileId || null) === null)
    const absorb = nullR && (
      nullR.localMods === undefined
      || (Array.isArray(nullR.localMods) && nullR.localMods.some(lm => lm && lms.some(x => sameLocalMod(x, lm))))
    )
    if (absorb) {
      for (const lm of Array.isArray(nullR.localMods) ? nullR.localMods : []) {
        if (lm && lm.name && lm.modType && !lms.some(x => sameLocalMod(x, lm))) {
          lms.push(lm)
        }
      }
      safe = safe.filter(e => e !== nullR)
    }
  }
  safe.push({
    modId,
    fileId: fid,
    installedAt: now,
    // Installed version string, when known (the update flow passes it through).
    // Lets the update badge show "v1.2 -> v1.5"; absent on older receipts.
    version: version || null,
    localMods: lms,
  })
  return safe
}

export function recordInstall(modId: number, fileId: number | null | undefined, localMods: LocalModRef[] | null | undefined, version: string | null = null): void {
  const list = configStore.get('nexusInstalledMods', [])
  configStore.set('nexusInstalledMods', mergeInstallReceipt(list, modId, fileId, localMods, version, Date.now()))
}

// PURE: after an update installed `newFileId`, retire the superseded
// `oldFileId` receipt. recordInstall only upserts by (modId, fileId), so
// without this the OLD receipt survives every update and keeps evaluating as
// outdated forever (badge/counter never clear, "Update all" reinstalls the
// same file every run). localMods entries the old receipt carried beyond the
// new one — e.g. hand-installed files claimed via nexus:link-mod — are moved
// onto the new receipt so they keep their update coverage and profile source
// attribution. No-op unless BOTH receipts exist (never drop tracking when the
// new receipt failed to record).
export function supersedeReceiptIn(receipts: Receipts, modId: number, oldFileId: number | null | undefined, newFileId: number | null | undefined): NexusInstallReceipt[] {
  const list = Array.isArray(receipts) ? receipts : []
  const oldFid = oldFileId ?? null
  const newFid = newFileId ?? null
  if (oldFid === newFid) return list
  const oldR = list.find(e => e && e.modId === modId && (e.fileId ?? null) === oldFid)
  const newR = list.find(e => e && e.modId === modId && (e.fileId ?? null) === newFid)
  if (!oldR || !newR) return list
  const lms = Array.isArray(newR.localMods) ? [...newR.localMods] : []
  for (const lm of Array.isArray(oldR.localMods) ? oldR.localMods : []) {
    // Prefix-aware dedup: the old receipt's conflict-renamed 'z1_Cool' and the
    // new receipt's freshly landed 'Cool' are the same pak — carrying both
    // would leave a duplicate entry once restore re-applies the prefix.
    if (lm && lm.name && lm.modType && !lms.some(x => sameLocalMod(x, lm))) {
      lms.push(lm)
    }
  }
  return list.filter(e => e !== oldR).map(e => (e === newR ? { ...newR, localMods: lms } : e))
}

export function supersedeReceipt(modId: number, oldFileId: number | null | undefined, newFileId: number | null | undefined): void {
  const list = configStore.get('nexusInstalledMods', [])
  const next = supersedeReceiptIn(list, modId, oldFileId, newFileId)
  if (next !== list) configStore.set('nexusInstalledMods', next)
}

// PURE: pick which receipt an incoming (modId, newFileId) install replaces.
// A mod page can host several independent files (variants) with one receipt
// each, so "first receipt with this modId" is wrong — it would snapshot,
// archive and state-restore a SIBLING variant. Selection order:
//   1. exact (modId, fileId) receipt — a reinstall of the same file;
//   2. with the mod's file list: the receipt whose installed file shares the
//      new file's `name` (the same-name family rule evaluateOutdated uses) —
//      and when the new file is a different variant than anything installed,
//      NULL (it's a fresh variant install, not an update);
//   3. no metadata: a lone receipt is the only sensible target; several are
//      ambiguous — null.
// A lone legacy/link receipt without fileId is accepted as the target: it
// stands for "the mod" as a whole.
export function selectReceiptForUpdate(
  receipts: Receipts,
  modId: number,
  newFileId: number | null,
  modFiles: Array<Pick<NexusModFile, 'file_id' | 'name'> | null> | null = null,
): NexusInstallReceipt | null {
  const list = (Array.isArray(receipts) ? receipts : []).filter(r => r && r.modId === modId)
  if (list.length === 0) return null
  const exact = list.find(r => (r.fileId ?? null) === newFileId)
  if (exact) return exact
  if (Array.isArray(modFiles) && modFiles.length > 0) {
    const newFile = modFiles.find(f => f && f.file_id === newFileId)
    if (newFile) {
      const match = list.find(r => {
        if (r.fileId == null) return false
        const cur = modFiles.find(f => f && f.file_id === r.fileId)
        return !!cur && cur.name === newFile.name
      })
      if (match) return match
      if (list.length === 1 && list[0].fileId == null) return list[0]
      return null
    }
  }
  return list.length === 1 ? list[0] : null
}

// Manually associate a local mod with a Nexus mod page ("claim" a hand-
// installed mod so the update checker covers it). Pure: returns the new
// receipts array. Merging into an existing receipt only ADDS the localMod;
// fileId/version fill in only when the receipt had none — a real install's
// info always outranks a manual link.
export function mergeLinkIntoReceipts(
  receipts: Receipts,
  modId: number,
  localMod: LocalModRef,
  { fileId = null, version = null, now = 0 }: { fileId?: number | null; version?: string | null; now?: number } = {},
): NexusInstallReceipt[] {
  const list = Array.isArray(receipts) ? receipts.map(r => (r ? { ...r } : r)) : []
  const existing = list.find(r => r && r.modId === modId)
  if (existing) {
    const lms = Array.isArray(existing.localMods) ? [...existing.localMods] : []
    if (!lms.some(lm => lm && lm.modType === localMod.modType && lm.name === localMod.name)) {
      lms.push(localMod)
    }
    existing.localMods = lms
    if (existing.fileId == null && fileId != null) {
      existing.fileId = fileId
      if (!existing.version && version) existing.version = version
    }
    return list
  }
  list.push({ modId, fileId, installedAt: now, version, localMods: [localMod] })
  return list
}

// Flatten installMods / downloadAndInstallFromUrl result into the flat
// {name, modType}[] shape recordInstall wants. The install result nests
// `mods` arrays inside one top-level entry per source archive.
export function flattenLandedMods(installResult: InstalledArchive[] | null | undefined): LocalModRef[] {
  if (!Array.isArray(installResult)) return []
  const out: LocalModRef[] = []
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
export function localModKey(m: Pick<ScannedMod, 'type' | 'filename'> | null | undefined): string | null {
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
function stripDisabled(filename: unknown): string {
  return typeof filename === 'string' ? filename.replace(/\.disabled$/i, '') : ''
}

// Pure reverse lookup: for each wanted (enabled) filename, find the Nexus
// install receipt whose landed localMods include the matching on-disk mod, and
// emit its source. Mods with no receipt (manual installs) are omitted.
//
// receipts: nexusInstalledMods entries. mods: scanMods() result. wantedFilenames:
// a profile's enabledModFilenames. Returns one entry per matched filename.
export function matchSourcesToMods(receipts: Receipts, mods: ScannedMod[] | null | undefined, wantedFilenames: string[] | null | undefined): ModSource[] {
  if (!Array.isArray(receipts) || !Array.isArray(mods) || !Array.isArray(wantedFilenames)) return []
  if (receipts.length === 0 || wantedFilenames.length === 0) return []

  // receipt localMod key (`${modType}:${name}`) → receipt
  const keyToReceipt = new Map<string, NexusInstallReceipt>()
  for (const r of receipts) {
    if (!r || !r.modId || !Array.isArray(r.localMods)) continue
    for (const lm of r.localMods) {
      if (lm && lm.name && lm.modType) keyToReceipt.set(`${lm.modType}:${lm.name}`, r)
    }
  }

  const wanted = new Set(wantedFilenames.map(stripDisabled).filter(Boolean))
  const out: ModSource[] = []
  const seen = new Set<string>()
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
export function getInstalledMods(): NexusInstallReceipt[] {
  const raw: NexusInstallReceipt[] = configStore.get('nexusInstalledMods', [])
  if (!Array.isArray(raw) || raw.length === 0) return []

  let localMods: ScannedMod[] = []
  try {
    localMods = scanMods() || []
  } catch (err) {
    logger.warn(`nexus getInstalledMods scanMods failed: ${(err as Error).message}`)
    return raw
  }
  // A partial scan (a paks dir couldn't be read — AV lock, dir being rebuilt)
  // returns fewer mods than are really on disk. Pruning receipts against it
  // would permanently delete still-installed entries, so skip pruning this time.
  if (wasLastScanPartial()) {
    logger.warn('nexus getInstalledMods: scan was partial, skipping receipt prune')
    return raw
  }
  // A scan that throws is handled above; a scan that returns EMPTY is just as
  // untrustworthy for pruning. scanMods() returns [] not only when the user has
  // no mods, but also when gamePath is still set yet the Paks/UE4SS dirs are
  // momentarily unreadable (external drive unplugged, game folder moved). Pruning
  // against an empty set would drop EVERY modern receipt and persist that wipe,
  // losing all Nexus install tracking permanently. Treat empty as "can't verify"
  // and return the list unpruned rather than committing a destructive write.
  if (localMods.length === 0) return raw
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
export function forgetInstalled(modId: unknown): { ok: boolean; reason?: string } {
  if (!Number.isInteger(modId)) return { ok: false, reason: 'invalid-id' }
  const list = configStore.get('nexusInstalledMods', [])
  const filtered = (Array.isArray(list) ? list : []).filter((e: NexusInstallReceipt | null) => e && e.modId !== modId)
  configStore.set('nexusInstalledMods', filtered)
  return { ok: true }
}
