import { describe, it, expect } from 'vitest'
import {
  assertSafeBatchPath,
  generateUpdaterBatch,
} from '../../src/main/ipc/app-update.js'

const VALID_NEW = 'C:\\Users\\user\\AppData\\Roaming\\hzmm-app\\hzmm-update.exe'
const VALID_CUR = 'C:\\Program Files\\HZMM\\HZMM Manager.exe'

describe('assertSafeBatchPath', () => {
  it('accepts a valid absolute Windows path', () => {
    expect(() => assertSafeBatchPath('test', VALID_CUR)).not.toThrow()
  })

  it('accepts path with spaces (they are quoted in the batch)', () => {
    expect(() => assertSafeBatchPath('test', 'C:\\Program Files\\foo bar\\app.exe')).not.toThrow()
  })

  const attacks = [
    { name: 'double quote injection', value: 'C:\\x\\"&calc&".exe' },
    { name: 'single quote', value: "C:\\x\\'.exe" },
    { name: 'carriage return', value: 'C:\\x\\a\rb.exe' },
    { name: 'line feed', value: 'C:\\x\\a\nb.exe' },
    { name: 'percent sign (variable expansion)', value: 'C:\\x\\%PATH%.exe' },
    { name: 'exclamation (delayed expansion)', value: 'C:\\x\\!VAR!.exe' },
    { name: 'caret escape', value: 'C:\\x\\a^b.exe' },
    { name: 'ampersand chain', value: 'C:\\x\\a&calc.exe' },
    { name: 'pipe', value: 'C:\\x\\a|b.exe' },
    { name: 'redirect <', value: 'C:\\x\\a<b.exe' },
    { name: 'redirect >', value: 'C:\\x\\a>b.exe' },
    { name: 'null byte', value: 'C:\\x\\a\0b.exe' },
  ]

  for (const a of attacks) {
    it(`rejects ${a.name}`, () => {
      expect(() => assertSafeBatchPath('test', a.value)).toThrow(/unsafe/i)
    })
  }

  it('rejects non-string', () => {
    expect(() => assertSafeBatchPath('test', null)).toThrow()
    expect(() => assertSafeBatchPath('test', 42)).toThrow()
    expect(() => assertSafeBatchPath('test', undefined)).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => assertSafeBatchPath('test', '')).toThrow()
  })

  it('rejects relative path', () => {
    expect(() => assertSafeBatchPath('test', 'subdir\\app.exe')).toThrow(/absolute/i)
  })
})

describe('generateUpdaterBatch', () => {
  it('produces a batch script with both paths quoted', () => {
    const batch = generateUpdaterBatch(VALID_NEW, VALID_CUR)
    expect(batch).toContain(`"${VALID_NEW}"`)
    expect(batch).toContain(`"${VALID_CUR}"`)
  })

  it('includes errorlevel check after copy (does not silently continue)', () => {
    const batch = generateUpdaterBatch(VALID_NEW, VALID_CUR)
    // Must check the copy succeeded before running the new exe
    expect(batch).toMatch(/if errorlevel 1/i)
    expect(batch.indexOf('if errorlevel 1')).toBeLessThan(batch.indexOf('start ""'))
  })

  it('uses CRLF line endings (Windows batch)', () => {
    const batch = generateUpdaterBatch(VALID_NEW, VALID_CUR)
    expect(batch).toContain('\r\n')
    expect(batch.split('\r\n').length).toBeGreaterThan(5)
  })

  it('starts with @echo off', () => {
    const batch = generateUpdaterBatch(VALID_NEW, VALID_CUR)
    expect(batch.startsWith('@echo off')).toBe(true)
  })

  it('refuses to generate batch when new exe path is unsafe', () => {
    expect(() => generateUpdaterBatch('C:\\x\\"&calc&".exe', VALID_CUR)).toThrow(/unsafe/i)
  })

  it('refuses to generate batch when current exe path is unsafe', () => {
    expect(() => generateUpdaterBatch(VALID_NEW, 'C:\\x\\a\nb.exe')).toThrow(/unsafe/i)
  })

  it('refuses batch generation on null inputs', () => {
    expect(() => generateUpdaterBatch(null, VALID_CUR)).toThrow()
    expect(() => generateUpdaterBatch(VALID_NEW, null)).toThrow()
  })

  it('self-deletes at the end so updater.bat does not linger', () => {
    const batch = generateUpdaterBatch(VALID_NEW, VALID_CUR)
    expect(batch).toContain('%~f0')
  })
})
