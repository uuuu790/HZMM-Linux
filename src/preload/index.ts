import { contextBridge, ipcRenderer, webUtils, webFrame, type IpcRendererEvent } from 'electron'
import type { HzmmApi, IpcEventMap, IpcInvokeMap } from './api'

// Splash (index.html) in the user's look from the first frame. This runs
// before the page is parsed: the mode comes from the main process
// (--hzmm-dark, from config), theme colours and language from what App.jsx
// stored last session. Every value is pattern-checked or looked up before it
// reaches CSS; anything missing or odd keeps the splash defaults.
const SPLASH_STATUS: Record<string, string> = {
  'zh-TW': '正在載入模組…',
  en: 'Loading mods…',
  ja: 'MODを読み込んでいます…',
  ko: '모드를 불러오는 중…',
  ru: 'Загрузка модов…',
  de: 'Mods werden geladen…',
  fr: 'Chargement des mods…'
}

// The splash droplets' orange shades, hue-rotated the way CSS hue-rotate()
// would (Filter Effects matrix, sRGB), so they match the hue-rotated clip
// without a filter pass of their own.
const DRIP_SHADES: [number, number, number, number][] = [
  [0xff, 0xd6, 0xb0, 1], [0xf7, 0x77, 0x2a, 1], [0xe3, 0x45, 0x2a, 1], [0xc9, 0x2a, 0x20, 1], [120, 20, 10, 0.35]
]

function hueRotated([r, g, b, a]: [number, number, number, number], deg: number): string {
  const c = Math.cos(deg * Math.PI / 180)
  const s = Math.sin(deg * Math.PI / 180)
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, v)))
  const R = (0.213 + 0.787 * c - 0.213 * s) * r + (0.715 - 0.715 * c - 0.715 * s) * g + (0.072 - 0.072 * c + 0.928 * s) * b
  const G = (0.213 - 0.213 * c + 0.143 * s) * r + (0.715 + 0.285 * c + 0.140 * s) * g + (0.072 - 0.072 * c - 0.283 * s) * b
  const B = (0.213 - 0.213 * c - 0.787 * s) * r + (0.715 - 0.715 * c + 0.715 * s) * g + (0.072 + 0.928 * c + 0.072 * s) * b
  return `rgba(${ch(R)},${ch(G)},${ch(B)},${a})`
}

function paintSplash(): void {
  const vars: string[] = []
  if (process.argv.includes('--hzmm-dark=0')) vars.push('--s-bg:#f8fafc', '--s-muted:#94a3b8')
  try {
    const s = JSON.parse(localStorage.getItem('hzmm.splash') || 'null') as Record<string, unknown> | null
    const ok = (v: unknown, re: RegExp): v is string => typeof v === 'string' && re.test(v)
    const hex = /^#[0-9a-f]{6}$/i
    if (s) {
      if (ok(s.accent, /^\d{1,3},\s?\d{1,3},\s?\d{1,3}$/)) vars.push(`--s-accent:${s.accent}`)
      if (ok(s.from, hex) && ok(s.to, hex)) vars.push(`--s-from:${s.from}`, `--s-to:${s.to}`)
      if (ok(s.hue, /^-?\d+(\.\d+)?deg$/)) {
        vars.push(`--s-hue:${s.hue}`)
        DRIP_SHADES.forEach((shade, i) => vars.push(`--drip-${i + 1}:${hueRotated(shade, parseFloat(s.hue as string))}`))
      }
      if (typeof s.lang === 'string' && Object.hasOwn(SPLASH_STATUS, s.lang)) vars.push(`--s-status:"${SPLASH_STATUS[s.lang]}"`)
    }
  } catch { /* storage unavailable or corrupt */ }
  if (vars.length) webFrame.insertCSS(`:root{${vars.join(';')}}`)
}
paintSplash()

