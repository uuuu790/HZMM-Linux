import StreamZip from 'node-stream-zip'
import { createExtractorFromFile } from 'node-unrar-js'
import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { isPathWithin } from './path-safety.js'

// Zip Slip 防護：檢查解壓路徑是否超出目標目錄
function isSafePath(entryName, destDir) {
  return isPathWithin(destDir, path.resolve(destDir, entryName))
}

function validateEntries(entryNames, destDir) {
  for (const name of entryNames) {
    if (!isSafePath(name, destDir)) {
      throw new Error(`Blocked path traversal in archive: ${name}`)
    }
  }
}

// 分析壓縮檔內部結構，判斷 mod 類型與安裝方式
function analyzeArchiveStructure(entryNames) {
  const pakFiles = entryNames.filter(n => n.endsWith('.pak') || n.endsWith('.ucas') || n.endsWith('.utoc'))
  const luaFiles = entryNames.filter(n => n.endsWith('.lua'))
  const dllFiles = entryNames.filter(n => n.endsWith('.dll'))
  const hasEnabledTxt = entryNames.some(n => path.basename(n) === 'enabled.txt')
  const hasModManifest = entryNames.some(n => path.basename(n) === 'modManifest.json')

  // 偵測是否有遊戲目錄結構（如 HumanitZ/Content/Paks/ 或 HumanitZ/Binaries/）
  const hasGameStructure = entryNames.some(n =>
    n.match(/^HumanitZ\/(Content|Binaries)\//i)
  )

  // UE4SS mod 偵測：
  // 1. 有 enabled.txt + lua 腳本
  // 2. 有 Scripts/main.lua 或 main.lua 結構（常見 UE4SS mod 不附 enabled.txt）
  // 3. 有 dll 但無 pak（UE4SS C++ mod）
  const hasScriptsMain = entryNames.some(n => n.replace(/\\/g, '/').match(/Scripts\/main\.lua$/i))
  const hasMainLua = entryNames.some(n => path.basename(n) === 'main.lua')
  const isUe4ssMod =
    (luaFiles.length > 0 && hasEnabledTxt) ||
    hasScriptsMain ||
    (hasMainLua && luaFiles.length > 0) ||
    (dllFiles.length > 0 && pakFiles.length === 0 && luaFiles.length === 0)

  // Find readme files in the archive
  const readmeNames = new Set(['readme.md', 'readme.txt', 'readme', 'description.txt', 'info.txt'])
  const readmeFiles = entryNames.filter(n => readmeNames.has(path.basename(n).toLowerCase()))

  // Build mod summary list for preview display
  const mods = []
  for (const p of pakFiles) {
    const name = path.basename(p).replace(/\.(pak|ucas|utoc)$/i, '').replace(/_P$/, '')
    mods.push({ name, modType: 'PAK' })
  }
  // UE4SS mod folders: find folder containing Scripts/main.lua or main.lua
  const ue4ssFolders = new Set()
  for (const l of luaFiles) {
    const parts = l.replace(/\\/g, '/').split('/')
    const idx = parts.findIndex(p => p.toLowerCase() === 'scripts')
    if (idx > 0) ue4ssFolders.add(parts[idx - 1])
    else if (parts.length >= 2) ue4ssFolders.add(parts[parts.length - 2])
  }
  for (const d of dllFiles) {
    const parts = d.replace(/\\/g, '/').split('/')
    // Cppmod standard layout is `<Mod>/dlls/main.dll`. The parent of `dlls/`
    // is the mod folder name; without stepping up an extra level we'd record
    // `'dlls'` and downstream rotate/restore would look at the wrong path.
    const dllsIdx = parts.findIndex(p => p.toLowerCase() === 'dlls')
    if (dllsIdx > 0) ue4ssFolders.add(parts[dllsIdx - 1])
    else if (parts.length >= 2) ue4ssFolders.add(parts[parts.length - 2])
  }
  for (const folder of ue4ssFolders) {
    mods.push({ name: folder, modType: 'UE4SS' })
  }

  // 混合型：同時有 PAK + UE4SS
  if (isUe4ssMod && pakFiles.length > 0) {
    return { type: 'hybrid', hasGameStructure, pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  // UE4SS 優先：即使包在遊戲目錄結構裡，有 UE4SS 特徵就判定為 UE4SS mod
  if (isUe4ssMod) {
    return { type: 'ue4ss-mod', hasGameStructure, pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  if (hasGameStructure) {
    return { type: 'game-structure', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  if (pakFiles.length > 0 && !luaFiles.length && !dllFiles.length && !hasModManifest) {
    return { type: 'pak-only', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
  }

  // 複合型 mod（含 dll/manifest 等）
  return { type: 'complex', pakFiles, luaFiles, dllFiles, mods, readmeFiles }
}

async function extractZip(zipPath, destDir, analyzeOnly = false) {
  // skipEntryNameValidation: some zip tools (e.g. Windows built-in) produce backslash paths
  // which node-stream-zip rejects as "Malicious entry"
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryNames = Object.values(entries).map(e => e.name.replace(/\\/g, '/'))
    const analysis = analyzeArchiveStructure(entryNames)

    if (analyzeOnly) return { ...analysis, entryNames }

    validateEntries(entryNames, destDir)
    fs.mkdirSync(destDir, { recursive: true })

    if (analysis.type === 'pak-only') {
      for (const pakFile of analysis.pakFiles) {
        const fileName = path.basename(pakFile)
        await zip.extract(pakFile, path.join(destDir, fileName))
      }
    } else {
      await zip.extract(null, destDir)
    }

    return analysis
  } finally {
    await zip.close()
  }
}

function copyFile(src, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, path.basename(src))
  fs.copyFileSync(src, destPath)
  return destPath
}

// Kill the download if no bytes flow for this long. setTimeout on the
// underlying request is an idle timeout: it resets on every chunk, so big
// downloads won't trip it as long as the server is sending data.
const DOWNLOAD_IDLE_TIMEOUT_MS = 60000

// `allowedHosts` (optional) enforces the host allowlist on EVERY hop of a
// redirect chain. Without this the initial-URL check at the caller is moot:
// a 302 to an arbitrary host would be followed unconditionally. Callers that
// already trust the user-supplied URL (mods:download-url, nexus) pass null.
function downloadFile(url, destPath, onProgress, allowedHosts = null) {
  return new Promise((resolve, reject) => {
    const isAllowed = (target) => {
      if (!allowedHosts) return true
      try {
        const u = new URL(target)
        if (u.protocol !== 'https:') return false
        return allowedHosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))
      } catch {
        return false
      }
    }
    const doRequest = (downloadUrl) => {
      if (!isAllowed(downloadUrl)) {
        reject(new Error(`Download blocked: ${downloadUrl} is not in the allowed host list`))
        return
      }
      const protocol = downloadUrl.startsWith('https') ? https : http
      const req = protocol.get(downloadUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location)
          return
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume()
          reject(new Error(`Download failed with HTTP ${res.statusCode}`))
          return
        }

        // Detect HTML responses (mod page URLs instead of direct download links)
        const contentType = res.headers['content-type'] || ''
        if (contentType.includes('text/html')) {
          res.resume()
          reject(new Error('URL is a web page, not a direct download link. Please use a direct .zip/.rar/.pak file URL.'))
          return
        }

        const totalSize = parseInt(res.headers['content-length'], 10)
        let downloaded = 0
        if (onProgress && totalSize) {
          res.on('data', (chunk) => {
            downloaded += chunk.length
            onProgress(Math.round((downloaded / totalSize) * 100))
          })
        }

        const file = fs.createWriteStream(destPath)
        // pipeline() handles back-pressure, wires up errors on both streams,
        // and avoids double-unlink races from manual .on('error') handlers.
        pipeline(res, file)
          .then(() => resolve(destPath))
          .catch((err) => {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
            } catch {
              // best-effort cleanup — ignore if the partial file can't be removed
            }
            reject(err)
          })
      })
      req.on('error', reject)
      req.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
        req.destroy()
        reject(new Error('Download stalled (no data for 60s)'))
      })
    }

    doRequest(url)
  })
}

