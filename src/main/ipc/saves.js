import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'
import { isPathWithin, assertSafeSegment } from '../services/path-safety.js'

function getSavePath() {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return null
  const primary = path.join(localAppData, 'HumanitZ', 'Saved', 'SaveGames', 'SaveList', 'Default')
  if (fs.existsSync(primary)) return primary
  const fallback = path.join(localAppData, 'TSSGame', 'Saved', 'SaveGames')
  if (fs.existsSync(fallback)) return fallback
  return null
}

function registerSavesIpc(_mainWindow) {
  ipcMain.handle('saves:list-worlds', () => {
    const savePath = getSavePath()
    if (!savePath) return []
    let files
    try { files = fs.readdirSync(savePath) } catch { return [] }
    const globalFiles = new Set(['CC_Presets.sav', 'LocalGlobal.sav', 'SaveCache.sav', 'DedSave_ResGlobal.sav', 'SavedSettings.sav', 'steam_autocloud.vdf', 'Save_ClanData.sav'])
    const worldNames = new Set()
    for (const file of files) {
      if (globalFiles.has(file) || file.startsWith('Minimap') || !file.endsWith('.sav')) continue
      const match = file.match(/^Save_(.+)\.sav$/)
      if (match) worldNames.add(match[1])
    }
    return Array.from(worldNames).map(name => {
      const mainFile = path.join(savePath, `Save_${name}.sav`)
      const charFile = path.join(savePath, `${name}_CharPreview.sav`)
      const foliageFile = path.join(savePath, `${name}_Foliage.sav`)
      const fileList = []
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
    }).sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
  })

  ipcMain.handle('saves:backup', (_, worldNames) => {
    if (!worldNames || worldNames.length === 0) throw new Error('No worlds selected')
    const savePath = getSavePath()
    if (!savePath) throw new Error('Save path not found')
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(backupDir, `save_backup_${timestamp}`)
    fs.mkdirSync(backupPath, { recursive: true })
    const worldsDir = path.join(backupPath, 'worlds')
    fs.mkdirSync(worldsDir, { recursive: true })
    const worlds = []
    let totalSize = 0
    for (const name of worldNames) {
      assertSafeSegment('worldName', name)
      const worldDir = path.join(worldsDir, name)
      fs.mkdirSync(worldDir, { recursive: true })
      const filesToCopy = [`Save_${name}.sav`, `${name}_CharPreview.sav`, `${name}_Foliage.sav`]
      const copied = []
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

  ipcMain.handle('saves:list-backups', () => {
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    if (!fs.existsSync(backupDir)) return []
    return fs.readdirSync(backupDir)
      .filter(d => d.startsWith('save_backup_') || d.startsWith('mods_backup_'))
      .map(d => {
        const bp = path.join(backupDir, d)
        try { if (!fs.statSync(bp).isDirectory()) return null } catch { return null }
        const isLegacy = d.startsWith('mods_backup_')
        let info = { name: d, path: bp, timestamp: d.replace(/^(save|mods)_backup_/, ''), legacy: isLegacy }
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(bp, 'backup.json'), 'utf-8'))
          info = { ...info, ...meta }
        } catch { /* missing/corrupt backup.json — use dirname-derived defaults */ }
        return info
      })
      .filter(Boolean)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  })

  ipcMain.handle('saves:restore-backup', (_, backupPath) => {
    const savePath = getSavePath()
    if (!savePath) throw new Error('Save path not found')
    const backupDir = path.join(configStore.getConfigDir(), 'backups')
    const resolved = path.resolve(backupPath)
    if (!isPathWithin(backupDir, resolved)) throw new Error('Invalid backup path')
    let meta = {}
    try { meta = JSON.parse(fs.readFileSync(path.join(backupPath, 'backup.json'), 'utf-8')) } catch { /* meta optional */ }
    const worldsDir = path.join(backupPath, 'worlds')
    if (!fs.existsSync(worldsDir)) throw new Error('No worlds directory in backup')
    const restoredWorlds = []
    for (const worldName of fs.readdirSync(worldsDir)) {
      // worldName / file come from disk but the backup folder is
      // user-modifiable. Validate as flat segments before joining into
      // savePath so a hand-edited backup can't write outside the save dir.
      try { assertSafeSegment('worldName', worldName) } catch { continue }
      const worldDir = path.join(worldsDir, worldName)
      if (!fs.statSync(worldDir).isDirectory()) continue
      for (const file of fs.readdirSync(worldDir)) {
        try { assertSafeSegment('file', file) } catch { continue }
        fs.copyFileSync(path.join(worldDir, file), path.join(savePath, file))
      }
      restoredWorlds.push(worldName)
    }
    logger.info(`Save backup restored: ${backupPath} (${restoredWorlds.length} worlds)`)
    return { restored: true, worlds: restoredWorlds, mods: meta.mods || [] }
  })

  ipcMain.handle('saves:delete-backup', (_, backupPath) => {
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
