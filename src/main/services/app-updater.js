import https from 'https'
import crypto from 'crypto'
import { app } from 'electron'
import { downloadFile } from './archive.js'
import configStore from './config-store.js'
import path from 'path'
import fs from 'fs'
import logger from './logger.js'

// Linux fork checks its own repo — releases (AppImage/deb) are published on
// HZMM-Linux, on the fork's own cadence, not on the Windows repo.
const REPO = 'uuuu790/HZMM-Linux'
const REQUEST_TIMEOUT_MS = 10000
const ALLOWED_DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com']
const ALLOWED_API_HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'codeload.github.com']

function githubHeaders() {
  return {
    'User-Agent': `HZMM/${app.getVersion()}`,
    'Accept': 'application/vnd.github.v3+json'
  }
}

function githubGet(endpoint, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'))
      return
    }

    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      headers: githubHeaders()
    }

    // Redirect handling lives entirely in handleResponse (single source of
    // truth, host-allowlisted) — the initial response just delegates to it.
    const req = https.get(options, (res) => {
      handleResponse(res, resolve, reject, maxRedirects)
    })

    req.on('error', reject)

    // Bug 7 fix: abort request after 10 seconds if GitHub API hangs
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('GitHub API request timed out'))
    })
  })
}

function handleResponse(res, resolve, reject, maxRedirects) {
  // Handle redirects (3xx) — one implementation for both the initial request
  // and every nested hop.
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'))
      return
    }
    const redirectUrl = new URL(res.headers.location)
    if (!ALLOWED_API_HOSTS.includes(redirectUrl.hostname)) {
      res.resume()
      reject(new Error(`Redirect to disallowed host: ${redirectUrl.hostname}`))
      return
    }
    const redirectOptions = {
      hostname: redirectUrl.hostname,
      path: redirectUrl.pathname + redirectUrl.search,
      headers: githubHeaders()
    }
    res.resume()
    const req = https.get(redirectOptions, (redirectRes) => {
      handleResponse(redirectRes, resolve, reject, maxRedirects - 1)
    })
    req.on('error', reject)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('GitHub API request timed out'))
    })
    return
  }

  let data = ''
  res.on('data', chunk => { data += chunk })
  res.on('end', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      reject(new Error(`GitHub API error: HTTP ${res.statusCode}`))
      return
    }
    try {
      resolve(JSON.parse(data))
    } catch {
      reject(new Error('Failed to parse GitHub response'))
    }
  })
}

// Bug 15 fix: strip pre-release suffix before comparing
function compareVersions(current, latest) {
  const a = current.replace(/^v/, '').split('-')[0].split('.').map(Number)
  const b = latest.replace(/^v/, '').split('-')[0].split('.').map(Number)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0
    const bv = b[i] || 0
    if (bv > av) return true
    if (bv < av) return false
  }
  return false
}

function isAllowedDownloadUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return ALLOWED_DOWNLOAD_HOSTS.some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))
  } catch {
    return false
  }
}

function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// True when this process runs from a mounted AppImage — the only Linux
// packaging we can self-update (deb needs root/dpkg, so it stays manual).
function isAppImageInstall() {
  return typeof process.env.APPIMAGE === 'string' && process.env.APPIMAGE.length > 0
}

// Pure release-JSON → update-info mapping, split out so it can be unit-tested
// without network or Electron. Integrity hash comes from the asset's GitHub-
// computed `digest` field ("sha256:<hex>") first, with the release body's
// `SHA256: <hex>` line as a fallback for older/hand-written releases.
function parseReleaseInfo(release, currentVersion) {
  const latestVersion = release.tag_name
  const hasUpdate = compareVersions(currentVersion, latestVersion)

  const asset = release.assets?.find(a => a.name.toLowerCase().endsWith('.appimage'))

  let expectedHash = null
  if (typeof asset?.digest === 'string') {
    const digestMatch = asset.digest.match(/^sha256:([a-fA-F0-9]{64})$/)
    if (digestMatch) expectedHash = digestMatch[1].toLowerCase()
  }
  if (!expectedHash && release.body) {
    const hashMatch = release.body.match(/SHA256:\s*([a-fA-F0-9]{64})/)
    if (hashMatch) expectedHash = hashMatch[1].toLowerCase()
  }

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    downloadUrl: asset?.browser_download_url || null,
    expectedHash,
    changelog: release.body || ''
  }
}

