// The window.api contract: what the preload (src/preload/index.ts) exposes to
// the renderer over contextBridge.
//
// - IpcInvokeMap: every ipcRenderer.invoke channel → the arguments the
//   renderer sends and the value the main-process handler resolves with.
// - IpcEventMap: every main → renderer push channel → its payload.
// - HzmmApi: the namespaced window.api surface built from the two.
//
// Argument types are what the renderer is meant to send; main still treats
// them as untrusted and checks them itself. Result types follow the handlers
// and event payloads the webContents.send calls in src/main (keep them in
// step when either changes shape — `npm run check:ipc` fails when they drift).
//
// Pure types, importing only src/main/ipc/types.ts (which has no imports), so
// both the node and the renderer tsconfig can include this file.

import type {
  BackupInfo,
  ConfigKey,
  ConfigSchema,
  ConfigSnapshot,
  GameVersionInfo,
  InstalledArchive,
  LocalModRef,
  ModSource,
  ModVersionInfo,
  NexusInstallReceipt,
  NexusModFile,
  PakConflict,
  PreviewResult,
  RestoreSummary,
  SaveFileInfo,
  ScannedMod,
  SettingsKey,
  SupportedLocale,
  Ue4ssStatus,
  UpdateCheckInfo,
  UpdateCheckPayload,
  V2ModCard,
  V2ModDetail,
  WorkshopBrowseOptions,
  WorkshopBrowseResult,
  WorldBackup,
} from '../main/ipc/types'

// ---------------------------------------------------------------------------
// Result shapes that only cross the IPC boundary
// ---------------------------------------------------------------------------

/** A scanned mod plus its user-set display name, if any. */
export type ModListEntry = ScannedMod & { customName?: string }

export interface ConfigFileEntry {
  name: string
  relativePath: string
  size: number
}

/** A file path declared in a mod's hzmm.config.json schema. */
export interface SchemaPathSpec {
  path: string
  /** Default 'game'. */
  relativeTo?: 'game' | 'mod'
  /** Default 'open'. */
  action?: 'reveal' | 'open'
}

export interface OpenSchemaPathResult {
  ok: boolean
  /** Why it failed, e.g. 'invalid-spec' / 'invalid-path'. */
  reason?: string
  resolved?: string
}

export interface ReadmeResult {
  filename: string
  content: string
}

export interface SaveWorld {
  name: string
  files: SaveFileInfo[]
  totalSize: number
  /** ISO date. */
  lastModified: string
}

export interface SaveBackupResult {
  path: string
  timestamp: string
  worlds: WorldBackup[]
  totalSize: number
}

export type AutoBackupResult =
  | { skipped: boolean; reason: string }
  | { path: string; timestamp: string; worlds: number; totalSize: number }

export interface RestoreBackupResult {
  restored: boolean
  worlds: string[]
  /** The mod list recorded in the backup's backup.json, as stored. */
  mods: unknown[]
}

export interface GamePathCheck {
  valid: boolean
  /** 'not-game-folder' | 'path-not-found' | 'select-subfolder' when invalid. */
  reason?: string
  /** For 'select-subfolder': the game folder found inside the chosen one. */
  suggestion?: string
}

/** A dialog file-type filter (same shape as Electron's FileFilter). */
export interface FileFilter {
  name: string
  extensions: string[]
}

export type AppUpdateCheckResult =
  | UpdateCheckInfo
  | { hasUpdate: boolean; currentVersion: string; error: string }

export interface NexusValidateResult {
  ok: boolean
  /** 'no-key' | 'not-premium' | 'invalid' | 'network' when not ok. */
  reason?: string
  name?: string
  profileUrl?: string
  error?: string
}

/** A cached Nexus V2 lookup: the payload on success, a network failure otherwise. */
export type NexusFetchResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: 'network'; error: string }

