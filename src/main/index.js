import { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import windowStateKeeper from 'electron-window-state'

import { registerModsIpc } from './ipc/mods'
import { registerModsConfigIpc } from './ipc/mods-config'
import { registerModsProfilesIpc } from './ipc/mods-profiles'
import { registerModsReadmeIpc } from './ipc/mods-readme'
import { registerSavesIpc } from './ipc/saves'
import { registerUe4ssIpc } from './ipc/ue4ss'
import { registerGameIpc } from './ipc/game'
import { registerSettingsIpc } from './ipc/settings'
import { registerLocaleIpc } from './ipc/locale'
import { registerAppUpdateIpc } from './ipc/app-update'
import { registerConflictsIpc } from './ipc/conflicts'
import { registerNexusIpc } from './ipc/nexus'
import logger from './services/logger.js'
import configStore from './services/config-store.js'

const is = { dev: !app.isPackaged }

// Under WSL2/WSLg there is no usable hardware GPU surface — Chromium tries
// to launch a GPU process, fails repeatedly (error_code=1002), and then
// kills the whole app with "GPU process isn't usable. Goodbye." Forcing
// software rendering on Linux avoids the crash; native Linux desktops with
// real GPUs only lose acceleration (correctness unchanged).
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
}

let mainWindow
let tray = null
let ipcRegistered = false
let isQuitting = false

function registerAllIpc(mainWindow) {
  if (ipcRegistered) return
  ipcRegistered = true

  registerModsIpc(mainWindow)
  registerModsConfigIpc()
  registerModsProfilesIpc()
  registerModsReadmeIpc()
  registerSavesIpc(mainWindow)
  registerUe4ssIpc(mainWindow)
  registerGameIpc(mainWindow)
  registerSettingsIpc()
  registerLocaleIpc()
  registerAppUpdateIpc(mainWindow)
  registerConflictsIpc()
  registerNexusIpc(mainWindow)

  // Logger IPC
  ipcMain.handle('logger:get-path', () => logger.getPath())
  ipcMain.handle('logger:read-recent', () => logger.readRecent())

  // Title bar overlay theme
  ipcMain.handle('app:set-titlebar-theme', (_, isDark) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay({
        color: isDark ? '#02061700' : '#f8fafc00',
        symbolColor: isDark ? '#94a3b8' : '#6b7280',
      })
    }
  })

  // Tray IPC
  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })

  // Auto-start setting
  ipcMain.handle('app:get-auto-start', () => {
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('app:set-auto-start', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
  })

  // Custom window controls — Linux has no titleBarOverlay support, so the
  // renderer renders its own close/min/max buttons and proxies through IPC.
  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
  })
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  })
  ipcMain.handle('window:is-maximized', () => {
    return !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized())
  })

}

function createWindow() {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 800
  })

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 900,
    minHeight: 600,
    // show: true from the start so the HTML splash (rendered by index.html)
    // is visible the moment the window opens. Old behavior used
    // `show:false` + `ready-to-show`, but on Windows that event sometimes
    // fires *after* React has mounted and the 3s-minimum init finishes —
    // in which case App.jsx calls splash.remove() before the window is
    // ever shown, and the user sees zero splash. Pairing `show: true`
    // with a matching backgroundColor avoids the white flash that
    // originally motivated `show: false`.
    show: true,
    backgroundColor: '#020617',
    icon: is.dev
      ? join(__dirname, '../../resources/icon.png')
      : join(process.resourcesPath, 'icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#6b7280',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      navigateOnDragDrop: false
    }
  })

  mainWindowState.manage(mainWindow)

  // Force the window / taskbar / jump list to use the HZMM icon instead of electron's default
  const windowIconPath = is.dev
    ? join(__dirname, '../../resources/icon.png')
    : join(process.resourcesPath, 'icon.png')
  console.log('[icon] using:', windowIconPath)
  try {
    const img = nativeImage.createFromPath(windowIconPath)
    if (!img.isEmpty()) {
      mainWindow.setIcon(img)
    } else {
      console.warn('[icon] nativeImage is empty, path may be wrong')
    }
    // setAppDetails is Windows-only — on Linux/macOS the method doesn't
    // exist on BrowserWindow and calling it throws. Guarded so the catch
    // block stays meaningful for real errors instead of swallowing this.
    if (process.platform === 'win32') {
      mainWindow.setAppDetails({
        appId: 'com.hzmm.mod-manager',
        appIconPath: windowIconPath,
        relaunchDisplayName: 'HZMM Manager'
      })
    }
  } catch (err) {
    console.warn('[icon] set failed:', err.message)
  }

  // No ready-to-show / 5s fallback anymore — window shows immediately with
  // a matching splash-colored background, so the HTML splash is guaranteed
  // visible before React ever mounts.

  // 捕獲渲染器錯誤
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('Renderer crashed:', details.reason)
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Notify renderer of visibility changes
  mainWindow.on('hide', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:visibility', false)
    }
  })

  mainWindow.on('show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:visibility', true)
    }
  })

  // 關閉按鈕 → 根據設定決定最小化到系統匣或直接退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      const minimizeToTray = configStore.get('minimizeToTray', true)
      if (minimizeToTray) {
        e.preventDefault()
        mainWindow.hide()
      } else {
        isQuitting = true
      }
    }
  })

  // 防止拖放導航
  mainWindow.webContents.on('will-navigate', (e) => { e.preventDefault() })

  // Register all IPC handlers (guarded against duplicate registration)
  registerAllIpc(mainWindow)

  logger.info(`HZMM Manager started — version ${app.getVersion()}`)

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray() {
  const iconPath = is.dev
    ? join(__dirname, '../../resources/icon.png')
    : join(process.resourcesPath, 'icon.png')

  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('HZMM Manager')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '顯示 HZMM',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: '結束',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // 點擊匣圖標 → 顯示視窗（若已銷毀則重新建立）
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
}

// Prevent multiple HZMM instances from racing on the mod cache and config.
// If we're the second instance, surface the existing window and quit.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })

  app.whenReady().then(() => {
    // Ensure Windows taskbar / jump list uses the correct app identity and icon
    // (only matters in dev — packaged builds are handled by electron-builder)
    app.setAppUserModelId('com.hzmm.mod-manager')
    app.setName('HZMM Manager')

    // Re-register auto-start with current exe path (handles rename/move)
    if (app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true })
    }

    createTray()
    createWindow()
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // minimizeToTray 開啟時保留 tray，否則完全退出
  const minimizeToTray = configStore.get('minimizeToTray', true)
  if (!minimizeToTray) {
    app.quit()
  }
})
