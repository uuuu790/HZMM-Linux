import { ipcMain, dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import logger from '../services/logger'
import { getLatestRelease, downloadRelease } from '../services/github-release'
import { extractZip, extractZipRaw } from '../services/archive'
import { resolveWithin } from '../services/path-safety'
import { mainText } from '../services/main-text'
import { currentLocale } from './locale'
import type { Ue4ssStatus } from './types'

type MainWindow = BrowserWindow | null | undefined

interface MovedFile {
  from: string
  to: string
}

interface SavedSettings {
  installPath: string
  rel: string
  content: Buffer
}

function getBinariesPath(): string | null {
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

function checkUe4ssStatus(): Ue4ssStatus {
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
  // published_at of the release we installed. Older HZMM builds didn't record
  // it, so this may be null — the status handler treats a missing value as
  // "up-to-date" rather than nagging (see ue4ss:status).
  const installedPublishedAt = configStore.get('ue4ssPublishedAt', null)
  const structure = hasNewStructure ? 'experimental' : 'legacy'
  return { status: 'installed', version: installedVersion, publishedAt: installedPublishedAt, structure }
}

// Move (not delete) the existing UE4SS core files into backupDir so a failed
// extract can roll back to a working install instead of a half-deleted mess.
// Mirrors the old "keep the user's Mods folder" rule. Backup lives next to the
// install (same volume) so renameSync never hits EXDEV. Returns moved {from,to}.
function rotateUe4ssToBackup(binPath: string, backupDir: string): MovedFile[] {
  const moved: MovedFile[] = []
  const stash = (from: string, key: string) => {
    const to = path.join(backupDir, key)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
    moved.push({ from, to })
  }
  const knownFiles = ['dwmapi.dll', 'UE4SS.dll', 'UE4SS-settings.ini']
  for (const file of knownFiles) {
    const filePath = path.join(binPath, file)
    if (fs.existsSync(filePath)) stash(filePath, file)
  }
  // experimental structure: ue4ss/ subdir — rotate everything except the
  // user's Mods folder.
  const ue4ssSubDir = path.join(binPath, 'ue4ss')
  if (fs.existsSync(ue4ssSubDir)) {
    for (const entry of fs.readdirSync(ue4ssSubDir)) {
      if (entry === 'Mods') continue
      stash(path.join(ue4ssSubDir, entry), path.join('ue4ss', entry))
    }
  }
  return moved
}

// Put rotated core files back after a failed extract.
function restoreUe4ssBackup(moved: MovedFile[]): void {
  for (const { from, to } of moved) {
    try {
      if (fs.existsSync(from)) {
        if (fs.statSync(from).isDirectory()) fs.rmSync(from, { recursive: true, force: true })
        else fs.unlinkSync(from)
      }
      fs.mkdirSync(path.dirname(from), { recursive: true })
      fs.renameSync(to, from)
    } catch (err) {
      logger.warn(`UE4SS rollback failed for ${from}: ${(err as Error).message}`)
    }
  }
}

// UE4SS-settings.ini lives in one of two places depending on the install
// layout. Both are user-editable (graphics API, console toggles, custom
// keybinds).
const UE4SS_SETTINGS_RELATIVE_PATHS = ['UE4SS-settings.ini', path.join('ue4ss', 'UE4SS-settings.ini')]

function snapshotUserSettings(installPath: string): SavedSettings[] {
  const saved: SavedSettings[] = []
  for (const rel of UE4SS_SETTINGS_RELATIVE_PATHS) {
    const full = path.join(installPath, rel)
    if (fs.existsSync(full)) {
      // Keep installPath + the relative path (not just the absolute target) so
      // restoreUserSettings can re-derive the write target under resolveWithin
      // rather than trusting a stored absolute path.
      try { saved.push({ installPath, rel, content: fs.readFileSync(full) }) } catch { /* unreadable */ }
    }
  }
  return saved
}

function restoreUserSettings(saved: SavedSettings[]): void {
  for (const { installPath, rel, content } of saved) {
    try {
      // Re-resolve the write target under the path guard. The rel paths come
      // from UE4SS_SETTINGS_RELATIVE_PATHS (not renderer input), so this is
      // defense-in-depth: it keeps the "writes stay inside installPath"
      // invariant explicit and refactor-proof rather than trusting a stored
      // absolute path.
      const full = resolveWithin(installPath, rel)
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, content)
      logger.info(`Preserved UE4SS-settings.ini at ${full}`)
    } catch (err) {
      logger.warn(`Failed to restore UE4SS-settings.ini: ${(err as Error).message}`)
    }
  }
}

// UE4SS 3.0+ ships DLLs under `Win64/ue4ss/`, which fails to load under
// Wine/Proton — Wine's DLL resolver doesn't follow the same subdirectory
// layout as the Windows loader. Flattening everything back into `Win64/`
// is the documented community workaround for UE4SS on Proton.
function flattenUe4ssLayout(binPath: string): void {
  const ue4ssDir = path.join(binPath, 'ue4ss')
  if (!fs.existsSync(ue4ssDir)) return

  const entries = fs.readdirSync(ue4ssDir)
  for (const entry of entries) {
    // Mods folder stays in place — UE4SS reads it from either location and
    // user-installed mods already live there, moving them risks collisions.
    if (entry === 'Mods') continue

    const src = path.join(ue4ssDir, entry)
    const dest = path.join(binPath, entry)

    // UE4SS-settings.ini: an existing root copy is the user's restored
    // settings (restoreUserSettings runs before flatten, and a previously
    // flattened install keeps them at Win64/UE4SS-settings.ini) — keep it and
    // leave the archive default in ue4ss/ instead of clobbering.
    if (entry === 'UE4SS-settings.ini' && fs.existsSync(dest)) continue

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

// Shared deploy: snapshot user settings → rotate old core files aside →
// extract → restore settings → flatten for Proton. Used by both the GitHub
// download path and the local-zip fallback.
async function deployZip(installPath: string, zipPath: string): Promise<void> {
  // Capture user-customized UE4SS-settings.ini BEFORE rotate + extract.
  // The settings file is rotated aside with the rest, and the archive's fresh
  // settings.ini would overwrite during extract — so re-apply it afterwards.
  const savedSettings = snapshotUserSettings(installPath)

  // Rotate old core files aside (keeping the user's Mods) instead of deleting,
  // so a failed extract rolls back to the working install rather than leaving
  // UE4SS half-deleted and unloadable.
  const backupDir = path.join(installPath, '_hzmm_ue4ss_backup')
  fs.rmSync(backupDir, { recursive: true, force: true })
  fs.mkdirSync(backupDir, { recursive: true })
  let rotated: MovedFile[] = []
  try {
    rotated = rotateUe4ssToBackup(installPath, backupDir)
    // Extract to game directory (不走 mod 分析，直接全部解壓)
    await extractZipRaw(zipPath, installPath)
  } catch (err) {
    restoreUe4ssBackup(rotated)
    throw err
  }
  fs.rmSync(backupDir, { recursive: true, force: true })

  // Put user's settings back (overwriting freshly-extracted defaults) at
  // their original layout location, then flatten. If they were captured at
  // ue4ss/UE4SS-settings.ini, flatten moves them into Win64/; if a prior
  // flattened install had them at Win64/UE4SS-settings.ini, flatten keeps
  // that copy (it never clobbers an existing root ini).
  restoreUserSettings(savedSettings)

  // Flatten Win64/ue4ss/* → Win64/* for Wine/Proton compatibility.
  flattenUe4ssLayout(installPath)
}

async function doInstall(mainWindow: MainWindow): Promise<{ version: string }> {
  const installPath = getBinariesPath()
  if (!installPath) throw new Error('GAME_PATH_NOT_FOUND')

  const release = await getLatestRelease()
  if (!release.downloadUrl) throw new Error('No download URL found')

  const tempDir = configStore.getConfigDir()
  const tempZip = path.join(tempDir, 'ue4ss_temp.zip')

  try {
    // Download with progress
    await downloadRelease(release.downloadUrl, tempZip, (progress: number) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ue4ss:progress', progress)
      }
    })

    await deployZip(installPath, tempZip)

    // Store version + published_at. The latter is what detects a fresh build
    // of the rolling 'experimental-latest' tag (whose version never changes).
    configStore.set('ue4ssVersion', release.version)
    configStore.set('ue4ssPublishedAt', release.publishedAt || null)

    logger.info(`UE4SS deployed (flattened for Proton): version ${release.version}`)
    return { version: release.version }
  } finally {
    // Cleanup temp file
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip)
  }
}

