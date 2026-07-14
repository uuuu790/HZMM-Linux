import { describe, it, expect } from 'vitest'
import {
  parsePgrepOutput,
  GAME_PROCESS_NAMES,
} from '../../src/main/services/process-detector.js'

// On Linux the game runs under Wine/Proton, so the kernel process is
// `wine64-preloader` but the full command line still carries the .exe name.
// `pgrep -af <pattern>` outputs rows like:
//   12345 wine64-preloader Z:\…\HumanitZ-Win64-Shipping.exe -fullscreen
// or, when nothing matches, pgrep exits 1 and stdout is empty.
//
// parsePgrepOutput does a case-insensitive substring match of the expected
// exe name against each line of stdout.

describe('parsePgrepOutput', () => {
  it('returns true when a pgrep line contains the expected exe name', () => {
    const stdout =
      '12345 wine64-preloader Z:\\drive_c\\game\\HumanitZ-Win64-Shipping.exe -fullscreen'
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })

  it('returns true case-insensitively', () => {
    const stdout =
      '12345 wine64-preloader z:\\drive_c\\game\\humanitz-win64-shipping.exe -fullscreen'
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })

  it('returns false when no line contains the exe name', () => {
    const stdout = '6789 wine64-preloader Z:\\drive_c\\game\\OtherGame.exe -windowed'
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
  })

  it('matches when only the suffix is searched (substring match)', () => {
    // pgrep parsing uses includes(), so a substring of the full exe name
    // is enough to match — unlike a strict full-name comparison.
    const stdout =
      '12345 wine64-preloader Z:\\drive_c\\game\\HumanitZ-Win64-Shipping.exe -fullscreen'
    expect(parsePgrepOutput(stdout, 'Shipping.exe')).toBe(true)
  })

  it('matches when the exe name appears mid-line as part of the path', () => {
    const stdout =
      '999 wine64-preloader C:\\Program Files\\HumanitZ\\HumanitZ-Win64-Shipping.exe'
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })

  it('handles multiple lines and matches any of them', () => {
    const stdout = [
      '100 wine64-preloader Z:\\drive_c\\game\\OtherGame.exe',
      '200 wine64-preloader Z:\\drive_c\\game\\HumanitZ-Win64-Shipping.exe -fullscreen',
    ].join('\n')
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })

  it('handles CRLF line endings', () => {
    const stdout =
      '100 wine64-preloader Z:\\drive_c\\game\\OtherGame.exe\r\n200 wine64-preloader Z:\\drive_c\\game\\HumanitZ-Win64-Shipping.exe\r\n'
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })

  it('returns false for empty / whitespace-only stdout', () => {
    expect(parsePgrepOutput('', 'HumanitZ-Win64-Shipping.exe')).toBe(false)
    expect(parsePgrepOutput('   \n  ', 'HumanitZ-Win64-Shipping.exe')).toBe(false)
  })

  it('returns false for non-string input (defensive)', () => {
    expect(parsePgrepOutput(null, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
    expect(parsePgrepOutput(undefined, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
    expect(parsePgrepOutput(123, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
    expect(parsePgrepOutput({}, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
  })

  it('returns false when expectedExeName is empty / falsy', () => {
    const stdout =
      '12345 wine64-preloader Z:\\drive_c\\game\\HumanitZ-Win64-Shipping.exe'
    expect(parsePgrepOutput(stdout, '')).toBe(false)
    expect(parsePgrepOutput(stdout, null)).toBe(false)
    expect(parsePgrepOutput(stdout, undefined)).toBe(false)
  })

  // Regression: on dash-/bin/sh systems (Debian/Ubuntu), running the search
  // through a shell made pgrep -f match the wrapper shell's own command line,
  // so "game running" was reported 100% of the time. Rows that are the pgrep
  // invocation itself (or a shell carrying it) must never count as a match.
  it('ignores the pgrep search process itself (self-match guard)', () => {
    const stdout = '28919 /bin/sh -c pgrep -af HumanitZ-Win64-Shipping.exe'
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
  })

  it('ignores a bare pgrep row but still matches a real game row alongside it', () => {
    const stdout = [
      '28919 pgrep -af HumanitZ-Win64-Shipping.exe',
      '200 wine64-preloader Z:\\drive_c\\game\\HumanitZ-Win64-Shipping.exe -fullscreen',
    ].join('\n')
    expect(parsePgrepOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })
})

describe('GAME_PROCESS_NAMES', () => {
  it('contains the HumanitZ shipping process name', () => {
    expect(GAME_PROCESS_NAMES).toContain('HumanitZ-Win64-Shipping.exe')
  })

  it('every entry passes the injection-guard pattern used before shelling out', () => {
    // isGameRunning skips any exe name with characters outside this set, since
    // it interpolates the name into a `pgrep -af <name>` command (and pgrep
    // treats it as a regex). The shipped names must therefore be safe.
    const VALID_EXE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/
    for (const name of GAME_PROCESS_NAMES) {
      expect(name).toMatch(VALID_EXE_NAME_PATTERN)
    }
  })

  it('contains no shell/regex metacharacters or whitespace', () => {
    for (const name of GAME_PROCESS_NAMES) {
      expect(name).not.toMatch(/[;&|$`(){}[\]<>*?!\\'"\s]/)
    }
  })
})