// ipcRenderer.invoke with the channel's argument / result types from the
// window.api contract (api.d.ts).
function invoke<C extends keyof IpcInvokeMap>(
  channel: C,
  ...args: Parameters<IpcInvokeMap[C]>
): Promise<ReturnType<IpcInvokeMap[C]>> {
  return ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('api', {
  // --- 模組管理 ---
  mods: {
    scan: () => invoke('mods:scan'),
    toggle: (filename) => invoke('mods:toggle', filename),
    install: (filePaths) => invoke('mods:install', filePaths),
    remove: (filename) => invoke('mods:remove', filename),
    getConfigFiles: (modFilename) => invoke('mods:get-config-files', modFilename),
    readConfig: (modFilename, relativePath) => invoke('mods:read-config', modFilename, relativePath),
    saveConfig: (modFilename, relativePath, content) => invoke('mods:save-config', modFilename, relativePath, content),
    snapshotConfigs: () => invoke('profiles:snapshot-configs'),
    restoreConfigs: (configSnapshot) => invoke('profiles:restore-configs', configSnapshot),
    invalidateCache: () => invoke('mods:invalidate-cache'),
    preview: (filePaths) => invoke('mods:preview', filePaths),
    getReadme: (modFilename, lang) => invoke('mods:get-readme', modFilename, lang),
    setCustomName: (modId, name) => invoke('mods:set-custom-name', modId, name),
    makePakWin: (filename, competitors) => invoke('mods:make-pak-win', filename, competitors),
    applyPakOrder: (orderedFilenames) => invoke('mods:apply-pak-order', orderedFilenames),
    getConfigSchema: (modFilename) => invoke('mods:get-config-schema', modFilename),
    openSchemaPath: (modFilename, spec) => invoke('mods:open-schema-path', modFilename, spec),
    onUpdated: (cb) => {
      const handler = () => cb()
      ipcRenderer.on('mods:updated', handler)
      return () => ipcRenderer.removeListener('mods:updated', handler)
    }
  },

  // --- 世界存檔備份 ---
  saves: {
    listWorlds: () => invoke('saves:list-worlds'),
    backup: (worldNames) => invoke('saves:backup', worldNames),
    autoBackup: () => invoke('saves:auto-backup'),
    listBackups: () => invoke('saves:list-backups'),
    restoreBackup: (backupPath) => invoke('saves:restore-backup', backupPath),
    deleteBackup: (backupPath) => invoke('saves:delete-backup', backupPath)
  },

  // --- UE4SS 引擎 ---
  ue4ss: {
    getStatus: () => invoke('ue4ss:status'),
    install: () => invoke('ue4ss:install'),
    update: () => invoke('ue4ss:update'),
    installFromFile: () => invoke('ue4ss:install-from-file'),
    onProgress: (cb) => {
      const handler = (_: IpcRendererEvent, progress: IpcEventMap['ue4ss:progress']) => cb(progress)
      ipcRenderer.on('ue4ss:progress', handler)
      return () => ipcRenderer.removeListener('ue4ss:progress', handler)
    }
  },

  // --- 遊戲 ---
  game: {
    detectPath: () => invoke('game:detect-path'),
    getPath: () => invoke('game:get-path'),
    setPath: (path) => invoke('game:set-path', path),
    getPaksPath: () => invoke('game:get-paks-path'),
    getVersionCached: () => invoke('game:get-version-cached'),
    getVersion: () => invoke('game:get-version'),
    launch: () => invoke('game:launch'),
    launchVanilla: () => invoke('game:launch-vanilla'),
    onVanillaRestored: (cb) => {
      const handler = (_: IpcRendererEvent, payload: IpcEventMap['game:vanilla-restored']) => cb(payload)
      ipcRenderer.on('game:vanilla-restored', handler)
      return () => ipcRenderer.removeListener('game:vanilla-restored', handler)
    },
    isRunning: () => invoke('game:is-running'),
    onRunning: (cb) => {
      const handler = (_: IpcRendererEvent, running: IpcEventMap['game:running']) => cb(running)
      ipcRenderer.on('game:running', handler)
      return () => ipcRenderer.removeListener('game:running', handler)
    }
  },

  // --- 設定 ---
  settings: {
    // Typed per key in the contract (overloads); the channel itself is untyped.
    get: ((key: string, defaultValue?: unknown) => invoke('settings:get', key, defaultValue)) as HzmmApi['settings']['get'],
    set: (key, value) => invoke('settings:set', key, value)
  },

  // --- Nexus Mods 瀏覽 (Premium 專用) ---
  nexus: {
    validate: () => invoke('nexus:validate'),
    listMods: (sort) => invoke('nexus:list-mods', sort),
    searchMods: (keyword) => invoke('nexus:search-mods', keyword),
    getModDetail: (modId) => invoke('nexus:get-mod-detail', modId),
    getModFiles: (modId) => invoke('nexus:get-mod-files', modId),
    installMod: (modId) => invoke('nexus:install-mod', modId),
    installFile: (modId, fileId, version, fallbackToLatest) => invoke('nexus:install-file', modId, fileId, version, fallbackToLatest),
    updateFile: (modId, fileId, version) => invoke('nexus:update-file', modId, fileId, version),
    getInstalledMods: () => invoke('nexus:get-installed-mods'),
    resolveProfileSources: (filenames) => invoke('profiles:resolve-nexus-sources', filenames),
    forgetInstalled: (modId) => invoke('nexus:forget-installed', modId),
    linkMod: (modId, filename, fileId, version) => invoke('nexus:link-mod', modId, filename, fileId, version),
    listModVersions: () => invoke('nexus:list-mod-versions'),
    rollbackMod: (modId, snapshotDir) => invoke('nexus:rollback-mod', modId, snapshotDir),
    clearCache: (prefix) => invoke('nexus:clear-cache', prefix),
    checkUpdates: () => invoke('nexus:check-updates'),
    checkUpdatesForce: () => invoke('nexus:check-updates-force'),
    onDownloadProgress: (cb) => {
      const handler = (_: IpcRendererEvent, progress: IpcEventMap['mods:download-progress']) => cb(progress)
      ipcRenderer.on('mods:download-progress', handler)
      return () => ipcRenderer.removeListener('mods:download-progress', handler)
    },
  },

  // --- nxm:// 協定接管 ---
  nxm: {
    getStatus: () => invoke('nxm:get-status'),
    setEnabled: (enabled) => invoke('nxm:set-enabled', enabled),
    onEvent: (cb) => {
      const started = (_: IpcRendererEvent, p: IpcEventMap['nxm:install-started']) => cb({ type: 'started', ...p })
      const done = (_: IpcRendererEvent, p: IpcEventMap['nxm:install-done']) => cb({ type: 'done', ...p })
      const failed = (_: IpcRendererEvent, p: IpcEventMap['nxm:install-failed']) => cb({ type: 'failed', ...p })
      const wrongGame = (_: IpcRendererEvent, p: IpcEventMap['nxm:wrong-game']) => cb({ type: 'wrong-game', ...p })
      ipcRenderer.on('nxm:install-started', started)
      ipcRenderer.on('nxm:install-done', done)
      ipcRenderer.on('nxm:install-failed', failed)
      ipcRenderer.on('nxm:wrong-game', wrongGame)
      return () => {
        ipcRenderer.removeListener('nxm:install-started', started)
        ipcRenderer.removeListener('nxm:install-done', done)
        ipcRenderer.removeListener('nxm:install-failed', failed)
        ipcRenderer.removeListener('nxm:wrong-game', wrongGame)
      }
    },
  },

  // --- Steam Workshop 瀏覽 (dev-only) ---
  steam: {
    browse: (opts) => invoke('steam:browse', opts),
  },

  // --- App 更新 ---
  appUpdate: {
    check: () => invoke('app-update:check'),
    getVersion: () => invoke('app-update:get-version'),
    download: (url, expectedHash) => invoke('app-update:download', url, expectedHash),
    install: () => invoke('app-update:install'),
    onProgress: (cb) => {
      const handler = (_: IpcRendererEvent, progress: IpcEventMap['app-update:progress']) => cb(progress)
      ipcRenderer.on('app-update:progress', handler)
      return () => ipcRenderer.removeListener('app-update:progress', handler)
    },
    onInstallFailed: (cb) => {
      const handler = (_: IpcRendererEvent, message: string) => cb(message)
      ipcRenderer.on('app-update:install-failed', handler)
      return () => ipcRenderer.removeListener('app-update:install-failed', handler)
    }
  },

  // --- 衝突偵測 ---
  conflicts: {
    scan: () => invoke('conflicts:scan')
  },

  // --- 日誌 ---
  logger: {
    getPath: () => invoke('logger:get-path'),
    readRecent: () => invoke('logger:read-recent')
  },

  // --- 語言 ---
  locale: {
    getSupported: () => invoke('locale:get-supported'),
    getPreference: () => invoke('locale:get-preference'),
    setPreference: (code) => invoke('locale:set-preference', code)
  },

  // --- 系統 ---
  system: {
    platform: process.platform,
    selectFolder: () => invoke('dialog:select-folder'),
    selectFiles: (filters) => invoke('dialog:select-files', filters),
    openExternal: (url) => invoke('shell:open-external', url),
    openPath: (filePath) => invoke('shell:open-path', filePath),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    setTitleBarTheme: (isDark) => invoke('app:set-titlebar-theme', isDark),
    quit: () => invoke('app:quit'),
    getAutoStart: () => invoke('app:get-auto-start'),
    setAutoStart: (enabled) => invoke('app:set-auto-start', enabled)
  },

  // --- 介面縮放 ---
  ui: {
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    getZoom: () => webFrame.getZoomFactor(),
    fitWindow: (contentWidth) => invoke('ui:fit-window', contentWidth),
  },

  // --- 視窗控制 (Linux/Mac fallback for missing titleBarOverlay) ---
  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:is-maximized')
  },
} satisfies HzmmApi)
