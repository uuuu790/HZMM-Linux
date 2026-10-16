import StreamZip from 'node-stream-zip'
import { createExtractorFromFile } from 'node-unrar-js'
import Seven, { type SevenEntry, type SevenStream } from 'node-7z'
import { path7za } from '7zip-bin'
import { net, type ClientRequest, type IncomingMessage } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { isPathWithin } from './path-safety'
import type { LocalModRef } from '../ipc/types'

// In a packaged app the 7za binary lives inside app.asar, which the OS cannot
// execute — electron-builder unpacks it (asarUnpack in electron-builder.yml)
// and the runnable copy lives under app.asar.unpacked. In dev this is a no-op.
const SEVEN_BIN = path7za.replace('app.asar', 'app.asar.unpacked')

// Decompression-bomb guard. A few-KB archive can declare entries that expand
// to tens of GB and fill the disk, so we reject before writing the first byte
// when the declared totals blow past these ceilings.
//   - 8 GiB total uncompressed: high enough not to false-positive on big but
//     legit mod packs (full Content/Paks bundles), low enough to stop a bomb.
//   - 100000 entries: guards against the "millions of tiny files" inode/handle
//     exhaustion variant that a size cap alone wouldn't catch.
const MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
const MAX_ENTRY_COUNT = 100000

// Hard ceiling on a single download's byte count. A compressed mod archive is
// always smaller than its extracted size, so mirroring the uncompressed cap
// never false-positives on a legit download but stops an unbounded hostile
// stream (absent/lying content-length) from filling the disk.
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024 * 1024

// Zip Slip 防護：檢查解壓路徑是否超出目標目錄
function isSafePath(entryName: string, destDir: string): boolean {
  return isPathWithin(destDir, path.resolve(destDir, entryName))
}

function validateEntries(entryNames: string[], destDir: string): void {
  for (const name of entryNames) {
    if (!isSafePath(name, destDir)) {
      throw new Error(`Blocked path traversal in archive: ${name}`)
    }
  }
}

// node-stream-zip / node-unrar-js key their entries by the RAW header name
// (backslashes preserved with skipEntryNameValidation). We validate and analyze
// with `\`→`/` normalized names, so before asking the extractor for a specific
// entry we must map the normalized name back to its original — otherwise the
// lookup misses and nothing is written. Returns the normalized `entryNames`
// (for validation/analysis) plus `originalByNormalized` for that reverse lookup.
function buildEntryNameMap(rawNames: string[]): { entryNames: string[]; originalByNormalized: Map<string, string> } {
  const entryNames: string[] = []
  const originalByNormalized = new Map<string, string>()
  for (const raw of rawNames) {
    const normalized = raw.replace(/\\/g, '/')
    entryNames.push(normalized)
    // First writer wins so a later duplicate can't hijack an existing mapping.
    if (!originalByNormalized.has(normalized)) originalByNormalized.set(normalized, raw)
  }
  return { entryNames, originalByNormalized }
}

