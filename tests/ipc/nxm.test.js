import { describe, it, expect } from 'vitest'
import { parseNxmUrl, findNxmUrlInArgv, buildExecCommand, buildDesktopEntry } from '../../src/main/ipc/nxm.js'

// parseNxmUrl gates everything the nxm:// handler does with OS-supplied input,
// so it must reject anything that is not exactly
// nxm://{game}/mods/{modId}/files/{fileId}[?key=..&expires=..].
describe('parseNxmUrl', () => {
  it('parses a canonical Mod Manager Download link', () => {
    const p = parseNxmUrl('nxm://humanitz/mods/82/files/433?key=abc-DEF_123&expires=1750000000&user_id=1')
    expect(p).toEqual({ game: 'humanitz', modId: 82, fileId: 433, key: 'abc-DEF_123', expires: '1750000000' })
  })

  it('parses a keyless (Premium) link with null token parts', () => {
    const p = parseNxmUrl('nxm://humanitz/mods/82/files/433')
    expect(p).toEqual({ game: 'humanitz', modId: 82, fileId: 433, key: null, expires: null })
  })

  it('lowercases the game domain and tolerates a trailing slash', () => {
    const p = parseNxmUrl('nxm://HumanitZ/mods/1/files/2/')
    expect(p?.game).toBe('humanitz')
  })

  it('rejects other protocols and malformed paths', () => {
    expect(parseNxmUrl('https://humanitz/mods/1/files/2')).toBe(null)
    expect(parseNxmUrl('nxm://humanitz/mods/1')).toBe(null)
    expect(parseNxmUrl('nxm://humanitz/mods/1/files/x')).toBe(null)
    expect(parseNxmUrl('nxm://humanitz/collections/1/revisions/2')).toBe(null)
    expect(parseNxmUrl('nxm://bad game/mods/1/files/2')).toBe(null)
    expect(parseNxmUrl(null)).toBe(null)
    expect(parseNxmUrl('nxm://' + 'a'.repeat(3000))).toBe(null)
  })

  it('rejects zero/negative/oversized ids', () => {
    expect(parseNxmUrl('nxm://humanitz/mods/0/files/2')).toBe(null)
    expect(parseNxmUrl('nxm://humanitz/mods/99999999999/files/2')).toBe(null)
  })

  it('nulls out a key/expires that fails the character allowlist', () => {
    const badKey = parseNxmUrl('nxm://humanitz/mods/1/files/2?key=has%20space&expires=123')
    expect(badKey?.key).toBe(null)
    const badExpires = parseNxmUrl('nxm://humanitz/mods/1/files/2?key=ok&expires=12x3')
    expect(badExpires?.expires).toBe(null)
  })
})

describe('findNxmUrlInArgv', () => {
  it('finds the first nxm:// argument among ordinary argv entries', () => {
    const argv = ['/usr/bin/hzmm', '--no-sandbox', 'nxm://humanitz/mods/1/files/2']
    expect(findNxmUrlInArgv(argv)).toBe('nxm://humanitz/mods/1/files/2')
  })

  it('returns null when no link is present or argv is not an array', () => {
    expect(findNxmUrlInArgv(['a', 'b'])).toBe(null)
    expect(findNxmUrlInArgv(undefined)).toBe(null)
  })
})

// The freedesktop registration: the Exec command decides what the OS launches
// for a clicked link, per install flavor.
describe('buildExecCommand / buildDesktopEntry', () => {
  it('uses the AppImage path (quoted — the artifact name contains a space)', () => {
    const cmd = buildExecCommand({
      appImagePath: '/home/u/Apps/HZMM Manager-1.1.0.AppImage',
      execPath: '/tmp/.mount_x/app', isPackaged: true, appArg: '.',
    })
    expect(cmd).toBe('"/home/u/Apps/HZMM Manager-1.1.0.AppImage" %u')
  })

  it('uses the binary for a packaged (deb) install and electron+app dir in dev', () => {
    expect(buildExecCommand({ appImagePath: null, execPath: '/opt/HZMM/hzmm', isPackaged: true, appArg: '.' }))
      .toBe('"/opt/HZMM/hzmm" %u')
    expect(buildExecCommand({ appImagePath: null, execPath: '/n/electron', isPackaged: false, appArg: '/repo/out/main' }))
      .toBe('"/n/electron" "/repo/out/main" %u')
  })

  it('escapes desktop-entry-special characters in paths', () => {
    const cmd = buildExecCommand({ appImagePath: '/p/we"ird$app.AppImage', execPath: '', isPackaged: true, appArg: '.' })
    expect(cmd).toBe('"/p/we\\"ird\\$app.AppImage" %u')
  })

  it('emits a valid desktop entry claiming the nxm scheme handler', () => {
    const entry = buildDesktopEntry('"/a/b.AppImage" %u')
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain('Exec="/a/b.AppImage" %u')
    expect(entry).toContain('MimeType=x-scheme-handler/nxm;')
    expect(entry).toContain('NoDisplay=true')
    expect(entry.endsWith('\n')).toBe(true)
  })
})
