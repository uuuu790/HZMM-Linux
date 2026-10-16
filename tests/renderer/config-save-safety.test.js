import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import process from 'process'
import { spawnSync } from 'child_process'
import luaparse from 'luaparse'
import {
  parseConfigFile,
  serializeConfig,
  appendKeyval,
  removeKeyvalAt,
  guessValueType,
  buildSectionKeyIndex,
  resolveEntryIdx,
  buildEntryKeyDefMap,
  parseLuaArray,
  parseLuaArrayItems,
  serializeLuaArray,
  normalizeSchema,
} from '../../src/renderer/src/utils/config-parser'
import {
  isValidNumber,
  prepareEntriesForSave,
  resetEntriesToDefaults,
  entriesAtDefaults,
  defaultToValueStr,
  valueEqualsDefault,
  typedDefaultSeed,
} from '../../src/renderer/src/utils/widget-helpers'

// Round-2 data-safety rules for the config parser / serializer: values the
// editor can't rewrite safely are readonly (R2 R3 R4), inserts keep the table
// valid (R5), INI values round-trip (R6), numbers are recognised (R7), untyped
// values keep their kind (R9), arrays keep numbers (R10) and removing a key
// removes every line of it (R11). Outputs are loaded with Lua 5.4 when a `lua`
// binary is on PATH (or LUA_BIN).

const LUA_BIN = process.env.LUA_BIN || 'lua'
const hasLua = spawnSync(LUA_BIN, ['-v']).status === 0

function luaRead(text, expr) {
  const file = path.join(os.tmpdir(), `hzmm-save-${process.pid}-${Math.random().toString(36).slice(2)}.lua`)
  fs.writeFileSync(file, text)
  try {
    const code = `local f, err = loadfile([[${file}]]) if not f then io.write('LOAD_ERROR: ' .. err) return end ` +
      `local env = setmetatable({}, { __index = _G }) debug.setupvalue(f, 1, env) ` +
      `local r = f() local C = type(r) == 'table' and r or env io.write(tostring(${expr}))`
    const res = spawnSync(LUA_BIN, ['-e', code], { encoding: 'utf8' })
    return (res.stdout + res.stderr).replace(/\r\n/g, '\n')
  } finally {
    fs.rmSync(file, { force: true })
  }
}
const expectLuaParses = (text) => expect(() => luaparse.parse(text, { luaVersion: '5.3' })).not.toThrow()

const parse = (text, syntax = 'lua') => parseConfigFile(text, { syntax })
const kvs = (entries) => entries.filter(e => e.type === 'keyval')
const kv = (entries, key) => entries.find(e => e.type === 'keyval' && e.key === key)
const edit = (entries, key, value) => entries.map(e => (e.type === 'keyval' && e.key === key ? { ...e, value } : e))
const idxOf = (entries, key, section = 'S') => resolveEntryIdx(buildSectionKeyIndex(entries), section, key)
const saveWith = (entries, schema) =>
  serializeConfig(prepareEntriesForSave(entries, schema ? buildEntryKeyDefMap(entries, normalizeSchema(schema)) : null))
const one = (keys) => ({ sections: { S: { keys } } })

