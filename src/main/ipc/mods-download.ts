import { app, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import { downloadFile } from '../services/archive'
import { netRequest } from '../services/net-client'
import logger from '../services/logger'
import { installMods } from './mods-install'
import type { InstalledArchive } from './types'

type MainWindow = BrowserWindow | null | undefined

/** A parsed nexusmods.com mod page URL. */
export interface NexusUrlInfo {
  game: string
  modId: number
  fileId: number | null
}

/** What resolveNexusDownloadUrl needs: a mod page, plus an nxm:// key/expires pair when there is one. */
export interface NexusDownloadTarget {
  game: string
  modId: number
  fileId?: number | null
  key?: string | null
  expires?: string | number | null
}

/** A resolved CDN link and the names it may be saved under. */
export interface ResolvedDownload {
  url: string
  name?: string
  fileName?: string | null
}

/** The V1 files.json fields used to pick the latest main file. */
interface NexusV1File {
  file_id: number
  category_id: number
  uploaded_timestamp?: number
  file_name?: string
  version?: string
}

// Allowed hosts for mod downloads. Exact-match only — no wildcard subdomains.
// downloadFile enforces the same exact-match rule on every redirect hop, so
// every legitimate redirect TARGET must be listed here too: github.com asset
// links 302 to objects./release-assets.githubusercontent.com, and source
// archive links (/archive/refs/...) 302 to codeload.github.com.
const ALLOWED_MOD_HOSTS = Object.freeze([
  'github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'cf-files.nexusmods.com',
  'amsterdam.nexusmods.com',
  'chicago.nexusmods.com',
  'la.nexusmods.com',
  'london.nexusmods.com',
  'miami.nexusmods.com',
  'paris.nexusmods.com',
  'prague.nexusmods.com',
  'singapore.nexusmods.com',
  // nexus-cdn.com is Nexus's CDN domain — download_link resolves here for
  // free/supporter accounts (nxm:// key+expires flow) and the newer Premium
  // CDN location, not just the *.nexusmods.com region mirrors above.
  'files.nexus-cdn.com',
  'supporter-files.nexus-cdn.com',
  'premium-files.nexus-cdn.com',
])

const ALLOWED_MOD_HOST_SET = new Set(ALLOWED_MOD_HOSTS)

function isAllowedModUrl(urlStr: unknown): boolean {
  if (typeof urlStr !== 'string' || !urlStr) return false
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return ALLOWED_MOD_HOST_SET.has(parsed.hostname)
}

function parseNexusUrl(url: string): NexusUrlInfo | null {
  // Matches: https://www.nexusmods.com/{game}/mods/{modId}?tab=files&file_id={fileId}
  // or: https://www.nexusmods.com/{game}/mods/{modId}
  // Uses URL parsing + hostname whitelist first so a crafted string like
  // `https://evil.com/?x=nexusmods.com/foo/mods/1` can't trip the Nexus
  // flow and prompt for an API key.
  let urlObj: URL
  try { urlObj = new URL(url) } catch { return null }
  if (urlObj.protocol !== 'https:') return null
  const host = urlObj.hostname.toLowerCase()
  if (host !== 'nexusmods.com' && host !== 'www.nexusmods.com') return null
  const match = urlObj.pathname.match(/^\/([^/]+)\/mods\/(\d+)/)
  if (!match) return null
  const game = match[1]
  const modId = parseInt(match[2])
  const fileId = urlObj.searchParams.get('file_id')
  return { game, modId, fileId: fileId ? parseInt(fileId) : null }
}

const NEXUS_V1_TIMEOUT_MS = 10000

// netRequest rides Electron's net module (Chromium stack) so it follows the
// OS proxy settings — same reason downloadFile does. The hard deadline keeps
// the old "hung API can't stall the install flow forever" guarantee.
// `T` is the endpoint's JSON shape; the response is trusted to match it.
async function nexusApiRequest<T = unknown>(endpoint: string, apiKey: string): Promise<T> {
  const res = await netRequest(`https://api.nexusmods.com/v1${endpoint}`, {
    headers: { 'apikey': apiKey, 'User-Agent': `HZMM/${app.getVersion()}` },
    timeoutMs: NEXUS_V1_TIMEOUT_MS,
    timeoutMessage: 'Nexus V1 API request timed out',
  })
  if (res.statusCode === 200) {
    try { return JSON.parse(res.bodyText) } catch { throw new Error('Invalid API response') }
  }
  if (res.statusCode === 401) throw new Error('Invalid Nexus Mods API key')
  if (res.statusCode === 403) throw new Error('Nexus Mods API: Premium account required for API downloads')
  throw new Error(`Nexus API error: HTTP ${res.statusCode}`)
}

// fileId is the file that will actually be downloaded (the caller's pin, or the
// resolved latest when no pin was given); version is known only when the
// latest file was resolved via files.json, else null. Callers recording install
// receipts must use THESE values, not their original request — recording a
// delisted pin makes the update checker blind to that mod forever.
async function resolveNexusDownloadUrl(nexusInfo: NexusDownloadTarget, apiKey: string): Promise<{ url: string; name: string; fileName: string | null; fileId: number | null; version: string | null }> {
  let fileId = nexusInfo.fileId
  let version = null
  // `fileName` is the file's real uploaded name (with extension) from the V1
  // files API. The CDN URL alone is no longer enough to name the download:
  // Nexus's newer CDN serves GUID paths with no extension at all.
  let fileName: string | null = null
  // If no file_id, get the latest main file
  if (!fileId) {
    const filesData = await nexusApiRequest<{ files?: NexusV1File[] }>(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files.json`, apiKey)
    const mainFiles = (filesData.files || []).filter(f => f.category_id === 1) // 1 = Main files
    const allFiles = mainFiles.length > 0 ? mainFiles : (filesData.files || [])
    if (allFiles.length === 0) throw new Error('No files found for this mod')
    // Pick the latest file (V1 uploaded_timestamp is a unix timestamp)
    allFiles.sort((a, b) => (b.uploaded_timestamp || 0) - (a.uploaded_timestamp || 0))
    fileId = allFiles[0].file_id
    version = allFiles[0].version || null
    fileName = allFiles[0].file_name || null
    logger.info(`Nexus: resolved latest file_id=${fileId} for mod ${nexusInfo.modId}`)
  } else {
    // Best-effort only: a metadata failure must not block the install —
    // magic-byte detection in the installer copes with a wrong extension.
    try {
      const fileData = await nexusApiRequest<{ file_name?: string } | null>(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files/${fileId}.json`, apiKey)
      fileName = fileData?.file_name || null
    } catch (err) {
      logger.warn(`Nexus: file metadata fetch failed for ${nexusInfo.modId}:${fileId}: ${(err as Error).message}`)
    }
  }
  // Get download links. `key`/`expires` come from an nxm:// link generated by
  // the website's "Mod Manager Download" button — WITH them this endpoint
  // works for free accounts too; without them it is Premium-only. Both are
  // format-validated by parseNxmUrl before they get here; encode regardless.
  let dlQuery = ''
  if (nexusInfo.key && nexusInfo.expires) {
    dlQuery = `?key=${encodeURIComponent(nexusInfo.key)}&expires=${encodeURIComponent(nexusInfo.expires)}`
  }
  const links = await nexusApiRequest<Array<{ URI: string; name?: string }> | null>(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files/${fileId}/download_link.json${dlQuery}`, apiKey)
  if (!links || links.length === 0) throw new Error('No download links returned from Nexus API')
  return { url: links[0].URI, name: links[0].name || `nexus_mod_${nexusInfo.modId}_${fileId}`, fileName, fileId, version }
}

const ARCHIVE_EXT_RE = /\.(zip|rar|7z|pak)$/i

// Decide the local temp filename for a downloaded mod. Preserving the real
// name matters (.pak `_P` suffix affects load order); the extension only has
// to be plausible — the installer picks the extractor from magic bytes.
// Priority: CDN URL basename (when it carries a recognizable extension, i.e.
// classic CDN paths) -> real uploaded name from the Nexus files API (GUID CDN
// paths) -> `<fallbackBase>.zip`. API/fallback names are sanitized to
// `[A-Za-z0-9._-]` so a surprise upstream name can't escape the temp dir.
function resolveDownloadFilename(urlStr: string, apiFileName: unknown, fallbackBase: unknown): string {
  let fromUrl = ''
  try { fromUrl = path.basename(new URL(urlStr).pathname) } catch { /* fall through */ }
  if (fromUrl.match(ARCHIVE_EXT_RE)) return fromUrl
  // Normalize backslashes before basename so sanitization is identical on
  // win32 and POSIX (the Linux fork shares this file).
  const sanitize = (name: unknown) => path.basename(String(name || '').replace(/\\/g, '/')).replace(/[^\w.-]/g, '_')
  const fromApi = sanitize(apiFileName)
  if (fromApi.match(ARCHIVE_EXT_RE)) return fromApi
  const safe = sanitize(fallbackBase)
  return `${safe || 'mod_download'}.zip`
}

// Shared tail of nexus:install-file / nexus:update-file / the nxm:// handler:
// take an already-RESOLVED CDN link, re-check it against the host allowlist,
// download into a unique temp subdir, and install. Receipt recording stays in
// the callers (they know modId/fileId/version semantics).
async function downloadAndInstallResolvedFile(
  resolved: ResolvedDownload,
  { modId, fileId }: { modId: number | string; fileId: number | string | null },
  mainWindow: MainWindow,
): Promise<InstalledArchive[]> {
  // Defense-in-depth: the resolved CDN URL comes from the Nexus API, but
  // validate it against the host allowlist so a poisoned/redirected link
  // can't make us fetch from an arbitrary host.
  if (!isAllowedModUrl(resolved.url)) {
    // Report only the hostname — the full URL carries a short-lived signed
    // auth token in its query string that must not leak to the renderer/log.
    let host = ''
    try { host = new URL(resolved.url).hostname } catch { /* unparseable — omit */ }
    throw new Error(`Resolved download URL is not from an allowed Nexus CDN host${host ? ` ("${host}")` : ''}`)
  }
  // URL basename -> real uploaded file_name (GUID CDN paths carry no
  // extension) -> sanitized fallback; see resolveDownloadFilename.
  const filename = resolveDownloadFilename(resolved.url, resolved.fileName, resolved.name || `nexus_mod_${modId}_${fileId}`)
  // Unique temp SUBDIR per download so concurrent installs never share a
  // path (and cleanup only removes its own dir), while preserving the real
  // filename — important for .pak mods whose _P suffix affects load order.
  const tempDir = path.join(configStore.getConfigDir(), 'temp', `dl_${modId}_${fileId}_${Date.now()}`)
  const tempPath = path.join(tempDir, filename)
  fs.mkdirSync(tempDir, { recursive: true })
  try {
    await downloadFile(resolved.url, tempPath, (progress: number) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:download-progress', progress)
    }, ALLOWED_MOD_HOSTS)
    const result = await installMods([tempPath], mainWindow)
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* temp already gone */ }
    return result
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* temp already gone */ }
    throw err
  }
}

// `url` comes from the renderer's install-from-URL box.
async function downloadAndInstallFromUrl(url: string, mainWindow: MainWindow): Promise<InstalledArchive[]> {
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) throw new Error('Invalid URL')

  // Check if it's a Nexus Mods URL
  const nexusInfo = parseNexusUrl(url)
  let nexusFileName: string | null = null
  if (nexusInfo) {
    const apiKey = configStore.get('nexusApiKey')
    if (!apiKey) throw new Error('NEXUS_API_KEY_REQUIRED')
    logger.info(`Nexus download: game=${nexusInfo.game}, mod=${nexusInfo.modId}, file=${nexusInfo.fileId || 'latest'}`)
    const resolved = await resolveNexusDownloadUrl(nexusInfo, apiKey)
    url = resolved.url
    nexusFileName = resolved.fileName
    // Log only the host — the resolved CDN URL carries a short-lived signed
    // auth token in its query string that must NOT be persisted to the log
    // file (which is readable from the renderer via logger:read-recent).
    logger.info(`Nexus resolved download from host: ${new URL(url).hostname}`)
  }

  // Validate URL against allowed hosts
  if (!isAllowedModUrl(url)) {
    throw new Error('Download URL is not from an allowed source. Supported: Nexus Mods, GitHub.')
  }

  const filename = resolveDownloadFilename(url, nexusFileName, 'mod_download')
  // Unique temp subdir per download so concurrent installs never share a path,
  // while preserving the real filename (.pak _P suffix affects load order).
  const tempDir = path.join(configStore.getConfigDir(), 'temp', `dl_${Date.now()}`)
  const tempPath = path.join(tempDir, filename)
  fs.mkdirSync(tempDir, { recursive: true })
  try {
    // Pass the allowlist so EVERY redirect hop is re-validated, not just the
    // initial URL — otherwise a 3xx to an arbitrary host would be followed.
    await downloadFile(url, tempPath, (progress: number) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:download-progress', progress)
    }, ALLOWED_MOD_HOSTS)
    const result = await installMods([tempPath], mainWindow)
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* temp already gone */ }
    return result
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch { /* temp already gone */ }
    throw err
  }
}

// Remove orphaned download temp dirs left by a crash/power-loss mid-download.
// The per-call try/finally only cleans the in-process happy/throw paths; a hard
// kill leaves `temp/dl_*` (often a large partial download) behind forever.
// Swept once on app startup — at that point no download can be in flight.
function cleanupStaleDownloadTemp(): void {
  try {
    const tempRoot = path.join(configStore.getConfigDir(), 'temp')
    if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true })
  } catch (err) {
    logger.warn(`Failed to sweep stale download temp: ${(err as Error).message}`)
  }
}

export { ALLOWED_MOD_HOSTS, isAllowedModUrl, parseNexusUrl, downloadAndInstallFromUrl, downloadAndInstallResolvedFile, nexusApiRequest, resolveNexusDownloadUrl, resolveDownloadFilename, cleanupStaleDownloadTemp }
