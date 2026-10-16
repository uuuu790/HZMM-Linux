// PAK load-order helpers. HumanitZ (UE4) mounts the paks in `~mods` in
// case-insensitive alphabetical order and the LATER mount wins conflicting
// assets (documented in the community modding guides and this project's own
// modding notes: "~mods 內按字母順序，後者覆蓋前者"). HZMM therefore controls
// which pak wins a conflict by renaming it with an escalating `z<N>_` prefix
// so it sorts after its competitors.
//
// Renaming a pak also has to migrate every store that keys mods by filename —
// profiles, Nexus receipts, custom names, hybrid link files — which is what
// renamePakEverywhere centralizes. This module is a LEAF (no electron, no
// mods-scan import) so mods-scan can import stripOrderPrefix without a cycle;
// the IPC handler lives in mods.ts.

import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import logger from '../services/logger'
import type { ModProfile, NexusInstallReceipt } from './types'

/** One rename of a load-order plan. */
export interface RenameTarget {
  from: string
  to: string
}

// Ordering prefixes HZMM writes: the conflict-winner form (z1_ .. z99_,
// escalating to zz1_ / zzz1_ when a competitor's own name already sorts into
// the z-range, e.g. "zebra") and the full-reorder form (exactly three digits,
// 010_ / 020_ ..., written by mods:apply-pak-order). Both are stripped for
// display titles and for the update flow's coreName.
export const ORDER_PREFIX_RE = /^(z+\d{1,2}|\d{3})_/i

// A non-string comes back unchanged.
export function stripOrderPrefix(name: string): string
export function stripOrderPrefix<T>(name: T): T
export function stripOrderPrefix(name: unknown): unknown {
  return typeof name === 'string' ? name.replace(ORDER_PREFIX_RE, '') : name
}

// True when an on-disk filename is a form of `modName`'s pak: enabled or
// `.disabled`, `_P` or plain, the pak's IoStore siblings (.ucas/.utoc land in
// the paks dir alongside it), WITH OR WITHOUT a load-order prefix on the
// FILENAME. The install rotation needs the prefix-aware match: a
// conflict-renamed z1_Cool_P.pak IS mod "Cool", and an update that only
// rotates Cool_P.pak would leave the old z1_ file behind — which then keeps
// winning the alphabetical mount order over the freshly installed version.
//
// Built as a candidate SET (the on-disk forms `modName` can produce), not by
// normalizing both sides — normalization either over-matches (mod "X_p"
// swallowing unrelated "X.pak") or under-matches (X_P_P.pak no longer matching
// mod "X_P"). The prefix is only ever stripped from the FILENAME side, so a
// mod legitimately named z1_X / 010_X can never swallow the unrelated mod X.
// Case-insensitive, like the Windows fs.
export function isPakFormOfMod(filename: unknown, modName: unknown): boolean {
  if (typeof filename !== 'string' || typeof modName !== 'string' || !modName) return false
  const enabledForm = filename.toLowerCase().replace(/\.disabled$/, '')
  const name = modName.toLowerCase()
  const candidates = new Set<string>()
  for (const body of [`${name}_p`, name]) {
    for (const ext of ['pak', 'ucas', 'utoc']) candidates.add(`${body}.${ext}`)
  }
  return candidates.has(enabledForm) || candidates.has(stripOrderPrefix(enabledForm))
}

