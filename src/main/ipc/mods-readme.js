// Mod README lookup IPC. Handles:
//   - PAK mods: reads from the `readmes/` store populated at install time
//     (PAK archives are unpacked into the game folder, so the original
//      readme file is no longer reachable after install)
//   - UE4SS mods: reads directly from the mod folder (preferring
//     language-specific variants like README.zh-TW.md)
//   - Falls back to the `readmes/` store for UE4SS mods whose folder was
//     renamed / removed
//
// Split out of mods.js as part of the 651-line refactor.

import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getUe4ssModsPath } from '../services/steam-detector.js'
import { assertSafeSegment } from '../services/path-safety.js'
import { normalizeReadme } from '../services/readme-utils.js'

export function registerModsReadmeIpc() {
  ipcMain.handle('mods:get-readme', (_, modFilename, lang) => {
    assertSafeSegment('modFilename', modFilename)
    if (lang != null && typeof lang !== 'string') return null
    if (typeof lang === 'string' && /[\\/\0]/.test(lang)) return null
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return null
    const isPakMod = modFilename.endsWith('.pak') || modFilename.endsWith('.pak.disabled')
    // Language-specific readmes first (e.g. README.zh-TW.md), then fallback to default
    const baseNames = ['README', 'readme', 'DESCRIPTION', 'description', 'INFO', 'info']
    const exts = ['.md', '.txt', '']
    const readmeNames = []
    if (lang) {
      for (const b of baseNames) for (const e of exts) readmeNames.push(`${b}.${lang}${e}`)
    }
    for (const b of baseNames) for (const e of exts) readmeNames.push(`${b}${e}`)

    if (isPakMod) {
      // PAK mod: check saved readmes from install time
      const modName = modFilename.replace(/\.(pak|pak\.disabled)$/i, '').replace(/_P$/, '')
      const readmesDir = path.join(configStore.getConfigDir(), 'readmes')
      const readmePath = path.join(readmesDir, `${modName}.txt`)
      if (fs.existsSync(readmePath)) {
        try { return { filename: 'README.txt', content: normalizeReadme(fs.readFileSync(readmePath, 'utf-8')) } } catch { return null }
      }
      return null
    }

    // UE4SS mod: check readme in mod folder first, then fallback to saved readmes
    const ue4ssModsPath = getUe4ssModsPath(gamePath)
    if (ue4ssModsPath) {
      const modDir = path.join(ue4ssModsPath, modFilename)
      if (fs.existsSync(modDir)) {
        // Match candidates against the ACTUAL directory listing, case-
        // insensitively: probing fixed-case names (README/readme) finds
        // `Readme.txt` on Windows' fs but misses it on Linux.
        const actualByLower = new Map()
        try {
          for (const f of fs.readdirSync(modDir)) actualByLower.set(f.toLowerCase(), f)
        } catch { /* unreadable dir — fall through to saved readmes */ }
        for (const name of readmeNames) {
          const actual = actualByLower.get(name.toLowerCase())
          if (!actual) continue
          const readmePath = path.join(modDir, actual)
          try { return { filename: actual, content: normalizeReadme(fs.readFileSync(readmePath, 'utf-8')) } } catch { /* fall through */ }
        }
      }
    }
    // Fallback: check saved readmes from install time
    const savedReadme = path.join(configStore.getConfigDir(), 'readmes', `${modFilename}.txt`)
    if (fs.existsSync(savedReadme)) {
      try { return { filename: 'README.txt', content: normalizeReadme(fs.readFileSync(savedReadme, 'utf-8')) } } catch { return null }
    }
    return null
  })
}
