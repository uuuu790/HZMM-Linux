import { describe, it, expect } from 'vitest'
import { isAllowedModUrl, ALLOWED_MOD_HOSTS } from '../../src/main/ipc/mods.js'

describe('ALLOWED_MOD_HOSTS', () => {
  it('is frozen to prevent runtime tampering', () => {
    expect(Object.isFrozen(ALLOWED_MOD_HOSTS)).toBe(true)
  })

  it('contains expected CDN entries', () => {
    expect(ALLOWED_MOD_HOSTS).toContain('github.com')
    expect(ALLOWED_MOD_HOSTS).toContain('objects.githubusercontent.com')
    expect(ALLOWED_MOD_HOSTS).toContain('cf-files.nexusmods.com')
  })

  it('does NOT contain a bare nexusmods.com entry', () => {
    // The bug was exactly this: a bare 'nexusmods.com' entry combined with
    // an endsWith('.nexusmods.com') check whitelisted ALL subdomains,
    // including ones that could be takeover targets.
    expect(ALLOWED_MOD_HOSTS).not.toContain('nexusmods.com')
  })
})

describe('isAllowedModUrl — legitimate downloads', () => {
  const legit = [
    'https://github.com/UE4SS-RE/RE-UE4SS/releases/download/experimental-latest/UE4SS.zip',
    'https://objects.githubusercontent.com/github-production-release-asset-2e65be/abc/def.zip',
    'https://cf-files.nexusmods.com/cdn/1234/abc.zip',
    'https://amsterdam.nexusmods.com/some/path.zip',
    'https://chicago.nexusmods.com/any/path',
    'https://la.nexusmods.com/file.rar',
    'https://london.nexusmods.com/file.pak',
    'https://miami.nexusmods.com/x',
    'https://paris.nexusmods.com/x',
    'https://prague.nexusmods.com/x',
    'https://singapore.nexusmods.com/x',
  ]

  for (const url of legit) {
    it(`allows ${new URL(url).hostname}`, () => {
      expect(isAllowedModUrl(url)).toBe(true)
    })
  }
})

describe('isAllowedModUrl — attack vectors (must all be rejected)', () => {
  // Bare nexusmods.com: the previous code's endsWith check would allow this
  // since it's an exact match of the bare entry. Now rejected.
  it('rejects bare nexusmods.com', () => {
    expect(isAllowedModUrl('https://nexusmods.com/evil.zip')).toBe(false)
  })

  // Subdomain takeover: attacker controls forum.nexusmods.com
  it('rejects forum.nexusmods.com', () => {
    expect(isAllowedModUrl('https://forum.nexusmods.com/evil.zip')).toBe(false)
  })

  // Attacker-controlled arbitrary subdomain
  it('rejects evil.nexusmods.com', () => {
    expect(isAllowedModUrl('https://evil.nexusmods.com/mod.zip')).toBe(false)
  })

  // Homograph / lookalike with a real CDN name as a subdomain of attacker domain
  it('rejects cf-files.nexusmods.com.evil.com', () => {
    expect(isAllowedModUrl('https://cf-files.nexusmods.com.evil.com/fake.zip')).toBe(false)
  })

  // Suffix-match bypass attempt
  it('rejects nexusmods.com.attacker.net', () => {
    expect(isAllowedModUrl('https://nexusmods.com.attacker.net/fake.zip')).toBe(false)
  })

  // GitHub subdomains not in the allowlist
  it('rejects gist.github.com (not in explicit allowlist)', () => {
    expect(isAllowedModUrl('https://gist.github.com/user/abc/raw/mod.zip')).toBe(false)
  })

  it('rejects raw.githubusercontent.com (not in explicit allowlist)', () => {
    // raw.githubusercontent is a real GitHub host but not where releases live.
    // Explicit allowlist means less surface for supply-chain attacks via gists.
    expect(isAllowedModUrl('https://raw.githubusercontent.com/evil/repo/main/mod.zip')).toBe(false)
  })

  // Protocol downgrades
  it('rejects http:// on an allowed host', () => {
    expect(isAllowedModUrl('http://github.com/owner/repo/releases/download/v1/mod.zip')).toBe(false)
  })

  it('rejects file:// protocol', () => {
    expect(isAllowedModUrl('file:///C:/windows/system32/evil.zip')).toBe(false)
  })

  it('rejects data: URL', () => {
    expect(isAllowedModUrl('data:application/zip;base64,ABC=')).toBe(false)
  })

  it('rejects javascript: URL', () => {
    expect(isAllowedModUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects userinfo trick (auth@allowed becoming attacker)', () => {
    // URL parser sets hostname correctly for these — this is a characterization
    // test to prove the bypass doesn't work.
    expect(isAllowedModUrl('https://github.com@evil.com/mod.zip')).toBe(false)
  })
})

describe('isAllowedModUrl — input validation', () => {
  it('rejects non-string input', () => {
    expect(isAllowedModUrl(null)).toBe(false)
    expect(isAllowedModUrl(undefined)).toBe(false)
    expect(isAllowedModUrl(42)).toBe(false)
    expect(isAllowedModUrl({})).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isAllowedModUrl('')).toBe(false)
  })

  it('rejects malformed URL', () => {
    expect(isAllowedModUrl('not a url')).toBe(false)
    expect(isAllowedModUrl('://missing-scheme.com')).toBe(false)
  })
})
