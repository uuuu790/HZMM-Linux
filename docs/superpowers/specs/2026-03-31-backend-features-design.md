# HZMM Backend Features Design

## Overview

5 new backend features for HZMM Manager. All changes are in the Electron main process; frontend receives data via IPC.

**Supported by:** Existing IPC/service pattern (`src/main/ipc/` + `src/main/services/`), preload bridge (`src/preload/index.js`).

---

## Feature 1: App Auto-Update (User-Controlled)

### New Files
- `src/main/services/app-updater.js`
- `src/main/ipc/app-update.js`

### Service: `app-updater.js`

Uses GitHub Releases API (`https://api.github.com/repos/uuuu790/HZMM/releases/latest`) with the same `https.get` pattern as `github-release.js`.

```
checkForUpdate() -> { hasUpdate, currentVersion, latestVersion, downloadUrl, changelog }
downloadUpdate(url, onProgress) -> tempFilePath
```

- Compares `app.getVersion()` against release `tag_name` (semver string compare)
- Downloads `.exe` installer asset to `config-store.CONFIG_DIR/hzmm-update.exe`
- Reports download progress via callback (same pattern as UE4SS download)

### IPC: `app-update.js`

| Handler | Returns | Description |
|---------|---------|-------------|
| `app-update:check` | `{ hasUpdate, currentVersion, latestVersion, downloadUrl, changelog }` | Check GitHub for new version |
| `app-update:get-version` | `string` | Current app version from `app.getVersion()` |
| `app-update:download` | `{ filePath }` | Download installer to temp dir, sends `app-update:progress` events |
| `app-update:install` | void | Spawn downloaded exe detached, then `app.quit()` |

Progress event: `mainWindow.webContents.send('app-update:progress', percentNumber)`

### Flow
1. Frontend calls `app-update:check` (on app start or manual)
2. If `hasUpdate`, frontend shows notification with changelog
3. User clicks "Download" -> frontend calls `app-update:download`, shows progress bar
4. Download complete -> frontend shows "Install & Restart" button
5. User clicks -> frontend calls `app-update:install` -> spawns exe, app quits

### Preload API
```js
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
}
```

---

## Feature 2: Mod Conflict Detection (PAK Header Parsing)

### New Files
- `src/main/services/pak-parser.js`
- `src/main/ipc/conflicts.js`

### Service: `pak-parser.js`

Reads UE4/UE5 PAK file index without extracting data.

```
readPakIndex(filePath) -> string[] (list of resource paths)
```

**PAK format parsing steps:**
1. Read last 221 bytes of file (footer area)
2. Find magic bytes `0x5A6F12E1` to locate footer
3. Read footer: version, index offset, index size
4. Seek to index offset, read mount point string
5. Read entry count, then iterate entries reading each file path
6. Return array of resource paths (e.g., `Game/Content/Blueprints/MyMod/BP_Thing.uasset`)

**Supported versions:** PAK v7 through v11 (UE4.21 ~ UE5.4). Unsupported versions return empty array (no error).

**Encrypted PAKs:** If index is encrypted (flag in footer), return empty array. Cannot read without key.

### IPC: `conflicts.js`

| Handler | Returns | Description |
|---------|---------|-------------|
| `conflicts:scan` | `ConflictResult[]` | Scan all enabled PAK mods for overlapping resources |

```ts
// Return type
type ConflictResult = {
  resource: string        // e.g. "Game/Content/Maps/TestMap.umap"
  mods: string[]          // e.g. ["ModA.pak", "ModB.pak"]
}
```

**Logic:**
1. Get all enabled PAK mods from `scanMods()`
2. For each PAK, call `readPakIndex()` to get resource list
3. Build a `Map<resource, mod[]>` — group by resource path
4. Filter entries where `mods.length > 1`
5. Return conflict list

Only scans enabled `.pak` files. Disabled (`.pak.disabled`) are skipped.

### Preload API
```js
conflicts: {
  scan: () => ipcRenderer.invoke('conflicts:scan')
}
```

---

## Feature 3: Logger System

### New Files
- `src/main/services/logger.js`

### Service: `logger.js`

Writes to `%APPDATA%/hzmm-manager/hzmm.log`.

```
logger.info(message)
logger.warn(message)
logger.error(message)
```

**Format:** `[2026-03-31 14:30:00] [INFO] message text here`

**Rotation:** When file exceeds 5MB, rename to `hzmm.log.old` (overwrite previous old). Only 1 old file kept.

**Implementation:** Synchronous `fs.appendFileSync` — simple, no async complexity. Check size before each write.

### IPC (added to existing `settings.js` or new `logger-ipc.js`)

