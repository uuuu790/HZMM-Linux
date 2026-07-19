import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { downloadFile } from '../services/archive.js'
import logger from '../services/logger.js'
import { installMods } from './mods-install.js'

// Allowed hosts for mod downloads. Exact-match only — no wildcard subdomains.
const ALLOWED_MOD_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'cf-files.nexusmods.com',
  'amsterdam.nexusmods.com',
  'chicago.nexusmods.com',
  'la.nexusmods.com',
  'london.nexusmods.com',
  'miami.nexusmods.com',
  'paris.nexusmods.com',
  'prague.nexusmods.com',
  'singapore.nexusmods.com',
])

const ALLOWED_MOD_HOST_SET = new Set(ALLOWED_MOD_HOSTS)

function isAllowedModUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr) return false
  let parsed
  try {
    parsed = new URL(urlStr)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return ALLOWED_MOD_HOST_SET.has(parsed.hostname)
}

function parseNexusUrl(url) {
  // Matches: https://www.nexusmods.com/{game}/mods/{modId}?tab=files&file_id={fileId}
  // or: https://www.nexusmods.com/{game}/mods/{modId}
  // Uses URL parsing + hostname whitelist first so a crafted string like
  // `https://evil.com/?x=nexusmods.com/foo/mods/1` can't trip the Nexus
  // flow and prompt for an API key.
  let urlObj
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

async function nexusApiRequest(endpoint, apiKey) {
  const https = await import('https')
  return new Promise((resolve, reject) => {
    const req = https.default.get(`https://api.nexusmods.com/v1${endpoint}`, {
      headers: { 'apikey': apiKey, 'User-Agent': `HZMM/${app.getVersion()}` }
    }, (res) => {
      // Collect raw buffers and decode ONCE at the end — per-chunk toString
      // corrupts multi-byte UTF-8 sequences that straddle chunk boundaries
      // (CJK account/file names turned into U+FFFD).
      const chunks = []
      res.on('data', chunk => { chunks.push(chunk) })
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8')
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid API response')) }
        } else if (res.statusCode === 401) {
          reject(new Error('Invalid Nexus Mods API key'))
        } else if (res.statusCode === 403) {
          reject(new Error('Nexus Mods API: Premium account required for API downloads'))
        } else {
          reject(new Error(`Nexus API error: HTTP ${res.statusCode}`))
        }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    // Without this the V1 endpoint can hang the install flow forever when
    // the API stalls after TCP handshake.
    req.setTimeout(NEXUS_V1_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('Nexus V1 API request timed out'))
    })
  })
}

