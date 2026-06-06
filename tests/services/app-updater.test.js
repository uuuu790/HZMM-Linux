import { describe, it, expect } from 'vitest'
import { compareVersions } from '../../src/main/services/app-updater.js'

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
