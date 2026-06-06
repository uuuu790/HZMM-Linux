import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { getLatestRelease, downloadRelease } from '../services/github-release.js'
import { extractZipRaw } from '../services/archive.js'

function getBinariesPath() {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return null

  // HumanitZ: gamePath/HumanitZ/Binaries/Win64/
  const candidates = [
    path.join(gamePath, 'HumanitZ', 'Binaries', 'Win64'),
    path.join(gamePath, 'Binaries', 'Win64')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function checkUe4ssStatus() {
  const binPath = getBinariesPath()
  if (!binPath) return { status: 'uninstalled', version: null }

  // experimental-latest: <proxy>.dll in Win64, UE4SS.dll in Win64/ue4ss/
  // 3.0.1: 全部在 Win64/
  // UE4SS ships different proxy DLLs depending on engine version; accept any
  // of the known names so we don't misreport an xinput-based install as
  // uninstalled and overwrite it.
  const PROXY_DLLS = ['dwmapi.dll', 'xinput1_3.dll', 'd3d11.dll', 'dsound.dll']
  const hasNewStructure = fs.existsSync(path.join(binPath, 'ue4ss', 'UE4SS.dll'))
  const hasOldStructure = fs.existsSync(path.join(binPath, 'UE4SS.dll'))
  const hasProxy = PROXY_DLLS.some(name => fs.existsSync(path.join(binPath, name)))

  if (!hasProxy && !hasNewStructure && !hasOldStructure) {
    return { status: 'uninstalled', version: null }
  }

  const installedVersion = configStore.get('ue4ssVersion', null)
  const structure = hasNewStructure ? 'experimental' : 'legacy'
  return { status: 'installed', version: installedVersion, structure }
}

function cleanUe4ssFiles(binPath) {
  // 清理已知的 UE4SS 檔案，避免舊版本殘留
  const knownFiles = ['dwmapi.dll', 'UE4SS.dll', 'UE4SS-settings.ini']
  for (const file of knownFiles) {
    const filePath = path.join(binPath, file)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
  // 清理 ue4ss 子目錄（experimental 結構）
  const ue4ssSubDir = path.join(binPath, 'ue4ss')
  if (fs.existsSync(ue4ssSubDir)) {
    // 保留 Mods 資料夾（使用者的 mod 不能刪）
    const _modsDir = path.join(ue4ssSubDir, 'Mods')
    const entries = fs.readdirSync(ue4ssSubDir)
    for (const entry of entries) {
      if (entry === 'Mods') continue
      const entryPath = path.join(ue4ssSubDir, entry)
      const stat = fs.statSync(entryPath)
      if (stat.isDirectory()) {
        fs.rmSync(entryPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(entryPath)
      }
    }
  }
}

// UE4SS-settings.ini lives in one of two places depending on the install
// layout. Both are user-editable (graphics API, console toggles, custom
// keybinds).
const UE4SS_SETTINGS_RELATIVE_PATHS = ['UE4SS-settings.ini', path.join('ue4ss', 'UE4SS-settings.ini')]

function snapshotUserSettings(installPath) {
  const saved = []
  for (const rel of UE4SS_SETTINGS_RELATIVE_PATHS) {
    const full = path.join(installPath, rel)
    if (fs.existsSync(full)) {
      try { saved.push({ path: full, content: fs.readFileSync(full) }) } catch { /* unreadable */ }
    }
  }
  return saved
}

function restoreUserSettings(saved) {
  for (const { path: full, content } of saved) {
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content)
      logger.info(`Preserved UE4SS-settings.ini at ${full}`)
    } catch (err) {
      logger.warn(`Failed to restore UE4SS-settings.ini: ${err.message}`)
    }
  }
}

// UE4SS 3.0+ ships DLLs under `Win64/ue4ss/`, which fails to load under
// Wine/Proton — Wine's DLL resolver doesn't follow the same subdirectory
// layout as the Windows loader. Flattening everything back into `Win64/`
// is the documented community workaround for UE4SS on Proton.
function flattenUe4ssLayout(binPath) {
  const ue4ssDir = path.join(binPath, 'ue4ss')
  if (!fs.existsSync(ue4ssDir)) return

  const entries = fs.readdirSync(ue4ssDir)
  for (const entry of entries) {
    // Mods folder stays in place — UE4SS reads it from either location and
    // user-installed mods already live there, moving them risks collisions.
    if (entry === 'Mods') continue

    const src = path.join(ue4ssDir, entry)
    const dest = path.join(binPath, entry)

    // Conflict guard: never overwrite a proxy DLL or existing file in Win64/.
    // If the release ever stops needing flattening this also prevents
    // re-flattening from clobbering hand-placed files.
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true })
    }
    fs.renameSync(src, dest)
  }

  // Remove the now-empty (or Mods-only) ue4ss/ directory shell when safe.
  // If Mods is the only remaining entry, leave the directory; UE4SS will
  // still discover Win64/Mods via the flattened path.
  const remaining = fs.readdirSync(ue4ssDir)
  if (remaining.length === 0) {
    fs.rmdirSync(ue4ssDir)
  }
}

