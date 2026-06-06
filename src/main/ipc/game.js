import { ipcMain, shell } from 'electron'
import fs from 'fs'
import { detectGamePath, getPaksPath, getGameVersion, getGameVersionCached, HUMANITZ_APP_ID } from '../services/steam-detector.js'
import configStore from '../services/config-store.js'
import { isGameRunning } from '../services/process-detector.js'
import logger from '../services/logger.js'

function registerGameIpc(_mainWindow) {
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
      await shell.openExternal(`steam://rungameid/${HUMANITZ_APP_ID}`)
      logger.info('Game launch dispatched via Steam')
      return true
    } catch (err) {
      logger.error('Game launch failed: ' + err.message)
      throw err
    }
  })

  ipcMain.handle('game:is-running', () => isGameRunning())
}

export { registerGameIpc }
