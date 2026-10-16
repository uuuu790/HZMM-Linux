import { describe, it, expect } from 'vitest'
import {
  readonlyPreview, readonlyFullValue, readonlyTooltip, valueShape, READONLY_EMPTY,
} from '../../src/renderer/src/utils/readonly-preview'
import { parseConfigFile } from '../../src/renderer/src/utils/config-parser'

const entryOf = (text, key) => parseConfigFile(text, { syntax: 'lua' }).find(e => e.type === 'keyval' && e.key === key)

describe('readonlyPreview', () => {
  it('collapses a multi-line array and drops the comma before the closing brace', () => {
    expect(readonlyPreview('{\n        "Pistol",\n        "Rifle",\n    }')).toBe('{ "Pistol", "Rifle" }')
  })

  it('handles nested tables, `;` separators and empty tables', () => {
    expect(readonlyPreview('{\n  a = { 1, 2, },\n  b = {\n  },\n}')).toBe('{ a = { 1, 2 }, b = {} }')
    expect(readonlyPreview('{\n  1;\n  2;\n}')).toBe('{ 1; 2 }')
  })

  it('drops comments inside the value', () => {
    expect(readonlyPreview('{\n  "Pistol", -- sidearm\n  --[[ "Knife", ]]\n  "Rifle",\n}')).toBe('{ "Pistol", "Rifle" }')
  })

  it('never rewrites commas, braces or whitespace inside strings', () => {
    expect(readonlyPreview('{\n  "a, }",\n  \'x  y\',\n}')).toBe('{ "a, }", \'x  y\' }')
    expect(readonlyPreview('{\n  [[one,\n two]],\n}')).toBe('{ [[one, two]] }')
  })

  it('shows only this key\'s own value on a line with two assignments', () => {
    expect(readonlyPreview('800, Height = 600')).toBe('800')
    expect(readonlyPreview('800; Height = 600')).toBe('800')
    expect(readonlyPreview('800 Height = 600')).toBe('800')
    expect(readonlyPreview('{ 1, 2 }, Other = { 3 }')).toBe('{ 1, 2 }')
    expect(readonlyPreview('[[say "hi]], Speed = 2')).toBe('[[say "hi]]')
    expect(readonlyPreview('5 ["x"] = 1')).toBe('5')
  })

  it('cuts before a statement keyword that follows the value', () => {
    expect(readonlyPreview('1 if DEBUG then X = 2 end')).toBe('1')
    expect(readonlyPreview('5; local y = 2')).toBe('5')
    // `function` is an expression too — never a cut point
    expect(readonlyPreview('ok and function() return 1 end')).toBe('ok and function() return 1 end')
    // keywords inside strings / identifiers don't count
    expect(readonlyPreview('"if you can", Other = 1')).toBe('"if you can"')
    expect(readonlyPreview('modifier_do + 1')).toBe('modifier_do + 1')
  })

  it('joins a quoted string continued over lines (\\z, backslash + line break)', () => {
    expect(readonlyPreview('"Welcome to \\z\n            the server"')).toBe('"Welcome to \\z the server"')
    expect(readonlyPreview('"Line one\\\nline two"')).toBe('"Line one\\ line two"')
  })

  it('does not split on comparison operators', () => {
    expect(readonlyPreview('a == b')).toBe('a == b')
    expect(readonlyPreview('a ~= b')).toBe('a ~= b')
    expect(readonlyPreview('a <= b')).toBe('a <= b')
  })

  it('keeps a function whole (its `=` belong to its body)', () => {
    expect(readonlyPreview('function()\n    x = 1\n    return x\nend')).toBe('function() x = 1 return x end')
    expect(readonlyPreview('function(a, b)\n  if a then return a, b end\nend')).toBe('function(a, b) if a then return a, b end end')
    // …but a second statement after the function's `end` is cut off
    expect(readonlyPreview('function() return 1 end, Other = 2')).toBe('function() return 1 end')
  })

  it('shows an em dash when there is nothing of its own to show', () => {
    expect(readonlyPreview('')).toBe(READONLY_EMPTY)
    expect(readonlyPreview(', Height = 600')).toBe(READONLY_EMPTY)
    expect(readonlyPreview('-- only a comment')).toBe(READONLY_EMPTY)
  })

  it('shows a decoded string as text, never parsed as code', () => {
    expect(readonlyPreview('hello, world = 1', { isQuoted: true })).toBe('hello, world = 1')
    expect(readonlyPreview('', { isQuoted: true })).toBe(READONLY_EMPTY)
  })

  it('previews real parser output', () => {
    const multi = entryOf('local Config = {\n    AllowedWeapons = {\n        "Pistol",\n        "Rifle",\n    },\n}\nreturn Config\n', 'AllowedWeapons')
    expect(multi.readonly).toBe(true)
    expect(readonlyPreview(multi.value)).toBe('{ "Pistol", "Rifle" }')
    const two = entryOf('local Config = {\n    Width = 800, Height = 600,\n}\nreturn Config\n', 'Width')
    expect(two.readonly).toBe(true)
    expect(readonlyPreview(two.value)).toBe('800')
  })
})

describe('readonlyFullValue', () => {
  it('keeps every statement, on one line, without comments', () => {
    expect(readonlyFullValue('800, Height = 600')).toBe('800, Height = 600')
    expect(readonlyFullValue('{\n  "a", -- x\n  "b",\n}')).toBe('{ "a", "b" }')
  })

  it('caps very long values', () => {
    const long = `{ ${Array.from({ length: 200 }, (_, i) => `"item${i}"`).join(', ')} }`
    const out = readonlyFullValue(long)
    expect(out.length).toBeLessThanOrEqual(300)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('readonlyTooltip', () => {
  it('de-indents the continuation lines', () => {
    expect(readonlyTooltip('{\n        "Pistol",\n        "Rifle",\n    }')).toBe('{\n    "Pistol",\n    "Rifle",\n}')
  })

  it('strips CR and caps the number of lines', () => {
    const many = ['{', ...Array.from({ length: 80 }, (_, i) => `  ${i},`), '}'].join('\r\n')
    const lines = readonlyTooltip(many).split('\n')
    expect(lines.length).toBe(41)
    expect(lines[40]).toBe('…')
    expect(lines.some(l => l.includes('\r'))).toBe(false)
  })
})

describe('valueShape', () => {
  it('tells lists, tables and code apart', () => {
    expect(valueShape('{ "a", "b" }')).toBe('list')
    expect(valueShape('{\n  {1, 2},\n  {3},\n}')).toBe('list')
    expect(valueShape('{\n  Pistol = 5,\n}')).toBe('table')
    expect(valueShape('{ [1] = "a" }')).toBe('table')
    expect(valueShape('{ a == b }')).toBe('list')
    expect(valueShape('function() return 1 end')).toBe('code')
    // a function body's `=` is not a named field
    expect(valueShape('{\n  function() x = 1 end,\n}')).toBe('list')
    expect(valueShape('{ OnHit = function() x = 1 end }')).toBe('table')
  })

  it('returns null for scalars and looks only at this key\'s value', () => {
    expect(valueShape('800, Height = 600')).toBe(null)
    expect(valueShape('"x"')).toBe(null)
    expect(valueShape('{ 1, 2 }, Other = 3')).toBe('list')
  })
})
