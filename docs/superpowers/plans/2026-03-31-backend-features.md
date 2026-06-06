# HZMM Backend Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 backend features to HZMM Manager: app auto-update, mod conflict detection, logger, game running detection, and mod cache.

**Architecture:** Each feature follows the existing pattern: service module in `src/main/services/` for logic, IPC handler in `src/main/ipc/` for exposure, preload bridge in `src/preload/index.js` for frontend access. Logger is implemented first as other features depend on it.

**Tech Stack:** Node.js (Electron main process), fs/https/child_process built-ins, UE4 PAK binary format parsing.

---

## Dependency Order

Logger (Task 1) must be implemented first — Tasks 2-5 import it. Tasks 2-5 are independent of each other. Task 6 (preload + registration) ties everything together. Task 7 updates existing code to use logger.

---

### Task 1: Logger Service

**Files:**
- Create: `src/main/services/logger.js`

- [ ] **Step 1: Create `src/main/services/logger.js`**

```js
import fs from 'fs'
import path from 'path'
import configStore from './config-store.js'

const LOG_FILE = path.join(configStore.CONFIG_DIR, 'hzmm.log')
const OLD_LOG_FILE = path.join(configStore.CONFIG_DIR, 'hzmm.log.old')
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

function ensureDir() {
  const dir = path.dirname(LOG_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function rotate() {
  try {
    const stat = fs.statSync(LOG_FILE)
    if (stat.size >= MAX_SIZE) {
      if (fs.existsSync(OLD_LOG_FILE)) fs.unlinkSync(OLD_LOG_FILE)
      fs.renameSync(LOG_FILE, OLD_LOG_FILE)
    }
  } catch {
    // File doesn't exist yet, nothing to rotate
  }
}

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function write(level, message) {
  ensureDir()
  rotate()
  const line = `[${timestamp()}] [${level}] ${message}\n`
  fs.appendFileSync(LOG_FILE, line, 'utf-8')
}

function readRecent(lineCount = 100) {
  if (!fs.existsSync(LOG_FILE)) return []
  const content = fs.readFileSync(LOG_FILE, 'utf-8')
  const lines = content.split('\n').filter(Boolean)
  return lines.slice(-lineCount)
}

const logger = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  getPath: () => LOG_FILE,
  readRecent
}

export default logger
```

- [ ] **Step 2: Verify file created correctly**

Run: `cat src/main/services/logger.js | head -5`
Expected: First 5 lines of the logger module visible.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/logger.js
git commit -m "feat: add logger service with rotation and read-recent"
```

---

### Task 2: App Auto-Update Service & IPC

**Files:**
- Create: `src/main/services/app-updater.js`
- Create: `src/main/ipc/app-update.js`

- [ ] **Step 1: Create `src/main/services/app-updater.js`**

```js
import https from 'https'
import { app } from 'electron'
import { downloadFile } from './archive.js'
import configStore from './config-store.js'
import path from 'path'
import fs from 'fs'
import logger from './logger.js'

const REPO = 'uuuu790/HZMM'

function githubGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      headers: {
        'User-Agent': 'HZMM-Manager/1.0.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    }

    https.get(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API error: HTTP ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Failed to parse GitHub response'))
        }
      })
    }).on('error', reject)
  })
}

function compareVersions(current, latest) {
  // Strip leading 'v' if present
  const a = current.replace(/^v/, '').split('.').map(Number)
  const b = latest.replace(/^v/, '').split('.').map(Number)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0
    const bv = b[i] || 0
    if (bv > av) return true
    if (bv < av) return false
  }
  return false
}

async function checkForUpdate() {
  const currentVersion = app.getVersion()
  logger.info(`Checking for updates... current version: ${currentVersion}`)

  const release = await githubGet(`/repos/${REPO}/releases/latest`)
  if (!release || !release.tag_name) {
    throw new Error('No release found')
  }

  const latestVersion = release.tag_name
  const hasUpdate = compareVersions(currentVersion, latestVersion)

  // Find .exe asset
  const asset = release.assets?.find(a => a.name.toLowerCase().endsWith('.exe'))

  const result = {
    hasUpdate,
    currentVersion,
    latestVersion,
    downloadUrl: asset?.browser_download_url || null,
    changelog: release.body || ''
  }

  if (hasUpdate) {
    logger.info(`Update available: ${latestVersion}`)
  } else {
    logger.info(`Already up to date: ${currentVersion}`)
  }

  return result
}

