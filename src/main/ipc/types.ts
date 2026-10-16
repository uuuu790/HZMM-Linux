// Domain types shared across the main-process IPC modules.
//
// Shapes that cross module boundaries live here (Nexus V2 payloads, UE4SS
// registry files, Steam Workshop items, locales); a type only one module
// uses stays in that module. Field nullability follows what the code
// tolerates today — external payloads are typed as received, not as hoped.
//
// This file has no imports, so the renderer's tsconfig can include it too:
// the window.api contract (src/preload/api.d.ts) builds on these types.

// ---------------------------------------------------------------------------
// Nexus Mods V2 GraphQL (see nexus-v2-client)
// ---------------------------------------------------------------------------

/** A mod as returned by the list / search queries (MOD_CARD_FIELDS). */
export interface V2ModCard {
  modId: number
  name: string
  summary: string | null
  author: string | null
  version: string
  pictureUrl: string | null
  thumbnailUrl: string | null
  endorsements: number
  downloads: number
  adultContent: boolean
  updatedAt: string
  createdAt: string
  modCategory: { name: string } | null
}

/** One page of the `mods` query. */
export interface V2ModsPage {
  totalCount: number
  nodes: V2ModCard[]
}

/** The `mod` detail query. */
export interface V2ModDetail extends V2ModCard {
  description: string | null
  thumbnailLargeUrl: string | null
  fileSize: number | null
  uploader: { name: string; memberId: number } | null
}

/** A `modFiles` entry, normalized to the V1-style snake_case the renderer reads. */
export interface NexusModFile {
  file_id: number
  name: string
  version: string
  description: string | null
  category_id: number
  category_name: string
  is_primary: boolean
  /** KB, like V1. */
  size: number
  size_in_bytes: number
  /** ISO date string from V2's `date` (V1 used a unix timestamp). */
  uploaded_timestamp: string
  file_name: string
  total_downloads: number
  unique_downloads: number
}

// ---------------------------------------------------------------------------
// Settings-store records (configStore keys)
// ---------------------------------------------------------------------------

export type ModType = 'PAK' | 'UE4SS'

/** A saved mod profile (`profiles`). */
export interface ModProfile {
  id: string
  name: string
  /** Filenames in their enabled form; some older entries keep `.disabled`. */
  enabledModFilenames: string[]
  [field: string]: unknown
}

/** An on-disk mod an install receipt points at. PAK names are base names. */
export interface LocalModRef {
  name: string
  modType: ModType
}

/** A mod vanilla launch disabled, persisted so it can be re-enabled. */
export interface VanillaEntry {
  type: ModType
  filename: string
}

// Every key the app reads or writes, with the shape the app stores under it.
// The file is plain JSON on disk, so these are the shapes as written, not a
// validation: renderer-owned keys arrive through settings:set unvalidated
// (see ALLOWED_SETTINGS_KEYS), and an older or hand-edited config can hold
// anything — callers keep the defensive checks they already have.
export interface ConfigSchema {
  gamePath: string
  lang: string
  cachedGameVersion: GameVersionInfo
  nexusApiKey: string
  nexusInstalledMods: NexusInstallReceipt[]
  nexusUpdateCheck: UpdateCheckPayload
  nxmHandlerEnabled: boolean
  /** Enabled-form filename → display name. */
  modCustomNames: Record<string, string>
  profiles: ModProfile[]
  activeProfileId: string | null
  ue4ssVersion: string
  ue4ssPublishedAt: string | null
  /** Mods a vanilla launch disabled, re-enabled once the game exits. */
  vanillaLaunchRestore: { entries: VanillaEntry[]; at: number } | null
  minimizeToTray: boolean
  uiZoom: number
  themeId: string
  darkMode: boolean
  skipInstallPreview: boolean
  windowState: unknown
}

export type ConfigKey = keyof ConfigSchema

/** The keys settings:set accepts from the renderer (ALLOWED_SETTINGS_KEYS). */
export type SettingsKey =
  | 'themeId' | 'darkMode' | 'minimizeToTray'
  | 'nexusApiKey' | 'ue4ssVersion' | 'windowState'
  | 'profiles' | 'activeProfileId'
  | 'nexusInstalledMods'
  | 'skipInstallPreview'
  | 'uiZoom'

/** A Nexus install receipt (`nexusInstalledMods`). */
export interface NexusInstallReceipt {
  modId: number
  fileId: number | null
  installedAt: number
  version?: string | null
  /** Missing on pre-localMods legacy receipts. */
  localMods?: LocalModRef[]
  [field: string]: unknown
}

// ---------------------------------------------------------------------------
// Nexus update checking (see nexus-update-checker)
// ---------------------------------------------------------------------------

/** evaluateOutdated's verdict for one receipt. */
export interface OutdatedVerdict {
  outdated: boolean
  latestFileId: number | null
  latestVersion: string | null
  currentVersion: string | null
}

/** One receipt's entry in the update-check payload; `error` when its lookup failed. */
export interface UpdateCheckResult extends Partial<OutdatedVerdict> {
  modId: number
  outdated: boolean
  /** On-disk filenames this receipt's localMods map to. */
  affectedFilenames: string[]
  error?: string
}

/** The cached update-check payload (`nexusUpdateCheck`). */
export interface UpdateCheckPayload {
  checkedAt: number
  results: UpdateCheckResult[]
}

// ---------------------------------------------------------------------------
// Installed mods (see mods-scan / mods-install)
// ---------------------------------------------------------------------------

