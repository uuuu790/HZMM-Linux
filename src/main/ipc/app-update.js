import { ipcMain, app } from 'electron'
import { spawn } from 'child_process'
import { checkForUpdate, downloadUpdate } from '../services/app-updater.js'
import configStore from '../services/config-store.js'
import path from 'path'
import fs from 'fs'
import logger from '../services/logger.js'

// Characters that break batch-script quoting or line structure.
// Double-quote and single-quote would terminate the surrounding "..."
// CR / LF would inject new batch lines.
// % and ! are variable-expansion sigils.
// & | < > ^ are shell metacharacters.
// Null byte would truncate the string in native APIs.
const UNSAFE_BATCH_PATH_CHARS = /[%!^&|<>"'\r\n\0]/

export function assertSafeBatchPath(label, value) {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label}: path must be a non-empty string`)
  }
  if (UNSAFE_BATCH_PATH_CHARS.test(value)) {
    throw new Error(`${label}: path contains characters unsafe for batch execution`)
  }
  if (!path.isAbsolute(value)) {
    throw new Error(`${label}: path must be absolute`)
  }
}

// Pure function — easy to unit test. Throws on any unsafe input.
export function generateUpdaterBatch(newExePath, currentExePath) {
  assertSafeBatchPath('newExePath', newExePath)
  assertSafeBatchPath('currentExePath', currentExePath)

  // Copy may fail with "file in use" when Windows Defender / slow shutdown
  // keeps the exe locked past the initial 2s delay. Retry up to 10 times
  // with a 1s pause between attempts before giving up.
  return [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    'set /a tries=0',
    ':retry',
    `copy /y "${newExePath}" "${currentExePath}" >nul`,
    'if errorlevel 1 (',
    '  set /a tries+=1',
    '  if %tries% geq 10 (',
    '    echo Update copy failed after 10 retries >&2',
    '    exit /b 1',
    '  )',
    '  timeout /t 1 /nobreak >nul',
    '  goto retry',
    ')',
    `del /f "${newExePath}" >nul 2>&1`,
    `start "" "${currentExePath}"`,
    `del /f "%~f0" >nul 2>&1`,
  ].join('\r\n')
}

function registerAppUpdateIpc(mainWindow) {
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

  // Bug 9 fix: accept downloadUrl from frontend to avoid redundant checkForUpdate call
  // Security: URL is validated against allowed hosts, SHA256 verified if available
  ipcMain.handle('app-update:download', async (_, downloadUrl, expectedHash) => {
    try {
      if (!downloadUrl) {
        throw new Error('No download URL provided')
      }

      const filePath = await downloadUpdate(downloadUrl, expectedHash || null, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-update:progress', progress)
        }
      })

      return { filePath }
    } catch (err) {
      logger.error(`Update download failed: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle('app-update:install', () => {
    const newExePath = path.join(configStore.getConfigDir(), 'hzmm-update.exe')
    if (!fs.existsSync(newExePath)) {
      throw new Error('Update file not found. Please download first.')
    }

    const currentExePath = app.getPath('exe')
    const batPath = path.join(configStore.getConfigDir(), 'updater.bat')

    // Preflight: writable target, unsafe-char validation done inside generateUpdaterBatch
    try {
      fs.accessSync(currentExePath, fs.constants.W_OK)
    } catch (err) {
      throw new Error(`Cannot write to current executable: ${err.message}`)
    }

    const batContent = generateUpdaterBatch(newExePath, currentExePath)

    fs.writeFileSync(batPath, batContent, 'utf-8')
    logger.info(`Update script created: ${batPath}`)
    logger.info(`Replacing: ${currentExePath}`)

    const child = spawn('cmd', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.on('error', (err) => {
      logger.error(`Failed to start updater: ${err.message}`)
    })

    child.unref()

    setTimeout(() => {
      app.quit()
    }, 500)
  })
}

export { registerAppUpdateIpc }