describe('R2 block comments next to a value', () => {
  const text = 'local Config = {\n    MaxSlots = 20, --[[ Number of slots.\n        Range 1-100 ]]\n}\nreturn Config\n'

  it('a field whose block comment runs onto later lines is ONE readonly entry through the comment end', () => {
    const entries = parse(text)
    expect(kv(entries, 'MaxSlots')).toMatchObject({
      value: '20',
      readonly: true,
      multiline: true,
      raw: '    MaxSlots = 20, --[[ Number of slots.\n        Range 1-100 ]]',
    })
    expect(serializeConfig(edit(entries, 'MaxSlots', '30'))).toBe(text)
  })

  it('an inserted key lands after the comment end (break-F2a) and the field is never half-removed (F2b)', () => {
    const entries = parse(text)
    const out = serializeConfig(appendKeyval(entries, 'Extra', '7'))
    expect(out).toBe('local Config = {\n    MaxSlots = 20, --[[ Number of slots.\n        Range 1-100 ]]\n    Extra = 7,\n}\nreturn Config\n')
    if (hasLua) expect(luaRead(out, 'C.Extra + C.MaxSlots')).toBe('27')
    expect(removeKeyvalAt(entries, idxOf(entries, 'MaxSlots'))).toBe(entries)
  })

  it('a comma-less field before a multi-line comment gets its comma before the comment', () => {
    const t = 'return {\n  A = 1 --[[ one\n  two ]]\n}\n'
    const out = serializeConfig(appendKeyval(parse(t), 'B', '2'))
    expect(out).toBe('return {\n  A = 1, --[[ one\n  two ]]\n  B = 2,\n}\n')
    expectLuaParses(out)
  })

  it('code after a closed inline block comment makes the value readonly (break-F10)', () => {
    const t = 'local Config = {\n    Damage = 5 --[[ base ]] + 3,\n    Before = --[[ c ]] 4,\n    Next = 1,\n}\nreturn Config\n'
    const entries = parse(t)
    expect(kvs(entries).map(e => [e.key, !!e.readonly, !!e.multiline])).toEqual([['Damage', true, false], ['Before', true, false], ['Next', false, false]])
    expect(serializeConfig(edit(edit(entries, 'Damage', '7'), 'Before', '9'))).toBe(t)
    if (hasLua) expect(luaRead(t, 'C.Damage')).toBe('8')
  })

  it('trailing comments that only follow the value stay editable', () => {
    const entries = parse('return {\n  A = 1, --[[ x ]] --[==[ y ]==]\n  B = 2 -- z\n}')
    expect(kvs(entries).every(e => !e.readonly)).toBe(true)
  })
})

describe('R3 strings continued with `\\` or `\\z`', () => {
  it('a `\\z` continuation is one readonly entry', () => {
    const t = 'local Config = {\n    Motd = "Welcome to \\z\n            the server",\n    Speed = 1,\n}\nreturn Config\n'
    const entries = parse(t)
    expect(kv(entries, 'Motd')).toMatchObject({ readonly: true, multiline: true })
    expect(kv(entries, 'Speed')).toMatchObject({ value: '1' })
    expect(serializeConfig(edit(entries, 'Motd', 'Hi'))).toBe(t)
    if (hasLua) expect(luaRead(t, 'C.Motd')).toBe('Welcome to the server')
  })

  it('a backslash-newline continuation line is never a field (break-F5c)', () => {
    const t = 'local Config = {\n    Motd = "Line one\\\nSpeed = 2 --",\n    Name = "x",\n}\nreturn Config\n'
    const entries = parse(t)
    expect(kvs(entries).map(e => [e.key, !!e.readonly])).toEqual([['Motd', true], ['Name', false]])
    expect(idxOf(entries, 'Speed')).toBeUndefined()
    if (hasLua) expect(luaRead(t, 'C.Speed')).toBe('nil')
  })

  it('in globals too, and the string state never leaks past its end', () => {
    const t = 'A = "x\\\n  B = 1"\nC = 2\n'
    expect(kvs(parse(t)).map(e => [e.key, !!e.readonly])).toEqual([['A', true], ['C', false]])
  })
})

describe('R4 two statements on one line / long strings with quotes', () => {
  it.each([
    ['Width = 1920 Height = 1080\n', 'Width', ['Height']],
    ['X = 1 if A then B = 2 end\n', 'X', ['B']],
    ['Debug = 0; Speed = 4\n', 'Debug', ['Speed']],
    ['local Config = {\n  Motd = [[say "hi]], Speed = 2,\n}\nreturn Config\n', 'Motd', ['Speed']],
    ['return {\n  A = [==[a]]b]==], B = 1,\n}', 'A', ['B']],
  ])('%j is readonly', (text, key, assigns) => {
    const entries = parse(text)
    expect(kv(entries, key)).toMatchObject({ readonly: true, assigns })
    expect(serializeConfig(edit(entries, key, '9'))).toBe(text)
  })

  it('comparisons, calls, tables and strings are not second statements', () => {
    const t = 'return {\n  A = a == b,\n  B = x ~= y,\n  C = f(a, b),\n  D = { x = 1, y = 2 },\n  E = "a = b, c",\n  F = [[x = 1]],\n  G = 1 <= 2,\n  H = t[1],\n}'
    expect(kvs(parse(t)).map(e => [e.key, !!e.readonly])).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(k => [k, false]))
  })

  it('the shared-line key is untouched: edit, removal and insert of the hidden key are all refused', () => {
    const t = 'Width = 800 Height = 600\n'
    const entries = parse(t)
    expect(removeKeyvalAt(entries, 0)).toBe(entries)
    expect(appendKeyval(entries, 'Height', '1')).toBe(entries)
    if (hasLua) expect(luaRead(serializeConfig(edit(entries, 'Width', '1024')), 'C.Height')).toBe('600')
  })
})