// Fallback for users who can't reach GitHub from the app (blocked CDN, proxy
// the app can't use): they download a UE4SS release zip themselves and pick
// it here. Same rotate/extract/rollback path as the online install.
async function doInstallFromFile(mainWindow: MainWindow): Promise<{ canceled: true } | { version: string }> {
  const installPath = getBinariesPath()
  if (!installPath) throw new Error('GAME_PATH_NOT_FOUND')

  const text = mainText(currentLocale())
  const options: OpenDialogOptions = {
    title: text.ue4ssZipTitle,
    filters: [{ name: text.ue4ssZipFilter, extensions: ['zip'] }],
    properties: ['openFile']
  }
  // Same dialog as before: parented to the main window when there is one.
  const { canceled, filePaths } = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (canceled || !filePaths || filePaths.length === 0) return { canceled: true }
  const zipPath = filePaths[0]

  // Refuse anything that doesn't actually contain UE4SS.dll — rotating the
  // working install aside for a random zip would trash it for nothing.
  // analyzeOnly reads the entry table without writing a byte and resolves the
  // structure analysis plus the archive's entry names.
  const { entryNames } = await extractZip(zipPath, installPath, true) as { entryNames: string[] }
  if (!entryNames.some((n: string) => n.toLowerCase().endsWith('ue4ss.dll'))) {
    throw new Error('INVALID_UE4SS_ZIP')
  }

  await deployZip(installPath, zipPath)

  // A hand-picked zip has no trustworthy version identity — record 'manual'
  // so ue4ss:status neither nags "update" forever (the download that update
  // needs is exactly what failed for these users) nor claims a real version.
  configStore.set('ue4ssVersion', 'manual')
  configStore.set('ue4ssPublishedAt', null)

  logger.info(`UE4SS deployed from local zip (flattened for Proton): ${zipPath}`)
  return { version: 'manual' }
}

