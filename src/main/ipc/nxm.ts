// nxm:// protocol handler — the Nexus website's "Mod Manager Download" button.
//
// An nxm link (nxm://humanitz/mods/123/files/456?key=..&expires=..&user_id=..)
// carries a short-lived signed token that makes the V1 download_link endpoint
// work for FREE accounts (the plain endpoint is Premium-only). Registering as
// the OS handler for nxm: is therefore the one-click install path for
// non-Premium users.
//
// nxm: is a GLOBAL protocol shared by every Nexus game — taking it over also
// takes it from Vortex / MO2 (under Proton/Wine). Registration is opt-in
// (Settings toggle, default OFF); links for other games get a "wrong game"
// toast and are dropped.
//
// Linux fork: Electron's setAsDefaultProtocolClient writes nothing useful for
// an AppImage (no installed .desktop entry), so registration is done the
// freedesktop way — write a per-user .desktop file whose Exec points at the
// AppImage / binary, then set it as the x-scheme-handler/nxm default via
// xdg-mime. The OS then delivers clicked links as a plain argv argument,
// exactly like Windows, so the argv scanning below is shared.

import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import configStore from '../services/config-store'
import logger from '../services/logger'
import { resolveNexusDownloadUrl, downloadAndInstallResolvedFile } from './mods-download'
import { recordInstall, flattenLandedMods } from './nexus-install-tracker'
import { runUpdateWithStateRestore } from './mods-update-flow'
import { GAME_DOMAIN } from './nexus-v2-client'

/** A validated nxm:// link. key/expires are null when absent or malformed. */
export interface NxmLink {
  game: string
  modId: number
  fileId: number
  key: string | null
  expires: string | null
}

// Parse + validate an nxm:// URL. Returns null unless every part is
// well-formed: nxm://{game}/mods/{modId}/files/{fileId}[?key=..&expires=..].
// key/expires are length-bounded and character-restricted here, BEFORE they
// are ever echoed into an API query string.
export function parseNxmUrl(urlStr: unknown): NxmLink | null {
  if (typeof urlStr !== 'string' || urlStr.length > 2048) return null
  let u: URL
  try { u = new URL(urlStr) } catch { return null }
  if (u.protocol !== 'nxm:') return null
  const game = u.hostname.toLowerCase()
  if (!/^[a-z0-9]+$/.test(game)) return null
  const m = u.pathname.match(/^\/mods\/(\d{1,10})\/files\/(\d{1,10})\/?$/)
  if (!m) return null
  const modId = parseInt(m[1], 10)
  const fileId = parseInt(m[2], 10)
  if (!Number.isInteger(modId) || modId <= 0) return null
  if (!Number.isInteger(fileId) || fileId <= 0) return null
  const rawKey = u.searchParams.get('key')
  const rawExpires = u.searchParams.get('expires')
  const key = rawKey && /^[\w-]{1,256}$/.test(rawKey) ? rawKey : null
  const expires = rawExpires && /^\d{1,20}$/.test(rawExpires) ? rawExpires : null
  return { game, modId, fileId, key, expires }
}

// First nxm:// string in an argv array (cold start / second-instance both
// deliver the clicked link as a plain argument).
export function findNxmUrlInArgv(argv: unknown): string | null {
  return (Array.isArray(argv) ? argv : []).find((a: unknown): a is string => typeof a === 'string' && a.startsWith('nxm://')) || null
}

const DESKTOP_FILE_NAME = 'hzmm-manager-nxm.desktop'

function desktopDir(): string {
  return path.join(os.homedir(), '.local', 'share', 'applications')
}