| Handler | Returns | Description |
|---------|---------|-------------|
| `logger:get-path` | `string` | Full path to log file |
| `logger:read-recent` | `string[]` | Last 100 lines of log |

### Modifications to Existing Code

Replace `console.error` calls with `logger.error` in:
- `mods.js` — install, toggle, remove failures
- `ue4ss.js` — download/deploy failures
- `game.js` — launch failure

Add `logger.info` for key operations:
- Mod installed / uninstalled / toggled
- UE4SS deployed / updated
- Game launched
- App started (with version)
- Language changed

### Preload API
```js
logger: {
  getPath: () => ipcRenderer.invoke('logger:get-path'),
  readRecent: () => ipcRenderer.invoke('logger:read-recent')
}
```

---

## Feature 4: Game Running Detection

### New Files
- `src/main/services/process-detector.js`

### Service: `process-detector.js`

```
isGameRunning() -> Promise<boolean>
```

**Implementation:** Run `tasklist /FI "IMAGENAME eq HumanitZ-Win64-Shipping.exe" /NH` via `execSync`. Parse output — if it contains the exe name, game is running.

**Fallback exe names:** Also check common variants:
- `HumanitZ-Win64-Shipping.exe`
- `HumanitZ.exe`

Uses the exe name derived from `getGameExe()` in `steam-detector.js` when available.

**Timeout:** `execSync` with `{ timeout: 3000 }` to avoid hanging.

### IPC (added to `game.js`)

| Handler | Returns | Description |
|---------|---------|-------------|
| `game:is-running` | `boolean` | Whether game process is currently running |

No polling/watching. Frontend calls on-demand before mod operations.

### Preload API
```js
// Added to existing game object
game: {
  ...existing,
  isRunning: () => ipcRenderer.invoke('game:is-running')
}
```

---

## Feature 5: Mod Metadata Cache

### Modified Files
- `src/main/ipc/mods.js`

### Design

In-memory cache only (no disk persistence). Cache invalidated by file changes.

**Cache structure:**
```js
let modCache = {
  pakDirMtimes: {},    // { dirPath: mtimeMs } — directory modification times
  ue4ssDirMtime: null, // UE4SS Mods dir mtime
  mods: [],            // cached scan result
  valid: false         // cache validity flag
}
```

**Cache hit logic:**
1. On `mods:scan`, check `mtime` of each Paks directory and UE4SS Mods directory
2. If all directory `mtime` values match cached values → return cached `mods[]`
3. If any mismatch → full rescan, update cache

**Why directory mtime:** Adding, removing, or renaming files in a directory updates the directory's `mtime`. This is a single `fs.statSync` call per directory instead of per-file, much faster with many mods.

**Invalidation:**
- `mods:install`, `mods:toggle`, `mods:remove` → set `modCache.valid = false` after operation
- `mods:invalidate-cache` → manual invalidation from frontend
- `profiles:restore-configs` → invalidate cache

### IPC

| Handler | Returns | Description |
|---------|---------|-------------|
| `mods:invalidate-cache` | `void` | Force cache invalidation |

### Preload API
```js
// Added to existing mods object
mods: {
  ...existing,
  invalidateCache: () => ipcRenderer.invoke('mods:invalidate-cache')
}
```

---

## File Summary

### New Files (6)
| File | Feature |
|------|---------|
| `src/main/services/app-updater.js` | App update check & download |
| `src/main/ipc/app-update.js` | App update IPC handlers |
| `src/main/services/pak-parser.js` | PAK file index reader |
| `src/main/ipc/conflicts.js` | Mod conflict detection IPC |
| `src/main/services/logger.js` | Log system |
| `src/main/services/process-detector.js` | Game running detection |

### Modified Files (5)
| File | Changes |
|------|---------|
| `src/main/index.js` | Register new IPC modules |
| `src/main/ipc/mods.js` | Add cache logic, replace console.error with logger |
| `src/main/ipc/ue4ss.js` | Replace console.error with logger |
| `src/main/ipc/game.js` | Add `game:is-running`, replace console.error with logger |
| `src/preload/index.js` | Expose new APIs |

---

## Frontend Handoff

After backend implementation, frontend will receive these new APIs:

```js
window.api.appUpdate.check()         // Check for updates
window.api.appUpdate.download()      // Download update
window.api.appUpdate.install()       // Install & quit
window.api.appUpdate.onProgress(cb)  // Download progress

window.api.conflicts.scan()          // Get mod conflicts

window.api.logger.getPath()          // Log file path
window.api.logger.readRecent()       // Last 100 log lines

window.api.game.isRunning()          // Game running check

window.api.mods.invalidateCache()    // Force rescan
```
