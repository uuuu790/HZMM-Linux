import { ipcMain, app, shell } from 'electron'
import { checkForUpdate } from '../services/app-updater.js'
import logger from '../services/logger.js'

// Linux fork: there is NO auto-install. electron-builder ships an AppImage /
// deb that the user installs manually, so the Windows "download the new .exe,
// copy it over the running binary, relaunch" flow does not apply here. The
// app only DETECTS a new GitHub release and points the user at the releases
// page to download the new AppImage/deb themselves.
//
// The IPC channel names mirror Windows exactly so the shared renderer
// (useUpdateHandlers / SettingsTab) drives both platforms unchanged:
//   app-update:get-version  -> current version
//   app-update:check        -> detect a newer release (+ changelog)
//   app-update:download      -> advance the UI to its "ready" state (no binary
//                              is fetched on Linux — see below)
//   app-update:install       -> open the releases page for a MANUAL download
//   app-update:progress     -> download progress channel (unused on Linux)
const RELEASES_URL = 'https://github.com/uuuu790/HZMM/releases/latest'

function registerAppUpdateIpc(_mainWindow) {
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
  // On Linux this does NOT fetch a binary — there is nothing to auto-stage,
  // because the actual download is manual. It simply re-confirms an update
  // exists and resolves so the shared renderer advances to its "ready" state,
  // at which point the install action opens the releases page.
  ipcMain.handle('app-update:download', async () => {
    try {
      const release = await checkForUpdate()
      if (!release.hasUpdate) {
        throw new Error('No update available')
      }
      // No download-and-swap on Linux. Resolve with a null path to keep the
      // { filePath } return shape the renderer expects.
      return { filePath: null }
    } catch (err) {
      logger.error(`Update download failed: ${err.message}`)
      throw err
    }
  })

  // Manual-download path: open the GitHub releases page so the user can grab
  // the new AppImage/deb. Deliberately NOT an executable swap — no temp-file
  // copy, no PORTABLE_EXECUTABLE_FILE, no relaunch, no rollback (all of which
  // are Windows-portable-only). The channel name matches Windows so the shared
  // "Install" button works; the behavior is Linux's manual download. Upstream
  // v1.5.0's install-in-flight guard is not needed: opening a URL is idempotent.
  ipcMain.handle('app-update:install', async () => {
    logger.info(`Opening releases page for manual download: ${RELEASES_URL}`)
    await shell.openExternal(RELEASES_URL)
    return { manual: true, url: RELEASES_URL }
  })
}

export { registerAppUpdateIpc }
