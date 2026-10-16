import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store'
import logger from '../services/logger'
import { isPathWithin, assertSafeSegment } from '../services/path-safety'
import { getProtonPrefix } from '../services/steam-detector'
import type { BackupInfo, SaveFileInfo, WorldBackup } from './types'

// The Windows build keeps saves under %LOCALAPPDATA%. On Linux the game runs
// through Proton, so that same tree lives inside the game's Wine prefix at
// drive_c/users/steamuser/AppData/Local. LOCALAPPDATA is still probed first
// for the (unusual) case of the manager itself running under Wine.
function getSaveRoots(): string[] {
  const roots: string[] = []
  if (process.env.LOCALAPPDATA) roots.push(process.env.LOCALAPPDATA)
  const prefix = getProtonPrefix()
  if (prefix) {
    roots.push(path.join(prefix, 'drive_c', 'users', 'steamuser', 'AppData', 'Local'))
  }
  return roots
}

function getSavePath(): string | null {
  for (const root of getSaveRoots()) {
    const primary = path.join(root, 'HumanitZ', 'Saved', 'SaveGames', 'SaveList', 'Default')
    if (fs.existsSync(primary)) return primary
    const fallback = path.join(root, 'TSSGame', 'Saved', 'SaveGames')
    if (fs.existsSync(fallback)) return fallback
  }
  return null
}

// Non-world save files that must never be treated as world names.
const GLOBAL_SAVE_FILES = new Set(['CC_Presets.sav', 'LocalGlobal.sav', 'SaveCache.sav', 'DedSave_ResGlobal.sav', 'SavedSettings.sav', 'steam_autocloud.vdf', 'Save_ClanData.sav'])

// Keep only the newest `keep` auto-backups (dir names sort chronologically —
// ISO timestamps). Manual backups are untouched. Exported for unit tests.
export function pruneAutoBackups(backupDir: string, keep = 5): number {
  let dirs: string[] = []
  try { dirs = fs.readdirSync(backupDir).filter(d => d.startsWith('save_backup_auto_')) } catch { return 0 }
  dirs.sort((a, b) => b.localeCompare(a))
  let pruned = 0
  for (const d of dirs.slice(keep)) {
    try {
      fs.rmSync(path.join(backupDir, d), { recursive: true, force: true })
      pruned++
    } catch (err) {
      logger.warn(`Auto-backup prune failed for ${d}: ${(err as Error).message}`)
    }
  }
  return pruned
}

