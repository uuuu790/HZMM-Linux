import { describe, it, expect } from 'vitest'
import { parseNexusUrl } from '../../src/main/ipc/mods-download.js'

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