function registerUe4ssIpc(mainWindow: MainWindow): void {
  ipcMain.handle('ue4ss:status', async (): Promise<Ue4ssStatus> => {
    const local = checkUe4ssStatus()

    try {
      const latest = await getLatestRelease()

      if (local.status === 'installed') {
        if (local.version === 'manual') {
          // Installed from a user-picked zip: no comparable version or
          // publishedAt, and nagging "update" would push these users back
          // into the download path that failed for them. Treat as current.
          return { ...local, latestVersion: latest.version }
        }
        if (!local.version) {
          // 非透過 HZMM 安裝的，標記為可更新/重新安裝
          return { ...local, status: 'update', latestVersion: latest.version }
        }
        if (latest.version !== local.version) {
          return { ...local, status: 'update', latestVersion: latest.version }
        }
        // Same version, but 'experimental-latest' reuses one tag forever — a
        // newer build only shows up as a changed published_at. Only flag it
        // when we actually recorded a publishedAt at install time; a missing
        // stored value (older HZMM install) is treated as up-to-date so we
        // don't nag on every launch — it backfills on the next install.
        if (local.publishedAt && latest.publishedAt && local.publishedAt !== latest.publishedAt) {
          return { ...local, status: 'update', latestVersion: latest.version }
        }
      }

      return { ...local, latestVersion: latest.version }
    } catch (err) {
      logger.warn(`UE4SS status check failed: ${(err as Error).message}`)
      return local
    }
  })

  const doInstallLogged = async () => {
    try { return await doInstall(mainWindow) }
    catch (e) { logger.error(`UE4SS deploy failed: ${(e as Error).message}`); throw e }
  }
  ipcMain.handle('ue4ss:install', doInstallLogged)
  ipcMain.handle('ue4ss:update', doInstallLogged)
  ipcMain.handle('ue4ss:install-from-file', async () => {
    try { return await doInstallFromFile(mainWindow) }
    catch (e) { logger.error(`UE4SS local-zip deploy failed: ${(e as Error).message}`); throw e }
  })
}

export { registerUe4ssIpc }
