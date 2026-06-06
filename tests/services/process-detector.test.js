import { describe, it, expect } from 'vitest'
import { parseTasklistOutput } from '../../src/main/services/process-detector.js'

// `tasklist /FO CSV /NH` outputs lines like:
//   "HumanitZ-Win64-Shipping.exe","12345","Console","1","123,456 K"
// or, when no process matches:
//   INFO: No tasks are running which match the specified criteria.
// (the latter shows up as a single text line, not CSV)

describe('parseTasklistOutput', () => {
  it('returns true when a CSV line matches the expected exe name', () => {
    const stdout = '"HumanitZ-Win64-Shipping.exe","12345","Console","1","123,456 K"'
    expect(parseTasklistOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })

  it('returns true case-insensitively', () => {
    const stdout = '"humanitz-win64-shipping.exe","12345","Console","1","123,456 K"'
    expect(parseTasklistOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(true)
  })

  it('returns false when the CSV name does not match', () => {
    const stdout = '"OtherGame.exe","12345","Console","1","123,456 K"'
    expect(parseTasklistOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
  })

  it('returns false on the "No tasks are running" message', () => {
    const stdout = 'INFO: No tasks are running which match the specified criteria.'
    expect(parseTasklistOutput(stdout, 'HumanitZ-Win64-Shipping.exe')).toBe(false)
  })

  it('handles multiple lines and matches any', () => {
    const stdout = [
      '"OtherGame.exe","100","Console","1","10 K"',
      '"HumanitZ.exe","200","Console","1","20 K"',
    ].join('\n')
    expect(parseTasklistOutput(stdout, 'HumanitZ.exe')).toBe(true)
  })

  it('handles CRLF line endings (Windows native)', () => {
    const stdout = '"HumanitZ.exe","100","Console","1","10 K"\r\n'
    expect(parseTasklistOutput(stdout, 'HumanitZ.exe')).toBe(true)
  })

  it('returns false for empty stdout', () => {
    expect(parseTasklistOutput('', 'HumanitZ.exe')).toBe(false)
    expect(parseTasklistOutput('   \n  ', 'HumanitZ.exe')).toBe(false)
  })

  it('returns false for non-string input (defensive)', () => {
    expect(parseTasklistOutput(null, 'HumanitZ.exe')).toBe(false)
    expect(parseTasklistOutput(undefined, 'HumanitZ.exe')).toBe(false)
    expect(parseTasklistOutput(123, 'HumanitZ.exe')).toBe(false)
  })

  it('returns false when expectedExeName is empty', () => {
    expect(parseTasklistOutput('"HumanitZ.exe","100","C","1","10 K"', '')).toBe(false)
    expect(parseTasklistOutput('"HumanitZ.exe","100","C","1","10 K"', null)).toBe(false)
  })

  it('does not match when only the suffix matches (full name match required)', () => {
    const stdout = '"HumanitZ-Win64-Shipping.exe","12345","Console","1","123,456 K"'
    expect(parseTasklistOutput(stdout, 'Shipping.exe')).toBe(false)
  })
})
