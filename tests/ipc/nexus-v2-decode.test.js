import { describe, it, expect } from 'vitest'
import { decodeUtf8Chunks } from '../../src/main/ipc/nexus-v2-client.js'

describe('decodeUtf8Chunks', () => {
  it('reassembles a multi-byte char split across chunks', () => {
    // "中文" is 6 UTF-8 bytes; cut at byte 4 splits "文" (bytes 3-5) in half.
    const full = Buffer.from('中文', 'utf8')
    const a = full.subarray(0, 4)
    const b = full.subarray(4)
    expect(decodeUtf8Chunks([a, b])).toBe('中文')
  })

  it('the old string-concat approach corrupts the same input (regression guard)', () => {
    const full = Buffer.from('完整繁體中文翻譯', 'utf8')
    const a = full.subarray(0, 22)
    const b = full.subarray(22)
    // '' + Buffer decodes each chunk independently -> U+FFFD at the boundary.
    const broken = '' + a + b
    expect(broken).toContain('�')
    expect(decodeUtf8Chunks([a, b])).toBe('完整繁體中文翻譯')
  })
})
