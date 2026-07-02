import fs from 'fs'
import path from 'path'
import logger from '../services/logger.js'

// Sync mods.txt and mods.json with mod enabled state
function syncUe4ssModRegistry(ue4ssModsPath, modName, enabled) {
  // --- mods.txt ---
  const modsTxtPath = path.join(ue4ssModsPath, 'mods.txt')
  if (fs.existsSync(modsTxtPath)) {
    try {
      let content = fs.readFileSync(modsTxtPath, 'utf-8')
      const regex = new RegExp(`^(${modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*:\\s*\\d+`, 'm')
      const newLine = `${modName} : ${enabled ? '1' : '0'}`
      if (regex.test(content)) {
        content = content.replace(regex, newLine)
      } else if (enabled) {
        // Only add if enabling — don't clutter mods.txt with disabled entries
        const keybindsMatch = content.match(/^;.*keybinds.*$/im)
        if (keybindsMatch) {
          content = content.replace(keybindsMatch[0], `${newLine}\n${keybindsMatch[0]}`)
        } else {
          content = content.trimEnd() + `\n${newLine}\n`
        }
      }
      fs.writeFileSync(modsTxtPath, content, 'utf-8')
    } catch (err) { logger.warn(`Failed to sync mods.txt: ${err.message}`) }
  }

  // --- mods.json ---
  const modsJsonPath = path.join(ue4ssModsPath, 'mods.json')
  if (fs.existsSync(modsJsonPath)) {
    try {
      const mods = JSON.parse(fs.readFileSync(modsJsonPath, 'utf-8'))
      if (!Array.isArray(mods)) { logger.warn('mods.json is not an array, skipping sync'); return }
      const existing = mods.find(m => m.mod_name === modName)
      if (existing) {
        existing.mod_enabled = enabled
      } else if (enabled) {
        mods.push({ mod_name: modName, mod_enabled: true })
      }
      fs.writeFileSync(modsJsonPath, JSON.stringify(mods, null, 4), 'utf-8')
    } catch (err) { logger.warn(`Failed to sync mods.json: ${err.message}`) }
  }
}

// Remove mod entry from mods.txt and mods.json
function removeFromUe4ssModRegistry(ue4ssModsPath, modName) {
  const modsTxtPath = path.join(ue4ssModsPath, 'mods.txt')
  if (fs.existsSync(modsTxtPath)) {
    try {
      let content = fs.readFileSync(modsTxtPath, 'utf-8')
      // Match trailing CR + LF so UE4SS-written CRLF files don't leave an orphan \r
      const regex = new RegExp(`^${modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*\\d+[ \\t]*\\r?\\n?`, 'm')
      content = content.replace(regex, '')
      fs.writeFileSync(modsTxtPath, content, 'utf-8')
    } catch (err) { logger.warn(`Failed to remove from mods.txt: ${err.message}`) }
  }

  const modsJsonPath = path.join(ue4ssModsPath, 'mods.json')
  if (fs.existsSync(modsJsonPath)) {
    try {
      const mods = JSON.parse(fs.readFileSync(modsJsonPath, 'utf-8'))
      if (!Array.isArray(mods)) { logger.warn('mods.json is not an array, skipping remove'); return }
      const filtered = mods.filter(m => m.mod_name !== modName)
      fs.writeFileSync(modsJsonPath, JSON.stringify(filtered, null, 4), 'utf-8')
    } catch (err) { logger.warn(`Failed to remove from mods.json: ${err.message}`) }
  }
}

export { syncUe4ssModRegistry, removeFromUe4ssModRegistry }
