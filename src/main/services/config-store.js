import { app } from 'electron'
import { join } from 'path'
import os from 'os'
import fs from 'fs'

let CONFIG_DIR = null
let CONFIG_FILE = null

// Resolve %AppData%\Roaming directly via env / homedir, not via
// app.getPath('appData'). Reason: electron-builder portable builds and
// app.setName() timing in some Electron versions can momentarily shift
// the Electron-resolved app path during startup, and a stale resolution
// would land us writing/reading from a different folder across upgrades.
// process.env.APPDATA is the same directory Electron normally returns,
// just with no Electron lifecycle dependency.
function ensurePaths() {
  if (!CONFIG_DIR) {
    const appData = process.env.APPDATA
      || (app && typeof app.getPath === 'function' ? app.getPath('appData') : null)
      || join(os.homedir(), 'AppData', 'Roaming')
    CONFIG_DIR = join(appData, 'hzmm-manager')
    CONFIG_FILE = join(CONFIG_DIR, 'config.json')
  }
}

function ensureDir() {
  ensurePaths()
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function load() {
  if (cache) return cache
  ensureDir()
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    } else {
      cache = {}
    }
  } catch {
    cache = {}
  }
  return cache
}

let cache = null

function save() {
  ensureDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cache, null, 2), 'utf-8')
}

function get(key, defaultValue = null) {
  const data = load()
  return data[key] !== undefined ? data[key] : defaultValue
}

function set(key, value) {
  load()
  cache[key] = value
  save()
}

function remove(key) {
  load()
  delete cache[key]
  save()
}

function getConfigDir() {
  ensurePaths()
  return CONFIG_DIR
}

export default { get, set, remove, getConfigDir }