async function extractRar(rarPath, destDir, analyzeOnly = false) {
  const extractor = await createExtractorFromFile({ filepath: rarPath })

  const list = extractor.getFileList()
  const fileHeaders = [...list.fileHeaders]
  const entryNames = fileHeaders.map(h => h.name)

  const analysis = analyzeArchiveStructure(entryNames)

  if (analyzeOnly) return { ...analysis, entryNames }

  validateEntries(entryNames, destDir)
  fs.mkdirSync(destDir, { recursive: true })

  // 重新建立 extractor 來解壓（getFileList 後需重建）
  const extractor2 = await createExtractorFromFile({ filepath: rarPath, targetPath: destDir })

  if (analysis.type === 'pak-only') {
    const extracted = extractor2.extract({ files: analysis.pakFiles })
    const files = [...extracted.files]
    // node-unrar-js extract 到 targetPath，但保留子目錄結構
    // 將深層 .pak 移到 destDir 根目錄
    for (const f of files) {
      if (f.fileHeader.flags.directory) continue
      const extractedPath = path.join(destDir, f.fileHeader.name)
      const targetPath = path.join(destDir, path.basename(f.fileHeader.name))
      if (extractedPath !== targetPath && fs.existsSync(extractedPath)) {
        fs.renameSync(extractedPath, targetPath)
      }
    }
  } else {
    const extracted = extractor2.extract()
    // 必須迭代 generator 才會實際解壓檔案
    ;[...extracted.files]
  }

  return analysis
}

async function extractZipRaw(zipPath, destDir) {
  const zip = new StreamZip.async({ file: zipPath, skipEntryNameValidation: true })
  try {
    const entries = await zip.entries()
    const entryNames = Object.values(entries).map(e => e.name.replace(/\\/g, '/'))
    validateEntries(entryNames, destDir)
    fs.mkdirSync(destDir, { recursive: true })
    await zip.extract(null, destDir)
    return true
  } finally {
    await zip.close()
  }
}

export {
  extractZip,
  extractZipRaw,
  extractRar,
  copyFile,
  downloadFile,
  analyzeArchiveStructure,
  isSafePath,
  validateEntries,
}