function registerSavesIpc(_mainWindow?: BrowserWindow | null): void {
  ipcMain.handle('saves:list-worlds', () => {
    const savePath = getSavePath()
    if (!savePath) return []
    let files: string[]
    try { files = fs.readdirSync(savePath) } catch { return [] }
    const worldNames = new Set<string>()
    for (const file of files) {
      if (GLOBAL_SAVE_FILES.has(file) || file.startsWith('Minimap') || !file.endsWith('.sav')) continue
      const match = file.match(/^Save_(.+)\.sav$/)
      if (match) worldNames.add(match[1])
    }
    return Array.from(worldNames).map(name => {
      const mainFile = path.join(savePath, `Save_${name}.sav`)
      const charFile = path.join(savePath, `${name}_CharPreview.sav`)
      const foliageFile = path.join(savePath, `${name}_Foliage.sav`)
      const fileList: SaveFileInfo[] = []
      let totalSize = 0
      let lastModified = 0
      for (const fp of [mainFile, charFile, foliageFile]) {
        try {
          const stat = fs.statSync(fp)
          fileList.push({ filename: path.basename(fp), size: stat.size })
          totalSize += stat.size
          if (stat.mtimeMs > lastModified) lastModified = stat.mtimeMs
        } catch { /* save file missing — skip */ }
      }
      return { name, files: fileList, totalSize, lastModified: new Date(lastModified).toISOString() }
    }).sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
  })

  ipcMain.handle('saves:backup', (_: IpcMainInvokeEvent, worldNames: unknown) => {
    if (!Array.isArray(worldNames) || worldNames.length === 0) throw new Error('No worlds selected')
    // Validate every name up front, before creating any directory — otherwise a
    // malformed entry throws mid-loop and leaves an orphaned empty backup dir
    // that then shows up in saves:list-backups.
    for (const name of worldNames) assertSafeSegment('worldName', name)
    const savePath = getSavePath()
    if (!savePath) throw new Error('Save path not found')
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(backupDir, `save_backup_${timestamp}`)
    fs.mkdirSync(backupPath, { recursive: true })
    const worldsDir = path.join(backupPath, 'worlds')
    fs.mkdirSync(worldsDir, { recursive: true })
    const worlds: WorldBackup[] = []
    let totalSize = 0
    for (const name of worldNames as string[]) { // every entry passed assertSafeSegment above
      const worldDir = path.join(worldsDir, name)
      fs.mkdirSync(worldDir, { recursive: true })
      const filesToCopy = [`Save_${name}.sav`, `${name}_CharPreview.sav`, `${name}_Foliage.sav`]
      const copied: SaveFileInfo[] = []
      for (const file of filesToCopy) {
        const src = path.join(savePath, file)
        if (fs.existsSync(src)) {
          const stat = fs.statSync(src)
          fs.copyFileSync(src, path.join(worldDir, file))
          copied.push({ filename: file, size: stat.size })
          totalSize += stat.size
        }
      }
      worlds.push({ name, files: copied })
    }
    const meta = { type: 'save_backup', version: 1, timestamp, date: new Date().toISOString(), savePath, worlds, totalSize }
    fs.writeFileSync(path.join(backupPath, 'backup.json'), JSON.stringify(meta, null, 2))
    logger.info(`Save backup created: ${backupPath} (${worlds.length} worlds, ${totalSize} bytes)`)
    return { path: backupPath, timestamp, worlds, totalSize }
  })

  // Silent safety net fired before a profile apply. Backs up every world with
  // an `auto_` dir marker and keeps only the newest 5 so they can't pile up.
  // Best-effort by contract: callers fire-and-forget; a miss must never block
  // the apply, so "nothing to back up" returns a skipped marker, not a throw.
  ipcMain.handle('saves:auto-backup', () => {
    const savePath = getSavePath()
    if (!savePath) return { skipped: true, reason: 'no-save-path' }
    let files: string[] = []
    try { files = fs.readdirSync(savePath) } catch { return { skipped: true, reason: 'unreadable' } }
    const worldNames: string[] = []
    for (const file of files) {
      if (GLOBAL_SAVE_FILES.has(file) || file.startsWith('Minimap')) continue
      const match = file.match(/^Save_(.+)\.sav$/)
      if (!match) continue
      try { assertSafeSegment('worldName', match[1]) } catch { continue }
      worldNames.push(match[1])
    }
    if (worldNames.length === 0) return { skipped: true, reason: 'no-worlds' }

    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(backupDir, `save_backup_auto_${timestamp}`)
    const worldsDir = path.join(backupPath, 'worlds')
    fs.mkdirSync(worldsDir, { recursive: true })
    const worlds: WorldBackup[] = []
    let totalSize = 0
    for (const name of worldNames) {
      const worldDir = path.join(worldsDir, name)
      fs.mkdirSync(worldDir, { recursive: true })
      const copied: SaveFileInfo[] = []
      for (const file of [`Save_${name}.sav`, `${name}_CharPreview.sav`, `${name}_Foliage.sav`]) {
        const src = path.join(savePath, file)
        if (!fs.existsSync(src)) continue
        const stat = fs.statSync(src)
        fs.copyFileSync(src, path.join(worldDir, file))
        copied.push({ filename: file, size: stat.size })
        totalSize += stat.size
      }
      worlds.push({ name, files: copied })
    }
    const meta = { type: 'save_backup', version: 1, auto: true, timestamp, date: new Date().toISOString(), savePath, worlds, totalSize }
    fs.writeFileSync(path.join(backupPath, 'backup.json'), JSON.stringify(meta, null, 2))
    pruneAutoBackups(backupDir, 5)
    logger.info(`Auto save backup created: ${backupPath} (${worlds.length} worlds, ${totalSize} bytes)`)
    return { path: backupPath, timestamp, worlds: worlds.length, totalSize }
  })

  ipcMain.handle('saves:list-backups', () => {
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    if (!fs.existsSync(backupDir)) return []
    // readdir can throw (EACCES, or the dir replaced mid-read). This handler is
    // awaited by the renderer's startup init() Promise.all, so an unhandled throw
    // would leave the splash screen up forever — degrade to "no backups" instead.
    let names: string[]
    try { names = fs.readdirSync(backupDir) } catch (err) { logger.warn(`Failed to read backups dir: ${(err as Error).message}`); return [] }
    return names
      .filter(d => d.startsWith('save_backup_') || d.startsWith('mods_backup_'))
      .map((d): BackupInfo | null => {
        const bp = path.join(backupDir, d)
        try { if (!fs.statSync(bp).isDirectory()) return null } catch { return null }
        const isLegacy = d.startsWith('mods_backup_')
        let info: BackupInfo = { name: d, path: bp, timestamp: d.replace(/^(save|mods)_backup_/, ''), legacy: isLegacy }
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(bp, 'backup.json'), 'utf-8'))
          info = { ...info, ...meta }
        } catch { /* missing/corrupt backup.json — use dirname-derived defaults */ }
        return info
      })
      .filter((info): info is BackupInfo => Boolean(info))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  })

  // backupPath: a path the renderer got from saves:list-backups; checked to
  // stay inside the backups dir before anything is read.
  ipcMain.handle('saves:restore-backup', (_: IpcMainInvokeEvent, backupPath: string) => {
    const savePath = getSavePath()
    if (!savePath) throw new Error('Save path not found')
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    const resolved = path.resolve(backupPath)
    if (!isPathWithin(backupDir, resolved)) throw new Error('Invalid backup path')
    let meta: { mods?: unknown[] } = {}
    try { meta = JSON.parse(fs.readFileSync(path.join(backupPath, 'backup.json'), 'utf-8')) } catch { /* meta optional */ }
    const worldsDir = path.join(backupPath, 'worlds')
    if (!fs.existsSync(worldsDir)) throw new Error('No worlds directory in backup')
    const restoredWorlds: string[] = []
    for (const worldName of fs.readdirSync(worldsDir)) {
      // worldName / file come from disk but the backup folder is
      // user-modifiable. Validate as flat segments before joining into
      // savePath so a hand-edited backup can't write outside the save dir.
      try { assertSafeSegment('worldName', worldName) } catch { continue }
      const worldDir = path.join(worldsDir, worldName)
      if (!fs.statSync(worldDir).isDirectory()) continue
      for (const file of fs.readdirSync(worldDir)) {
        try { assertSafeSegment('file', file) } catch { continue }
        // Atomic restore: copy to a temp file then rename onto the live save, so
        // a process kill mid-copy can't leave the existing save truncated/corrupt.
        const dest = path.join(savePath, file)
        const tmp = `${dest}.tmp`
        fs.copyFileSync(path.join(worldDir, file), tmp)
        fs.renameSync(tmp, dest)
      }
      restoredWorlds.push(worldName)
    }
    logger.info(`Save backup restored: ${backupPath} (${restoredWorlds.length} worlds)`)
    return { restored: true, worlds: restoredWorlds, mods: meta.mods || [] }
  })

  ipcMain.handle('saves:delete-backup', (_: IpcMainInvokeEvent, backupPath: string) => {
    if (!backupPath || !fs.existsSync(backupPath)) return false
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    const resolved = path.resolve(backupPath)
    if (!isPathWithin(backupDir, resolved)) return false
    fs.rmSync(resolved, { recursive: true, force: true })
    logger.info(`Backup deleted: ${backupPath}`)
    return true
  })
}

export { registerSavesIpc }