// Desktop Entry Exec quoting: double-quote the argument and escape the
// characters the spec treats specially inside quotes. AppImage paths commonly
// contain spaces ("HZMM Manager-1.0.0.AppImage").
function quoteExec(p: unknown): string {
  return '"' + String(p).replace(/[\\"`$]/g, '\\$&') + '"'
}

interface ExecCommandInput {
  appImagePath: string | null
  execPath: string
  isPackaged: boolean
  appArg: string
}

// The command the OS runs for a clicked nxm link, per install flavor:
// AppImage -> the AppImage itself; packaged deb -> the installed binary;
// dev run -> electron + the app dir (mirrors the Windows dev handling).
export function buildExecCommand({ appImagePath, execPath, isPackaged, appArg }: ExecCommandInput): string {
  if (appImagePath) return `${quoteExec(appImagePath)} %u`
  if (isPackaged) return `${quoteExec(execPath)} %u`
  return `${quoteExec(execPath)} ${quoteExec(appArg)} %u`
}

export function buildDesktopEntry(execCommand: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=HZMM Manager (nxm link handler)',
    'NoDisplay=true',
    `Exec=${execCommand}`,
    'MimeType=x-scheme-handler/nxm;',
    'Terminal=false',
  ].join('\n') + '\n'
}

export function registerNxmProtocol(): boolean {
  try {
    const dir = desktopDir()
    fs.mkdirSync(dir, { recursive: true })
    const execCommand = buildExecCommand({
      appImagePath: process.env.APPIMAGE || null,
      execPath: process.execPath,
      isPackaged: app.isPackaged,
      appArg: path.resolve(process.argv[1] || '.'),
    })
    fs.writeFileSync(path.join(dir, DESKTOP_FILE_NAME), buildDesktopEntry(execCommand), 'utf-8')
    execFileSync('xdg-mime', ['default', DESKTOP_FILE_NAME, 'x-scheme-handler/nxm'], { timeout: 5000 })
    // Refresh the desktop database so the handler is picked up without a
    // re-login; absence of the tool is harmless (many distros do this lazily).
    try { execFileSync('update-desktop-database', [dir], { timeout: 5000 }) } catch { /* optional tool */ }
    return true
  } catch (err) {
    logger.warn(`nxm: Linux protocol registration failed: ${(err as Error).message}`)
    return false
  }
}

export function unregisterNxmProtocol(): boolean {
  // xdg-mime has no "unset" — removing the .desktop file invalidates the
  // default and the next nxm click falls through to whatever else is
  // installed (Vortex under Proton, etc.).
  try { fs.unlinkSync(path.join(desktopDir(), DESKTOP_FILE_NAME)) } catch { /* not registered */ }
  return true
}

function isNxmProtocolClient(): boolean {
  try {
    const out = execFileSync('xdg-mime', ['query', 'default', 'x-scheme-handler/nxm'], { timeout: 5000, encoding: 'utf-8' })
    return out.trim() === DESKTOP_FILE_NAME
  } catch {
    return false
  }
}

// Re-assert the registration on startup when the user opted in — the .desktop
// Exec points at an absolute path, and the AppImage may have moved (or been
// replaced by the in-app updater) since it was written.
export function ensureNxmRegistration(): void {
  if (configStore.get('nxmHandlerEnabled', false)) {
    if (!registerNxmProtocol()) logger.warn('nxm: protocol re-registration failed')
  }
}

// Window-scoped: re-bound on every createWindow so a rebuilt window keeps
// receiving nxm toasts (the IPC registration below is one-time).
let windowRef: BrowserWindow | null = null

export function initNxmHandler(mainWindow: BrowserWindow): void {
  windowRef = mainWindow
}

function send(channel: string, payload: unknown): void {
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send(channel, payload)
}

const nxmInFlight = new Set<string>()

// Entry point for both launch paths: cold start (own argv, deferred until the
// renderer loaded) and second-instance (commandLine argv).
export async function handleNxmUrl(urlStr: unknown): Promise<void> {
  const parsed = parseNxmUrl(urlStr)
  if (!parsed) {
    logger.warn('nxm: dropped malformed link')
    return
  }
  // The OS can still deliver links while the toggle is off (e.g. the .desktop
  // entry survived a config reset) — respect the setting, not the registration.
  if (!configStore.get('nxmHandlerEnabled', false)) {
    logger.warn('nxm: link received while handler disabled — ignored')
    return
  }
  if (parsed.game !== GAME_DOMAIN) {
    logger.info(`nxm: link for other game "${parsed.game}" — ignored`)
    send('nxm:wrong-game', { game: parsed.game })
    return
  }
  const apiKey = configStore.get('nexusApiKey')
  if (!apiKey) {
    send('nxm:install-failed', { modId: parsed.modId, error: 'NEXUS_API_KEY_REQUIRED' })
    return
  }
  const lockKey = `${parsed.modId}:${parsed.fileId}`
  if (nxmInFlight.has(lockKey)) return
  nxmInFlight.add(lockKey)
  send('nxm:install-started', { modId: parsed.modId, fileId: parsed.fileId })
  try {
    const resolved = await resolveNexusDownloadUrl(
      { game: parsed.game, modId: parsed.modId, fileId: parsed.fileId, key: parsed.key, expires: parsed.expires },
      apiKey
    )
    // Route through the shared snapshot/restore + version-retention wrapper
    // (same as nexus:update-file): when the incoming file replaces a tracked
    // receipt this is the free-account update path — enabled-state, edited
    // configs, load-order prefixes and rollback behave exactly like the
    // Premium one-click update. For an untracked mod (or a fresh variant of a
    // tracked one) the wrapper finds no receipt and degrades to a plain
    // install. recordInstall runs INSIDE the install step (mirrors
    // performInstallFile) so the restore step's receipt migration (load-order
    // prefix rename) covers the fresh receipt too — recording after restore
    // would overwrite the migrated name.
    const install = async () => {
      const r = await downloadAndInstallResolvedFile(resolved, { modId: parsed.modId, fileId: parsed.fileId }, windowRef)
      // Best-effort: the files already landed — a receipt write failure must
      // not fail the install (and must not trip the update wrapper's
      // failed-install snapshot cleanup). The wrapper's receipt retirement
      // no-ops when the new receipt is missing, so nothing is orphaned.
      try {
        recordInstall(parsed.modId, parsed.fileId, flattenLandedMods(r), resolved.version ?? null)
      } catch (err) {
        logger.warn(`nxm: receipt record failed: ${(err as Error).message}`)
      }
      return r
    }
    const { result, wasUpdate } = await runUpdateWithStateRestore(parsed.modId, parsed.fileId, install)
    const landed = flattenLandedMods(result)
    logger.info(`nxm: ${wasUpdate ? 'updated' : 'installed'} mod ${parsed.modId} file ${parsed.fileId}`)
    send('nxm:install-done', { modId: parsed.modId, fileId: parsed.fileId, mods: landed, updated: wasUpdate })
  } catch (err) {
    // Resolver/downloader errors are already host-only (no token leakage).
    logger.warn(`nxm: install failed for ${lockKey}: ${(err as Error).message}`)
    send('nxm:install-failed', { modId: parsed.modId, error: (err as Error).message })
  } finally {
    nxmInFlight.delete(lockKey)
  }
}

export function registerNxmIpc(): void {
  ipcMain.handle('nxm:get-status', () => ({
    enabled: !!configStore.get('nxmHandlerEnabled', false),
    isDefault: isNxmProtocolClient(),
  }))

  // Dedicated handler, NOT the settings:set whitelist: flipping this touches
  // OS state (protocol registration), so it goes through explicit IPC the same
  // way gamePath only goes through the validating game:set-path.
  ipcMain.handle('nxm:set-enabled', (_: IpcMainInvokeEvent, enabled: unknown) => {
    const on = !!enabled
    if (on) {
      if (!registerNxmProtocol()) {
        return { enabled: false, isDefault: isNxmProtocolClient(), error: 'register-failed' }
      }
    } else {
      unregisterNxmProtocol()
    }
    configStore.set('nxmHandlerEnabled', on)
    logger.info(`nxm: handler ${on ? 'enabled' : 'disabled'}`)
    return { enabled: on, isDefault: isNxmProtocolClient() }
  })
}
