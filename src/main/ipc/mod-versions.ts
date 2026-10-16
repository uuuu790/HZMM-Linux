// Mod version retention for one-click rollback. Before nexus:update-file
// replaces a mod, the outgoing files are archived under
// <configDir>/mod-versions/<modId>/<timestamp>/ with a manifest; only the
// newest KEEP_VERSIONS snapshots per mod are retained (paks can be large).
//
// Pure fs + injected paths — no configStore/Electron — so unit tests drive
// everything against temp dirs. IPC handlers live in nexus.ts.

import fs from 'fs'
import path from 'path'
import { assertSafeSegment } from '../services/path-safety'
import { copyDirSync } from './mods-install'
import logger from '../services/logger'
import type { PakLocations } from './mods-order'
import type { LocalModRef, ModType, ModVersionInfo, NexusInstallReceipt } from './types'

export const KEEP_VERSIONS = 2

/** One archived pak / UE4SS folder in a snapshot manifest. */
interface VersionEntry {
  kind: ModType
  name: string
  /** PAK only: the on-disk name it had (may be `.disabled`). */
  filename?: string
}

interface ModVersionManifest {
  type: 'mod-version'
  version: 1
  modId: number
  fileId: number | null
  modVersion: string | null
  savedAt: number
  entries: VersionEntry[]
}

// Locate a receipt-recorded PAK on disk in whatever form it currently has.
// Candidate names mirror rotateModsToBackup / mods-update-state.
function findPakFile(paksPaths: string[] | null | undefined, name: string): { dir: string; onDiskName: string } | null {
  for (const base of [`${name}_P.pak`, `${name}.pak`]) {
    for (const dir of paksPaths || []) {
      if (fs.existsSync(path.join(dir, base))) return { dir, onDiskName: base }
      if (fs.existsSync(path.join(dir, `${base}.disabled`))) return { dir, onDiskName: `${base}.disabled` }
    }
  }
  return null
}

// Delete every on-disk variant (enabled/disabled) of a receipt PAK name.
// Used by rollback to clear the current version before copying the archive in.
export function removePakVariants(paksPaths: string[] | null | undefined, name: string): number {
  let removed = 0
  for (const base of [`${name}_P.pak`, `${name}.pak`]) {
    for (const dir of paksPaths || []) {
      for (const variant of [base, `${base}.disabled`]) {
        const p = path.join(dir, variant)
        if (!fs.existsSync(p)) continue
        try {
          fs.unlinkSync(p)
          removed++
        } catch (err) {
          logger.warn(`mod-versions: could not remove ${variant}: ${(err as Error).message}`)
        }
      }
    }
  }
  return removed
}

// Keep only the newest `keep` snapshots for one mod (dir names are epoch ms).
export function pruneModVersions(modVersionsDir: string, keep = KEEP_VERSIONS): number {
  let dirs: string[] = []
  try { dirs = fs.readdirSync(modVersionsDir).filter(d => /^\d+$/.test(d)) } catch { return 0 }
  dirs.sort((a, b) => Number(b) - Number(a))
  let pruned = 0
  for (const d of dirs.slice(keep)) {
    try {
      fs.rmSync(path.join(modVersionsDir, d), { recursive: true, force: true })
      pruned++
    } catch (err) {
      logger.warn(`mod-versions: prune failed for ${d}: ${(err as Error).message}`)
    }
  }
  return pruned
}

// Snapshot the CURRENT on-disk files of a receipt before an update replaces
// them. Returns { dir, entries } or null when nothing was found to archive.
// `prune: false` defers retention pruning to the caller — the update flow
// prunes only AFTER the install succeeds, so a failed attempt (whose snapshot
// it deletes again) can never evict a genuinely older version's rollback slot.
export function archiveModVersion(
  { paksPaths, ue4ssModsPath }: PakLocations,
  retentionRoot: string,
  receipt: NexusInstallReceipt | null | undefined,
  now = Date.now(),
  { prune = true }: { prune?: boolean } = {},
): { dir: string; entries: number } | null {
  if (!receipt || !Number.isInteger(receipt.modId)) return null
  const snapshotDir = path.join(retentionRoot, String(receipt.modId), String(now))
  const entries: VersionEntry[] = []
  for (const lm of Array.isArray(receipt.localMods) ? receipt.localMods : []) {
    if (!lm || !lm.name || !lm.modType) continue
    try { assertSafeSegment('modName', lm.name) } catch { continue }
    try {
      if (lm.modType === 'PAK') {
        const found = findPakFile(paksPaths, lm.name)
        if (!found) continue
        const outDir = path.join(snapshotDir, 'paks')
        fs.mkdirSync(outDir, { recursive: true })
        fs.copyFileSync(path.join(found.dir, found.onDiskName), path.join(outDir, found.onDiskName))
        entries.push({ kind: 'PAK', filename: found.onDiskName, name: lm.name })
      } else if (lm.modType === 'UE4SS' && ue4ssModsPath) {
        const modDir = path.join(ue4ssModsPath, lm.name)
        let isDir = false
        try { isDir = fs.statSync(modDir).isDirectory() } catch { /* not on disk */ }
        if (!isDir) continue
        copyDirSync(modDir, path.join(snapshotDir, 'ue4ss', lm.name))
        entries.push({ kind: 'UE4SS', name: lm.name })
      }
    } catch (err) {
      logger.warn(`mod-versions: archive failed for ${lm.name}: ${(err as Error).message}`)
    }
  }
  if (entries.length === 0) {
    try { fs.rmSync(snapshotDir, { recursive: true, force: true }) } catch { /* nothing landed */ }
    return null
  }
  const manifest: ModVersionManifest = {
    type: 'mod-version',
    version: 1,
    modId: receipt.modId,
    fileId: receipt.fileId ?? null,
    modVersion: receipt.version ?? null,
    savedAt: now,
    entries,
  }
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  if (prune) pruneModVersions(path.join(retentionRoot, String(receipt.modId)))
  logger.info(`mod-versions: archived mod ${receipt.modId} (${entries.length} entries)`)
  return { dir: snapshotDir, entries: entries.length }
}