describe('R5 the line before an insert always gets its separator', () => {
  it.each([
    ['positional item (break-F8)', 'local Config = {\n    "item"\n}\nreturn Config\n', 'local Config = {\n    "item",\n    Extra = 7,\n}\nreturn Config\n', 'C[1] .. C.Extra', 'item7'],
    ['["k"] = v', 'return {\n  ["weird key"] = 1\n}\n', 'return {\n  ["weird key"] = 1,\n  Extra = 7,\n}\n', 'C["weird key"] + C.Extra', '8'],
    ['comment after the item', 'return {\n  "a" -- first\n}\n', 'return {\n  "a", -- first\n  Extra = 7,\n}\n', 'C[1] .. C.Extra', 'a7'],
    ['nested table close', 'return {\n  {\n    1,\n  }\n}\n', 'return {\n  {\n    1,\n  },\n  Extra = 7,\n}\n', 'C[1][1] + C.Extra', '8'],
    ['`;` separator is kept', 'return {\n  "a";\n}\n', 'return {\n  "a";\n  Extra = 7,\n}\n', 'C.Extra', '7'],
    ['opener with an item on it', 'return { "a"\n}\n', 'return { "a",\n    Extra = 7,\n}\n', 'C[1] .. C.Extra', 'a7'],
  ])('%s', (_name, text, expected, expr, value) => {
    const out = serializeConfig(appendKeyval(parse(text), 'Extra', '7'))
    expect(out).toBe(expected)
    expectLuaParses(out)
    if (hasLua) expect(luaRead(out, expr)).toBe(value)
  })
})

