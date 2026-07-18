import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  compareVersions,
  parseReleaseInfo,
  isAppImageInstall,
  replaceAppImageFile
} from '../../src/main/services/app-updater.js'

describe('compareVersions', () => {
  // Returns true when latest > current (update available)

  it('detects newer major version', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(true)
  })

  it('detects newer minor version', () => {
    expect(compareVersions('1.2.0', '1.3.0')).toBe(true)
  })

  it('detects newer patch version', () => {
    expect(compareVersions('1.2.8', '1.2.9')).toBe(true)
  })

  it('returns false when already up to date', () => {
    expect(compareVersions('1.2.9', '1.2.9')).toBe(false)
  })

  it('returns false when current is newer', () => {
    expect(compareVersions('2.0.0', '1.2.9')).toBe(false)
  })

  it('strips leading v from both versions', () => {
    expect(compareVersions('v1.2.8', 'v1.2.9')).toBe(true)
    expect(compareVersions('1.2.8', 'v1.2.9')).toBe(true)
    expect(compareVersions('v1.2.9', '1.2.9')).toBe(false)
  })

  it('strips pre-release suffix before comparing', () => {
    // 1.2.9-beta and 1.2.9 are treated as equal
    expect(compareVersions('1.2.9-beta', '1.2.9')).toBe(false)
    expect(compareVersions('1.2.9', '1.2.9-fix')).toBe(false)
  })

  it('handles different segment lengths', () => {
    expect(compareVersions('1.2', '1.2.1')).toBe(true)
    expect(compareVersions('1.2.1', '1.2')).toBe(false)
    expect(compareVersions('1', '1.0.0')).toBe(false)
  })

  it('known limitation: v1.2.8fix is NOT detected as update for v1.2.8', () => {
    // This documents the known behavior — suffix-only changes are invisible
    expect(compareVersions('1.2.8', 'v1.2.8fix')).toBe(false)
  })

  it('handles large version jumps', () => {
    expect(compareVersions('1.0.0', '10.0.0')).toBe(true)
    expect(compareVersions('1.2.9', '1.2.100')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parseReleaseInfo(release, currentVersion) — pure GitHub-release-JSON →
// update-info mapping behind checkForUpdate(). Picks the .AppImage asset and
// resolves the integrity hash: asset digest first, release-body line second.
// ---------------------------------------------------------------------------
describe('parseReleaseInfo — AppImage asset and hash resolution', () => {
  const HEX = 'a'.repeat(64)
  const OTHER_HEX = 'b'.repeat(64)

  function release(overrides = {}) {
    return {
      tag_name: 'v1.1.0',
      body: 'Release notes',
      assets: [
        { name: 'HZMM.Manager-1.1.0.AppImage', digest: `sha256:${HEX}`, browser_download_url: 'https://github.com/dl/x.AppImage' },
        { name: 'HZMM.Manager-1.1.0.deb', digest: `sha256:${OTHER_HEX}`, browser_download_url: 'https://github.com/dl/x.deb' }
      ],
      ...overrides
    }
  }

  it('picks the .AppImage asset, not the .deb', () => {
    const info = parseReleaseInfo(release(), '1.0.0')
    expect(info.downloadUrl).toBe('https://github.com/dl/x.AppImage')
    expect(info.expectedHash).toBe(HEX)
  })

  it('matches the AppImage extension case-insensitively', () => {
    const info = parseReleaseInfo(release({
      assets: [{ name: 'hzmm-1.1.0.appimage', digest: `sha256:${HEX}`, browser_download_url: 'https://github.com/dl/lower' }]
    }), '1.0.0')
    expect(info.downloadUrl).toBe('https://github.com/dl/lower')
  })

  it('reports hasUpdate via semantic version comparison', () => {
    expect(parseReleaseInfo(release(), '1.0.0').hasUpdate).toBe(true)
    expect(parseReleaseInfo(release(), '1.1.0').hasUpdate).toBe(false)
    expect(parseReleaseInfo(release(), '2.0.0').hasUpdate).toBe(false)
  })

  it('prefers the GitHub asset digest over a release-body SHA256 line', () => {
    const info = parseReleaseInfo(release({ body: `SHA256: ${OTHER_HEX}` }), '1.0.0')
    expect(info.expectedHash).toBe(HEX)
  })

  it('falls back to the release-body SHA256 line when the digest is missing', () => {
    const assets = [{ name: 'x.AppImage', browser_download_url: 'https://github.com/dl/x' }]
    const info = parseReleaseInfo(release({ assets, body: `Notes\nSHA256: ${OTHER_HEX}` }), '1.0.0')
    expect(info.expectedHash).toBe(OTHER_HEX)
  })

  it('ignores a malformed digest (wrong algo or truncated hex)', () => {
    const bad = [
      { name: 'x.AppImage', digest: `sha512:${HEX}`, browser_download_url: 'u' },
      { name: 'x.AppImage', digest: 'sha256:deadbeef', browser_download_url: 'u' }
    ]
    for (const asset of bad) {
      const info = parseReleaseInfo(release({ assets: [asset], body: '' }), '1.0.0')
      expect(info.expectedHash).toBe(null)
    }
  })

  it('normalizes the hash to lowercase from either source', () => {
    const upper = HEX.toUpperCase()
    const fromDigest = parseReleaseInfo(release({
      assets: [{ name: 'x.AppImage', digest: `sha256:${upper}`, browser_download_url: 'u' }]
    }), '1.0.0')
    expect(fromDigest.expectedHash).toBe(HEX)
    const fromBody = parseReleaseInfo(release({ assets: [], body: `SHA256: ${upper}` }), '1.0.0')
    expect(fromBody.expectedHash).toBe(HEX)
  })

  it('yields null downloadUrl when the release has no AppImage asset', () => {
    const info = parseReleaseInfo(release({ assets: [{ name: 'x.deb', browser_download_url: 'u' }] }), '1.0.0')
    expect(info.downloadUrl).toBe(null)
  })

  it('tolerates missing assets and body entirely', () => {
    const info = parseReleaseInfo({ tag_name: 'v1.1.0' }, '1.0.0')
    expect(info).toEqual({
      hasUpdate: true,
      currentVersion: '1.0.0',
      latestVersion: 'v1.1.0',
      downloadUrl: null,
      expectedHash: null,
      changelog: ''
    })
  })
})

// ---------------------------------------------------------------------------
// isAppImageInstall() — the AppImage/manual mode switch, driven purely by the
// APPIMAGE env var that AppImage runtimes export.
// ---------------------------------------------------------------------------
describe('isAppImageInstall', () => {
  let saved
  beforeEach(() => { saved = process.env.APPIMAGE })
  afterEach(() => {
    if (saved === undefined) delete process.env.APPIMAGE
    else process.env.APPIMAGE = saved
  })

  it('is true when APPIMAGE points at a path', () => {
    process.env.APPIMAGE = '/home/user/Apps/HZMM.AppImage'
    expect(isAppImageInstall()).toBe(true)
  })

  it('is false when APPIMAGE is unset or empty', () => {
    delete process.env.APPIMAGE
    expect(isAppImageInstall()).toBe(false)
    process.env.APPIMAGE = ''
    expect(isAppImageInstall()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// replaceAppImageFile(stagedPath, targetPath) — the pure file-swap half of the
// in-place AppImage update (the Electron relaunch half is not testable here).
// Real-fs fixtures, matching this suite's convention.
// ---------------------------------------------------------------------------
describe('replaceAppImageFile — atomic in-place swap', () => {
  let tempDir
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzmm-appimage-swap-'))
  })
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('replaces the target with the staged file and cleans up', () => {
    const staged = path.join(tempDir, 'hzmm-update.AppImage')
    const target = path.join(tempDir, 'HZMM.Manager-1.0.0.AppImage')
    fs.writeFileSync(staged, 'NEW BINARY')
    fs.writeFileSync(target, 'OLD BINARY')

    replaceAppImageFile(staged, target)

    expect(fs.readFileSync(target, 'utf8')).toBe('NEW BINARY')
    expect(fs.existsSync(staged)).toBe(false)
    expect(fs.existsSync(target + '.hzmm-new')).toBe(false)
    if (process.platform !== 'win32') {
      expect(fs.statSync(target).mode & 0o111).not.toBe(0)
    }
  })

  it('works when the target does not exist yet (first swap into place)', () => {
    const staged = path.join(tempDir, 'staged.AppImage')
    const target = path.join(tempDir, 'app.AppImage')
    fs.writeFileSync(staged, 'NEW')

    replaceAppImageFile(staged, target)

    expect(fs.readFileSync(target, 'utf8')).toBe('NEW')
  })

  it('throws when nothing is staged', () => {
    const target = path.join(tempDir, 'app.AppImage')
    expect(() => replaceAppImageFile(null, target)).toThrow(/No staged update file/)
    expect(() => replaceAppImageFile(path.join(tempDir, 'missing'), target)).toThrow(/No staged update file/)
  })

  it('throws and leaves no temp file when the target directory is unwritable', () => {
    const staged = path.join(tempDir, 'staged.AppImage')
    fs.writeFileSync(staged, 'NEW')
    const target = path.join(tempDir, 'no-such-dir', 'app.AppImage')

    expect(() => replaceAppImageFile(staged, target)).toThrow(/Failed to replace AppImage/)
    expect(fs.existsSync(target + '.hzmm-new')).toBe(false)
    // The staged download must survive a failed swap so the user can retry.
    expect(fs.existsSync(staged)).toBe(true)
  })
})
