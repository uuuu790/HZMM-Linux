import { app } from 'electron'
import { downloadFile, type ProgressCallback } from './archive'
import { netRequest } from './net-client'

const UE4SS_REPO = 'UE4SS-RE/RE-UE4SS'
const REQUEST_TIMEOUT_MS = 10000

/** The fields HZMM reads from a GitHub release payload. */
export interface GithubRelease {
  tag_name: string
  name: string | null
  prerelease: boolean
  published_at: string | null
  body: string | null
  /** digest: GitHub-computed "sha256:<hex>" (newer releases only). */
  assets?: Array<{ name: string; browser_download_url: string; size: number; digest?: string }>
}

export interface Ue4ssRelease {
  /** The release tag ('experimental-latest' for the rolling pre-release). */
  version: string
  publishedAt: string | null
  name: string | null
  downloadUrl: string | null
  assetName: string | null
  size: number
}

// netRequest goes through Electron's net module (Chromium stack) so it
// follows the OS proxy settings — same reason downloadFile does.
async function githubGet<T>(endpoint: string): Promise<T> {
  const res = await netRequest(`https://api.github.com${endpoint}`, {
    headers: {
      'User-Agent': `HZMM/${app.getVersion()}`,
      'Accept': 'application/vnd.github.v3+json'
    },
    timeoutMs: REQUEST_TIMEOUT_MS,
    timeoutMessage: 'GitHub API request timed out'
  })
  if (res.statusCode === 403) throw new Error('GitHub API rate limit exceeded')
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`GitHub API error: HTTP ${res.statusCode}`)
  }
  try {
    return JSON.parse(res.bodyText)
  } catch {
    throw new Error('Failed to parse GitHub response')
  }
}

async function getLatestRelease(): Promise<Ue4ssRelease> {
  // 優先抓 experimental-latest（pre-release），否則 fallback 到 latest stable
  const releases = await githubGet<GithubRelease[]>(`/repos/${UE4SS_REPO}/releases?per_page=10`)
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
    // The 'experimental-latest' release reuses ONE rolling tag, so tag_name
    // never changes across builds. published_at DOES move on every rebuild —
    // it's the only signal that lets ue4ss:status detect a newer build.
    publishedAt: release.published_at || null,
    name: release.name,
    downloadUrl: asset?.browser_download_url || null,
    assetName: asset?.name || null,
    size: asset?.size || 0
  }
}

// GitHub release downloads start on github.com and 302 to a CDN host under
// *.githubusercontent.com. Restrict every redirect hop to these so a
// compromised/hijacked API response can't redirect the UE4SS zip — extracted
// into Binaries/Win64, a DLL injection surface — to an arbitrary host. The
// `*.` prefix opts in to subdomain matching (downloadFile entries are
// exact-match otherwise); GitHub rotates asset CDN hosts (objects. /
// release-assets. / …) so the wildcard is deliberate here.
const ALLOWED_DOWNLOAD_HOSTS = ['github.com', '*.githubusercontent.com']

function downloadRelease(url: string, destPath: string, onProgress: ProgressCallback | null | undefined): Promise<string> {
  return downloadFile(url, destPath, onProgress, ALLOWED_DOWNLOAD_HOSTS)
}

export { getLatestRelease, downloadRelease }