async function downloadUpdate(url, onProgress) {
  const destPath = path.join(configStore.CONFIG_DIR, 'hzmm-update.exe')

  // Clean up previous download
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath)

  logger.info(`Downloading update from: ${url}`)
  await downloadFile(url, destPath, onProgress)
  logger.info(`Update downloaded to: ${destPath}`)

  return destPath
}

export { checkForUpdate, downloadUpdate, compareVersions }
```

- [ ] **Step 2: Create `src/main/ipc/app-update.js`**

```js
import { ipcMain, app } from 'electron'
import { spawn } from 'child_process'
import { checkForUpdate, downloadUpdate } from '../services/app-updater.js'
import configStore from '../services/config-store.js'
import path from 'path'
import fs from 'fs'
import logger from '../services/logger.js'

function registerAppUpdateIpc(mainWindow) {
  ipcMain.handle('app-update:get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('app-update:check', async () => {
    try {
      return await checkForUpdate()
    } catch (err) {
      logger.error(`Update check failed: ${err.message}`)
      return { hasUpdate: false, currentVersion: app.getVersion(), error: err.message }
    }
  })

  ipcMain.handle('app-update:download', async () => {
    try {
      const updateInfo = await checkForUpdate()
      if (!updateInfo.hasUpdate || !updateInfo.downloadUrl) {
        throw new Error('No update available or no download URL')
      }

      const filePath = await downloadUpdate(updateInfo.downloadUrl, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-update:progress', progress)
        }
      })

      return { filePath }
    } catch (err) {
      logger.error(`Update download failed: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle('app-update:install', () => {
    const exePath = path.join(configStore.CONFIG_DIR, 'hzmm-update.exe')
    if (!fs.existsSync(exePath)) {
      throw new Error('Update file not found. Please download first.')
    }

    logger.info('Installing update and quitting app...')

    const child = spawn(exePath, [], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()

    app.quit()
  })
}

export { registerAppUpdateIpc }
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/app-updater.js src/main/ipc/app-update.js
git commit -m "feat: add app auto-update check, download, and install"
```

---

### Task 3: PAK Parser & Mod Conflict Detection

**Files:**
- Create: `src/main/services/pak-parser.js`
- Create: `src/main/ipc/conflicts.js`

- [ ] **Step 1: Create `src/main/services/pak-parser.js`**

```js
import fs from 'fs'
import logger from './logger.js'

const PAK_MAGIC = 0x5A6F12E1

// Footer sizes by version
// v7: 44 bytes, v8+: variable up to ~221 bytes
// We read 221 bytes from end to cover all versions
const FOOTER_READ_SIZE = 221

function readFString(buffer, offset) {
  // UE4 FString: int32 length (including null terminator), then UTF-8 or UTF-16 bytes
  if (offset + 4 > buffer.length) return { str: '', bytesRead: 4 }

  let strLen = buffer.readInt32LE(offset)
  if (strLen === 0) return { str: '', bytesRead: 4 }

  const isUnicode = strLen < 0
  if (isUnicode) {
    strLen = -strLen
    const byteLen = strLen * 2
    if (offset + 4 + byteLen > buffer.length) return { str: '', bytesRead: 4 + byteLen }
    const str = buffer.toString('utf16le', offset + 4, offset + 4 + byteLen - 2) // -2 for null
    return { str, bytesRead: 4 + byteLen }
  }

  if (offset + 4 + strLen > buffer.length) return { str: '', bytesRead: 4 + strLen }
  const str = buffer.toString('utf-8', offset + 4, offset + 4 + strLen - 1) // -1 for null
  return { str, bytesRead: 4 + strLen }
}

function parseFooter(buffer, fileSize) {
  // Search for magic from end of buffer
  // Footer structure (v7+):
  //   - EncryptionKeyGuid (16 bytes) [v7+]
  //   - bEncryptedIndex (1 byte) [v7+]
  //   - Magic (4 bytes, uint32 = 0x5A6F12E1)
  //   - Version (4 bytes, int32)
  //   - IndexOffset (8 bytes, int64)
  //   - IndexSize (8 bytes, int64)
  //   - IndexHash (20 bytes, SHA1)
  //   [v9+: additional compression fields]

  // Scan backwards for magic
  for (let i = buffer.length - 4; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === PAK_MAGIC) {
      const magicOffset = i

      // Read version (4 bytes after magic)
      if (magicOffset + 8 > buffer.length) continue
      const version = buffer.readInt32LE(magicOffset + 4)
      if (version < 1 || version > 11) continue

      // Read index offset (8 bytes after version)
      if (magicOffset + 16 > buffer.length) continue
      const indexOffset = Number(buffer.readBigInt64LE(magicOffset + 8))

      // Read index size (8 bytes after index offset)
      if (magicOffset + 24 > buffer.length) continue
      const indexSize = Number(buffer.readBigInt64LE(magicOffset + 16))

      // Check encrypted index flag (1 byte before magic)
      const bEncryptedIndex = magicOffset > 0 ? buffer.readUInt8(magicOffset - 1) : 0

      if (indexOffset >= 0 && indexOffset < fileSize && indexSize > 0 && indexSize < fileSize) {
        return { version, indexOffset, indexSize, bEncryptedIndex }
      }
    }
  }

  return null
}

function readPakIndex(filePath) {
  try {
    const stat = fs.statSync(filePath)
    const fileSize = stat.size
    if (fileSize < FOOTER_READ_SIZE) return []

    const fd = fs.openSync(filePath, 'r')

    try {
      // Read footer area
      const footerBuf = Buffer.alloc(FOOTER_READ_SIZE)
      fs.readSync(fd, footerBuf, 0, FOOTER_READ_SIZE, fileSize - FOOTER_READ_SIZE)

      const footer = parseFooter(footerBuf, fileSize)
      if (!footer) return []

      // Skip unsupported versions
      if (footer.version < 7 || footer.version > 11) return []

      // Skip encrypted indexes
      if (footer.bEncryptedIndex) return []

      // Read index
      const indexBuf = Buffer.alloc(footer.indexSize)
      fs.readSync(fd, indexBuf, 0, footer.indexSize, footer.indexOffset)

      // Parse index: mount point string, then entry count, then entries
      let offset = 0
      const { str: mountPoint, bytesRead: mpBytes } = readFString(indexBuf, offset)
      offset += mpBytes

      if (offset + 4 > indexBuf.length) return []
      const entryCount = indexBuf.readInt32LE(offset)
      offset += 4

      if (entryCount <= 0 || entryCount > 1000000) return [] // sanity check

      const entries = []
      for (let i = 0; i < entryCount; i++) {
        if (offset >= indexBuf.length) break
        const { str: fileName, bytesRead } = readFString(indexBuf, offset)
        offset += bytesRead

        if (fileName) {
          entries.push(mountPoint + fileName)
        }

        // Skip entry metadata (variable size depending on version)
        // v7-v8: offset(8) + size(8) + uncompressed(8) + compressionMethod(4) + hash(20) = 48 bytes
        // v9+: flags(4) + offset(4) + ... variable
        // We use a heuristic: skip to next FString by scanning for valid string length
        if (offset + 4 <= indexBuf.length) {
          // Try to read the compression block size or skip fixed entry data
          // Simplified: skip 48 bytes for standard entry (works for v7-v8)
          // For v9+, entry data is in a separate "full directory index"
          if (footer.version <= 8) {
            offset += 48
            // Skip compression blocks if present
            if (offset + 4 <= indexBuf.length) {
              const compressionBlockCount = indexBuf.readUInt32LE(offset)
              offset += 4
              offset += compressionBlockCount * 16 // each block: start(8) + end(8)
            }
            offset += 1 // bEncrypted flag
            offset += 4 // compressionBlockSize
          } else {
            // v9+ uses "path hash index" + "full directory index"
            // The entry data is encoded differently — we need to parse the encoded entries
            // For v10+, the index contains encoded entry info after the file name
            // Skip: flags(4) + offset(4 or 8) based on version
            offset += 12 // approximate skip for encoded entry
          }
        }
      }

      return entries
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    logger.warn(`Failed to parse PAK: ${filePath} — ${err.message}`)
    return []
  }
}

export { readPakIndex }
```

- [ ] **Step 2: Create `src/main/ipc/conflicts.js`**

```js
import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import configStore from '../services/config-store.js'
import { getAllPaksPaths } from '../services/steam-detector.js'
import { readPakIndex } from '../services/pak-parser.js'
import logger from '../services/logger.js'

function registerConflictsIpc() {
  ipcMain.handle('conflicts:scan', () => {
    const gamePath = configStore.get('gamePath')
    if (!gamePath) return []

    const paksPaths = getAllPaksPaths(gamePath)
    const modResources = new Map() // resource -> [modName, ...]

    for (const paksDir of paksPaths) {
      if (!fs.existsSync(paksDir)) continue

      const files = fs.readdirSync(paksDir)
      for (const file of files) {
        // Only enabled .pak files, skip game originals
        if (!file.endsWith('.pak')) continue
        const lower = file.toLowerCase()
        if (lower.startsWith('pakchunk') || lower.startsWith('global')) continue

        const filePath = path.join(paksDir, file)
        const stat = fs.statSync(filePath)
        if (!stat.isFile()) continue

        const entries = readPakIndex(filePath)
        for (const entry of entries) {
          if (!modResources.has(entry)) {
            modResources.set(entry, [])
          }
          modResources.get(entry).push(file)
        }
      }
    }

    // Filter to conflicts only (2+ mods touching same resource)
    const conflicts = []
    for (const [resource, mods] of modResources) {
      if (mods.length > 1) {
        conflicts.push({ resource, mods })
      }
    }

    logger.info(`Conflict scan complete: ${conflicts.length} conflicts found across ${paksPaths.length} directories`)
    return conflicts
  })
}

export { registerConflictsIpc }
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/pak-parser.js src/main/ipc/conflicts.js
git commit -m "feat: add PAK parser and mod conflict detection"
```

---

### Task 4: Game Running Detection

**Files:**
- Create: `src/main/services/process-detector.js`
- Modify: `src/main/ipc/game.js`

- [ ] **Step 1: Create `src/main/services/process-detector.js`**

```js
import { execSync } from 'child_process'
import path from 'path'
import logger from './logger.js'

const KNOWN_EXE_NAMES = [
  'HumanitZ-Win64-Shipping.exe',
  'HumanitZ.exe'
]

function isGameRunning(gameExePath) {
  // Build list of exe names to check
  const exeNames = [...KNOWN_EXE_NAMES]
  if (gameExePath) {
    const exeName = path.basename(gameExePath)
    if (!exeNames.includes(exeName)) {
      exeNames.unshift(exeName)
    }
  }

  for (const exeName of exeNames) {
    try {
      const output = execSync(
        `tasklist /FI "IMAGENAME eq ${exeName}" /NH`,
        { encoding: 'utf-8', windowsHide: true, timeout: 3000 }
      )
      // tasklist outputs "INFO: No tasks are running..." when not found
      if (output.includes(exeName)) {
        return true
      }
    } catch {
      // tasklist failed or timed out, try next exe name
      continue
    }
  }

  return false
}

export { isGameRunning }
```

- [ ] **Step 2: Add `game:is-running` IPC handler to `src/main/ipc/game.js`**

Add this import at the top of `game.js`:

```js
import { isGameRunning } from '../services/process-detector.js'
```

Add this handler inside `registerGameIpc(mainWindow)`, after the `game:launch` handler:

```js
  ipcMain.handle('game:is-running', () => {
    const gamePath = configStore.get('gamePath')
    const exePath = gamePath ? getGameExe(gamePath) : null
    return isGameRunning(exePath)
  })
```

- [ ] **Step 3: Commit**

```bash
git add src/main/services/process-detector.js src/main/ipc/game.js
git commit -m "feat: add game running detection via tasklist"
```

---

### Task 5: Mod Metadata Cache

**Files:**
- Modify: `src/main/ipc/mods.js`

- [ ] **Step 1: Add cache variables at the top of `src/main/ipc/mods.js`**

Add after the existing imports:

```js
// --- Mod scan cache ---
let modCache = {
  pakDirMtimes: {},
  ue4ssDirMtime: null,
  mods: [],
  valid: false
}

function getDirMtime(dirPath) {
  try {
    return fs.statSync(dirPath).mtimeMs
  } catch {
    return null
  }
}

function isCacheValid() {
  if (!modCache.valid) return false

  const gamePath = configStore.get('gamePath')
  if (!gamePath) return false

  // Check PAK directories
  const paksPaths = getAllPaksPaths(gamePath)
  for (const p of paksPaths) {
    const current = getDirMtime(p)
    if (current !== modCache.pakDirMtimes[p]) return false
  }

  // Check UE4SS Mods directory
  const ue4ssModsPath = getUe4ssModsPath(gamePath)
  if (ue4ssModsPath) {
    const current = getDirMtime(ue4ssModsPath)
    if (current !== modCache.ue4ssDirMtime) return false
  }

  return true
}

function updateCacheState(mods) {
  const gamePath = configStore.get('gamePath')
  if (!gamePath) return

  const paksPaths = getAllPaksPaths(gamePath)
  const pakDirMtimes = {}
  for (const p of paksPaths) {
    pakDirMtimes[p] = getDirMtime(p)
  }

  const ue4ssModsPath = getUe4ssModsPath(gamePath)

  modCache = {
    pakDirMtimes,
    ue4ssDirMtime: ue4ssModsPath ? getDirMtime(ue4ssModsPath) : null,
    mods,
    valid: true
  }
}

function invalidateCache() {
  modCache.valid = false
}
```

- [ ] **Step 2: Modify the `mods:scan` handler**

Replace the existing `mods:scan` handler:

```js
  ipcMain.handle('mods:scan', () => {
    if (isCacheValid()) {
      return modCache.mods
    }
    const mods = scanMods()
    updateCacheState(mods)
    return mods
  })
```

- [ ] **Step 3: Add cache invalidation after mutation operations**

Add `invalidateCache()` call at the end of these existing handlers (before the return):
- `mods:toggle` — add `invalidateCache()` before the final `return`
- `mods:install` — `installMods` function: add `invalidateCache()` before `return installed`
- `mods:remove` — add `invalidateCache()` before `return true`
- `profiles:restore-configs` — add `invalidateCache()` before `return true`

- [ ] **Step 4: Add `mods:invalidate-cache` handler**

Add inside `registerModsIpc`:

```js
  ipcMain.handle('mods:invalidate-cache', () => {
    invalidateCache()
  })
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/mods.js
git commit -m "feat: add in-memory mod scan cache with dir mtime validation"
```

---

### Task 6: Preload Bridge & Main Process Registration

**Files:**
- Modify: `src/preload/index.js`
- Modify: `src/main/index.js`

- [ ] **Step 1: Add new APIs to `src/preload/index.js`**

Add inside the `contextBridge.exposeInMainWorld('api', { ... })` object, before the `// --- 系統 ---` comment:

```js
  // --- App 更新 ---
  appUpdate: {
    check: () => ipcRenderer.invoke('app-update:check'),
    getVersion: () => ipcRenderer.invoke('app-update:get-version'),
    download: () => ipcRenderer.invoke('app-update:download'),
    install: () => ipcRenderer.invoke('app-update:install'),
    onProgress: (cb) => {
      const handler = (_, progress) => cb(progress)
      ipcRenderer.on('app-update:progress', handler)
      return () => ipcRenderer.removeListener('app-update:progress', handler)
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
```

Add `isRunning` to the existing `game` object:

```js
  game: {
    ...existing entries...,
    isRunning: () => ipcRenderer.invoke('game:is-running')
  },
```

Add `invalidateCache` to the existing `mods` object:

```js
  mods: {
    ...existing entries...,
    invalidateCache: () => ipcRenderer.invoke('mods:invalidate-cache')
  },
```

- [ ] **Step 2: Register new IPC modules in `src/main/index.js`**

Add imports:

```js
import { registerAppUpdateIpc } from './ipc/app-update'
import { registerConflictsIpc } from './ipc/conflicts'
import logger from './services/logger.js'
```

Add registrations after `registerLocaleIpc()`:

```js
  registerAppUpdateIpc(mainWindow)
  registerConflictsIpc()
```

Add logger IPC handlers (inline, no separate file needed):

```js
  // Logger IPC
  const { ipcMain: ipc } = require('electron')
  ipc.handle('logger:get-path', () => logger.getPath())
  ipc.handle('logger:read-recent', () => logger.readRecent())
```

Add startup log:

```js
  logger.info(`HZMM Manager started — version ${app.getVersion()}`)
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.js src/main/index.js
git commit -m "feat: register all new IPC modules and expose preload APIs"
```

---

### Task 7: Integrate Logger into Existing Code

**Files:**
- Modify: `src/main/ipc/mods.js`
- Modify: `src/main/ipc/ue4ss.js`
- Modify: `src/main/ipc/game.js`
- Modify: `src/main/ipc/locale.js`

- [ ] **Step 1: Add logger to `src/main/ipc/mods.js`**

Add import at top:

```js
import logger from '../services/logger.js'
```

Add logging to `installMods` function, after `installed.push(...)`:

```js
logger.info(`Mod installed: ${path.basename(filePath)} (type: ${type || 'pak-only'})`)
```

Add logging to `mods:toggle` handler, before the return statements:

```js
// In PAK toggle, before return:
logger.info(`Mod toggled: ${filename} → ${newPath.endsWith('.pak') ? 'enabled' : 'disabled'}`)

// In UE4SS toggle, before return:
logger.info(`Mod toggled: ${filename} → ${!isEnabled ? 'enabled' : 'disabled'}`)
```

Add logging to `mods:remove` handler, before `return true`:

```js
logger.info(`Mod removed: ${filename}`)
```

- [ ] **Step 2: Add logger to `src/main/ipc/ue4ss.js`**

Add import at top:

```js
import logger from '../services/logger.js'
```

In `doInstall`, replace the existing code after `configStore.set('ue4ssVersion', ...)`:

```js
logger.info(`UE4SS deployed: version ${release.version}`)
```

Add to the catch in `ue4ss:status` (the `catch` block that currently does nothing):

```js
} catch (err) {
  logger.warn(`UE4SS status check failed: ${err.message}`)
  return local
}
```

- [ ] **Step 3: Add logger to `src/main/ipc/game.js`**

Add import at top:

```js
import logger from '../services/logger.js'
```

In `game:launch`, before `return true`:

```js
logger.info(`Game launched: ${exePath}`)
```

In `game:detect-path`, after `configStore.set('gamePath', detected)`:

```js
logger.info(`Game path detected: ${detected}`)
```

- [ ] **Step 4: Add logger to `src/main/ipc/locale.js`**

Add import at top:

```js
import logger from '../services/logger.js'
```

In `locale:set-preference`, before `return true`:

```js
logger.info(`Language changed to: ${code}`)
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/mods.js src/main/ipc/ue4ss.js src/main/ipc/game.js src/main/ipc/locale.js
git commit -m "feat: integrate logger across all IPC modules"
```

---

### Task 8: Final Verification & Push

- [ ] **Step 1: Verify all files exist**

```bash
ls src/main/services/logger.js src/main/services/app-updater.js src/main/services/pak-parser.js src/main/services/process-detector.js src/main/ipc/app-update.js src/main/ipc/conflicts.js
```

Expected: All 6 files listed.

- [ ] **Step 2: Check git status is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

- [ ] **Step 3: Review git log**

```bash
git log --oneline
```

Expected: 8 commits (1 initial + 7 feature commits).

- [ ] **Step 4: Push to GitHub**

```bash
git push origin master
```

Expected: Push succeeds to `uuuu790/HZMM`.
