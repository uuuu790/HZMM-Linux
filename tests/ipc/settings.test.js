import { describe, it, expect } from 'vitest'
import { ALLOWED_SETTINGS_KEYS } from '../../src/main/ipc/settings.js'

// The whitelist is the only line of defense between the renderer and the
// settings file. A drift here means either:
//   a) a real key gets rejected (toggle silently fails to persist — like the
//      `skipInstallPreview` regression caught in 1.3.6), or
//   b) an unintended key sneaks in (the renderer writes garbage to disk).
//
// These tests pin the whitelist's expected contents so future edits surface
// either the diff or a deliberate test update.

describe('ALLOWED_SETTINGS_KEYS', () => {
  it('is a Set', () => {
    expect(ALLOWED_SETTINGS_KEYS).toBeInstanceOf(Set)
  })

  // The keys actually written by the renderer (App.jsx + Settings tab + hooks).
  // Adding a new persisted setting in renderer must add it here too.
  const REQUIRED_KEYS = [
    'gamePath',
    'theme', 'themeId', 'darkMode',
    'minimizeToTray',
    'nexusApiKey',
    'ue4ssVersion',
    'autoCheckUpdate',
    'modSortOrder', 'modSortDirection',
    'lastTab',
    'windowState',
    'profiles', 'activeProfileId',
    'nexusInstalledMods',
    'skipInstallPreview',
  ]

  it.each(REQUIRED_KEYS)('whitelists %s', (key) => {
    expect(ALLOWED_SETTINGS_KEYS.has(key)).toBe(true)
  })

  it('rejects keys never written by the app', () => {
    expect(ALLOWED_SETTINGS_KEYS.has('language')).toBe(false) // moved to locale:set-preference
    expect(ALLOWED_SETTINGS_KEYS.has('arbitraryKey')).toBe(false)
    expect(ALLOWED_SETTINGS_KEYS.has('__proto__')).toBe(false)
    expect(ALLOWED_SETTINGS_KEYS.has('')).toBe(false)
  })

  it('size matches the expected key count (catches accidental adds/removes)', () => {
    // If you intentionally add or remove a key, update REQUIRED_KEYS above
    // and bump this number. The point is to make a silent drift loud.
    expect(ALLOWED_SETTINGS_KEYS.size).toBe(REQUIRED_KEYS.length)
  })
})