describe('R6 INI values', () => {
  it('an emptied value is written, per the line\'s own prefix (review-F2, break-F9a)', () => {
    const text = '[Server]\nPassword=secret\nMotd = Welcome ; shown on join\nTag = x # note\nQuoted = "abc"\n'
    let entries = parse(text, 'ini')
    for (const key of ['Password', 'Motd', 'Tag', 'Quoted']) entries = edit(entries, key, '')
    const out = saveWith(entries, one({ Password: { type: 'text' }, Motd: { type: 'text' }, Tag: { type: 'text' }, Quoted: { type: 'text' } }))
    // a `;` comment stays; a `#` one would read back as the value, so it goes
    expect(out).toBe('[Server]\nPassword=\nMotd = ; shown on join\nTag =\nQuoted = ""\n')
    expect(kvs(parse(out, 'ini')).map(e => e.value)).toEqual(['', '', '', ''])
    // …and a later edit writes the comment back in front of the value
    const again = serializeConfig(edit(parse(out, 'ini'), 'Motd', 'Hi'))
    expect(again).toBe('[Server]\nPassword=\nMotd = Hi ; shown on join\nTag =\nQuoted = ""\n')
  })

  it('never strips or adds a trailing comma (break-F9c)', () => {
    const entries = parse('[General]\nItems = a,b,\n', 'ini')
    expect(kv(entries, 'Items').value).toBe('a,b,')
    expect(serializeConfig(edit(entries, 'Items', 'c'))).toBe('[General]\nItems = c\n')
    expect(serializeConfig(edit(entries, 'Items', 'c,d,'))).toBe('[General]\nItems = c,d,\n')
  })

  it('inline comments are found from the value on; only a leading quote quotes (review-F5)', () => {
    const entries = parse('[Colors]\nMain = #FF0000 ; primary color\nTitle = Bob\'s Server ; shown in the lobby\nEmpty = ; nothing\nHash=#1\n', 'ini')
    expect(kvs(entries).map(e => [e.key, e.value, e.trailing])).toEqual([
      ['Main', '#FF0000', ' ; primary color'],
      ['Title', "Bob's Server", ' ; shown in the lobby'],
      ['Empty', '', '; nothing'],
      ['Hash', '#1', ''],
    ])
    const out = serializeConfig(edit(edit(entries, 'Main', '#123456'), 'Title', "Alice's"))
    expect(out).toBe('[Colors]\nMain = #123456 ; primary color\nTitle = Alice\'s ; shown in the lobby\nEmpty = ; nothing\nHash=#1\n')
  })

  it('a value that would be cut at ` ;` / ` #` / ` --` (or lose its quotes) is written quoted (break-F9b)', () => {
    const cases = [
      ['Welcome ; have fun', 'Motd = "Welcome ; have fun"'],
      ['a # b', 'Motd = "a # b"'],
      ['x -- y', 'Motd = "x -- y"'],
      [';start', 'Motd = ";start"'],
      ['say "hi" ; now', 'Motd = \'say "hi" ; now\''],
      ['"quoted"', 'Motd = \'"quoted"\''],
      ['plain; text#1', 'Motd = plain; text#1'],
    ]
    for (const [typed, line] of cases) {
      const out = serializeConfig(edit(parse('[G]\nMotd = hi\n', 'ini'), 'Motd', typed))
      expect(out, typed).toBe(`[G]\n${line}\n`)
      expect(kv(parse(out, 'ini'), 'Motd').value, typed).toBe(typed)
    }
    // the line's own trailing comment is taken into account (a lone `'`)
    const out = serializeConfig(edit(parse('[G]\nMotd = hi # note\n', 'ini'), 'Motd', "'"))
    expect(out).toBe('[G]\nMotd = "\'" # note\n')
    expect(kv(parse(out, 'ini'), 'Motd').value).toBe("'")
  })

  it('a line break can never split an INI line: it is written as a space', () => {
    const entries = edit(parse('[G]\nMotd = hi ; note\r\nNext = 1\r\n', 'ini'), 'Motd', 'line\nbreak')
    const out = saveWith(entries, one({ Motd: { type: 'text' } }))
    expect(out).toBe('[G]\nMotd = line break ; note\r\nNext = 1\r\n')
    expect(serializeConfig(entries)).toBe(out)
  })

  it('keys may contain `-` and `.`; they bind and toggle like any key (break-F9d)', () => {
    const entries = parse('[General]\nwindow-width = 800\nAudio.Volume = 5\n', 'ini')
    expect(kvs(entries).map(e => e.key)).toEqual(['window-width', 'Audio.Volume'])
    const idx = idxOf(entries, 'window-width', 'General')
    const off = removeKeyvalAt(entries, idx)
    expect(serializeConfig(off)).toBe('[General]\nAudio.Volume = 5\n')
    const on = appendKeyval(off, 'window-width', '1024', { format: 'ini', sectionHint: 'General' })
    expect(serializeConfig(on)).toBe('[General]\nAudio.Volume = 5\nwindow-width = 1024\n')
    expect(appendKeyval(on, 'window-width', '1', { format: 'ini', sectionHint: 'General' })).toBe(on)
  })

  it('an optional key without a default is seeded empty (`Key =`), never `""` (review-F2)', () => {
    const entries = parse('[Server]\nPort=7777\n', 'ini')
    const out = serializeConfig(appendKeyval(entries, 'Motd', typedDefaultSeed('text'), { format: 'ini', sectionHint: 'Server' }))
    expect(out).toBe('[Server]\nPort=7777\nMotd=\n')
    expect(kv(parse(out, 'ini'), 'Motd').value).toBe('')
    // a new value with a comment marker is quoted so it reads back
    const quoted = serializeConfig(appendKeyval(entries, 'Motd', 'a ; b', { format: 'ini', sectionHint: 'Server' }))
    expect(quoted).toBe('[Server]\nPort=7777\nMotd="a ; b"\n')
  })
})

