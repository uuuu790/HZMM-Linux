import crypto from 'crypto'
import { app } from 'electron'
import { downloadFile, type ProgressCallback } from './archive'
import { netRequest } from './net-client'
import configStore from './config-store'
import path from 'path'
import fs from 'fs'
import logger from './logger'
import type { GithubRelease } from './github-release'
import type { UpdateCheckInfo } from '../ipc/types'

// Linux fork checks its own repo — releases (AppImage/deb) are published on
// HZMM-Linux, on the fork's own cadence, not on the Windows repo.
const REPO = 'uuuu790/HZMM-Linux'
const REQUEST_TIMEOUT_MS = 10000
// downloadFile matches these exactly on every redirect hop — GitHub rotates
// release-asset redirects between objects. and release-assets., so both must
// be listed or self-update breaks when GitHub serves the rotated host.
const ALLOWED_DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
const ALLOWED_API_HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'codeload.github.com']

function githubHeaders(): Record<string, string> {
  return {
    'User-Agent': `HZMM/${app.getVersion()}`,
    'Accept': 'application/vnd.github.v3+json'
  }
}

// netRequest rides Electron's net module (Chromium stack) so it follows the
// OS proxy settings — same reason downloadFile does. Redirect hops stay
// pinned to ALLOWED_API_HOSTS, matching the old hand-rolled handler.
async function githubGet<T>(endpoint: string, maxRedirects = 5): Promise<T> {
  const res = await netRequest(`https://api.github.com${endpoint}`, {
    headers: githubHeaders(),
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: 'GitHub API request timed out',
    allowedRedirectHosts: ALLOWED_API_HOSTS,
    maxRedirects
  })
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`GitHub API error: HTTP ${res.statusCode}`)
  }
  try {
    return JSON.parse(res.bodyText)
  } catch {
    throw new Error('Failed to parse GitHub response')
  }
}

// Bug 15 fix: strip pre-release suffix before comparing
function compareVersions(current: string, latest: string): boolean {
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

function isAllowedDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    // github.com asset URLs must belong to OUR repo's releases; the CDN redirect
    // targets (objects./release-assets.githubusercontent.com) serve opaque paths
    // so only their hosts are pinned. Narrows the allow-list to the actual trust
    // boundary. Exact host match — same rule downloadFile enforces per hop.
    if (parsed.hostname === 'github.com') {
      return parsed.pathname.startsWith(`/${REPO}/releases/download/`)
    }
    return ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname)
  } catch {
    return false
  }
}

function computeFileHash(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// True when this process runs from a mounted AppImage — the only Linux
// packaging we can self-update (deb needs root/dpkg, so it stays manual).
function isAppImageInstall(): boolean {
  return typeof process.env.APPIMAGE === 'string' && process.env.APPIMAGE.length > 0
}

// Pure release-JSON → update-info mapping, split out so it can be unit-tested
// without network or Electron. Integrity hash comes from the asset's GitHub-
// computed `digest` field ("sha256:<hex>") first, with the release body's
// `SHA256: <hex>` line as a fallback for older/hand-written releases.
function parseReleaseInfo(release: GithubRelease, currentVersion: string): UpdateCheckInfo {
  const latestVersion = release.tag_name
  const hasUpdate = compareVersions(currentVersion, latestVersion)

  const asset = release.assets?.find(a => a.name.toLowerCase().endsWith('.appimage'))

  let expectedHash: string | null = null
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

async function checkForUpdate(): Promise<UpdateCheckInfo> {
  const currentVersion = app.getVersion()
  logger.info(`Checking for updates... current version: ${currentVersion}`)

  const release = await githubGet<GithubRelease | null>(`/repos/${REPO}/releases/latest`)
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

// Remembers the SHA256 verified at download time so app-update:install can
// re-check the on-disk file just before copying it over the running exe —
// closes the download→install TOCTOU on the fixed update path.
let lastVerifiedUpdate: { path: string; hash: string } | null = null

function getVerifiedUpdate(): { path: string; hash: string } | null {
  return lastVerifiedUpdate
}

async function downloadUpdate(
  url: string,
  expectedHash: string | null,
  onProgress: ProgressCallback | null | undefined
): Promise<string> {
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
  lastVerifiedUpdate = { path: destPath, hash: actualHash }

  logger.info(`Update downloaded to: ${destPath}`)
  return destPath
}

// Pure file-swap half of the AppImage update, split from the Electron
// relaunch so it can be unit-tested with mock-fs. Stages the replacement
// NEXT TO the target (same filesystem) so the final rename is atomic — the
// running app keeps its mounted inode, so replacing the file is safe.
function replaceAppImageFile(stagedPath: string | null | undefined, targetPath: string): void {
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
    throw new Error(`Failed to replace AppImage: ${(err as Error).message}`)
  }
  try { fs.unlinkSync(stagedPath) } catch { /* best-effort */ }
}

function installAppImageUpdate(stagedPath: string | null | undefined): void {
  const targetPath = process.env.APPIMAGE
  if (!targetPath || !isAppImageInstall()) {
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
  computeFileHash,
  getVerifiedUpdate,
  isAppImageInstall,
  replaceAppImageFile,
  installAppImageUpdate
}
