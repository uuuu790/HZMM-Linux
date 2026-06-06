import { ipcMain, dialog, shell } from 'electron'
import path from 'path'
import configStore from '../services/config-store.js'

// NOTE: `language` was previously here but never read — language preference
// is stored under `lang` via locale:set-preference. Removed to prevent
// renderers from writing a dead key.
// Exported so unit tests can verify the whitelist directly without spinning
// up Electron / the IPC handler.
export const ALLOWED_SETTINGS_KEYS = new Set([
  'gamePath', 'theme', 'themeId', 'darkMode', 'minimizeToTray',
  'nexusApiKey', 'ue4ssVersion', 'autoCheckUpdate',
  'modSortOrder', 'modSortDirection', 'lastTab', 'windowState',
  'profiles', 'activeProfileId',
  'nexusInstalledMods',
  'skipInstallPreview',
])

function registerSettingsIpc() {
  ipcMain.handle('settings:get', (_, key, defaultValue) => {
    return configStore.get(key, defaultValue)
  })

  ipcMain.handle('settings:set', (_, key, value) => {
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      throw new Error(`Setting key not allowed: ${key}`)
    }
    configStore.set(key, value)
  })

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-files', async (_, filters) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters || [
        { name: 'Mod Files', extensions: ['zip', 'rar', 'pak'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('shell:open-external', (_, url) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    } catch {
      return
    }
    shell.openExternal(url)
  })

  ipcMain.handle('shell:open-path', (_, filePath) => {
    if (typeof filePath !== 'string') return

    // Restrict to game directory or app config directory
    const resolved = path.resolve(filePath)
    const gamePath = configStore.get('gamePath')
    const configDir = configStore.getConfigDir()
    const allowed = [gamePath, configDir].filter(Boolean).map(p => path.resolve(p))
    const isAllowed = allowed.some(dir => resolved === dir || resolved.startsWith(dir + path.sep))
    if (!isAllowed) return

    // Use OS default association instead of hardcoding notepad.exe.
    // Returns an error string on failure, empty string on success.
    return shell.openPath(resolved)
  })
}

export { registerSettingsIpc }
