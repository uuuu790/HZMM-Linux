import { describe, it, expect } from 'vitest'
import { parseNexusUrl, resolveDownloadFilename } from '../../src/main/ipc/mods-download'

describe('parseNexusUrl', () => {
  it('parses standard Nexus mod URL', () => {
    const result = parseNexusUrl('https://www.nexusmods.com/humanitz/mods/123')
    expect(result).toEqual({ game: 'humanitz', modId: 123, fileId: null })
  })

  it('parses Nexus URL with file_id param', () => {
    const result = parseNexusUrl('https://www.nexusmods.com/humanitz/mods/456?tab=files&file_id=789')
    expect(result).toEqual({ game: 'humanitz', modId: 456, fileId: 789 })
  })

  it('parses Nexus URL without www prefix', () => {
    const result = parseNexusUrl('https://nexusmods.com/skyrimspecialedition/mods/999')
    expect(result).toEqual({ game: 'skyrimspecialedition', modId: 999, fileId: null })
  })

  it('returns null for non-Nexus URL', () => {
    expect(parseNexusUrl('https://github.com/some/repo')).toBe(null)
  })

  it('returns null for malformed Nexus URL', () => {
    expect(parseNexusUrl('https://www.nexusmods.com/humanitz')).toBe(null)
    expect(parseNexusUrl('https://www.nexusmods.com/humanitz/mods/')).toBe(null)
  })

  it('returns null for empty or invalid input', () => {
    expect(parseNexusUrl('')).toBe(null)
    expect(parseNexusUrl('not a url')).toBe(null)
  })

  it('handles Nexus URL with extra query params', () => {
    const result = parseNexusUrl('https://www.nexusmods.com/humanitz/mods/42?tab=description&file_id=100&foo=bar')
    expect(result).toEqual({ game: 'humanitz', modId: 42, fileId: 100 })
  })
})

// Nexus's newer CDN serves GUID paths with no extension — the temp filename
// must then come from the files API (real uploaded name) so .rar/.7z/.pak
// payloads aren't blindly labeled .zip.
describe('resolveDownloadFilename', () => {
  it('keeps the URL basename when it has a recognizable extension', () => {
    expect(resolveDownloadFilename(
      'https://cf-files.nexusmods.com/cdn/5743/SomeMod-1-0.rar?md5=x', 'Other.zip', 'fb'
    )).toBe('SomeMod-1-0.rar')
  })

  it('keeps .7z URL basenames (classic CDN path)', () => {
    expect(resolveDownloadFilename(
      'https://la.nexusmods.com/prod/Mod-90-1.7z?token=y', null, 'fb'
    )).toBe('Mod-90-1.7z')
  })

  it('uses the API file_name for GUID CDN paths with no extension', () => {
    expect(resolveDownloadFilename(
      'https://cf-files.nexusmods.com/prod/0d/fc/70/0dfc7031-560c?sig=z', 'Big Backpack-34-1-0.7z', 'fb'
    )).toBe('Big_Backpack-34-1-0.7z')
  })

  it('preserves a bare .pak API name so the _P suffix survives', () => {
    expect(resolveDownloadFilename(
      'https://cf-files.nexusmods.com/prod/aa/bb/guid', 'CoolMod_P.pak', 'fb'
    )).toBe('CoolMod_P.pak')
  })

  it('falls back to <base>.zip when neither URL nor API gives an extension', () => {
    expect(resolveDownloadFilename(
      'https://cf-files.nexusmods.com/prod/aa/bb/guid', null, 'nexus_mod_34_100'
    )).toBe('nexus_mod_34_100.zip')
  })

  it('sanitizes traversal attempts out of API names', () => {
    expect(resolveDownloadFilename(
      'https://cf-files.nexusmods.com/prod/aa/bb/guid', '..\\..\\evil.zip', 'fb'
    )).toBe('evil.zip')
  })

  it('survives an unparsable URL', () => {
    expect(resolveDownloadFilename('not a url', 'Mod.rar', 'fb')).toBe('Mod.rar')
  })
})