async function doInstall(mainWindow) {
  const installPath = getBinariesPath()
  if (!installPath) throw new Error('GAME_PATH_NOT_FOUND')

  const release = await getLatestRelease()
  if (!release.downloadUrl) throw new Error('No download URL found')

  const tempDir = configStore.getConfigDir()
  const tempZip = path.join(tempDir, 'ue4ss_temp.zip')

  try {
    // Download with progress
    await downloadRelease(release.downloadUrl, tempZip, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ue4ss:progress', progress)
      }
    })

    // Capture user-customized UE4SS-settings.ini BEFORE clean + extract.
    // cleanUe4ssFiles unlinks it directly, and even if it didn't, the
    // archive's fresh settings.ini would overwrite during extract.
    const savedSettings = snapshotUserSettings(installPath)

    // 清理舊版本檔案（保留使用者 Mods）
    cleanUe4ssFiles(installPath)

    // Extract to game directory (不走 mod 分析，直接全部解壓)
    await extractZipRaw(tempZip, installPath)

    // Put user's settings back (overwriting freshly-extracted defaults) at
    // their original layout location, then flatten — so the restored ini is
    // moved into Win64/ alongside the DLLs and ends where Wine actually reads it.
    restoreUserSettings(savedSettings)

    // Flatten Win64/ue4ss/* → Win64/* for Wine/Proton compatibility.
    flattenUe4ssLayout(installPath)

    // Store version
    configStore.set('ue4ssVersion', release.version)

    logger.info(`UE4SS deployed (flattened for Proton): version ${release.version}`)
    return { version: release.version }
  } finally {
    // Cleanup temp file
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip)
  }
}

function registerUe4ssIpc(mainWindow) {
  ipcMain.handle('ue4ss:status', async () => {
    const local = checkUe4ssStatus()

    try {
      const latest = await getLatestRelease()

      if (local.status === 'installed') {
        if (!local.version) {
          // 非透過 HZMM 安裝的，標記為可更新/重新安裝
          return { ...local, status: 'update', latestVersion: latest.version }
        }
        if (latest.version !== local.version) {
          return { ...local, status: 'update', latestVersion: latest.version }
        }
      }

      return { ...local, latestVersion: latest.version }
    } catch (err) {
      logger.warn(`UE4SS status check failed: ${err.message}`)
      return local
    }
  })

  const doInstallLogged = async () => {
    try { return await doInstall(mainWindow) }
    catch (e) { logger.error(`UE4SS deploy failed: ${e.message}`); throw e }
  }
  ipcMain.handle('ue4ss:install', doInstallLogged)
  ipcMain.handle('ue4ss:update', doInstallLogged)
}

export { registerUe4ssIpc }
