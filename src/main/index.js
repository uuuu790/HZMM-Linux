import { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage, screen } from 'electron'
import { join } from 'path'
import fs from 'fs'
import windowStateKeeper from 'electron-window-state'

import { registerModsIpc } from './ipc/mods'
import { registerModsConfigIpc } from './ipc/mods-config'
import { registerModsProfilesIpc } from './ipc/mods-profiles'
import { registerModsReadmeIpc } from './ipc/mods-readme'
import { registerSavesIpc } from './ipc/saves'
import { registerUe4ssIpc } from './ipc/ue4ss'
import { registerGameIpc, startGameRunningPolling } from './ipc/game'
import { registerSettingsIpc } from './ipc/settings'
import { registerLocaleIpc } from './ipc/locale'
import { registerAppUpdateIpc } from './ipc/app-update'
import { registerConflictsIpc } from './ipc/conflicts'
import { registerNexusIpc } from './ipc/nexus'
import { registerSteamWorkshopIpc } from './ipc/steam-workshop-ipc'
import { cleanupStaleDownloadTemp } from './ipc/mods-download'
import { cleanupStaleRollback } from './ipc/mods-install'
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

// Single source of truth for the app icon path (dev vs packaged resource
// layout). Linux ships a .png instead of the Windows .ico.
const ICON_PATH = is.dev
  ? join(__dirname, '../../resources/icon.png')
  : join(process.resourcesPath, 'icon.png')

// XDG autostart entry (~/.config/autostart/<name>.desktop). Electron's
// loginItemSettings API doesn't exist on Linux, so start-on-boot is
// implemented per freedesktop convention. AppImage runs must point Exec at
// the .AppImage itself ($APPIMAGE), not the extracted inner binary in the
// throwaway mount point.
const AUTOSTART_DESKTOP = join(app.getPath('appData'), 'autostart', 'hzmm-manager.desktop')

function getLinuxAutoStart() {
  try {
    return fs.existsSync(AUTOSTART_DESKTOP)
  } catch {
    return false
  }
}

function setLinuxAutoStart(enabled) {
  try {
    if (!enabled) {
      if (fs.existsSync(AUTOSTART_DESKTOP)) fs.unlinkSync(AUTOSTART_DESKTOP)
      return
    }
    const execPath = process.env.APPIMAGE || process.execPath
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=HZMM Manager',
      `Exec="${execPath.replace(/"/g, '\\"')}"`,
      `Icon=${ICON_PATH}`,
      'X-GNOME-Autostart-enabled=true',
      'Comment=HumanitZ Mod Manager',
      '',
    ].join('\n')
    fs.mkdirSync(join(app.getPath('appData'), 'autostart'), { recursive: true })
    fs.writeFileSync(AUTOSTART_DESKTOP, entry, 'utf-8')
  } catch (err) {
    logger.warn(`Failed to update autostart entry: ${err.message}`)
  }
}

let mainWindow
let tray = null
let ipcRegistered = false
let isQuitting = false