/** One installed mod as scanMods reports it to the renderer. */
export interface ScannedMod {
  /** `ue4ss:<folder>` for UE4SS mods, the enabled-form filename for PAKs. */
  id: string
  filename: string
  title: string
  enabled: boolean
  size: number
  /** ISO mtime. */
  modified: string
  type: ModType
  /** UE4SS only. */
  subtype?: 'lua' | 'cpp'
  /** null on a UE4SS mod without a hybrid link file. */
  hybrid: boolean | null
  /** UE4SS side of a hybrid: the paired pak names. */
  linkedPaks?: string[]
  /** PAK side of a hybrid: the paired UE4SS folder. */
  linkedUe4ss?: string
  path: string
}

/** One archive / pak handled by installMods. */
export interface InstalledArchive {
  name: string
  type: string
  mods: LocalModRef[]
}

/** A mod an install preview found in an archive; `existing` = already installed. */
export interface PreviewMod {
  name: string
  modType: string
  existing?: boolean
}

/** mods:preview's verdict for one dropped file. */
export interface PreviewResult {
  filePath: string
  fileName: string
  type: string
  mods: PreviewMod[]
  totalFiles: number
  error?: string
}

/** One asset more than one enabled PAK ships. */
export interface PakConflict {
  resource: string
  mods: string[]
}

/** mod folder → (config relative path → file text). */
export type ConfigSnapshot = Record<string, Record<string, string>>

/** What an update put back from the pre-update state. */
export interface RestoreSummary {
  enabledRestored: number
  configsRestored: number
  orderRestored: number
}

/** A retained snapshot as listModVersions reports it. */
export interface ModVersionInfo {
  dir: string
  version: string | null
  fileId: number | null
  savedAt: number
}

/** A profile mod traced back to the Nexus receipt it was installed from. */
export interface ModSource {
  filename: string
  modId: number
  fileId: number | null
  version: string | null
  displayName: string
}

/** An install failure, carrying what still landed and any retained backup. */
export interface InstallError extends Error {
  installed?: InstalledArchive[]
  backupRetained?: string
}

// ---------------------------------------------------------------------------
// UE4SS registry (mods.json / mods.txt, see mods-registry)
// ---------------------------------------------------------------------------

/** One entry of UE4SS's Mods/mods.json. */
export interface Ue4ssModsJsonEntry {
  mod_name: string
  mod_enabled: boolean
}

// ---------------------------------------------------------------------------
// World saves (see saves)
// ---------------------------------------------------------------------------

export interface SaveFileInfo {
  filename: string
  size: number
}

export interface WorldBackup {
  name: string
  files: SaveFileInfo[]
}

/** A backup dir as listed: dirname-derived defaults overlaid with backup.json. */
export interface BackupInfo {
  name: string
  path: string
  timestamp: string
  legacy: boolean
  [field: string]: unknown
}

// ---------------------------------------------------------------------------
// UE4SS (see ue4ss) and HZMM self-update (see app-update / app-updater)
// ---------------------------------------------------------------------------

/** What ue4ss:status reports. `version` 'manual' = installed from a local zip. */
export interface Ue4ssStatus {
  status: 'uninstalled' | 'installed' | 'update'
  version: string | null
  publishedAt?: string | null
  structure?: 'experimental' | 'legacy'
  latestVersion?: string
}

export interface UpdateCheckInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  downloadUrl: string | null
  /** Lower-case hex from the release notes' `SHA256: <hex>` line. */
  expectedHash: string | null
  changelog: string
  /** Linux: true when running from an AppImage (in-place update possible). */
  autoInstall?: boolean
}

// ---------------------------------------------------------------------------
// Steam Workshop (dev-only browser, see steam-workshop-*)
// ---------------------------------------------------------------------------

export interface WorkshopBrowseOptions {
  appId?: number
  /** 'trend' | 'toprated' | 'mostrecent'; anything else falls back to 'trend'. */
  sort?: string
  page?: number
  search?: string
}

/** A GetPublishedFileDetails entry, as Steam sends it. */
export interface SteamPublishedFileDetails {
  /** 1 = OK; anything else is deleted / hidden. */
  result: number
  publishedfileid: string | number
  title?: string
  preview_url?: string
  subscriptions?: number | string
  favorited?: number | string
  views?: number | string
  file_size?: number | string
  time_updated?: number | string
  time_created?: number | string
  tags?: Array<{ tag?: string }>
  description?: string
}

/** A workshop item in the renderer's display shape. */
export interface WorkshopItem {
  id: string
  title: string
  previewUrl: string
  subscriptions: number
  favorited: number
  views: number
  fileSize: number
  timeUpdated: number
  timeCreated: number
  tags: string[]
  descriptionBBCode: string
  url: string
}

export interface WorkshopBrowseResult {
  ok: boolean
  items: WorkshopItem[]
  page: number
  hasNext: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Game version (see steam-detector; cached under `cachedGameVersion`)
// ---------------------------------------------------------------------------

/** From the Steam appmanifest / news feed, or the exe's file version as a fallback. */
export type GameVersionInfo =
  | { versionName: string | null; buildId: string | null; lastUpdated: string | null }
  | { fileVersion: string }

// ---------------------------------------------------------------------------
// Locale
// ---------------------------------------------------------------------------

export interface SupportedLocale {
  code: string
  /** The language's own name (endonym). */
  name: string
}
