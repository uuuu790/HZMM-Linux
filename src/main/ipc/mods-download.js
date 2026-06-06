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

async function nexusApiRequest(endpoint, apiKey) {
  const https = await import('https')
  return new Promise((resolve, reject) => {
    const req = https.default.get(`https://api.nexusmods.com/v1${endpoint}`, {
      headers: { 'apikey': apiKey, 'User-Agent': `HZMM/${app.getVersion()}` }
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
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
  })
}

async function resolveNexusDownloadUrl(nexusInfo, apiKey) {
  let fileId = nexusInfo.fileId
  // If no file_id, get the latest main file
  if (!fileId) {
    const filesData = await nexusApiRequest(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files.json`, apiKey)
    const mainFiles = (filesData.files || []).filter(f => f.category_id === 1) // 1 = Main files
    const allFiles = mainFiles.length > 0 ? mainFiles : (filesData.files || [])
    if (allFiles.length === 0) throw new Error('No files found for this mod')
    // Pick the latest file
    allFiles.sort((a, b) => (b.uploaded_timestamp || 0) - (a.uploaded_timestamp || 0))
    fileId = allFiles[0].file_id
    logger.info(`Nexus: resolved latest file_id=${fileId} for mod ${nexusInfo.modId}`)
  }
  // Get download links
  const links = await nexusApiRequest(`/games/${nexusInfo.game}/mods/${nexusInfo.modId}/files/${fileId}/download_link.json`, apiKey)
  if (!links || links.length === 0) throw new Error('No download links returned from Nexus API')
  return { url: links[0].URI, name: links[0].name || `nexus_mod_${nexusInfo.modId}_${fileId}` }
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
    logger.info(`Nexus resolved download URL: ${url.slice(0, 80)}...`)
  }

  // Validate URL against allowed hosts
  if (!isAllowedModUrl(url)) {
    throw new Error('Download URL is not from an allowed source. Supported: Nexus Mods, GitHub.')
  }

  const urlObj = new URL(url)
  let filename = path.basename(urlObj.pathname)
  if (!filename || !filename.match(/\.(zip|rar|pak)$/i)) filename = `mod_download_${Date.now()}.zip`
  const tempPath = path.join(configStore.getConfigDir(), 'temp', filename)
  fs.mkdirSync(path.dirname(tempPath), { recursive: true })
  try {
    await downloadFile(url, tempPath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mods:download-progress', progress)
    })
    const result = await installMods([tempPath], mainWindow)
    try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
    return result
  } catch (err) {
    try { fs.unlinkSync(tempPath) } catch { /* temp file already gone */ }
    throw err
  }
}

export { ALLOWED_MOD_HOSTS, isAllowedModUrl, parseNexusUrl, downloadAndInstallFromUrl, nexusApiRequest, resolveNexusDownloadUrl }