/** Rejected before any request (e.g. 'invalid-id'). */
export interface NexusRejected {
  ok: false
  reason: string
}

export interface NexusInstallFileResult {
  ok: true
  fellBackToLatest: boolean
  mods: LocalModRef[]
}

export interface NxmStatus {
  enabled: boolean
  /** Whether HZMM is the OS default nxm:// handler. */
  isDefault: boolean
}

/** One nxm:// install event, as the preload merges the four push channels. */
export type NxmEvent =
  | ({ type: 'started' } & IpcEventMap['nxm:install-started'])
  | ({ type: 'done' } & IpcEventMap['nxm:install-done'])
  | ({ type: 'failed' } & IpcEventMap['nxm:install-failed'])
  | ({ type: 'wrong-game' } & IpcEventMap['nxm:wrong-game'])

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface IpcInvokeMap {
  // mods
  'mods:scan': () => ModListEntry[]
  'mods:toggle': (filename: string) => { id: string; filename: string; enabled: boolean; path: string }
  'mods:install': (filePaths: string[]) => InstalledArchive[]
  'mods:remove': (filename: string) => boolean
  'mods:get-config-files': (modFilename: string) => ConfigFileEntry[]
  'mods:read-config': (modFilename: string, relativePath: string) => string
  'mods:save-config': (modFilename: string, relativePath: string, content: string) => boolean
  'profiles:snapshot-configs': () => ConfigSnapshot
  'profiles:restore-configs': (configSnapshot: ConfigSnapshot) => boolean
  'mods:invalidate-cache': () => void
  'mods:preview': (filePaths: string[]) => PreviewResult[]
  'mods:get-readme': (modFilename: string, lang?: string | null) => ReadmeResult | null
  /** An empty / blank name clears the custom name. */
  'mods:set-custom-name': (modId: string, name: string | null) => void
  'mods:make-pak-win': (filename: string, competitors: string[]) => { filename: string; renamed: boolean }
  'mods:apply-pak-order': (orderedFilenames: string[]) => { renamed: number; skipped: number; changed: boolean }
  /** The mod's parsed hzmm.config.json as written by its author, or null. */
  'mods:get-config-schema': (modFilename: string) => unknown
  'mods:open-schema-path': (modFilename: string, spec: SchemaPathSpec) => OpenSchemaPathResult

  // saves
  'saves:list-worlds': () => SaveWorld[]
  'saves:backup': (worldNames: string[]) => SaveBackupResult
  'saves:auto-backup': () => AutoBackupResult
  'saves:list-backups': () => BackupInfo[]
  'saves:restore-backup': (backupPath: string) => RestoreBackupResult
  'saves:delete-backup': (backupPath: string) => boolean

  // ue4ss
  'ue4ss:status': () => Ue4ssStatus
  'ue4ss:install': () => { version: string }
  'ue4ss:update': () => { version: string }
  'ue4ss:install-from-file': () => { canceled: true } | { version: string }

  // game
  'game:detect-path': () => string | null
  'game:get-path': () => string | null
  'game:set-path': (path: string) => GamePathCheck
  'game:get-paks-path': () => string | null
  'game:get-version-cached': () => GameVersionInfo | null
  'game:get-version': () => GameVersionInfo | null
  'game:launch': () => boolean
  'game:launch-vanilla': () => { ok: boolean; disabledCount: number }
  'game:is-running': () => boolean

  // settings (typed per key on HzmmApi['settings'])
  'settings:get': (key: string, defaultValue?: unknown) => unknown
  'settings:set': (key: SettingsKey, value: unknown) => void

  // nexus
  'nexus:validate': () => NexusValidateResult
  /** sort: a nexus-v2-client SORT_MAP key; anything else lists trending. */
  'nexus:list-mods': (sort?: string) => NexusFetchResult<{ mods: V2ModCard[]; totalCount: number }>
  /** A blank keyword resolves to an empty page without a request. */
  'nexus:search-mods': (keyword: string) => NexusFetchResult<{ mods: V2ModCard[]; totalCount: number }>
  'nexus:get-mod-detail': (modId: number) => NexusFetchResult<{ mod: V2ModDetail | null }> | NexusRejected
  'nexus:get-mod-files': (modId: number) => NexusFetchResult<{ files: NexusModFile[] }> | NexusRejected
  'nexus:install-mod': (modId: number) => InstalledArchive[]
  'nexus:install-file': (modId: number, fileId: number, version?: string | null, fallbackToLatest?: boolean) => NexusInstallFileResult
  'nexus:update-file': (modId: number, fileId: number, version?: string | null) => NexusInstallFileResult & { restored: RestoreSummary | null }
  'nexus:get-installed-mods': () => NexusInstallReceipt[]
  'profiles:resolve-nexus-sources': (enabledModFilenames: string[]) => ModSource[]
  'nexus:forget-installed': (modId: number) => { ok: boolean; reason?: string }
  'nexus:link-mod': (modId: number, filename: string, fileId?: number | null, version?: string | null) => { ok: boolean }
  /** modId (as a string key) → its retained snapshots. */
  'nexus:list-mod-versions': () => Record<string, ModVersionInfo[]>
  'nexus:rollback-mod': (modId: number, snapshotDir: string) => { ok: boolean; version: string | null }
  'nexus:clear-cache': (prefix?: string) => { ok: boolean }
  'nexus:check-updates': () => UpdateCheckPayload
  'nexus:check-updates-force': () => UpdateCheckPayload

  // nxm
  'nxm:get-status': () => NxmStatus
  'nxm:set-enabled': (enabled: boolean) => NxmStatus & { error?: string }

  // steam workshop (dev-only)
  'steam:browse': (opts?: WorkshopBrowseOptions | null) => WorkshopBrowseResult

  // app update
  'app-update:check': () => AppUpdateCheckResult
  'app-update:get-version': () => string
  /** Main ignores both arguments and re-fetches the canonical release. */
  /** filePath is null on deb / dev runs, where the download is manual. */
  'app-update:download': (url?: string | null, expectedHash?: string | null) => { filePath: string | null }
  /** manual: true when it opened the releases page instead of swapping the AppImage. */
  'app-update:install': () => { manual: boolean; url?: string }

  // conflicts / logger / locale
  'conflicts:scan': () => PakConflict[]
  'logger:get-path': () => string
  'logger:read-recent': () => string[]
  'locale:get-supported': () => SupportedLocale[]
  'locale:get-preference': () => string
  'locale:set-preference': (code: string) => boolean

  // system
  'dialog:select-folder': () => string | null
  'dialog:select-files': (filters?: FileFilter[] | null) => string[]
  'shell:open-external': (url: string) => void
  /** '' on success, an error string on failure; undefined when the path is refused. */
  'shell:open-path': (filePath: string) => string | undefined
  'app:set-titlebar-theme': (isDark: boolean) => void
  'app:quit': () => void
  'app:get-auto-start': () => boolean
  'app:set-auto-start': (enabled: boolean) => void
  'ui:fit-window': (contentWidth: number) => void

  // window controls (Linux custom titlebar — no titleBarOverlay)
  'window:minimize': () => void
  /** Resolves to the new maximized state. */
  'window:maximize': () => boolean
  'window:close': () => void
  'window:is-maximized': () => boolean
}