// Enumerate every retained snapshot: { [modId]: [{ dir, version, fileId,
// savedAt }] } newest first. (IPC/structured-clone keys are strings.)
export function listModVersions(retentionRoot: string): Record<string, ModVersionInfo[]> {
  const out: Record<string, ModVersionInfo[]> = {}
  let modDirs: string[] = []
  try { modDirs = fs.readdirSync(retentionRoot).filter(d => /^\d+$/.test(d)) } catch { return out }
  for (const modId of modDirs) {
    const modDir = path.join(retentionRoot, modId)
    let snaps: string[] = []
    try { snaps = fs.readdirSync(modDir).filter(d => /^\d+$/.test(d)) } catch { continue }
    const versions: ModVersionInfo[] = []
    for (const snap of snaps) {
      try {
        const manifest: Partial<ModVersionManifest> = JSON.parse(fs.readFileSync(path.join(modDir, snap, 'manifest.json'), 'utf-8'))
        versions.push({
          dir: path.join(modDir, snap),
          version: manifest.modVersion ?? null,
          fileId: manifest.fileId ?? null,
          savedAt: manifest.savedAt || Number(snap),
        })
      } catch { /* corrupt/partial snapshot — skip */ }
    }
    if (versions.length > 0) {
      versions.sort((a, b) => b.savedAt - a.savedAt)
      out[modId] = versions
    }
  }
  return out
}

// Replace the mod's current files with an archived snapshot. Every name from
// the manifest is re-validated (the retention dir is user-modifiable on disk).
// Returns { modId, fileId, version, localMods } for the receipt rewrite.
export function restoreArchivedVersion(
  { paksPaths, ue4ssModsPath, primaryPaksPath }: PakLocations & { primaryPaksPath: string },
  snapshotDir: string,
): { modId: number; fileId: number | null; version: string | null; localMods: LocalModRef[] } {
  // The retention dir is user-modifiable: every entry field is checked below.
  const manifest: { modId: number; fileId?: number | null; modVersion?: string | null; entries?: unknown } =
    JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf-8'))
  const localMods: LocalModRef[] = []
  for (const entry of (Array.isArray(manifest.entries) ? manifest.entries : []) as Array<Partial<VersionEntry> | null>) {
    if (!entry || !entry.kind) continue
    try {
      if (entry.kind === 'PAK') {
        assertSafeSegment('filename', entry.filename)
        assertSafeSegment('modName', entry.name)
        const src = path.join(snapshotDir, 'paks', entry.filename)
        if (!fs.existsSync(src)) continue
        removePakVariants(paksPaths, entry.name)
        fs.copyFileSync(src, path.join(primaryPaksPath, entry.filename))
        localMods.push({ modType: 'PAK', name: entry.name })
      } else if (entry.kind === 'UE4SS' && ue4ssModsPath) {
        assertSafeSegment('modName', entry.name)
        const src = path.join(snapshotDir, 'ue4ss', entry.name)
        if (!fs.existsSync(src)) continue
        const dest = path.join(ue4ssModsPath, entry.name)
        fs.rmSync(dest, { recursive: true, force: true })
        copyDirSync(src, dest)
        localMods.push({ modType: 'UE4SS', name: entry.name })
      }
    } catch (err) {
      logger.warn(`mod-versions: restore skipped ${entry.name || entry.filename}: ${(err as Error).message}`)
    }
  }
  return {
    modId: manifest.modId,
    fileId: manifest.fileId ?? null,
    version: manifest.modVersion ?? null,
    localMods,
  }
}
