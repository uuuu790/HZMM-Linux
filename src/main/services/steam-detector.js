import { join, resolve, sep } from 'path'
import fs from 'fs'
import os from 'os'
import { net } from 'electron'
import configStore from './config-store.js'

const HUMANITZ_APP_ID = '1766060' // 遊戲本體 app id：appmanifest / 啟動 / news 同一個
const HUMANITZ_FOLDER_NAME = 'HumanitZ'

let cachedSteamPath = undefined

// Linux Steam ships through several distinct install channels, each placing
// the Steam data root in a different location. Order matters: we prefer
// native installs (least quirks) before Flatpak / Snap sandboxed variants.
function getSteamCandidatePaths() {
  const home = os.homedir()
  return [
    // Native packages — Debian/Ubuntu .deb, Arch steam, Fedora rpm
    // ~/.steam/steam is usually a symlink to ~/.local/share/Steam
    join(home, '.local', 'share', 'Steam'),
    join(home, '.steam', 'steam'),
    join(home, '.steam', 'debian-installation'),
    join(home, '.steam', 'root'),
    // Flatpak — com.valvesoftware.Steam
    join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
    // Snap — canonical/steam
    join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
    // Custom / non-standard
    join(home, 'Steam')
  ]
}

function getSteamPath() {
  if (cachedSteamPath !== undefined) return cachedSteamPath

  for (const p of getSteamCandidatePaths()) {
    try {
      // Verify it's a Steam install by checking for steamapps folder —
      // bare ~/Steam directories without steamapps are common (logs, etc).
      if (fs.existsSync(p) && fs.existsSync(join(p, 'steamapps'))) {
        cachedSteamPath = p
        return cachedSteamPath
      }
    } catch {
      continue
    }
  }

  cachedSteamPath = null
  return null
}

function parseLibraryFolders(steamPath) {
  const vdfPath = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!fs.existsSync(vdfPath)) return [steamPath]

  const content = fs.readFileSync(vdfPath, 'utf-8')
  const paths = [steamPath]

  // VDF library paths on Linux are forward-slash style and need no unescaping.
  // The replace is harmless for Linux-only input and keeps the parser robust
  // if a manifest was imported from a Windows install.
  const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/g)
  for (const m of pathMatches) {
    const p = m[1].replace(/\\\\/g, '\\')
    if (!paths.includes(p)) paths.push(p)
  }

  return paths
}

function detectGamePath() {
  const steamPath = getSteamPath()
  if (!steamPath) return null

  const libraryPaths = parseLibraryFolders(steamPath)

  for (const libPath of libraryPaths) {
    const gamePath = join(libPath, 'steamapps', 'common', HUMANITZ_FOLDER_NAME)
    if (fs.existsSync(gamePath)) {
      // Game files are still .exe — Proton runs them through Wine — so the
      // verification heuristic is unchanged from the Windows manager.
      try {
        const hasExe = fs.readdirSync(gamePath).some(f => f.toLowerCase().endsWith('.exe'))
        if (hasExe) return gamePath
      } catch { continue }
    }
  }

  return null
}

// Whether gamePath is the Steam-managed copy (under a Steam library's
// steamapps/common). Only then is launching via steam:// correct — a
// manually-set non-Steam copy isn't orchestrated by Steam. On Linux this
// also gates Proton: a Steam-managed copy gets the user's Proton/launch
// options; a non-Steam path has no Wine prefix to run through.
function isSteamGame(gamePath) {
  const steamPath = getSteamPath()
  if (!steamPath || !gamePath) return false
  const norm = resolve(gamePath).toLowerCase()
  for (const lib of parseLibraryFolders(steamPath)) {
    const common = resolve(join(lib, 'steamapps', 'common')).toLowerCase()
    if (norm === common || norm.startsWith(common + sep)) return true
  }
  return false
}