export interface IpcEventMap {
  'mods:updated': void
  /** Percent 0–100, or -1 once when the total size is unknown. */
  'mods:download-progress': number
  'ue4ss:progress': number
  'app-update:progress': number
  'game:running': boolean
  'game:vanilla-restored': { restored: number }
  'nxm:install-started': { modId: number; fileId: number }
  'nxm:install-done': { modId: number; fileId: number; mods: LocalModRef[]; updated: boolean }
  /** error 'NEXUS_API_KEY_REQUIRED' when no API key is set. */
  'nxm:install-failed': { modId: number; error: string }
  'nxm:wrong-game': { game: string }
}

// ---------------------------------------------------------------------------
// window.api
// ---------------------------------------------------------------------------

/** A preload method for an invoke channel: same arguments, resolves to the handler's result. */
export type InvokeMethod<C extends keyof IpcInvokeMap> =
  (...args: Parameters<IpcInvokeMap[C]>) => Promise<ReturnType<IpcInvokeMap[C]>>

/** Subscribe to a push channel; returns the unsubscribe function. */
export type Subscribe<P> = (cb: (payload: P) => void) => () => void

export interface HzmmApi {
  mods: {
    scan: InvokeMethod<'mods:scan'>
    toggle: InvokeMethod<'mods:toggle'>
    install: InvokeMethod<'mods:install'>
    remove: InvokeMethod<'mods:remove'>
    getConfigFiles: InvokeMethod<'mods:get-config-files'>
    readConfig: InvokeMethod<'mods:read-config'>
    saveConfig: InvokeMethod<'mods:save-config'>
    snapshotConfigs: InvokeMethod<'profiles:snapshot-configs'>
    restoreConfigs: InvokeMethod<'profiles:restore-configs'>
    invalidateCache: InvokeMethod<'mods:invalidate-cache'>
    preview: InvokeMethod<'mods:preview'>
    getReadme: InvokeMethod<'mods:get-readme'>
    setCustomName: InvokeMethod<'mods:set-custom-name'>
    makePakWin: InvokeMethod<'mods:make-pak-win'>
    applyPakOrder: InvokeMethod<'mods:apply-pak-order'>
    getConfigSchema: InvokeMethod<'mods:get-config-schema'>
    openSchemaPath: InvokeMethod<'mods:open-schema-path'>
    onUpdated: (cb: () => void) => () => void
  }
  saves: {
    listWorlds: InvokeMethod<'saves:list-worlds'>
    backup: InvokeMethod<'saves:backup'>
    autoBackup: InvokeMethod<'saves:auto-backup'>
    listBackups: InvokeMethod<'saves:list-backups'>
    restoreBackup: InvokeMethod<'saves:restore-backup'>
    deleteBackup: InvokeMethod<'saves:delete-backup'>
  }
  ue4ss: {
    getStatus: InvokeMethod<'ue4ss:status'>
    install: InvokeMethod<'ue4ss:install'>
    update: InvokeMethod<'ue4ss:update'>
    installFromFile: InvokeMethod<'ue4ss:install-from-file'>
    onProgress: Subscribe<IpcEventMap['ue4ss:progress']>
  }
  game: {
    detectPath: InvokeMethod<'game:detect-path'>
    getPath: InvokeMethod<'game:get-path'>
    setPath: InvokeMethod<'game:set-path'>
    getPaksPath: InvokeMethod<'game:get-paks-path'>
    getVersionCached: InvokeMethod<'game:get-version-cached'>
    getVersion: InvokeMethod<'game:get-version'>
    launch: InvokeMethod<'game:launch'>
    launchVanilla: InvokeMethod<'game:launch-vanilla'>
    onVanillaRestored: Subscribe<IpcEventMap['game:vanilla-restored']>
    isRunning: InvokeMethod<'game:is-running'>
    onRunning: Subscribe<IpcEventMap['game:running']>
  }
  settings: {
    /** A missing key resolves to the default (null without one). */
    get<K extends ConfigKey>(key: K, defaultValue: ConfigSchema[K]): Promise<ConfigSchema[K]>
    get<K extends ConfigKey>(key: K, defaultValue?: null): Promise<ConfigSchema[K] | null>
    /** Rejects for a key outside ALLOWED_SETTINGS_KEYS. */
    set<K extends SettingsKey>(key: K, value: ConfigSchema[K]): Promise<void>
  }
  nexus: {
    validate: InvokeMethod<'nexus:validate'>
    listMods: InvokeMethod<'nexus:list-mods'>
    searchMods: InvokeMethod<'nexus:search-mods'>
    getModDetail: InvokeMethod<'nexus:get-mod-detail'>
    getModFiles: InvokeMethod<'nexus:get-mod-files'>
    installMod: InvokeMethod<'nexus:install-mod'>
    installFile: InvokeMethod<'nexus:install-file'>
    updateFile: InvokeMethod<'nexus:update-file'>
    getInstalledMods: InvokeMethod<'nexus:get-installed-mods'>
    resolveProfileSources: InvokeMethod<'profiles:resolve-nexus-sources'>
    forgetInstalled: InvokeMethod<'nexus:forget-installed'>
    linkMod: InvokeMethod<'nexus:link-mod'>
    listModVersions: InvokeMethod<'nexus:list-mod-versions'>
    rollbackMod: InvokeMethod<'nexus:rollback-mod'>
    clearCache: InvokeMethod<'nexus:clear-cache'>
    checkUpdates: InvokeMethod<'nexus:check-updates'>
    checkUpdatesForce: InvokeMethod<'nexus:check-updates-force'>
    onDownloadProgress: Subscribe<IpcEventMap['mods:download-progress']>
  }
  nxm: {
    getStatus: InvokeMethod<'nxm:get-status'>
    setEnabled: InvokeMethod<'nxm:set-enabled'>
    onEvent: Subscribe<NxmEvent>
  }
  steam: {
    browse: InvokeMethod<'steam:browse'>
  }
  appUpdate: {
    check: InvokeMethod<'app-update:check'>
    getVersion: InvokeMethod<'app-update:get-version'>
    download: InvokeMethod<'app-update:download'>
    install: InvokeMethod<'app-update:install'>
    onProgress: Subscribe<IpcEventMap['app-update:progress']>
    /** Never fires on Linux (install errors reject the invoke instead); kept so
     *  the shared renderer subscribes the same way on both platforms. */
    onInstallFailed: Subscribe<string>
  }
  conflicts: {
    scan: InvokeMethod<'conflicts:scan'>
  }
  logger: {
    getPath: InvokeMethod<'logger:get-path'>
    readRecent: InvokeMethod<'logger:read-recent'>
  }
  locale: {
    getSupported: InvokeMethod<'locale:get-supported'>
    getPreference: InvokeMethod<'locale:get-preference'>
    setPreference: InvokeMethod<'locale:set-preference'>
  }
  system: {
    /** process.platform of the main process ('linux' in this fork). */
    platform: NodeJS.Platform
    selectFolder: InvokeMethod<'dialog:select-folder'>
    selectFiles: InvokeMethod<'dialog:select-files'>
    openExternal: InvokeMethod<'shell:open-external'>
    openPath: InvokeMethod<'shell:open-path'>
    /** Synchronous (webUtils): the on-disk path of a dropped File, '' if none. */
    getPathForFile: (file: File) => string
    setTitleBarTheme: InvokeMethod<'app:set-titlebar-theme'>
    quit: InvokeMethod<'app:quit'>
    getAutoStart: InvokeMethod<'app:get-auto-start'>
    setAutoStart: InvokeMethod<'app:set-auto-start'>
  }
  ui: {
    /** Synchronous (webFrame). */
    setZoom: (factor: number) => void
    /** Synchronous (webFrame). */
    getZoom: () => number
    fitWindow: InvokeMethod<'ui:fit-window'>
  }
  window: {
    minimize: InvokeMethod<'window:minimize'>
    maximize: InvokeMethod<'window:maximize'>
    close: InvokeMethod<'window:close'>
    isMaximized: InvokeMethod<'window:is-maximized'>
  }
}

declare global {
  interface Window {
    api: HzmmApi
  }
}
