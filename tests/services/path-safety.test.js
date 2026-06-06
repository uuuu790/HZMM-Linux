import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  isPathWithin,
  resolveWithin,
  assertSafeSegment,
} from '../../src/main/services/path-safety.js'

const IS_WINDOWS = process.platform === 'win32'
const ROOT = IS_WINDOWS ? 'C:\\base\\mods' : '/base/mods'

describe('isPathWithin', () => {
  it('returns true when candidate equals parent', () => {
    expect(isPathWithin(ROOT, ROOT)).toBe(true)
  })

  it('returns true for immediate child', () => {
    expect(isPathWithin(ROOT, path.join(ROOT, 'child.txt'))).toBe(true)
  })

  it('returns true for nested child', () => {
    expect(isPathWithin(ROOT, path.join(ROOT, 'a', 'b', 'c.txt'))).toBe(true)
  })

  it('returns false for sibling directory with shared prefix', () => {
    // classic startsWith pitfall: /base/mods vs /base/modsEvil
    const sibling = IS_WINDOWS ? 'C:\\base\\modsEvil\\file.txt' : '/base/modsEvil/file.txt'
    expect(isPathWithin(ROOT, sibling)).toBe(false)
  })

  it('returns false for parent escape via ..', () => {
    const escape = path.join(ROOT, '..', '..', 'etc', 'passwd')
    expect(isPathWithin(ROOT, escape)).toBe(false)
  })

  it('returns false for absolute path outside parent', () => {
    const outside = IS_WINDOWS ? 'C:\\Windows\\System32\\config' : '/etc/passwd'
    expect(isPathWithin(ROOT, outside)).toBe(false)
  })

  it('handles parent with trailing separator', () => {
    const withSlash = ROOT + path.sep
    expect(isPathWithin(withSlash, path.join(ROOT, 'child'))).toBe(true)
  })

  it('handles non-string inputs safely', () => {
    expect(isPathWithin(null, ROOT)).toBe(false)
    expect(isPathWithin(ROOT, null)).toBe(false)
    expect(isPathWithin('', ROOT)).toBe(false)
    expect(isPathWithin(ROOT, '')).toBe(false)
    expect(isPathWithin(undefined, undefined)).toBe(false)
  })

  if (IS_WINDOWS) {
    it('normalizes mixed separators on Windows', () => {
      // forward slash input should still be recognized as inside
      expect(isPathWithin('C:\\base\\mods', 'C:/base/mods/sub/file.txt')).toBe(true)
    })

    it('rejects forward-slash traversal on Windows', () => {
      expect(isPathWithin('C:\\base\\mods', 'C:/base/mods/../../etc')).toBe(false)
    })
  }
})

describe('resolveWithin', () => {
  it('joins segments and returns absolute path when safe', () => {
    const result = resolveWithin(ROOT, 'mod-a', 'config.ini')
    expect(result).toBe(path.resolve(ROOT, 'mod-a', 'config.ini'))
  })

  it('returns parent itself when no segments given', () => {
    expect(resolveWithin(ROOT)).toBe(path.resolve(ROOT))
  })

  it('throws when the first segment contains ..', () => {
    // This is the critical mods.js bug — renderer-supplied modFilename
    // must not be able to escape the parent directory.
    expect(() =>
      resolveWithin(ROOT, '..\\..\\..\\Windows\\System32', 'config.ini')
    ).toThrow(/traversal/i)
  })

  it('throws when a later segment contains ..', () => {
    expect(() => resolveWithin(ROOT, 'mod-a', '..\\..\\etc\\passwd')).toThrow(/traversal/i)
  })

  it('neutralizes absolute path segments — they must never replace the parent', () => {
    // path.join — unlike path.resolve — does not let a later absolute segment
    // replace the base. This test pins that behavior so a future refactor to
    // path.resolve (which WOULD be exploitable) gets caught by CI.
    const abs = IS_WINDOWS ? 'C:\\Windows\\System32' : '/etc'
    let result
    try {
      result = resolveWithin(ROOT, abs, 'passwd')
    } catch {
      return // throwing is equally acceptable
    }
    expect(isPathWithin(ROOT, result)).toBe(true)
  })

  it('allows a safe subpath that uses .. but stays inside parent', () => {
    // a/../b resolves to b inside parent — should be allowed
    expect(() => resolveWithin(ROOT, 'a', '..', 'b', 'file.txt')).not.toThrow()
    expect(resolveWithin(ROOT, 'a', '..', 'b', 'file.txt')).toBe(
      path.resolve(ROOT, 'b', 'file.txt')
    )
  })

  it('throws on non-string inputs', () => {
    expect(() => resolveWithin(ROOT, null)).toThrow()
    expect(() => resolveWithin(ROOT, 123)).toThrow()
    expect(() => resolveWithin('', 'mod')).toThrow()
  })
})

describe('assertSafeSegment — flat mod name validation', () => {
  const valid = [
    'MyMod',
    'mymod.pak',
    'mymod.pak.disabled',
    'mod_with_underscore',
    'mod-with-dash',
    'mod.v1.2.3',
    'mod with space',
    'UE4SS_MOD_123',
  ]

  for (const name of valid) {
    it(`accepts "${name}"`, () => {
      expect(() => assertSafeSegment('filename', name)).not.toThrow()
    })
  }

  const traversal = [
    '../escape',
    '..\\escape',
    '../../etc/passwd',
    'foo/../bar',
    'a/b',
    'a\\b',
    '.',
    '..',
    'foo..bar',
  ]

  for (const name of traversal) {
    it(`rejects traversal "${name}"`, () => {
      expect(() => assertSafeSegment('filename', name)).toThrow()
    })
  }

  const reserved = [
    'mod<tag>.pak',
    'mod|pipe.pak',
    'mod:colon',
    'mod"quote',
    'mod?q',
    'mod*wild',
    'mod\0null',
  ]

  for (const name of reserved) {
    it(`rejects reserved char in "${JSON.stringify(name)}"`, () => {
      expect(() => assertSafeSegment('filename', name)).toThrow(/reserved/i)
    })
  }

  it('rejects non-string', () => {
    expect(() => assertSafeSegment('filename', null)).toThrow()
    expect(() => assertSafeSegment('filename', undefined)).toThrow()
    expect(() => assertSafeSegment('filename', 42)).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => assertSafeSegment('filename', '')).toThrow()
  })

  it('rejects absolute paths', () => {
    const abs = process.platform === 'win32' ? 'C:\\evil.pak' : '/etc/evil.pak'
    expect(() => assertSafeSegment('filename', abs)).toThrow()
  })

  it('error message includes the label', () => {
    expect(() => assertSafeSegment('modFolderName', '')).toThrow(/modFolderName/)
  })
})
