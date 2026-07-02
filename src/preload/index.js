const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // --- 模組管理 ---
  mods: {
    scan: () => ipcRenderer.invoke('mods:scan'),
    toggle: (filename) => ipcRenderer.invoke('mods:toggle', filename),
    install: (filePaths) => ipcRenderer.invoke('mods:install', filePaths),
    remove: (filename) => ipcRenderer.invoke('mods:remove', filename),
    getConfigFiles: (modFilename) => ipcRenderer.invoke('mods:get-config-files', modFilename),
    readConfig: (modFilename, relativePath) => ipcRenderer.invoke('mods:read-config', modFilename, relativePath),
    saveConfig: (modFilename, relativePath, content) => ipcRenderer.invoke('mods:save-config', modFilename, relativePath, content),
    snapshotConfigs: () => ipcRenderer.invoke('profiles:snapshot-configs'),
    restoreConfigs: (configSnapshot) => ipcRenderer.invoke('profiles:restore-configs', configSnapshot),
    invalidateCache: () => ipcRenderer.invoke('mods:invalidate-cache'),
    preview: (filePaths) => ipcRenderer.invoke('mods:preview', filePaths),
    getReadme: (modFilename, lang) => ipcRenderer.invoke('mods:get-readme', modFilename, lang),
    setCustomName: (modId, name) => ipcRenderer.invoke('mods:set-custom-name', modId, name),
    getConfigSchema: (modFilename) => ipcRenderer.invoke('mods:get-config-schema', modFilename),
    openSchemaPath: (modFilename, spec) => ipcRenderer.invoke('mods:open-schema-path', modFilename, spec),
    onUpdated: (cb) => {
      const handler = () => cb()
      ipcRenderer.on('mods:updated', handler)
      return () => ipcRenderer.removeListener('mods:updated', handler)
    }
  },

  // --- 世界存檔備份 ---
  saves: {
    listWorlds: () => ipcRenderer.invoke('saves:list-worlds'),
    backup: (worldNames) => ipcRenderer.invoke('saves:backup', worldNames),
    listBackups: () => ipcRenderer.invoke('saves:list-backups'),
    restoreBackup: (backupPath) => ipcRenderer.invoke('saves:restore-backup', backupPath),
    deleteBackup: (backupPath) => ipcRenderer.invoke('saves:delete-backup', backupPath)
  },

  // --- UE4SS 引擎 ---
  ue4ss: {
    getStatus: () => ipcRenderer.invoke('ue4ss:status'),
    install: () => ipcRenderer.invoke('ue4ss:install'),
    update: () => ipcRenderer.invoke('ue4ss:update'),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('ue4ss:progress', handler)
      return () => ipcRenderer.removeListener('ue4ss:progress', handler)
    }
  },

  // --- 遊戲 ---
  game: {
    detectPath: () => ipcRenderer.invoke('game:detect-path'),
    getPath: () => ipcRenderer.invoke('game:get-path'),
    setPath: (path) => ipcRenderer.invoke('game:set-path', path),
    getPaksPath: () => ipcRenderer.invoke('game:get-paks-path'),
    getVersionCached: () => ipcRenderer.invoke('game:get-version-cached'),
    getVersion: () => ipcRenderer.invoke('game:get-version'),
    launch: () => ipcRenderer.invoke('game:launch'),
    isRunning: () => ipcRenderer.invoke('game:is-running'),
    onRunning: (cb) => {
      const handler = (_, running) => cb(running)
      ipcRenderer.on('game:running', handler)
      return () => ipcRenderer.removeListener('game:running', handler)
    }
  },

  // --- 設定 ---
  settings: {
    get: (key, defaultValue) => ipcRenderer.invoke('settings:get', key, defaultValue),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
  },

  // --- Nexus Mods 瀏覽 (Premium 專用) ---
  nexus: {
    validate: () => ipcRenderer.invoke('nexus:validate'),
    listMods: (sort) => ipcRenderer.invoke('nexus:list-mods', sort),
    searchMods: (keyword) => ipcRenderer.invoke('nexus:search-mods', keyword),
    getModDetail: (modId) => ipcRenderer.invoke('nexus:get-mod-detail', modId),
    getModFiles: (modId) => ipcRenderer.invoke('nexus:get-mod-files', modId),
    installMod: (modId) => ipcRenderer.invoke('nexus:install-mod', modId),
    installFile: (modId, fileId, version, fallbackToLatest) => ipcRenderer.invoke('nexus:install-file', modId, fileId, version, fallbackToLatest),
    getInstalledMods: () => ipcRenderer.invoke('nexus:get-installed-mods'),
    resolveProfileSources: (filenames) => ipcRenderer.invoke('profiles:resolve-nexus-sources', filenames),
    forgetInstalled: (modId) => ipcRenderer.invoke('nexus:forget-installed', modId),
    clearCache: (prefix) => ipcRenderer.invoke('nexus:clear-cache', prefix),
    checkUpdates: () => ipcRenderer.invoke('nexus:check-updates'),
    checkUpdatesForce: () => ipcRenderer.invoke('nexus:check-updates-force'),
    onDownloadProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('mods:download-progress', handler)
      return () => ipcRenderer.removeListener('mods:download-progress', handler)
    },
  },

  // --- Steam Workshop 瀏覽 (dev-only) ---
  steam: {
    browse: (opts) => ipcRenderer.invoke('steam:browse', opts),
  },

  // --- App 更新 ---
  appUpdate: {
    check: () => ipcRenderer.invoke('app-update:check'),
    getVersion: () => ipcRenderer.invoke('app-update:get-version'),
    download: (url, expectedHash) => ipcRenderer.invoke('app-update:download', url, expectedHash),
    install: () => ipcRenderer.invoke('app-update:install'),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('app-update:progress', handler)
      return () => ipcRenderer.removeListener('app-update:progress', handler)
    },
    onInstallFailed: (cb) => {
      const handler = (_, message) => cb(message)
      ipcRenderer.on('app-update:install-failed', handler)
      return () => ipcRenderer.removeListener('app-update:install-failed', handler)
    }
  },

  // --- 衝突偵測 ---
  conflicts: {
    scan: () => ipcRenderer.invoke('conflicts:scan')
  },

  // --- 日誌 ---
  logger: {
    getPath: () => ipcRenderer.invoke('logger:get-path'),
    readRecent: () => ipcRenderer.invoke('logger:read-recent')
  },

  // --- 語言 ---
  locale: {
    getSupported: () => ipcRenderer.invoke('locale:get-supported'),
    getPreference: () => ipcRenderer.invoke('locale:get-preference'),
    setPreference: (code) => ipcRenderer.invoke('locale:set-preference', code)
  },

  // --- 系統 ---
  system: {
    platform: process.platform,
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
    selectFiles: (filters) => ipcRenderer.invoke('dialog:select-files', filters),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    setTitleBarTheme: (isDark) => ipcRenderer.invoke('app:set-titlebar-theme', isDark),
    quit: () => ipcRenderer.invoke('app:quit'),
    getAutoStart: () => ipcRenderer.invoke('app:get-auto-start'),
    setAutoStart: (enabled) => ipcRenderer.invoke('app:set-auto-start', enabled)
  },

  // --- 介面縮放 ---
  ui: {
    setZoom: (factor) => webFrame.setZoomFactor(factor),
    getZoom: () => webFrame.getZoomFactor(),
    fitWindow: (contentWidth) => ipcRenderer.invoke('ui:fit-window', contentWidth),
  },

  // --- 視窗控制 (Linux/Mac fallback for missing titleBarOverlay) ---
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized')
  }
})