describe('R7 guessValueType agrees with isValidNumber', () => {
  it.each([
    ['1', 'int'], ['-0', 'int'], ['007', 'int'],
    ['.5', 'float'], ['3.', 'float'], ['1e3', 'float'], ['-2.5E-3', 'float'], ['1.0', 'float'],
    ['0x10', 'string'], ['1e', 'string'], ['', 'string'], ['true', 'bool'],
  ])('%j → %s', (v, type) => {
    expect(guessValueType(v)).toBe(type)
    if (type === 'int' || type === 'float') expect(isValidNumber(v, 'float')).toBe(true)
  })

  it('comment mode keeps a saved `.5` a number field (break-F4)', () => {
    let entries = parse('local Config = {\n    SlotCount = 10,\n}\nreturn Config\n')
    entries = parse(saveWith(edit(entries, 'SlotCount', '.5'), null))
    expect(kv(entries, 'SlotCount').value).toBe('.5')
    const out = saveWith(edit(entries, 'SlotCount', '1,5'), null)
    expect(out).toBe('local Config = {\n    SlotCount = .5,\n}\nreturn Config\n')
  })
})

describe('R9 untyped / unknown types keep the value\'s kind', () => {
  const text = 'local Config = {\n    Speed = 5,\n    Ratio = 1.5,\n    Mode = nil,\n    Items = {"a"},\n    Tag = fast,\n    Name = "x",\n}\nreturn Config\n'
  const schema = one({
    Speed: { default: 5 },
    Ratio: { type: 'number', min: 0, max: 2 },
    Mode: { default: 'Hard' },
    Items: {},
    Tag: { type: 'slider' },
    Name: {},
  })

  it('an inferred number is validated like an int / float (break-F3a–c)', () => {
    for (const bad of ['1,5', 'fast', '', '0x10']) {
      const out = saveWith(edit(edit(parse(text), 'Speed', bad), 'Ratio', bad), schema)
      expect(out, bad).toBe(text)
    }
    const ok = saveWith(edit(edit(parse(text), 'Speed', '7'), 'Ratio', '9'), schema)
    expect(ok).toContain('    Speed = 7,\n    Ratio = 2,\n')
  })

  it('a bare value that is no longer a number / bool literal is written quoted (break-F3d)', () => {
    const out = saveWith(edit(edit(edit(parse(text), 'Mode', 'Hard'), 'Tag', 'very fast'), 'Name', 'y'), schema)
    expect(out).toContain('    Mode = "Hard",\n')
    expect(out).toContain('    Tag = "very fast",\n')
    expect(out).toContain('    Name = "y",\n')
    expectLuaParses(out)
    if (hasLua) expect(luaRead(out, 'C.Mode .. "|" .. C.Tag')).toBe('Hard|very fast')
    // numbers / bools typed into a bare text field stay literals
    expect(saveWith(edit(parse(text), 'Tag', 'true'), schema)).toContain('    Tag = true,\n')
  })

  it('a table replaced by a table stays a table', () => {
    const out = saveWith(edit(parse(text), 'Items', '{"a", "b"}'), schema)
    expect(out).toContain('    Items = {"a", "b"},\n')
    if (hasLua) expect(luaRead(out, '#C.Items')).toBe('2')
  })

  it('clearing a bare value keeps the line', () => {
    expect(saveWith(edit(parse(text), 'Tag', '  '), schema)).toBe(text)
  })

  it('comment mode: a quoted "1234" is text; an unquoted number is validated (review-F3)', () => {
    const t = 'local Config = {\n  Password = "1234",\n  Port = 7777,\n}\nreturn Config\n'
    const out = saveWith(edit(edit(parse(t), 'Password', 'hunter2'), 'Port', 'abc'), null)
    expect(out).toBe('local Config = {\n  Password = "hunter2",\n  Port = 7777,\n}\nreturn Config\n')
    if (hasLua) expect(luaRead(out, 'C.Password')).toBe('hunter2')
  })

  it('comment mode: free text on a bare line is quoted, Lua names / tables stay bare', () => {
    const t = 'local Config = {\n  Mode = Normal,\n  Hotkey = Key.F6,\n  List = {1},\n}\nreturn Config\n'
    let entries = edit(edit(edit(parse(t), 'Mode', 'Very Hard'), 'Hotkey', 'Key.F7'), 'List', '{1, 2}')
    const out = saveWith(entries, null)
    expect(out).toBe('local Config = {\n  Mode = "Very Hard",\n  Hotkey = Key.F7,\n  List = {1, 2},\n}\nreturn Config\n')
    expectLuaParses(out)
    entries = edit(parse(t), 'Mode', 'end')
    expect(saveWith(entries, null)).toContain('  Mode = "end",')
  })
})