function getPaksPath(gamePath) {
  // UE4 mod loader path is identical under Proton — Wine maps the Windows
  // path layout 1:1 onto the Linux filesystem inside the game directory.
  const candidates = [
    join(gamePath, 'HumanitZ', 'Content', 'Paks', '~mods'),
    join(gamePath, 'HumanitZ', 'Content', 'Paks'),
    join(gamePath, 'Content', 'Paks', '~mods'),
    join(gamePath, 'Content', 'Paks')
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  const defaultPaks = join(gamePath, 'HumanitZ', 'Content', 'Paks')
  if (fs.existsSync(gamePath)) {
    fs.mkdirSync(defaultPaks, { recursive: true })
    return defaultPaks
  }

  return null
}

function getAllPaksPaths(gamePath) {
  const candidates = [
    join(gamePath, 'HumanitZ', 'Content', 'Paks', '~mods'),
    join(gamePath, 'HumanitZ', 'Content', 'Paks'),
    join(gamePath, 'Content', 'Paks', '~mods'),
    join(gamePath, 'Content', 'Paks')
  ]
  return candidates.filter(p => fs.existsSync(p))
}

function getGameExe(gamePath) {
  if (!gamePath || !fs.existsSync(gamePath)) return null
  let files
  try { files = fs.readdirSync(gamePath) } catch { return null }
  // Case-sensitive filesystem on Linux — lowercase compare so we match
  // whatever casing the publisher actually shipped.
  const exe = files.find(f => {
    const lower = f.toLowerCase()
    return lower.endsWith('.exe') &&
      !lower.includes('crash') &&
      !lower.includes('unins') &&
      !lower.includes('ue4prereq') &&
      !lower.includes('redist')
  })
  return exe ? join(gamePath, exe) : null
}

function getUe4ssModsPath(gamePath) {
  // Even under Proton the game's Binaries/Win64 directory exists exactly
  // as on Windows — Wine doesn't relocate game-relative paths.
  const candidates = [
    join(gamePath, 'HumanitZ', 'Binaries', 'Win64', 'ue4ss', 'Mods'),
    join(gamePath, 'ue4ss', 'Mods'),
    join(gamePath, 'Mods')
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  return null
}

// Detect which Steam install channel is in use — surfaced to the UI so the
// Proton setup guide can mention sandbox-specific quirks (Flatpak permissions,
// Snap home confinement, etc.) when the user hits problems.
function getSteamInstallType() {
  const steamPath = getSteamPath()
  if (!steamPath) return 'unknown'
  if (steamPath.includes('.var/app/com.valvesoftware.Steam')) return 'flatpak'
  if (steamPath.includes('/snap/steam/')) return 'snap'
  return 'native'
}

// Proton's per-game Wine prefix lives under
// steamapps/compatdata/<appid>/pfx. Surfaced for diagnostic UI; mod files
// go in the real Linux game directory, not inside the prefix.
function getProtonPrefix() {
  const steamPath = getSteamPath()
  if (!steamPath) return null
  const prefix = join(steamPath, 'steamapps', 'compatdata', HUMANITZ_APP_ID, 'pfx')
  return fs.existsSync(prefix) ? prefix : null
}

function fetchGameVersionFromSteamNews() {
  return new Promise((resolve) => {
    const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${HUMANITZ_APP_ID}&count=20&maxlength=0`
    const request = net.request(url)
    let body = ''

    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString() })
      response.on('end', () => {
        try {
          const data = JSON.parse(body)
          const items = data?.appnews?.newsitems || []
          for (const item of items) {
            const match = item.title.match(/(\d+\.\d+(?:\.\w+)?)\s*(Update|Patch|Hotfix)/i)
            if (match) {
              resolve(match[1])
              return
            }
          }
          resolve(null)
        } catch {
          resolve(null)
        }
      })
    })

    request.on('error', () => resolve(null))
    request.end()

    setTimeout(() => { try { request.abort() } catch { /* already completed */ } resolve(null) }, 3000)
  })
}

function getGameVersionCached() {
  const cached = configStore.get('cachedGameVersion')
  return cached || null
}

async function getGameVersion(gamePath) {
  if (!gamePath) return null

  // Method 1: Steam appmanifest — local, fast, identical on all platforms
  let buildId = null
  let lastUpdated = null
  const steamPath = getSteamPath()
  if (steamPath) {
    const libraryPaths = parseLibraryFolders(steamPath)
    for (const libPath of libraryPaths) {
      const manifestPath = join(libPath, 'steamapps', `appmanifest_${HUMANITZ_APP_ID}.acf`)
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf-8')
        const buildMatch = content.match(/"buildid"\s+"(\d+)"/)
        const updatedMatch = content.match(/"LastUpdated"\s+"(\d+)"/)
        if (buildMatch) {
          buildId = buildMatch[1]
          lastUpdated = updatedMatch ? new Date(parseInt(updatedMatch[1]) * 1000).toLocaleDateString() : null
        }
        break
      }
    }
  }

  // Method 2: Steam News API — version name parsing
  const versionName = await fetchGameVersionFromSteamNews()

  if (versionName || buildId) {
    const result = { versionName, buildId, lastUpdated }
    configStore.set('cachedGameVersion', result)
    return result
  }

  // Method 3 (Windows PowerShell file version) intentionally omitted —
  // not portable without bundling pefile/objdump dependencies, and we
  // already have two independent version sources above.
  return null
}

export {
  detectGamePath,
  isSteamGame,
  getPaksPath,
  getAllPaksPaths,
  getGameExe,
  getUe4ssModsPath,
  getGameVersion,
  getGameVersionCached,
  getSteamPath,
  getSteamInstallType,
  getProtonPrefix,
  HUMANITZ_APP_ID
}
