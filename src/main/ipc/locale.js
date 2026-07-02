import { ipcMain, app } from 'electron'
import configStore from '../services/config-store.js'
import logger from '../services/logger.js'

const SUPPORTED_LOCALES = [
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ru', name: 'Русский' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' }
]

const SUPPORTED_CODES = new Set(SUPPORTED_LOCALES.map(l => l.code))
const DEFAULT_LOCALE = 'en'

function detectLocale() {
  const osLocale = app.getLocale() // e.g. 'zh-TW', 'en-US', 'ja'

  // Exact match
  if (SUPPORTED_CODES.has(osLocale)) return osLocale

  // Special handling for Chinese locales:
  // Only zh (bare) and zh-Hant* map to zh-TW; zh-CN, zh-Hans, zh-SG etc. fallback to en
  const lang = osLocale.split('-')[0]
  if (lang === 'zh') {
    const lower = osLocale.toLowerCase()
    if (lower === 'zh' || lower.startsWith('zh-hant')) {
      return 'zh-TW'
    }
    // zh-CN, zh-Hans, zh-SG, etc. — simplified Chinese not supported, fallback
    return DEFAULT_LOCALE
  }

  // Prefix match for non-Chinese locales: 'fr-CA' -> 'fr', 'de-AT' -> 'de'
  const match = SUPPORTED_LOCALES.find(l => l.code.split('-')[0] === lang)
  if (match) return match.code

  return DEFAULT_LOCALE
}

function registerLocaleIpc() {
  ipcMain.handle('locale:get-supported', () => {
    return SUPPORTED_LOCALES
  })

  ipcMain.handle('locale:get-preference', () => {
    const saved = configStore.get('lang')
    if (saved && SUPPORTED_CODES.has(saved)) return saved
    return detectLocale()
  })

  ipcMain.handle('locale:set-preference', (_, code) => {
    if (!SUPPORTED_CODES.has(code)) return false
    configStore.set('lang', code)
    logger.info(`Language changed to: ${code}`)
    return true
  })
}

export { registerLocaleIpc }
