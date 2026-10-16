import { ipcMain, dialog, shell, type FileFilter, type IpcMainInvokeEvent } from 'electron'
import path from 'path'
import configStore from '../services/config-store'
import { isExecutableExt } from '../services/path-safety'
import type { SettingsKey } from './types'

// NOTE: several keys were removed after being confirmed unread across main +
// renderer: `language` (now `lang` via locale:set-preference), `theme`
// (superseded by `themeId`), `autoCheckUpdate`, `modSortOrder`,
// `modSortDirection`, and `lastTab`. Keeping the whitelist tight stops the
// renderer writing dead keys to the config file.
// Exported so unit tests can verify the whitelist directly without spinning
// up Electron / the IPC handler.
// NOTE: `gamePath` is intentionally NOT here. It is the trust anchor every
// filesystem path is built from (extraction roots, rm/rename targets, the
// shell:open-path allow-list) and it must only be written through the
// validating `game:set-path` handler, which confirms the folder is a real
// game install and rejects UNC/network paths. Allowing it via the generic
// `settings:set` would let a compromised renderer point the whole app at an
// arbitrary (or remote) directory. game.ts writes it via configStore directly.
export const ALLOWED_SETTINGS_KEYS: ReadonlySet<string> = new Set<SettingsKey>([
  'themeId', 'darkMode', 'minimizeToTray',
  'nexusApiKey', 'ue4ssVersion', 'windowState',
  'profiles', 'activeProfileId',
  'nexusInstalledMods',
  'skipInstallPreview',
  'uiZoom',
])

function registerSettingsIpc(): void {
  // Read-only and unrestricted, as before: the renderer passes setting names
  // (configStore.get resolves any other key to the default).
  ipcMain.handle('settings:get', (_: IpcMainInvokeEvent, key: unknown, defaultValue: unknown) => {
    return configStore.get(key as string, defaultValue)
  })

  ipcMain.handle('settings:set', (_: IpcMainInvokeEvent, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !ALLOWED_SETTINGS_KEYS.has(key)) {
      throw new Error(`Setting key not allowed: ${key}`)
    }
    configStore.set(key, value)
  })

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-files', async (_: IpcMainInvokeEvent, filters?: FileFilter[] | null) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters || [
        { name: 'Mod Files', extensions: ['zip', 'rar', '7z', 'pak'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('shell:open-external', (_: IpcMainInvokeEvent, url: unknown) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    } catch {
      return
    }
    shell.openExternal(url)
  })

  ipcMain.handle('shell:open-path', (_: IpcMainInvokeEvent, filePath: unknown) => {
    if (typeof filePath !== 'string') return

    // Restrict to game directory or app config directory
    const resolved = path.resolve(filePath)
    const gamePath = configStore.get('gamePath')
    const configDir = configStore.getConfigDir()
    const allowed = [gamePath, configDir].filter((p): p is string => Boolean(p)).map(p => path.resolve(p))
    const isAllowed = allowed.some(dir => resolved === dir || resolved.startsWith(dir + path.sep))
    if (!isAllowed) return

    // openPath uses the OS default association, which EXECUTES .exe/.bat/etc.
    // A malicious mod can drop such a file under the game dir, so reveal those
    // in the folder instead of running them. (Mirrors mods-config's open-path.)
    if (isExecutableExt(resolved)) {
      shell.showItemInFolder(resolved)
      return ''
    }
    // Returns an error string on failure, empty string on success.
    return shell.openPath(resolved)
  })
}

export { registerSettingsIpc }