describe('R10 numbers in list / multi-select values stay numbers', () => {
  const text = 'local Config = {\n    Slots = {1, 2},\n    Ids = {10, 20, 30},\n    Names = {"a"},\n    Other = true,\n}\nreturn Config\n'
  const schema = one({
    Slots: { type: 'multi-select', options: [1, 2, 3] },
    Ids: { type: 'list' },
    Names: { type: 'multi-select', options: ['a', 'b'] },
    Other: { type: 'bool' },
  })

  it('checking an option writes numeric options bare (break-F11)', () => {
    // What MultiSelectInput stores: strings.
    const entries = edit(parse(text), 'Slots', serializeLuaArray(['1', '2', '3']))
    const out = saveWith(entries, schema)
    expect(out).toContain('    Slots = {1, 2, 3},\n')
    if (hasLua) expect(luaRead(out, 'C.Slots[1] == 1 and math.type(C.Slots[3])')).toBe('integer')
  })

  it('an unrelated edit keeps Slots[1] == 1', () => {
    const out = saveWith(edit(parse(text), 'Other', 'false'), schema)
    expect(out).toContain('    Slots = {1, 2},\n')
    if (hasLua) expect(luaRead(out, 'C.Slots[1] == 1')).toBe('true')
  })

  it('list items that were bare numbers stay bare when unchanged; new items are strings', () => {
    const out = saveWith(edit(parse(text), 'Ids', serializeLuaArray(['20', '30', 'x'])), schema)
    expect(out).toContain('    Ids = {20, 30, "x"},\n')
    if (hasLua) expect(luaRead(out, 'math.type(C.Ids[1]) .. C.Ids[3]')).toBe('integerx')
  })

  it('string options stay strings', () => {
    const out = saveWith(edit(parse(text), 'Names', serializeLuaArray(['a', 'b'])), schema)
    expect(out).toContain('    Names = {"a", "b"},\n')
  })

  it('numeric array defaults are numbers and compare equal to the stored form', () => {
    const def = { type: 'multi-select', options: [1, 2, 3], default: [1, 2] }
    expect(defaultToValueStr(def)).toBe('{1, 2}')
    expect(valueEqualsDefault('{1, 2}', def)).toBe(true)
    expect(valueEqualsDefault('{"1", "2"}', def)).toBe(true)
    expect(valueEqualsDefault('{1,2}', def)).toBe(true)
    expect(valueEqualsDefault('{2, 1}', def)).toBe(false)
    expect(parseLuaArray('{1, "2"}')).toEqual(['1', '2'])
    expect(parseLuaArrayItems('{1, "2"}')).toEqual([{ text: '1', bare: true }, { text: '2', bare: false }])
  })
})

describe('R11 removing a key removes every line of it in the same table', () => {
  it('toggle off: both duplicate lines go, Lua reads nil (break-F13)', () => {
    const t = 'local Config = {\n    Speed = 1,\n    Speed = 2,\n}\nreturn Config\n'
    const entries = parse(t)
    const out = serializeConfig(removeKeyvalAt(entries, idxOf(entries, 'Speed')))
    expect(out).toBe('local Config = {\n}\nreturn Config\n')
    if (hasLua) expect(luaRead(out, 'C.Speed')).toBe('nil')
  })

  it('footer reset of an optional key without a default removes every line too', () => {
    const t = 'return {\n  -- ====[ AK47 ]====\n  Damage = 30,\n  -- ====[ M4 ]====\n  Damage = 25,\n  Keep = 1,\n}\n'
    const entries = parse(t)
    const schema = normalizeSchema({ sections: { M4: { keys: { Damage: { type: 'int', optional: true } } }, S: { keys: { Keep: { type: 'int', default: 1 } } } } })
    const map = buildEntryKeyDefMap(entries, schema)
    expect(entriesAtDefaults(entries, map)).toBe(false)
    const out = serializeConfig(resetEntriesToDefaults(entries, map))
    expect(out).toBe('return {\n  -- ====[ AK47 ]====\n  -- ====[ M4 ]====\n  Keep = 1,\n}\n')
    if (hasLua) expect(luaRead(out, 'C.Damage')).toBe('nil')
  })

  it('INI: only the same [Section]', () => {
    const t = '[A]\nX = 1\nX = 2\n[B]\nX = 3\n'
    const entries = parse(t, 'ini')
    expect(serializeConfig(removeKeyvalAt(entries, idxOf(entries, 'X', 'A')))).toBe('[A]\n[B]\nX = 3\n')
  })

  it('refused (same array back) when one of the lines is readonly', () => {
    const t = 'return {\n  Speed = {\n    1,\n  },\n  Speed = 2,\n}\n'
    const entries = parse(t)
    expect(removeKeyvalAt(entries, idxOf(entries, 'Speed'))).toBe(entries)
  })
})

