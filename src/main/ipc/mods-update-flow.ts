// Shared "update a mod IN PLACE" wrapper: snapshot the user-local state the
// reinstall would otherwise wipe (enabled/disabled + edited UE4SS configs),
// retain the outgoing version for one-click rollback, run the install, then
// re-apply the snapshot. Used by nexus:update-file and by the nxm:// handler
// when the incoming file belongs to an already-installed mod — so the
// free-account website flow ("Mod Manager Download" on a newer file) gets the
// exact same update semantics as the Premium one-click button.

import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import logger from '../services/logger'
import { serializeModWrite } from './mods-install'
import { captureModState, restoreModState } from './mods-update-state'
import { archiveModVersion, pruneModVersions } from './mod-versions'
import { renamePakEverywhere } from './mods-order'
import { invalidateCache } from './mods-scan'
import { getAllPaksPaths, getUe4ssModsPath } from '../services/steam-detector'
import { selectReceiptForUpdate, supersedeReceipt } from './nexus-install-tracker'
import { v2GetModFiles } from './nexus-v2-client'
import type { NexusInstallReceipt, NexusModFile, RestoreSummary } from './types'

export interface UpdateRunResult<R> {
  result: R
  /** null when re-applying the snapshot failed. */
  restored: RestoreSummary | null
  /** false when no receipt matched: a fresh install / fresh variant. */
  wasUpdate: boolean
}

// Wrap `installFn` (which downloads + installs the new file and returns the
// install result, recording its own receipt) with the snapshot/restore +
// version-retention dance. `newFileId` identifies the incoming file so the
// right receipt is selected on multi-variant pages and the superseded
// receipt can be dropped afterwards. Returns { result, restored, wasUpdate }
// — restored is null when re-applying failed; wasUpdate is false when no
// receipt matched (fresh install / fresh variant), in which case this is a
// plain install with no snapshot.
export async function runUpdateWithStateRestore<R>(modId: number, newFileId: number | null, installFn: () => Promise<R>): Promise<UpdateRunResult<R>> {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) throw new Error('Game path not set')

  const receipts: NexusInstallReceipt[] = configStore.get('nexusInstalledMods', [])
  const candidates = (Array.isArray(receipts) ? receipts : []).filter(r => r && r.modId === modId)
  let receipt: NexusInstallReceipt | null = candidates.find(r => (r.fileId ?? null) === newFileId) || null
  // Whether the receipt choice is CONFIRMED (exact fileId match, or file
  // metadata contained newFileId so the family rule really applied). The
  // lone-receipt fallback without metadata may misidentify a fresh variant
  // install as an update — snapshotting a sibling is benign, but receipt
  // retirement is destructive and retention pruning would let the junk
  // snapshot evict a real rollback slot, so both are gated on `confident`.
  let confident = !!receipt
  if (!receipt && candidates.length > 0) {
    // No exact receipt: fetch the mod's file list once so the same-name
    // family rule (mirrors the update checker) picks the receipt the incoming
    // file actually replaces — never a sibling variant. Best-effort: on API
    // failure selectReceiptForUpdate falls back to its no-metadata rule.
    let modFiles: NexusModFile[] | null = null
    try {
      modFiles = await v2GetModFiles(modId)
    } catch (err) {
      logger.warn(`update-flow: file list unavailable for receipt selection: ${(err as Error).message}`)
    }
    confident = Array.isArray(modFiles) && modFiles.some(f => f && f.file_id === newFileId)
    receipt = selectReceiptForUpdate(receipts, modId, newFileId, modFiles)
  }

  const modPaths = { paksPaths: getAllPaksPaths(gamePath), ue4ssModsPath: getUe4ssModsPath(gamePath) }
  const retentionRoot = path.join(configStore.getConfigDir(), 'mod-versions')
  // Capture inside the write mutex so the snapshot sees a settled disk
  // state (never mid-toggle / mid-install).
  // Assigned inside the serializeModWrite callback below — the cast keeps TS
  // from narrowing it to `null` at the later reads.
  let archived = null as { dir: string; entries: number } | null
  const prevState = await serializeModWrite(() => {
    // Retain the outgoing version for one-click rollback BEFORE the install
    // rotates the old files away. Pruning is deferred until the install
    // succeeds (see below).
    if (receipt) {
      try {
        archived = archiveModVersion(modPaths, retentionRoot, receipt, Date.now(), { prune: false })
      } catch (err) {
        logger.warn(`update-flow: version archive failed: ${(err as Error).message}`)
      }
    }
    return captureModState(modPaths, receipt?.localMods || [])
  })

  let result: R
  try {
    result = await installFn()
  } catch (err) {
    // The failed download/install replaced nothing — the snapshot duplicates
    // what's still on disk, and pruned it would evict a genuinely older
    // version's rollback slot (KEEP_VERSIONS). Drop it before rethrowing.
    // (Known trade-off: in the narrow window where installFn threw AFTER the
    // install fully landed — a post-extract bookkeeping step failed — the
    // snapshot deleted here was the old version's last copy. That window is
    // rare and the alternative, keeping every failed attempt's snapshot,
    // reliably evicted real rollback slots on transient download failures.)
    if (archived?.dir) {
      try { fs.rmSync(archived.dir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
    throw err
  }

  // Install succeeded. On a confirmed match the snapshot is a real previous
  // version — apply retention — and the superseded receipt is retired
  // (installFn recorded the new one) so the old fileId stops evaluating as
  // outdated forever. On an unconfirmed lone match both are skipped: the
  // possibly-junk snapshot must not evict a real rollback slot, and the old
  // receipt is left for the update checker's stale-successor sweep (or a
  // later confirmed update) to clean up.
  if (archived && confident) {
    try { pruneModVersions(path.join(retentionRoot, String(modId))) } catch { /* best-effort */ }
  }
  if (receipt && (receipt.fileId ?? null) !== newFileId && confident) {
    supersedeReceipt(modId, receipt.fileId ?? null, newFileId)
  }

  // Restore is best-effort — the update itself succeeded; a partial
  // restore logs per entry and must not fail the whole operation.
  let restored: RestoreSummary | null = null
  try {
    restored = await serializeModWrite(() => restoreModState(modPaths, prevState, {
      // Re-applies a load-order prefix the reinstall dropped, migrating
      // the filename-keyed stores along with the on-disk rename.
      renamePak: (oldName, newName) => renamePakEverywhere(modPaths, oldName, newName),
    }))
    invalidateCache()
  } catch (err) {
    logger.warn(`update-flow: state restore failed: ${(err as Error).message}`)
  }
  return { result, restored, wasUpdate: !!receipt }
}
