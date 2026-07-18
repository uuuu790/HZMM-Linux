import { ipcMain, app, shell } from 'electron'
import { checkForUpdate, downloadUpdate, isAppImageInstall, installAppImageUpdate } from '../services/app-updater.js'
import logger from '../services/logger.js'

// Linux fork update flow, two modes decided by how the app is installed:
//
//   AppImage (process.env.APPIMAGE set) — true in-app update:
//     app-update:download  -> fetch the release's .AppImage asset (SHA256
//                             verified against GitHub's asset digest), report
//                             progress on app-update:progress
//     app-update:install   -> atomically replace the AppImage on disk, then
//                             relaunch into the new version
//
//   deb / dev run — manual flow (installing a deb needs root, so we only
//   detect and point at the releases page):
//     app-update:download  -> no binary fetched; advances the UI to "ready"
//     app-update:install   -> open the releases page for a manual download
//
// The IPC channel names mirror Windows exactly so the shared renderer
// (useUpdateHandlers / SettingsTab) drives both platforms unchanged.
const RELEASES_URL = 'https://github.com/uuuu790/HZMM-Linux/releases/latest'

function registerAppUpdateIpc(mainWindow) {
  // Path of the verified update staged by app-update:download; consumed by
  // app-update:install. Never derived from renderer input.
  let stagedUpdatePath = null

  ipcMain.handle('app-update:get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('app-update:check', async () => {
    try {
      return await checkForUpdate()
    } catch (err) {
      logger.error(`Update check failed: ${err.message}`)
      return { hasUpdate: false, currentVersion: app.getVersion(), error: err.message }
    }
  })

  // Renderer-supplied URL/hash are IGNORED (mirrors the Windows hardening: an
  // XSS-compromised renderer must not be able to point the updater anywhere).
  // The download URL and expected hash are re-fetched from the GitHub API here
  // in the main process.
  ipcMain.handle('app-update:download', async () => {
    try {
      const release = await checkForUpdate()
      if (!release.hasUpdate) {
        throw new Error('No update available')
      }
      if (!release.autoInstall) {
        // deb / dev: nothing to stage — the actual download is manual. Resolve
        // so the shared renderer advances to its "ready" state, where the
        // install action opens the releases page.
        return { filePath: null }
      }
      if (!release.downloadUrl) {
        throw new Error('Latest release has no AppImage asset')
      }
      const filePath = await downloadUpdate(release.downloadUrl, release.expectedHash, (pct) => {
        mainWindow?.webContents.send('app-update:progress', pct)
      })
      stagedUpdatePath = filePath
      return { filePath }
    } catch (err) {
      logger.error(`Update download failed: ${err.message}`)
      throw err
    }
  })

  // AppImage: swap the file in place and relaunch (quits on success — the
  // renderer keeps its "updating" state until the window goes away). Errors
  // reject and surface in the UI. deb / dev / nothing staged: open the
  // releases page for a manual download; opening a URL is idempotent.
  ipcMain.handle('app-update:install', async () => {
    if (isAppImageInstall() && stagedUpdatePath) {
      logger.info('Installing AppImage update in place...')
      await installAppImageUpdate(stagedUpdatePath)
      stagedUpdatePath = null
      return { manual: false }
    }
    logger.info(`Opening releases page for manual download: ${RELEASES_URL}`)
    await shell.openExternal(RELEASES_URL)
    return { manual: true, url: RELEASES_URL }
  })
}

export { registerAppUpdateIpc }
