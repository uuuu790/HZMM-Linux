import https from 'https'
import { app } from 'electron'
import { downloadFile } from './archive.js'

const UE4SS_REPO = 'UE4SS-RE/RE-UE4SS'
const REQUEST_TIMEOUT_MS = 10000

function githubGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      headers: {
        'User-Agent': `HZMM/${app.getVersion()}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }

    const req = https.get(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 403) {
          reject(new Error('GitHub API rate limit exceeded'))
          return
        }
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
    })

    req.on('error', reject)

    // Abort if GitHub hangs — matches app-updater.js behavior.
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('GitHub API request timed out'))
    })
  })
}

async function getLatestRelease() {
  // 優先抓 experimental-latest（pre-release），否則 fallback 到 latest stable
  const releases = await githubGet(`/repos/${UE4SS_REPO}/releases?per_page=10`)
  if (!Array.isArray(releases) || releases.length === 0) throw new Error('No releases found')

  // 找 experimental-latest tag
  let release = releases.find(r => r.tag_name === 'experimental-latest')
  // Fallback 到最新的 release
  if (!release) release = releases.find(r => !r.prerelease) || releases[0]
  if (!release || !release.tag_name) throw new Error('No release found')

  // 找 zip asset（排除 source、DEV、CustomGameConfigs、MapGenBP）
  const excludePatterns = ['source', 'customgameconfigs', 'mapgenbp', 'dev']
  const asset = release.assets?.find(a => {
    const lower = a.name.toLowerCase()
    return lower.endsWith('.zip') && !excludePatterns.some(p => lower.includes(p))
  })

  return {
    version: release.tag_name,
    name: release.name,
    downloadUrl: asset?.browser_download_url || null,
    assetName: asset?.name || null,
    size: asset?.size || 0
  }
}

function downloadRelease(url, destPath, onProgress) {
  return downloadFile(url, destPath, onProgress)
}

export { getLatestRelease, downloadRelease }