// Returns { url, name, fileName, fileId, version }. fileId is the file that
// will actually be downloaded (the caller's pin, or the resolved latest when
// no pin was given); version is known only when the latest file was resolved
// via files.json, else null. Callers recording install receipts must use THESE
// values, not their original request — recording a delisted pin makes the
// update checker blind to that mod forever.
async function resolveNexusDownloadUrl(nexusInfo, apiKey) {
  let fileId = nexusInfo.fileId
  let version = null
  // `fileName` is the file's real uploaded name (with extension) from the V1
  // files API. The CDN URL alone is no longer enough to name the download:
  // Nexus's newer CDN serves GUID paths with no extension at all.
  let fileName = null
  // If no file_id, get the latest main file
  if (!fileId) {
    const filesData = await nexusApiRequest(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files.json`, apiKey)
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
      const fileData = await nexusApiRequest(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files/${fileId}.json`, apiKey)
      fileName = fileData?.file_name || null
    } catch (err) {
      logger.warn(`Nexus: file metadata fetch failed for ${nexusInfo.modId}:${fileId}: ${err.message}`)
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
  const links = await nexusApiRequest(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files/${fileId}/download_link.json${dlQuery}`, apiKey)
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
function resolveDownloadFilename(urlStr, apiFileName, fallbackBase) {
  let fromUrl = ''
  try { fromUrl = path.basename(new URL(urlStr).pathname) } catch { /* fall through */ }
  if (fromUrl.match(ARCHIVE_EXT_RE)) return fromUrl
  // Normalize backslashes before basename so sanitization is identical on
  // win32 and POSIX (the Linux fork shares this file).
  const sanitize = (name) => path.basename(String(name || '').replace(/\\/g, '/')).replace(/[^\w.-]/g, '_')
  const fromApi = sanitize(apiFileName)
  if (fromApi.match(ARCHIVE_EXT_RE)) return fromApi
  const safe = sanitize(fallbackBase)
  return `${safe || 'mod_download'}.zip`
}

// Shared tail of nexus:install-file / nexus:update-file / the nxm:// handler:
// take an already-RESOLVED CDN link, re-check it against the host allowlist,
// download into a unique temp subdir, and install. Receipt recording stays in
// the callers (they know modId/fileId/version semantics).
async function downloadAndInstallResolvedFile(resolved, { modId, fileId }, mainWindow) {
  // Defense-in-depth: the resolved CDN URL comes from the Nexus API, but
  // validate it against the host allowlist so a poisoned/redirected link
  // can't make us fetch from an arbitrary host.
  if (!isAllowedModUrl(resolved.url)) {
    throw new Error('Resolved download URL is not from an allowed Nexus CDN host')
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
    await downloadFile(resolved.url, tempPath, (progress) => {
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

async function downloadAndInstallFromUrl(url, mainWindow) {
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) throw new Error('Invalid URL')

  // Check if it's a Nexus Mods URL
  const nexusInfo = parseNexusUrl(url)
  if (nexusInfo) {
    const apiKey = configStore.get('nexusApiKey')
    if (!apiKey) throw new Error('NEXUS_API_KEY_REQUIRED')
    logger.info(`Nexus download: game=${nexusInfo.game}, mod=${nexusInfo.modId}, file=${nexusInfo.fileId || 'latest'}`)
    const resolved = await resolveNexusDownloadUrl(nexusInfo, apiKey)
    url = resolved.url
    // Log only the host — the resolved CDN URL carries a short-lived signed
    // auth token in its query string that must NOT be persisted to the log
    // file (which is readable from the renderer via logger:read-recent).
    logger.info(`Nexus resolved download from host: ${new URL(url).hostname}`)
  }

  // Validate URL against allowed hosts
  if (!isAllowedModUrl(url)) {
    throw new Error('Download URL is not from an allowed source. Supported: Nexus Mods, GitHub.')
  }

  const urlObj = new URL(url)
  let filename = path.basename(urlObj.pathname)
  if (!filename || !filename.match(/\.(zip|rar|pak)$/i)) filename = 'mod_download.zip'
  // Unique temp subdir per download so concurrent installs never share a path,
  // while preserving the real filename (.pak _P suffix affects load order).
  const tempDir = path.join(configStore.getConfigDir(), 'temp', `dl_${Date.now()}`)
  const tempPath = path.join(tempDir, filename)
  fs.mkdirSync(tempDir, { recursive: true })
  try {
    // Pass the allowlist so EVERY redirect hop is re-validated, not just the
    // initial URL — otherwise a 3xx to an arbitrary host would be followed.
    await downloadFile(url, tempPath, (progress) => {
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
function cleanupStaleDownloadTemp() {
  try {
    const tempRoot = path.join(configStore.getConfigDir(), 'temp')
    if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true })
  } catch (err) {
    logger.warn(`Failed to sweep stale download temp: ${err.message}`)
  }
}

export { ALLOWED_MOD_HOSTS, isAllowedModUrl, parseNexusUrl, downloadAndInstallFromUrl, downloadAndInstallResolvedFile, nexusApiRequest, resolveNexusDownloadUrl, resolveDownloadFilename, cleanupStaleDownloadTemp }