// NOTE: the parameter deliberately does NOT shadow the module-level
// `mainWindow`. registerAllIpc runs once (guarded below), so every closure it
// creates lives for the whole app; the inline handlers reference the
// module-level variable, which createWindow() reassigns — a window rebuilt
// from the tray / second-instance path keeps working window controls instead
// of silently no-op'ing against the first (destroyed) window.
function registerAllIpc(win) {
  if (ipcRegistered) return
  ipcRegistered = true

  registerModsIpc(win)
  registerModsConfigIpc()
  registerModsProfilesIpc()
  registerModsReadmeIpc()
  registerSavesIpc(win)
  registerUe4ssIpc(win)
  registerGameIpc()
  registerSettingsIpc()
  registerLocaleIpc()
  registerAppUpdateIpc(win)
  registerConflictsIpc()
  registerNexusIpc(win)
  registerSteamWorkshopIpc()

  // Logger IPC
  ipcMain.handle('logger:get-path', () => logger.getPath())
  ipcMain.handle('logger:read-recent', () => logger.readRecent())

  // Title bar overlay theme
  ipcMain.handle('app:set-titlebar-theme', (_, isDark) => {
    const dark = isDark === true
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitleBarOverlay({
        color: dark ? '#02061700' : '#f8fafc00',
        symbolColor: dark ? '#94a3b8' : '#6b7280',
      })
    }
  })

  // Tray IPC
  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })

  // Auto-start setting. Electron's get/setLoginItemSettings are implemented
  // on Windows/macOS only — on Linux they are silent no-ops, which left the
  // toggle doing nothing and snapping back off on restart. Linux uses the XDG
  // autostart convention instead: a .desktop file in ~/.config/autostart.
  ipcMain.handle('app:get-auto-start', () => {
    if (process.platform === 'linux') return getLinuxAutoStart()
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('app:set-auto-start', (_, enabled) => {
    // Coerce to a real boolean — the renderer is the trust boundary, and the
    // sibling app:set-titlebar-theme handler applies the same `=== true` guard.
    if (process.platform === 'linux') {
      setLinuxAutoStart(enabled === true)
      return
    }
    app.setLoginItemSettings({ openAtLogin: enabled === true })
  })

  // Grow the window just enough to fit the zoomed content, clamped to the
  // screen work area. Grow-only: the renderer calls this after a zoom change
  // when its content area overflows horizontally; we never shrink the window
  // (the user can do that manually). Skipped while maximized/fullscreen.
  ipcMain.handle('ui:fit-window', (_e, neededContentWidth) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (typeof neededContentWidth !== 'number' || !Number.isFinite(neededContentWidth)) return
    if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return
    const { workArea } = screen.getDisplayMatching(mainWindow.getBounds())
    const [curW, curH] = mainWindow.getContentSize()
    const target = Math.min(Math.max(curW, Math.ceil(neededContentWidth)), workArea.width)
    if (target <= curW + 1) return
    mainWindow.setContentSize(target, curH)
    // If widening pushed the window past the right edge, nudge it back in.
    const b = mainWindow.getBounds()
    if (b.x + b.width > workArea.x + workArea.width) {
      mainWindow.setPosition(Math.max(workArea.x, workArea.x + workArea.width - b.width), b.y)
    }
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
    icon: ICON_PATH,
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
  const windowIconPath = ICON_PATH
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

  // 捕獲渲染器錯誤 — persist to the file logger so they survive in packaged
  // builds (no attached console) and surface in the in-app log viewer.
  mainWindow.webContents.on('render-process-gone', (_, details) => {
    logger.error(`Renderer crashed: ${details.reason} (exitCode ${details.exitCode})`)
  })

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    logger.error(`Failed to load renderer: ${errorCode} ${errorDescription}`)
  })

  // Apply the saved UI zoom once the renderer has loaded (avoids a flash).
  mainWindow.webContents.on('did-finish-load', () => {
    const z = Number(configStore.get('uiZoom', 1))
    if (Number.isFinite(z) && z > 0) mainWindow.webContents.setZoomFactor(z)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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

  // Game-running polling is window-scoped — (re)start it on every createWindow
  // so a window rebuilt from the tray keeps receiving updates (registerAllIpc is
  // one-time-guarded and won't re-bind it).
  startGameRunningPolling(mainWindow)

  logger.info(`HZMM Manager started — version ${app.getVersion()}`)

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON_PATH))
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
    if (process.platform === 'linux') {
      if (getLinuxAutoStart()) setLinuxAutoStart(true)
    } else if (app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true })
    }

    // Sweep orphaned temp/rollback dirs left by a prior crash or hard-kill so
    // partial downloads and abandoned rollback backups don't accumulate.
    cleanupStaleDownloadTemp()
    cleanupStaleRollback()

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
