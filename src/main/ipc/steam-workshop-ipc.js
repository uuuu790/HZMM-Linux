import { ipcMain } from 'electron'
import logger from '../services/logger.js'
import { browseWorkshop } from './steam-workshop-client.js'

// Only ever invoked from the dev-only Steam Workshop tab. Errors are returned
// as { ok: false, error } so the renderer can show a retry state, and logged
// so a future Steam markup change (the browse-page scrape is HTML-based) is
// diagnosable from the main-process log.
export function registerSteamWorkshopIpc() {
  ipcMain.handle('steam:browse', async (_e, opts) => {
    const page = (opts && opts.page) || 1
    try {
      return await browseWorkshop(opts || {})
    } catch (err) {
      logger.warn(`steam:browse failed: ${err.message}`)
      return { ok: false, items: [], page, hasNext: false, error: String(err?.message || err) }
    }
  })
}