// Case-insensitive lexical compare — mirrors how the engine's alphabetical
// mount order treats filenames on Windows.
export function comparePakNames(a: unknown, b: unknown): number {
  const x = String(a).toLowerCase()
  const y = String(b).toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

// Compute a filename for `filename` that sorts strictly AFTER every name in
// `competitors`. Returns the unchanged name when it already wins. Existing
// order prefixes on `filename` are replaced, not stacked. Throws when no
// prefix within the escalation cap can win (pathological competitor names).
export function pickWinningName(filename: string, competitors: unknown): string {
  const core = stripOrderPrefix(filename)
  const rivals = (Array.isArray(competitors) ? competitors : [])
    .filter((c: unknown): c is string => typeof c === 'string' && c !== '' && comparePakNames(c, filename) !== 0)
  const beatsAll = (candidate: string) => rivals.every(r => comparePakNames(candidate, r) > 0)
  if (beatsAll(filename)) return filename
  for (let zs = 1; zs <= 4; zs++) {
    for (let n = 1; n <= 99; n++) {
      const candidate = `${'z'.repeat(zs)}${n}_${core}`
      if (beatsAll(candidate)) return candidate
    }
  }
  throw new Error('Could not compute a winning load-order name')
}

// --- Full reorder (drag-and-drop panel) ---

// Given the user's desired sequence of pak filenames, compute the renames that
// make the on-disk alphabetical order equal that sequence. No-op when the
// sequence is ALREADY strictly ascending (whatever prefixes the names carry);
// otherwise every entry is renumbered to `NNN_<core>` (existing order prefixes
// replaced, 3-digit zero-padded, step 10 to leave gaps — step 1 past 99 mods).
// Pure: returns [{ from, to }] with already-matching names filtered out.
export function buildOrderTargets(orderedFilenames: string[] | null | undefined): RenameTarget[] {
  const names = Array.isArray(orderedFilenames) ? orderedFilenames : []
  let ascending = true
  for (let i = 1; i < names.length; i++) {
    if (comparePakNames(names[i - 1], names[i]) >= 0) { ascending = false; break }
  }
  if (ascending) return []
  const step = names.length > 99 ? 1 : 10
  const targets: RenameTarget[] = []
  for (let i = 0; i < names.length; i++) {
    const to = `${String((i + 1) * step).padStart(3, '0')}_${stripOrderPrefix(names[i])}`
    if (to !== names[i]) targets.push({ from: names[i], to })
  }
  return targets
}

export interface RenameOps {
  exists: (name: string) => boolean
  rename: (from: string, to: string) => void
}

// Execute a rename plan where a target name may still be occupied by another
// plan entry (e.g. swapping 010_A and 020_B — a true rename cycle). Multi-pass:
// each pass renames every entry whose target is free; a stalled pass bounces
// one blocked entry through a unique temp name to break the cycle. `exists` /
// `rename` are injected so the logic is unit-testable without fs; production
// wires them to the paks dirs + renamePakEverywhere.
export function executeOrderRenames(targets: RenameTarget[] | null | undefined, { exists, rename }: RenameOps): { renamed: number; skipped: number } {
  const pending = (targets || []).map(t => ({ ...t }))
  const summary = { renamed: 0, skipped: 0 }
  let guard = 0
  while (pending.length > 0) {
    if (++guard > 500) throw new Error('Load order rename plan did not converge')
    let progressed = false
    for (let i = pending.length - 1; i >= 0; i--) {
      const t = pending[i]
      if (!exists(t.from)) {
        // Source vanished (concurrent remove / stale renderer list) — skip it.
        pending.splice(i, 1)
        summary.skipped++
        progressed = true
        continue
      }
      if (exists(t.to)) continue
      rename(t.from, t.to)
      pending.splice(i, 1)
      summary.renamed++
      progressed = true
    }
    if (pending.length > 0 && !progressed) {
      // Every remaining target is occupied by another pending entry — bounce
      // one through a temp name. The prefix deliberately doesn't match
      // ORDER_PREFIX_RE, so the transient name can't be misread as ordered.
      const t = pending[0]
      const tmp = `ztmp${(guard * 7919) % 100000}_${t.to}`
      if (exists(tmp)) throw new Error('Load order temp name collision')
      rename(t.from, tmp)
      t.from = tmp
    }
  }
  return summary
}

// --- Pure store migrations (unit-tested; orchestrated below) ---
// Each takes the stored value as-is (it may be missing or malformed) and
// returns the SAME reference when nothing changes.

// Profiles store full filenames (enabled form, sometimes .disabled).
export function migrateProfiles<T extends ModProfile[] | null | undefined>(profiles: T, oldFilename: string, newFilename: string): T {
  if (!Array.isArray(profiles)) return profiles
  return profiles.map((p: ModProfile | null) => {
    if (!p || !Array.isArray(p.enabledModFilenames)) return p
    return {
      ...p,
      enabledModFilenames: p.enabledModFilenames.map(fn => {
        if (fn === oldFilename) return newFilename
        if (fn === `${oldFilename}.disabled`) return `${newFilename}.disabled`
        return fn
      }),
    }
  }) as T
}

// Receipts key PAK localMods by the base name (extension, `_P`, `.disabled`
// stripped) — same normalization as localModKey in nexus-install-tracker.
function pakBaseName(filename: unknown): string {
  return String(filename || '')
    .replace(/\.(pak|ucas|utoc)(\.disabled)?$/i, '')
    .replace(/_P$/, '')
}

export function migrateReceipts<T extends NexusInstallReceipt[] | null | undefined>(receipts: T, oldFilename: string, newFilename: string): T {
  if (!Array.isArray(receipts)) return receipts
  const oldBase = pakBaseName(oldFilename)
  const newBase = pakBaseName(newFilename)
  if (!oldBase || oldBase === newBase) return receipts
  return receipts.map((r: NexusInstallReceipt | null) => {
    if (!r || !Array.isArray(r.localMods)) return r
    return {
      ...r,
      localMods: r.localMods.map(lm =>
        lm && lm.modType === 'PAK' && lm.name === oldBase ? { ...lm, name: newBase } : lm
      ),
    }
  }) as T
}

// Custom names are keyed by the mod id (= filename minus `.disabled`).
export function migrateCustomNames<T extends Record<string, string> | null | undefined>(names: T, oldFilename: string, newFilename: string): T {
  if (!names || typeof names !== 'object') return names
  const oldKey = String(oldFilename).replace(/\.disabled$/i, '')
  if (!(oldKey in names)) return names
  const out: Record<string, string> = { ...names }
  out[String(newFilename).replace(/\.disabled$/i, '')] = out[oldKey]
  delete out[oldKey]
  return out as T
}

// Hybrid link files reference pak names on disk — rewrite matching entries.
export function migrateHybridLinks(ue4ssModsPath: string, oldFilename: string, newFilename: string): void {
  const oldBase = String(oldFilename).replace(/\.disabled$/i, '')
  const newBase = String(newFilename).replace(/\.disabled$/i, '')
  let dirs: string[] = []
  try { dirs = fs.readdirSync(ue4ssModsPath) } catch { return }
  for (const dir of dirs) {
    const linkFile = path.join(ue4ssModsPath, dir, '_hzmm_link.json')
    try {
      if (!fs.existsSync(linkFile)) continue
      const data: { pakFiles?: unknown; [field: string]: unknown } = JSON.parse(fs.readFileSync(linkFile, 'utf-8'))
      const pakFiles: unknown[] = Array.isArray(data.pakFiles) ? data.pakFiles : []
      let changed = false
      const migrated = pakFiles.map(p => {
        if (String(p).replace(/\.disabled$/i, '') === oldBase) { changed = true; return newBase }
        return p
      })
      if (changed) {
        const tmp = `${linkFile}.tmp`
        fs.writeFileSync(tmp, JSON.stringify({ ...data, pakFiles: migrated }), 'utf-8')
        fs.renameSync(tmp, linkFile)
      }
    } catch (err) {
      logger.warn(`Load order: hybrid link migration failed for ${dir}: ${(err as Error).message}`)
    }
  }
}

export interface PakLocations {
  paksPaths?: string[] | null
  ue4ssModsPath?: string | null
}

// Rename a pak on disk AND migrate every filename-keyed store. Callers hold
// the shared write mutex (mods:make-pak-win wraps in serializeModWrite; the
// update-flow restore already runs inside one). `oldFilename`/`newFilename`
// are the ENABLED-form names; the on-disk `.disabled` twin is handled.
export function renamePakEverywhere({ paksPaths, ue4ssModsPath }: PakLocations, oldFilename: string, newFilename: string): { renamed: boolean } {
  if (oldFilename === newFilename) return { renamed: false }
  let renamedOnDisk = false
  for (const pp of paksPaths || []) {
    const fromEnabled = path.join(pp, oldFilename)
    const fromDisabled = `${fromEnabled}.disabled`
    const from = fs.existsSync(fromEnabled) ? fromEnabled : (fs.existsSync(fromDisabled) ? fromDisabled : null)
    if (!from) continue
    const wasDisabled = from === fromDisabled
    const to = path.join(pp, wasDisabled ? `${newFilename}.disabled` : newFilename)
    if (fs.existsSync(path.join(pp, newFilename)) || fs.existsSync(path.join(pp, `${newFilename}.disabled`))) {
      throw new Error(`Target name already exists: ${newFilename}`)
    }
    fs.renameSync(from, to)
    renamedOnDisk = true
    break
  }
  if (!renamedOnDisk) throw new Error(`PAK file not found: ${oldFilename}`)

  const profiles = configStore.get('profiles', [])
  const migratedProfiles = migrateProfiles(profiles, oldFilename, newFilename)
  if (migratedProfiles !== profiles) configStore.set('profiles', migratedProfiles)

  const receipts = configStore.get('nexusInstalledMods', [])
  const migratedReceipts = migrateReceipts(receipts, oldFilename, newFilename)
  if (migratedReceipts !== receipts) configStore.set('nexusInstalledMods', migratedReceipts)

  const names = configStore.get('modCustomNames', {})
  const migratedNames = migrateCustomNames(names, oldFilename, newFilename)
  if (migratedNames !== names) configStore.set('modCustomNames', migratedNames)

  if (ue4ssModsPath) migrateHybridLinks(ue4ssModsPath, oldFilename, newFilename)

  logger.info(`Load order: renamed ${oldFilename} → ${newFilename}`)
  return { renamed: true }
}