async function checkForUpdate() {
  const currentVersion = app.getVersion()
  logger.info(`Checking for updates... current version: ${currentVersion}`)

  const release = await githubGet(`/repos/${REPO}/releases/latest`)
  if (!release || !release.tag_name) {
    throw new Error('No release found')
  }

  const result = parseReleaseInfo(release, currentVersion)
  // Tells the renderer whether "install" means in-place update (AppImage) or
  // a manual download (deb / dev run), so it can label the button accordingly.
  result.autoInstall = isAppImageInstall()

  if (result.hasUpdate) {
    logger.info(`Update available: ${result.latestVersion}`)
  } else {
    logger.info(`Already up to date: ${currentVersion}`)
  }

  return result
}

async function downloadUpdate(url, expectedHash, onProgress) {
  if (!isAllowedDownloadUrl(url)) {
    throw new Error('Update URL is not from an allowed source')
  }

  const destPath = path.join(configStore.getConfigDir(), 'hzmm-update.AppImage')

  if (fs.existsSync(destPath)) fs.unlinkSync(destPath)

  logger.info(`Downloading update from: ${url}`)
  await downloadFile(url, destPath, onProgress, ALLOWED_DOWNLOAD_HOSTS)

  // SHA256 is mandatory — silently skipping it (the previous fallback) meant
  // a release without any hash bypassed integrity entirely. The hash comes
  // from the GitHub asset digest (or a `SHA256: <64hex>` release-notes line).
  if (!expectedHash) {
    try { fs.unlinkSync(destPath) } catch { /* best-effort */ }
    throw new Error('Update integrity check failed: no SHA256 available for the release asset')
  }
  const actualHash = await computeFileHash(destPath)
  if (actualHash !== expectedHash.toLowerCase()) {
    fs.unlinkSync(destPath)
    throw new Error(`Update integrity check failed (expected ${expectedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...)`)
  }
  logger.info(`Update integrity verified: SHA256 ${actualHash.slice(0, 16)}...`)

  logger.info(`Update downloaded to: ${destPath}`)
  return destPath
}

// Pure file-swap half of the AppImage update, split from the Electron
// relaunch so it can be unit-tested with mock-fs. Stages the replacement
// NEXT TO the target (same filesystem) so the final rename is atomic — the
// running app keeps its mounted inode, so replacing the file is safe.
function replaceAppImageFile(stagedPath, targetPath) {
  if (!stagedPath || !fs.existsSync(stagedPath)) {
    throw new Error('No staged update file — download the update first')
  }
  const tmpPath = targetPath + '.hzmm-new'
  try {
    fs.copyFileSync(stagedPath, tmpPath)
    fs.chmodSync(tmpPath, 0o755)
    fs.renameSync(tmpPath, targetPath)
  } catch (err) {
    try { fs.unlinkSync(tmpPath) } catch { /* best-effort */ }
    throw new Error(`Failed to replace AppImage: ${err.message}`)
  }
  try { fs.unlinkSync(stagedPath) } catch { /* best-effort */ }
}

function installAppImageUpdate(stagedPath) {
  const targetPath = process.env.APPIMAGE
  if (!isAppImageInstall()) {
    throw new Error('Not running from an AppImage — install the update manually')
  }
  replaceAppImageFile(stagedPath, targetPath)
  logger.info(`AppImage updated in place: ${targetPath}`)
  // Relaunch through the (now-updated) AppImage path, not process.execPath —
  // execPath points inside the transient mount of the OLD version.
  app.relaunch({ execPath: targetPath, args: [] })
  app.quit()
}

export {
  checkForUpdate,
  downloadUpdate,
  compareVersions,
  parseReleaseInfo,
  isAppImageInstall,
  replaceAppImageFile,
  installAppImageUpdate
}
