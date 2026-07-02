import { describe, it, expect } from 'vitest'
import { formatCount, formatDate } from '../../src/renderer/src/components/common/utils.js'

describe('formatCount', () => {
  it('formats millions and thousands with one decimal', () => {
    expect(formatCount(2070424)).toBe('2.1M')
    expect(formatCount(4322)).toBe('4.3k')
  })
  it('drops the decimal at 10M+ and 10k+', () => {
    expect(formatCount(12000000)).toBe('12M')
    expect(formatCount(15000)).toBe('15k')
  })
  it('returns the raw number under 1000 and a dash for NaN/null', () => {
    expect(formatCount(50)).toBe('50')
    expect(formatCount(NaN)).toBe('—')
    expect(formatCount(null)).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats a unix-seconds timestamp to a non-empty locale string', () => {
    const out = formatDate(1715710825)
    expect(typeof out).toBe('string')
    expect(out).not.toBe('—')
    expect(out.length).toBeGreaterThan(0)
  })
  it('returns a dash for falsey input', () => {
    expect(formatDate(0)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
  })
})