// Reject before extraction if the archive's declared uncompressed size or entry
// count exceeds the ceilings above. `sizes` are the per-entry uncompressed byte
// counts pulled from the central directory / RAR headers (callers pass the
// field name appropriate to their lib: node-stream-zip `.size`, node-unrar-js
// `.unpSize`). Throwing here keeps the disk-fill bomb from ever touching disk.
function validateArchiveLimits(sizes: unknown[]): void {
  if (sizes.length > MAX_ENTRY_COUNT) {
    throw new Error(
      `Archive rejected: ${sizes.length} entries exceeds the ${MAX_ENTRY_COUNT} entry limit (possible decompression bomb)`
    )
  }
  let total = 0
  for (const size of sizes) {
    total += Number(size) || 0
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Archive rejected: uncompressed size exceeds the ${MAX_TOTAL_UNCOMPRESSED_BYTES} byte limit (possible decompression bomb)`
      )
    }
  }
}

// Pick a destination path that does not clobber an existing file. When the
// preferred path is taken, append a numeric suffix before the extension —
// `mod.pak` -> `mod (2).pak` -> `mod (3).pak` — so two paks that share a
// basename under different subfolders both survive instead of one silently
// overwriting the other.
function resolveCollisionFreePath(destPath: string): string {
  if (!fs.existsSync(destPath)) return destPath
  const dir = path.dirname(destPath)
  const ext = path.extname(destPath)
  const base = path.basename(destPath, ext)
  for (let i = 2; i < 10000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  // Astronomically unlikely; fail loudly rather than overwrite.
  throw new Error(`Could not find a non-colliding destination for ${destPath}`)
}

// Walk an extracted tree and reject any symlink. 7za restores symlink entries
// from the archive, and validateEntries only checks each entry's own path — not
// a symlink's target — so a `link -> C:\` entry followed by `link/x` could write
// outside the tree. lstat does NOT follow links. Both extract7z branches run
// this on a TEMP dir and only move content into the live destination after the
// walk passes, so a detected link never lands in the game folders. Residual: on
// symlink-capable systems (the Linux fork; Windows with dev mode/elevation) 7za
// can still write THROUGH a link during extraction into the temp dir — this
// walk is containment + detection, not prevention. On default Windows, link
// creation itself fails without elevation.
function assertNoSymlinks(dir: string): void {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = fs.lstatSync(full)
    if (st.isSymbolicLink()) {
      // Delete the link before throwing so nothing that later walks or cleans
      // the tree can follow it.
      try { fs.unlinkSync(full) } catch { /* best-effort */ }
      throw new Error(`Blocked symlink entry in archive: ${entry}`)
    }
    if (st.isDirectory()) assertNoSymlinks(full)
  }
}

/** A mod an archive would install, for the preview list. */
export type ArchiveMod = LocalModRef

export interface ArchiveAnalysis {
  type: 'hybrid' | 'ue4ss-mod' | 'game-structure' | 'pak-only' | 'complex'
  /** Set for 'hybrid' / 'ue4ss-mod'. */
  hasGameStructure?: boolean
  pakFiles: string[]
  luaFiles: string[]
  dllFiles: string[]
  mods: ArchiveMod[]
  readmeFiles: string[]
  /** Added by an analyzeOnly extract. */
  entryNames?: string[]
}

export type ArchiveFormat = 'zip' | 'rar' | '7z' | 'unknown'

/** Download progress: a percentage, or -1 once when the total size is unknown. */
export type ProgressCallback = (percent: number) => void

// 分析壓縮檔內部結構，判斷 mod 類型與安裝方式
function analyzeArchiveStructure(entryNames: string[]): ArchiveAnalysis {
  // Case-insensitive extension matching: an archive whose only payload is
  // `Mod.PAK` (uppercase) must still be recognized as pak-only, else it falls
  // through to 'complex' and the whole archive is dumped into the game root.
  const pakFiles = entryNames.filter(n => /\.(pak|ucas|utoc)$/i.test(n))
  const luaFiles = entryNames.filter(n => /\.lua$/i.test(n))
  const dllFiles = entryNames.filter(n => /\.dll$/i.test(n))
  const hasEnabledTxt = entryNames.some(n => path.basename(n).toLowerCase() === 'enabled.txt')
  const hasModManifest = entryNames.some(n => path.basename(n).toLowerCase() === 'modmanifest.json')

  // 偵測是否有遊戲目錄結構（如 HumanitZ/Content/Paks/ 或 HumanitZ/Binaries/）
  const hasGameStructure = entryNames.some(n =>
    n.match(/^HumanitZ\/(Content|Binaries)\//i)
  )

  // UE4SS mod 偵測：
  // 1. 有 enabled.txt + lua 腳本
  // 2. 有 Scripts/main.lua 或 main.lua 結構（常見 UE4SS mod 不附 enabled.txt）
  // 3. 有 dll 但無 pak（UE4SS C++ mod）
  const hasScriptsMain = entryNames.some(n => n.replace(/\\/g, '/').match(/Scripts\/main\.lua$/i))
  const hasMainLua = entryNames.some(n => path.basename(n) === 'main.lua')
  const isUe4ssMod =
    (luaFiles.length > 0 && hasEnabledTxt) ||
    hasScriptsMain ||
    (hasMainLua && luaFiles.length > 0) ||
    (dllFiles.length > 0 && pakFiles.length === 0 && luaFiles.length === 0)

  // Find readme files in the archive
  const readmeNames = new Set(['readme.md', 'readme.txt', 'readme', 'description.txt', 'info.txt'])
  const readmeFiles = entryNames.filter(n => readmeNames.has(path.basename(n).toLowerCase()))

  // Build mod summary list for preview display. Dedupe by name: an IoStore
  // trio (X.pak + X.ucas + X.utoc) is ONE mod, not three — without this the
  // preview lists it thrice and rotate/backup walks the same files repeatedly.
  const mods: ArchiveMod[] = []
  const seenPakNames = new Set<string>()
  for (const p of pakFiles) {
    const name = path.basename(p).replace(/\.(pak|ucas|utoc)$/i, '').replace(/_P$/, '')
    const key = name.toLowerCase()
    if (seenPakNames.has(key)) continue
    seenPakNames.add(key)
    mods.push({ name, modType: 'PAK' })
  }
  // UE4SS mod folders: find folder containing Scripts/main.lua or main.lua
  const ue4ssFolders = new Set<string>()
  for (const l of luaFiles) {
    const parts = l.replace(/\\/g, '/').split('/')
    const idx = parts.findIndex(p => p.toLowerCase() === 'scripts')
    if (idx > 0) ue4ssFolders.add(parts[idx - 1])
    else if (parts.length >= 2) ue4ssFolders.add(parts[parts.length - 2])
  }
  for (const d of dllFiles) {
    const parts = d.replace(/\\/g, '/').split('/')
    // Cppmod standard layout is `<Mod>/dlls/main.dll`. The parent of `dlls/`
    // is the mod folder name; without stepping up an extra level we'd record
    // `'dlls'` and downstream rotate/restore would look at the wrong path.
    const dllsIdx = parts.findIndex(p => p.toLowerCase() === 'dlls')
    if (dllsIdx > 0) ue4ssFolders.add(parts[dllsIdx - 1])
    else if (parts.length >= 2) ue4ssFolders.add(parts[parts.length - 2])
  }
  for (const folder of ue4ssFolders) {
    // Skip traversal/degenerate folder names derived from crafted archive paths
    // (e.g. "../Scripts/main.lua" yields ".."). Downstream these names become
    // fs targets in rotateModsToBackup / registry writes, so drop them here.
    if (!folder || folder === '.' || folder === '..' || folder.includes('/') || folder.includes('\\')) continue
    mods.push({ name: folder, modType: 'UE4SS' })
  }

  // 混合型：同時有 PAK + UE4SS
  if (isUe4ssMod && pakFiles.length > 0) {
    return { type: 'hybrid', hasGameStructure, pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  // UE4SS 優先：即使包在遊戲目錄結構裡，有 UE4SS 特徵就判定為 UE4SS mod
  if (isUe4ssMod) {
    return { type: 'ue4ss-mod', hasGameStructure, pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  if (hasGameStructure) {
    return { type: 'game-structure', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  if (pakFiles.length > 0 && !luaFiles.length && !dllFiles.length && !hasModManifest) {
    return { type: 'pak-only', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  // 複合型 mod（含 dll/manifest 等）
  return { type: 'complex', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
}

// node-stream-zip keys entries by their RAW stored name and writes that raw
// name to disk on bulk extract. Archives produced by Windows tools (built-in
// zipper, PowerShell Compress-Archive — the very tools skipEntryNameValidation
// exists for) use backslash separators, so on Linux:
//   - zip.extract(<normalized name>, …) finds no entry and silently writes
//     NOTHING (install "succeeds" with zero files landed);
//   - zip.extract(null, destDir) writes literal files named `a\b\c.pak`.
// Single-entry lookups go through buildEntryNameMap's originalByNormalized; the
// bulk-extract helper below writes each entry at its normalized path instead.
async function extractAllZipEntries(
  zip: InstanceType<typeof StreamZip.async>,
  entryList: StreamZip.ZipEntry[],
  destDir: string
): Promise<void> {
  if (!entryList.some(e => e.name.includes('\\'))) {
    // Fast path: sane separators, let the library restore the tree itself.
    await zip.extract(null, destDir)
    return
  }
  for (const entry of entryList) {
    const rel = entry.name.replace(/\\/g, '/')
    // validateEntries already ran on the normalized names, so rel is in-tree.
    const dest = path.join(destDir, rel)
    if (entry.isDirectory) {
      fs.mkdirSync(dest, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    await zip.extract(entry.name, dest)
  }
}

// Sniff the real archive format from magic bytes. A downloaded file's
// extension can't be trusted: Nexus's newer CDN serves GUID paths with no
// extension at all, and the download flow falls back to naming those .zip —
// feeding a RAR/7z payload to the zip extractor ("Bad archive").
// Returns 'zip' | 'rar' | '7z' | 'unknown'; any read failure is 'unknown'.
function detectArchiveFormat(filePath: string): ArchiveFormat {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(8)
    const read = fs.readSync(fd, buf, 0, 8, 0)
    if (read >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
      // Local file header (03 04), empty-archive EOCD (05 06), spanned (07 08).
      const pair = (buf[2] << 8) | buf[3]
      if (pair === 0x0304 || pair === 0x0506 || pair === 0x0708) return 'zip'
    }
    if (read >= 7 && buf.subarray(0, 6).equals(Buffer.from('Rar!\x1a\x07', 'latin1'))
      && (buf[6] === 0x00 || (read >= 8 && buf[6] === 0x01 && buf[7] === 0x00))) {
      return 'rar' // v4 ends 0x00; v5 ends 0x01 0x00
    }
    if (read >= 6 && buf.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) {
      return '7z'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* best-effort */ }
    }
  }
}

function extractZip(zipPath: string, destDir: string | null, analyzeOnly: true): Promise<ArchiveAnalysis>
function extractZip(zipPath: string, destDir: string, analyzeOnly?: boolean): Promise<ArchiveAnalysis>
async function extractZip(zipPath: string, destDir: string | null, analyzeOnly = false): Promise<ArchiveAnalysis> {
  // skipEntryNameValidation: some zip tools (e.g. Windows built-in) produce backslash paths
  // which node-stream-zip rejects as "Malicious entry"
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryList = Object.values(entries)
    const { entryNames, originalByNormalized } = buildEntryNameMap(entryList.map(e => e.name))
    const analysis = analyzeArchiveStructure(entryNames)

    if (analyzeOnly) return { ...analysis, entryNames }

    // Past the analyzeOnly return a destination is always given (see the overloads).
    destDir = destDir as string

    // validateEntries MUST run before any write — it is the sole zip-slip guard
    // (skipEntryNameValidation is on so node-stream-zip won't reject the
    // backslash paths we normalize ourselves). validateArchiveLimits likewise
    // rejects decompression bombs before the first byte hits disk.
    validateEntries(entryNames, destDir)
    validateArchiveLimits(entryList.map(e => e.size))
    fs.mkdirSync(destDir, { recursive: true })

    if (analysis.type === 'pak-only') {
      for (const pakFile of analysis.pakFiles) {
        const fileName = path.basename(pakFile)
        const target = resolveCollisionFreePath(path.join(destDir, fileName))
        // pakFile is a normalized name; node-stream-zip keys entries by the
        // original (backslashes preserved), so hand it the raw name or the
        // lookup misses and zero files get written.
        await zip.extract(originalByNormalized.get(pakFile) ?? pakFile, target)
      }
    } else {
      await extractAllZipEntries(zip, entryList, destDir)
    }

    return analysis
  } finally {
    await zip.close()
  }
}

// Returns the copied file's path.
function copyFile(src: string, destDir: string): string {
  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, path.basename(src))
  fs.copyFileSync(src, destPath)
  return destPath
}

// Kill the download if no bytes flow for this long. The timer is idle-based:
// it re-arms on every chunk, so big downloads won't trip it as long as the
// server keeps sending data.
const DOWNLOAD_IDLE_TIMEOUT_MS = 60000

// Transient failures (stall, connection reset, HTTP 5xx/429) are retried up
// to this many total attempts, resuming from the partial file via a Range
// request when the server honors it. Policy refusals (blocked host, 4xx,
// HTML page, size cap) never retry.
const DOWNLOAD_MAX_ATTEMPTS = 3
const DOWNLOAD_RETRY_BASE_DELAY_MS = 2000

// Host allowlist matcher for downloadFile. EXACT hostname match by default —
// an entry only matches subdomains when it opts in with an explicit `*.`
// prefix (`*.githubusercontent.com` matches any subdomain, never the bare
// domain). Implicit subdomain matching used to let a redirect hop reach e.g.
// gist.github.com when only github.com was listed — the exact-match rule the
// callers' allowlists document (and test) now holds on every hop.
function isHostAllowed(hostname: string, allowedHosts: unknown): boolean {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) return false
  return allowedHosts.some(h => {
    if (typeof h !== 'string' || !h) return false
    if (h.startsWith('*.')) return hostname.endsWith(h.slice(1))
    return hostname === h
  })
}

// Electron net response headers may hold string or string[] values.
function headerValue(headers: Record<string, string | string[]> | undefined, name: string): string | undefined {
  const value = headers ? headers[name] : undefined
  return Array.isArray(value) ? value[0] : value
}

// Tag an error as safe to retry (network-level hiccup, not a policy refusal).
interface RetriableError extends Error {
  downloadRetriable?: boolean
}

function asRetriable(err: Error): RetriableError {
  const tagged: RetriableError = err
  tagged.downloadRetriable = true
  return tagged
}

// One download attempt over Electron's net module. net rides Chromium's
// network stack, so it honors the OS proxy/PAC configuration that Node's
// https module ignores — users whose only route to GitHub goes through a
// system proxy used to stall for 60s here even though their browser worked.
// `resumeFrom` > 0 sends a Range header; a 206 appends to the existing
// partial file, a 200 (server ignored the range) restarts it from scratch.
function downloadFileOnce(
  url: string,
  destPath: string,
  onProgress: ProgressCallback | null | undefined,
  allowedHosts: readonly string[] | null | undefined,
  resumeFrom = 0
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const isAllowed = (target: string): boolean => {
      // Fail closed: no allow-list means deny (every caller passes one). Stops a
      // future caller that forgets the argument from silently getting an
      // unrestricted SSRF + cleartext-http download primitive.
      try {
        const u = new URL(target)
        if (u.protocol !== 'https:') return false
        return isHostAllowed(u.hostname, allowedHosts)
      } catch {
        return false
      }
    }
    const blockedError = (target: string): Error => {
      // Report only the host — a Nexus CDN URL carries a short-lived signed
      // auth token in its query string that must not leak to the renderer/log.
      let blockedHost = target
      try { blockedHost = new URL(target).hostname } catch { /* keep raw */ }
      return new Error(`Download blocked: host "${blockedHost}" is not in the allowed list`)
    }

    // Initial-URL check runs BEFORE net.request so a disallowed URL never
    // opens a connection (and the check stays testable outside Electron).
    if (!isAllowed(url)) {
      reject(blockedError(url))
      return
    }

    let settled = false
    let idleTimer: NodeJS.Timeout | undefined
    // Electron types IncomingMessage as a plain EventEmitter, but at runtime it
    // is a stream.Readable — destroy() and pipeline() below rely on that.
    let response: (IncomingMessage & Readable) | null = null
    let request: ClientRequest

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(idleTimer)
      try { request.abort() } catch { /* already closed */ }
      // Tear the response down too so pipeline() releases the file handle —
      // on Windows an open fd would block the partial file's later cleanup.
      // destroy() WITHOUT an error: before pipeline() attaches, the stream has
      // no 'error' listener and destroy(err) would crash the process with an
      // uncaught exception; an active pipeline still rejects (premature close)
      // and that rejection is absorbed by the settled guard.
      try { response?.destroy() } catch { /* already destroyed */ }
      reject(err)
    }
    const armIdleTimer = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        fail(asRetriable(new Error(`Download stalled (no data for ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000}s)`)))
      }, DOWNLOAD_IDLE_TIMEOUT_MS)
    }

    try {
      request = net.request({ url, redirect: 'manual' })
    } catch (err) {
      reject(err)
      return
    }
    if (resumeFrom > 0) request.setHeader('Range', `bytes=${resumeFrom}-`)
    armIdleTimer()

    // Same allowlist on EVERY hop of the redirect chain. Without this the
    // initial-URL check is moot: a 302 to an arbitrary host would be followed
    // unconditionally.
    let redirectsLeft = 5
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      if (settled) return
      if (redirectsLeft-- <= 0) {
        fail(new Error('Download failed: too many redirects'))
        return
      }
      if (!isAllowed(redirectUrl)) {
        fail(blockedError(redirectUrl))
        return
      }
      armIdleTimer()
      request.followRedirect()
    })

    request.on('error', (err) => fail(asRetriable(new Error(`Download failed: ${err.message}`))))

    request.on('response', (incoming) => {
      if (settled) return
      const res = incoming as IncomingMessage & Readable
      response = res
      armIdleTimer()

      if (res.statusCode < 200 || res.statusCode >= 300) {
        const err = new Error(`Download failed with HTTP ${res.statusCode}`)
        // Server-side transients are worth retrying; 4xx refusals are not.
        if (res.statusCode >= 500 || res.statusCode === 429) asRetriable(err)
        fail(err)
        return
      }

      // Detect HTML responses (mod page URLs instead of direct download links)
      const contentType = headerValue(res.headers, 'content-type') || ''
      if (contentType.includes('text/html')) {
        fail(new Error('URL is a web page, not a direct download link. Please use a direct .zip/.rar/.7z/.pak file URL.'))
        return
      }

      const resumed = res.statusCode === 206 && resumeFrom > 0
      let downloaded = resumed ? resumeFrom : 0
      let totalSize = 0
      if (resumed) {
        // Content-Range: bytes <start>-<end>/<total>
        const match = /\/(\d+)\s*$/.exec(headerValue(res.headers, 'content-range') || '')
        totalSize = match ? parseInt(match[1], 10) : 0
      } else {
        totalSize = parseInt(headerValue(res.headers, 'content-length') as string, 10) || 0
      }
      // No usable total: emit an indeterminate signal once so the renderer
      // can show a spinner instead of a bar stuck at 0%.
      if (onProgress && !totalSize) onProgress(-1)

      res.on('data', (chunk: Buffer) => {
        armIdleTimer()
        downloaded += chunk.length
        // Hard byte cap independent of content-length: a hostile or hijacked
        // stream with an absent/lying length would otherwise fill the disk
        // (the idle timeout only catches stalls, not a steady stream).
        if (downloaded > MAX_DOWNLOAD_BYTES) {
          fail(new Error('Download aborted: exceeds the maximum allowed size'))
          return
        }
        // Clamp: a server that over-sends past content-length must not push
        // the progress bar above 100%.
        if (onProgress && totalSize) {
          onProgress(Math.min(100, Math.round((downloaded / totalSize) * 100)))
        }
      })

      const file = fs.createWriteStream(destPath, { flags: resumed ? 'a' : 'w' })
      // pipeline() handles back-pressure, wires up errors on both streams,
      // and avoids double-unlink races from manual .on('error') handlers.
      pipeline(res, file)
        .then(() => {
          if (settled) return
          settled = true
          clearTimeout(idleTimer)
          resolve(destPath)
        })
        .catch((err) => {
          // Keep the partial file — a retriable failure resumes from it; the
          // outer downloadFile removes it once retries are exhausted.
          fail(asRetriable(err instanceof Error ? err : new Error(String(err))))
        })
    })

    request.end()
  })
}

// `allowedHosts` (optional) enforces the host allowlist on EVERY hop of a
// redirect chain. The list is REQUIRED — a missing/empty list denies every
// request (fail closed), so each caller must pass the allow-list for its own
// trust boundary. Entries match exactly unless prefixed with `*.` (see
// isHostAllowed above). Transient failures retry with resume; callers never
// see a torn file — on final failure the partial is removed before throwing.
async function downloadFile(
  url: string,
  destPath: string,
  onProgress: ProgressCallback | null | undefined,
  allowedHosts: readonly string[] | null | undefined
): Promise<string> {
  // Never resume leftovers from an unrelated earlier download.
  try { fs.rmSync(destPath, { force: true }) } catch { /* best-effort */ }

  let lastErr: unknown = null
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    let resumeFrom = 0
    try { resumeFrom = fs.statSync(destPath).size } catch { resumeFrom = 0 }
    try {
      return await downloadFileOnce(url, destPath, onProgress, allowedHosts, resumeFrom)
    } catch (err) {
      lastErr = err
      if (!(err as RetriableError | null)?.downloadRetriable || attempt === DOWNLOAD_MAX_ATTEMPTS) break
      await new Promise(r => { setTimeout(r, DOWNLOAD_RETRY_BASE_DELAY_MS * attempt) })
    }
  }
  try { fs.rmSync(destPath, { force: true }) } catch { /* best-effort */ }
  throw lastErr
}

function extractRar(rarPath: string, destDir: string | null, analyzeOnly: true): Promise<ArchiveAnalysis>
function extractRar(rarPath: string, destDir: string, analyzeOnly?: boolean): Promise<ArchiveAnalysis>
async function extractRar(rarPath: string, destDir: string | null, analyzeOnly = false): Promise<ArchiveAnalysis> {
  const extractor = await createExtractorFromFile({ filepath: rarPath })

  const list = extractor.getFileList()
  const fileHeaders = [...list.fileHeaders]
  // Normalize `\`→`/` for validation/analysis the same way extractZip does, but
  // keep the mapping so extract() below still gets the ORIGINAL header names.
  // RAR flags directories in the header instead of a trailing '/' the way zip
  // names do — mark them, since downstream consumers (preview's totalFiles
  // filter) rely on the trailing-slash convention.
  const { entryNames: normalizedNames, originalByNormalized } = buildEntryNameMap(fileHeaders.map(h => h.name))
  const entryNames = normalizedNames.map((n, i) =>
    fileHeaders[i].flags.directory && !n.endsWith('/') ? `${n}/` : n)

  const analysis = analyzeArchiveStructure(entryNames)

  if (analyzeOnly) return { ...analysis, entryNames }

  // Past the analyzeOnly return a destination is always given (see the overloads).
  destDir = destDir as string

  // validateEntries MUST run before any write — it is the sole zip-slip guard.
  // validateArchiveLimits rejects decompression bombs before the first byte
  // hits disk (node-unrar-js exposes uncompressed size as `.unpSize`).
  validateEntries(entryNames, destDir)
  validateArchiveLimits(fileHeaders.map(h => h.unpSize))
  fs.mkdirSync(destDir, { recursive: true })

  // 重新建立 extractor 來解壓（getFileList 後需重建）
  const extractor2 = await createExtractorFromFile({ filepath: rarPath, targetPath: destDir })

  if (analysis.type === 'pak-only') {
    // analysis.pakFiles are normalized names; node-unrar-js selects entries by
    // the raw header name, so map them back before requesting extraction.
    const rawPakFiles = analysis.pakFiles.map(p => originalByNormalized.get(p) ?? p)
    const extracted = extractor2.extract({ files: rawPakFiles })
    const files = [...extracted.files]
    // node-unrar-js extract 到 targetPath，但保留子目錄結構
    // 將深層 .pak 移到 destDir 根目錄
    for (const f of files) {
      if (f.fileHeader.flags.directory) continue
      const normalized = f.fileHeader.name.replace(/\\/g, '/')
      // The library may have written either the normalized tree or a literal
      // backslash-named file, depending on the archive — probe both.
      const treePath = path.join(destDir, ...normalized.split('/'))
      const literalPath = path.join(destDir, f.fileHeader.name)
      const extractedPath = fs.existsSync(treePath) ? treePath : literalPath
      const rootPath = path.join(destDir, path.basename(normalized))
      // Only deep paks need moving to the root; a pak already at the root is
      // left in place (rootPath === extractedPath).
      if (extractedPath !== rootPath && fs.existsSync(extractedPath)) {
        // Disambiguate same-basename paks from different subfolders instead of
        // letting the second rename silently overwrite the first.
        const targetPath = resolveCollisionFreePath(rootPath)
        fs.renameSync(extractedPath, targetPath)
      }
    }
  } else {
    const extracted = extractor2.extract()
    // 必須迭代 generator 才會實際解壓檔案
    Array.from(extracted.files)
  }

  return analysis
}

// node-7z spawns the bundled 7za binary and reports entries/progress as
// stream events; resolve when the child exits cleanly.
function sevenStreamDone(stream: SevenStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.on('end', resolve)
    stream.on('error', reject)
  })
}

function extract7z(archivePath: string, destDir: string | null, analyzeOnly: true): Promise<ArchiveAnalysis>
function extract7z(archivePath: string, destDir: string, analyzeOnly?: boolean): Promise<ArchiveAnalysis>
async function extract7z(archivePath: string, destDir: string | null, analyzeOnly = false): Promise<ArchiveAnalysis> {
  const rawEntries: SevenEntry[] = []
  const listStream = Seven.list(archivePath, { $bin: SEVEN_BIN })
  listStream.on('data', (entry) => rawEntries.push(entry))
  await sevenStreamDone(listStream)

  // 7z lists directories as plain entries (attribute 'D', no trailing slash);
  // normalize to the zip convention — forward slashes, dirs end with '/' — so
  // analyzeArchiveStructure and callers treat all three formats identically.
  const entryNames = rawEntries.map((e) => {
    const name = String(e.file || '').replace(/\\/g, '/')
    const isDir = typeof e.attributes === 'string' && e.attributes.includes('D')
    return isDir && !name.endsWith('/') ? `${name}/` : name
  })
  const analysis = analyzeArchiveStructure(entryNames)

  if (analyzeOnly) return { ...analysis, entryNames }

  // Past the analyzeOnly return a destination is always given (see the overloads).
  destDir = destDir as string

  // validateEntries MUST run before any write — same zip-slip guard as the
  // zip/rar paths. validateArchiveLimits rejects decompression bombs first
  // (7z list exposes per-entry uncompressed size as `.size`).
  validateEntries(entryNames, destDir)
  validateArchiveLimits(rawEntries.map((e) => e.size))
  fs.mkdirSync(destDir, { recursive: true })

  if (analysis.type === 'pak-only') {
    // destDir is the live Paks folder — readmes/screenshots inside the archive
    // must not land there. extractZip/extractRar cherry-pick via their libs;
    // 7za's include-mask semantics are fiddly enough that extracting to a temp
    // subdir and moving only the pak-family files over is the safer equivalent.
    const tempDir = path.join(destDir, '_hzmm_7z_temp')
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
      await sevenStreamDone(Seven.extractFull(archivePath, tempDir, { $bin: SEVEN_BIN }))
      assertNoSymlinks(tempDir)
      const moveDeepPaks = (dir: string): void => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry)
          if (fs.lstatSync(full).isDirectory()) {
            moveDeepPaks(full)
          } else if (/\.(pak|ucas|utoc)$/i.test(entry)) {
            fs.renameSync(full, resolveCollisionFreePath(path.join(destDir, entry)))
          }
        }
      }
      moveDeepPaks(tempDir)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } else {
    // Extract to a temp subdir (inside destDir, so renames stay on one volume),
    // reject symlinks, and only then merge the tree into the live destination.
    // Extracting straight into destDir would mean a malicious link is already
    // in the game folder by the time the walk finds it — and the partial
    // extraction would be left behind by the throw. Unique suffix so an archive
    // can't plausibly contain an entry with the same name.
    const tempDir = path.join(destDir, `_hzmm_7z_extract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    try {
      await sevenStreamDone(Seven.extractFull(archivePath, tempDir, { $bin: SEVEN_BIN }))
      assertNoSymlinks(tempDir)
      // Merge-move preserving structure. renameSync replaces existing files,
      // matching 7za's previous overwrite-on-extract (-y) behavior into destDir.
      const mergeMove = (srcDir: string, targetDir: string): void => {
        fs.mkdirSync(targetDir, { recursive: true })
        for (const entry of fs.readdirSync(srcDir)) {
          const from = path.join(srcDir, entry)
          const to = path.join(targetDir, entry)
          if (fs.lstatSync(from).isDirectory()) {
            mergeMove(from, to)
          } else {
            fs.renameSync(from, to)
          }
        }
      }
      mergeMove(tempDir, destDir)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  return analysis
}

async function extractZipRaw(zipPath: string, destDir: string): Promise<boolean> {
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryList = Object.values(entries)
    const { entryNames } = buildEntryNameMap(entryList.map(e => e.name))
    // validateEntries MUST run before any write — it is the sole zip-slip guard.
    validateEntries(entryNames, destDir)
    validateArchiveLimits(entryList.map(e => e.size))
    fs.mkdirSync(destDir, { recursive: true })
    await extractAllZipEntries(zip, entryList, destDir)
    return true
  } finally {
    await zip.close()
  }
}

export {
  extractZip,
  extractZipRaw,
  extractRar,
  extract7z,
  detectArchiveFormat,
  copyFile,
  downloadFile,
  isHostAllowed,
  analyzeArchiveStructure,
  buildEntryNameMap,
  isSafePath,
  validateEntries,
  validateArchiveLimits,
  resolveCollisionFreePath,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
  MAX_ENTRY_COUNT,
}
