import { ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { detectGamePath, getPaksPath, getAllPaksPaths, getUe4ssModsPath, getGameVersion, getGameVersionCached, HUMANITZ_APP_ID } from '../services/steam-detector.js'
import configStore from '../services/config-store.js'
import { isGameRunning } from '../services/process-detector.js'
import { assertSafeSegment } from '../services/path-safety.js'
import { serializeModWrite } from './mods-install.js'
import { scanMods, invalidateCache } from './mods-scan.js'
import { syncUe4ssModRegistry } from './mods-registry.js'
import logger from '../services/logger.js'

// Shared launch core for game:launch and game:launch-vanilla. Always through
// Steam's URL protocol so Steam orchestrates Proton — no direct-exe fallback
// on Linux (a Windows .exe can't be bare-spawned without a Wine wrapper).
async function launchGame() {
  await shell.openExternal(`steam://rungameid/${HUMANITZ_APP_ID}`)
  logger.info('Game launch dispatched via Steam')
  return true
}

// --- Vanilla launch: disable everything, play clean, restore on exit ---

const VANILLA_RESTORE_KEY = 'vanillaLaunchRestore'
// While the game is NOT running, a pending restore is only applied after this
// grace period — a slow Steam bootstrap must not get its mods handed back
// mid-startup. The true→false exit transition restores immediately.
const VANILLA_RESTORE_GRACE_MS = 2 * 60 * 1000

// Disable every enabled mod directly on disk. No hybrid cascade needed — the
// scan list contains both halves of a pair, each disabled on its own. Injected
// paths keep both helpers unit-testable; per-mod failures are logged and
// skipped so one locked file can't abort the vanilla launch.
export function disableModsOnDisk({ paksPaths, ue4ssModsPath }, mods) {
  const disabled = []
  for (const mod of Array.isArray(mods) ? mods : []) {
    if (!mod || !mod.enabled || !mod.filename) continue
    try { assertSafeSegment('filename', mod.filename) } catch { continue }
    try {
      if (mod.type === 'PAK') {
        for (const pp of paksPaths || []) {
          const from = path.join(pp, mod.filename)
          if (!fs.existsSync(from)) continue
          fs.renameSync(from, `${from}.disabled`)
          disabled.push({ type: 'PAK', filename: mod.filename })
          break
        }
      } else if (mod.type === 'UE4SS' && ue4ssModsPath) {
        const enabledFile = path.join(ue4ssModsPath, mod.filename, 'enabled.txt')
        if (!fs.existsSync(enabledFile)) continue
        fs.unlinkSync(enabledFile)
        syncUe4ssModRegistry(ue4ssModsPath, mod.filename, false)
        disabled.push({ type: 'UE4SS', filename: mod.filename })
      }
    } catch (err) {
      logger.warn(`Vanilla launch: could not disable ${mod.filename}: ${err.message}`)
    }
  }
  return disabled
}

export function restoreModsOnDisk({ paksPaths, ue4ssModsPath }, entries) {
  let restored = 0
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !entry.filename) continue
    try { assertSafeSegment('filename', entry.filename) } catch { continue }
    try {
      if (entry.type === 'PAK') {
        for (const pp of paksPaths || []) {
          const from = path.join(pp, `${entry.filename}.disabled`)
          if (!fs.existsSync(from)) continue
          fs.renameSync(from, path.join(pp, entry.filename))
          restored++
          break
        }
      } else if (entry.type === 'UE4SS' && ue4ssModsPath) {
        const modDir = path.join(ue4ssModsPath, entry.filename)
        if (!fs.existsSync(modDir)) continue
        const enabledFile = path.join(modDir, 'enabled.txt')
        if (!fs.existsSync(enabledFile)) fs.writeFileSync(enabledFile, '', 'utf-8')
        syncUe4ssModRegistry(ue4ssModsPath, entry.filename, true)
        restored++
      }
    } catch (err) {
      logger.warn(`Vanilla restore: could not re-enable ${entry.filename}: ${err.message}`)
    }
  }
  return restored
}

// Re-enable a pending vanilla-launch set. Called from the running poller:
// immediately on the exit transition (force), and after the grace period
// otherwise (failed launch / app restarted while the set was pending).
let vanillaRestoreInFlight = false
function maybeRestoreVanilla(mainWindow, { force = false } = {}) {
  if (vanillaRestoreInFlight) return
  const pending = configStore.get(VANILLA_RESTORE_KEY, null)
  if (!pending || !Array.isArray(pending.entries) || pending.entries.length === 0) return
  if (!force && Date.now() - (pending.at || 0) < VANILLA_RESTORE_GRACE_MS) return
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return
  vanillaRestoreInFlight = true
  serializeModWrite(() => {
    const modPaths = { paksPaths: getAllPaksPaths(gamePath), ue4ssModsPath: getUe4ssModsPath(gamePath) }
    const restored = restoreModsOnDisk(modPaths, pending.entries)
    configStore.set(VANILLA_RESTORE_KEY, null)
    invalidateCache()
    logger.info(`Vanilla launch: restored ${restored} mods`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:vanilla-restored', { restored })
      mainWindow.webContents.send('mods:updated')
    }
  }).catch((err) => {
    logger.warn(`Vanilla restore failed: ${err.message}`)
  }).finally(() => {
    vanillaRestoreInFlight = false
  })
}