describe('clamping never lands outside the range', () => {
  it('a float min finer than 4 decimals, an int with fractional bounds', () => {
    const t = 'return {\n  Eps = 0.5,\n  Count = 1,\n}\n'
    const schema = one({ Eps: { type: 'float', min: 0.00001, max: 1 }, Count: { type: 'int', min: 0.5, max: 3.5 } })
    const low = saveWith(edit(edit(parse(t), 'Eps', '0'), 'Count', '0'), schema)
    expect(low).toBe('return {\n  Eps = 0.00001,\n  Count = 1,\n}\n')
    const high = saveWith(edit(parse(t), 'Count', '9'), schema)
    expect(high).toBe('return {\n  Eps = 0.5,\n  Count = 3,\n}\n')
  })
})

describe('final-verification fixes', () => {
  it('never inserts after a `return` that shares its line with other code', () => {
    // The file returns its (one-line) table — a new global would never reach
    // the mod, and a line after `return` doesn't load: refused.
    const same = parse('local Config <const> = {}; return Config\n')
    expect(appendKeyval(same, 'Bonus', '3', { format: 'lua' })).toBe(same)
    const onField = parse('A = 1; return A\n')
    expect(appendKeyval(onField, 'Bonus', '3', { format: 'lua' })).toBe(onField)
    // `return nil` returns nothing: the global goes BEFORE the return.
    const out = serializeConfig(appendKeyval(parse('Debug = false\nreturn nil\n'), 'Bonus', '3', { format: 'lua' }))
    expect(out).toBe('Debug = false\nBonus = 3\nreturn nil\n')
    expectLuaParses(out)
  })

  it('a strict .lua file reads a leading `;` as code, so the insert stays valid', () => {
    const text = 'local Config = {\n  A = 1\n  ;B = 2\n}\nreturn Config\n'
    const out = serializeConfig(appendKeyval(parse(text), 'Extra', '7', { format: 'lua' }))
    expectLuaParses(out)
    expect(kv(parse(out), 'Extra').value).toBe('7')
    if (hasLua) expect(luaRead(out, 'C.Extra')).toBe('7')
  })

  it('a sniffed hybrid file keeps `;` lines as comments, even ones with Lua keywords', () => {
    const text = 'return {\n; set to true if you want the HUD\n  Hud = true,\n}\n'
    const entries = parseConfigFile(text, { syntax: 'auto' })
    expect(kv(entries, 'Hud').value).toBe('true')
    const added = appendKeyval(entries, 'Extra', '7', { format: 'auto' })
    expect(added).not.toBe(entries)
    expect(serializeConfig(added)).toBe('return {\n; set to true if you want the HUD\n  Hud = true,\n  Extra = 7,\n}\n')
  })

  it('INI: a banner comment next to real sections is just a comment', () => {
    const text = '[General]\n; [Audio]\nVolume = 5\n[Audio]\nVolume = 3\n'
    const entries = parse(text, 'ini')
    const idx = resolveEntryIdx(buildSectionKeyIndex(entries), 'Audio', 'Volume')
    expect(entries[idx].value).toBe('3')
  })

  it('INI: a section header may carry a trailing comment', () => {
    const entries = parse('[Video] ; display\nWidth = 800\n', 'ini')
    const idx = resolveEntryIdx(buildSectionKeyIndex(entries), 'Video', 'Width')
    expect(entries[idx].value).toBe('800')
    expect(serializeConfig(entries)).toBe('[Video] ; display\nWidth = 800\n')
  })

  it('numbers must be finite', () => {
    expect(isValidNumber('1e999', 'float')).toBe(false)
    expect(isValidNumber('-1e999', 'float')).toBe(false)
    expect(isValidNumber('1e308', 'float')).toBe(true)
  })
})
