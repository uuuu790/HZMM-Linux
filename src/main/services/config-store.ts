import { app } from 'electron'
import { join } from 'path'
import os from 'os'
import fs from 'fs'
import type { ConfigKey, ConfigSchema } from '../ipc/types'

// A key outside the schema — settings:get / settings:set pass renderer-chosen
// names through as plain strings. A schema key resolves to `never` here, so a
// call with a known key and a mismatched value can't fall through to the
// untyped overload.
type OtherKey<K extends string> = K & (K extends ConfigKey ? never : unknown)

let CONFIG_DIR = ''
let CONFIG_FILE = ''

// Resolve %AppData%\Roaming directly via env / homedir, not via
// app.getPath('appData'). Reason: electron-builder portable builds and
// app.setName() timing in some Electron versions can momentarily shift
// the Electron-resolved app path during startup, and a stale resolution
// would land us writing/reading from a different folder across upgrades.
// process.env.APPDATA is the same directory Electron normally returns,
// just with no Electron lifecycle dependency.
function ensurePaths(): void {
  if (!CONFIG_DIR) {
    const appData = process.env.APPDATA
      || (app && typeof app.getPath === 'function' ? app.getPath('appData') : null)
      || join(os.homedir(), 'AppData', 'Roaming')
    CONFIG_DIR = join(appData, 'hzmm-manager')
    CONFIG_FILE = join(CONFIG_DIR, 'config.json')
  }
}

function ensureDir(): void {
  ensurePaths()
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function load(): Record<string, unknown> {
  if (cache) return cache
  ensureDir()
  if (!fs.existsSync(CONFIG_FILE)) {
    cache = {}
    return cache
  }
  try {
    cache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    // The file exists but is corrupt. Preserve it under a timestamped name
    // before falling back to {} — otherwise the next set() would overwrite the
    // (possibly recoverable) original with an empty object, silently wiping
    // gamePath / profiles / Nexus receipts / API key. No logger import here to
    // avoid a config-store <-> logger cycle; the backup file is the signal.
    try {
      fs.renameSync(CONFIG_FILE, `${CONFIG_FILE}.corrupt-${Date.now()}`)
    } catch { /* best-effort — fall through to empty cache */ }
    cache = {}
  }
  return cache as Record<string, unknown>
}

let cache: Record<string, unknown> | null = null

function save(): void {
  ensureDir()
  // Atomic write: tmp + rename. A power-cycle / hard-kill mid-write
  // would otherwise leave a truncated config.json, and load()'s silent
  // JSON.parse catch resets cache to {} — wiping the user's settings.
  const tmpPath = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8')
  fs.renameSync(tmpPath, CONFIG_FILE)
}

// Without a default (or with null), a missing key reads as null.
function get<K extends ConfigKey>(key: K, defaultValue?: null): ConfigSchema[K] | null
function get<K extends ConfigKey>(key: K, defaultValue: ConfigSchema[K]): ConfigSchema[K]
function get<K extends string>(key: OtherKey<K>, defaultValue?: unknown): unknown
function get(key: string, defaultValue: unknown = null): unknown {
  const data = load()
  // Object.hasOwn (not `data[key] !== undefined`) so keys like '__proto__' /
  // 'constructor' resolve to the default instead of an inherited prototype prop.
  return Object.hasOwn(data, key) ? data[key] : defaultValue
}

function set<K extends ConfigKey>(key: K, value: ConfigSchema[K]): void
function set<K extends string>(key: OtherKey<K>, value: unknown): void
function set(key: string, value: unknown): void {
  const data = load()
  data[key] = value
  save()
}

function remove(key: string): void {
  const data = load()
  delete data[key]
  save()
}

function getConfigDir(): string {
  ensurePaths()
  return CONFIG_DIR
}

export default { get, set, remove, getConfigDir }