function registerGameIpc() {
  ipcMain.handle('game:detect-path', () => {
    // Check cache first
    const cached = configStore.get('gamePath')
    if (cached) {
      if (fs.existsSync(cached)) return cached
    }

    const detected = detectGamePath()
    if (detected) {
      configStore.set('gamePath', detected)
      logger.info(`Game path detected: ${detected}`)
    }
    return detected
  })

  ipcMain.handle('game:get-path', () => {
    return configStore.get('gamePath', null)
  })

  ipcMain.handle('game:set-path', (_, gamePath) => {
    if (!gamePath || !fs.existsSync(gamePath)) return { valid: false, reason: 'path-not-found' }

    // Readdir can throw on permission / transient filesystem errors — fold
    // those into a user-facing "not-game-folder" response instead of a
    // stack trace back to the renderer.
    const readSafe = (p) => { try { return fs.readdirSync(p) } catch { return null } }
    const entries = readSafe(gamePath)
    if (!entries) return { valid: false, reason: 'not-game-folder' }

    // Check if this is the game root (has exe) or user selected a subfolder
    const hasExe = entries.some(f => f.toLowerCase().endsWith('.exe') && !f.toLowerCase().includes('crash') && !f.toLowerCase().includes('unins'))
    const hasContentFolder = fs.existsSync(require('path').join(gamePath, 'HumanitZ', 'Content'))

    if (!hasExe && !hasContentFolder) {
      // Maybe they selected the parent or a wrong folder entirely
      // Try checking if HumanitZ is a subfolder
      const sub = require('path').join(gamePath, 'HumanitZ')
      const subEntries = readSafe(sub)
      if (subEntries && subEntries.some(f => f.toLowerCase().endsWith('.exe'))) {
        // They selected steamapps/common instead of the game folder
        return { valid: false, reason: 'select-subfolder', suggestion: sub }
      }
      return { valid: false, reason: 'not-game-folder' }
    }

    configStore.set('gamePath', gamePath)
    logger.info(`Game path set manually: ${gamePath}`)
    return { valid: true }
  })

  ipcMain.handle('game:get-paks-path', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    return getPaksPath(gamePath)
  })

  ipcMain.handle('game:get-version-cached', () => {
    return getGameVersionCached()
  })

  ipcMain.handle('game:get-version', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    return getGameVersion(gamePath)
  })

  ipcMain.handle('game:launch', async () => {
    // Always launch through Steam's URL protocol so Steam orchestrates Proton —
    // applies the user's per-game launch options (WINEDLLOVERRIDES etc.), wires
    // up the Wine prefix, and enables the Steam overlay. HumanitZ ships no
    // steam_appid.txt, so bypassing Steam leaves the Steam API uninitialised →
    // multiplayer host bind failure (Could not bind local address). Unlike the
    // Windows manager there is no direct-exe fallback: a Windows .exe can't be
    // bare-spawned on Linux without a Wine wrapper, and a non-Steam copy has no
    // Proton prefix to run through. Tradeoff: requires Steam installed + signed in.
    try {
      return await launchGame()
    } catch (err) {
      logger.error('Game launch failed: ' + err.message)
      throw err
    }
  })

  // Vanilla launch: disable every enabled mod, persist the restore list, then
  // launch. The restore fires from the game-running poller (exit transition or
  // grace-expired crash recovery) — see maybeRestoreVanilla above.
  ipcMain.handle('game:launch-vanilla', async () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) throw new Error('Game path not set')
    const modPaths = { paksPaths: getAllPaksPaths(gamePath), ue4ssModsPath: getUe4ssModsPath(gamePath) }
    const disabled = await serializeModWrite(() => {
      const entries = disableModsOnDisk(modPaths, scanMods())
      if (entries.length > 0) {
        configStore.set(VANILLA_RESTORE_KEY, { entries, at: Date.now() })
      }
      invalidateCache()
      return entries
    })
    await launchGame()
    return { ok: true, disabledCount: disabled.length }
  })

  ipcMain.handle('game:is-running', () => isGameRunning())
}

// Game-running detection lives in the main process. Node timers are NOT subject
// to the renderer's background throttling, which on Windows is unreliable while
// the window is hidden/minimized (electron#31016) — so renderer-side polling
// could miss the game exiting while HZMM sat in the tray and show a stale
// "running" state on reopen. We poll here, push only on change, and re-assert
// the current state on window 'show' so reopening from the tray is never stale.
//
// This is WINDOW-SCOPED and must be (re)started on every createWindow() — NOT
// folded into the one-time registerGameIpc() above — otherwise a window rebuilt
// from the tray gets a dead interval bound to the first (destroyed) window and
// game-running detection silently stops. Any prior interval is torn down first.
let runningTimer = null
let lastRunning = null

function startGameRunningPolling(mainWindow) {
  if (runningTimer) { clearInterval(runningTimer); runningTimer = null }
  lastRunning = null
  const pushRunning = async () => {
    if (mainWindow.isDestroyed()) return
    let running
    try { running = await isGameRunning() } catch { return }
    // Vanilla-launch restore: immediately on the true→false exit transition,
    // otherwise (steady idle / app start with a stale pending set) only after
    // the grace period. Checked BEFORE the no-change early return so the
    // steady-false state keeps retrying until the grace elapses.
    if (running === false) {
      maybeRestoreVanilla(mainWindow, { force: lastRunning === true })
    }
    if (running === lastRunning) return
    lastRunning = running
    mainWindow.webContents.send('game:running', running)
  }
  runningTimer = setInterval(pushRunning, 5000)
  pushRunning()
  mainWindow.on('show', () => {
    if (!mainWindow.isDestroyed() && lastRunning !== null) {
      mainWindow.webContents.send('game:running', lastRunning)
    }
  })
  mainWindow.on('closed', () => {
    if (runningTimer) { clearInterval(runningTimer); runningTimer = null }
  })
}

export { registerGameIpc, startGameRunningPolling }
