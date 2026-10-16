import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import luaparse from 'luaparse'
import {
  parseConfigFile,
  serializeConfig,
  appendKeyval,
  syntaxForFile,
  valueNeedsQuote,
  keyDefNeedsQuote,
  buildSectionKeyIndex,
  resolveEntryIdx,
  resolveSectionName,
  buildEntryKeyDefMap,
  normalizeSchema,
} from '../../src/renderer/src/utils/config-parser'
import {
  typedDefaultSeed,
  isValidNumber,
  valueEqualsDefault,
  prepareEntriesForSave,
  resetEntriesToDefaults,
  entriesAtDefaults,
} from '../../src/renderer/src/utils/widget-helpers'

// Data-safety regressions for the config editor (spec 1.4, P1-P12): every
// write path must leave a config the mod can still load, and must only touch
// the line a schema row actually shows. Outputs are checked with luaparse
// (always) and, when a `lua` 5.4 binary is on PATH (or LUA_BIN), by really
// loading them and reading the value back.

const LUA_BIN = process.env.LUA_BIN || 'lua'
const hasLua = spawnSync(LUA_BIN, ['-v']).status === 0

// Syntax check with luaparse — runs everywhere.
function expectLuaParses(text) {
  expect(() => luaparse.parse(text, { luaVersion: '5.3', comments: false })).not.toThrow()
}

// Load `text` with real Lua and return tostring(<expr>) (`C` is the config:
// the chunk's return value, or _G for globals-style files). 'LOAD_ERROR: …'
// when the chunk doesn't compile.
function luaRead(text, expr) {
  const file = path.join(os.tmpdir(), `hzmm-cfg-${process.pid}-${Math.random().toString(36).slice(2)}.lua`)
  fs.writeFileSync(file, text)
  try {
    const code = `local f, err = loadfile([[${file}]]) if not f then io.write('LOAD_ERROR: ' .. err) return end ` +
      `local env = setmetatable({}, { __index = _G }) debug.setupvalue(f, 1, env) ` +
      `local r = f() local C = type(r) == 'table' and r or env io.write(tostring(${expr}))`
    const res = spawnSync(LUA_BIN, ['-e', code], { encoding: 'utf8' })
    // Windows text-mode stdout turns \n into \r\n.
    return (res.stdout + res.stderr).replace(/\r\n/g, '\n')
  } finally {
    fs.rmSync(file, { force: true })
  }
}

const kvs = (entries) => entries.filter(e => e.type === 'keyval')
const kv = (entries, key) => entries.find(e => e.type === 'keyval' && e.key === key)
const edit = (entries, key, value) => entries.map(e => (e.type === 'keyval' && e.key === key ? { ...e, value } : e))

describe('syntax selection (P1)', () => {
  it('maps file extensions to a parse syntax', () => {
    expect(syntaxForFile('config.lua')).toBe('lua')
    expect(syntaxForFile('Scripts/Config.LUA')).toBe('lua')
    expect(syntaxForFile('settings.ini')).toBe('ini')
    expect(syntaxForFile('mod.cfg')).toBe('ini')
    expect(syntaxForFile('options.txt')).toBe('auto')
  })

  it('explicit ini syntax takes values literally and splits ; / # comments', () => {
    const entries = parseConfigFile('Path = "C:\\Games\\" ; install dir\n', { syntax: 'ini' })
    expect(kv(entries, 'Path').value).toBe('C:\\Games\\')
    expect(kv(entries, 'Path').trailing).toBe(' ; install dir')
  })
})

describe('Lua string escaping (P5)', () => {
  const text = 'local Config = {\n  Title = "C:\\\\Logs",   -- log dir\n  Owner = \'Bob\',\n}\nreturn Config\n'

  it('unescapes quoted values on read', () => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(kv(entries, 'Title').value).toBe('C:\\Logs')
    expect(serializeConfig(entries)).toBe(text)
  })

  it('escapes quotes, backslashes and newlines on write, and the file still loads', () => {
    const typed = 'Bob\'s "Best" \\ Server\nline2'
    let entries = parseConfigFile(text, { syntax: 'lua' })
    entries = edit(edit(entries, 'Title', typed), 'Owner', "O'Brien")
    const out = serializeConfig(entries)
    expect(out).toContain('  Title = "Bob\'s \\"Best\\" \\\\ Server\\nline2",   -- log dir')
    expect(out).toContain("  Owner = 'O\\'Brien',")
    expectLuaParses(out)
    // Round-trips back to the exact text the user typed.
    expect(kv(parseConfigFile(out, { syntax: 'lua' }), 'Title').value).toBe(typed)
    if (hasLua) {
      expect(luaRead(out, 'C.Title')).toBe(typed)
      expect(luaRead(out, 'C.Owner')).toBe("O'Brien")
    }
  })

  it('INI values are never escaped', () => {
    const entries = edit(parseConfigFile('[A]\nPath = "x"\n', { syntax: 'ini' }), 'Path', 'C:\\Games')
    expect(serializeConfig(entries)).toBe('[A]\nPath = "C:\\Games"\n')
  })

  it('an escape the editor cannot re-encode makes the entry readonly', () => {
    const entries = parseConfigFile('Sep = "\\x2C",\n', { syntax: 'lua' })
    expect(kv(entries, 'Sep').readonly).toBe(true)
    expect(serializeConfig(edit(entries, 'Sep', 'changed'))).toBe('Sep = "\\x2C",\n')
  })

  it('a one-line long string decodes and is rewritten as a quoted string', () => {
    const entries = parseConfigFile('local C = {\n  Motd = [[Welcome -- enjoy]],\n}\nreturn C', { syntax: 'lua' })
    expect(kv(entries, 'Motd').value).toBe('Welcome -- enjoy')
    const out = serializeConfig(edit(entries, 'Motd', 'Welcome back -- enjoy'))
    expect(out).toContain('  Motd = "Welcome back -- enjoy",')
    expectLuaParses(out)
  })
})

describe('edited lines keep their formatting (P6)', () => {
  it('keeps key/= spacing, trailing comma, inline comment and CRLF', () => {
    const text = '    TrailSpacing   =  2000,        -- UU\r\nDamage=100\r\n'
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const out = serializeConfig(edit(edit(entries, 'TrailSpacing', '2500'), 'Damage', '150'))
    expect(out).toBe('    TrailSpacing   =  2500,        -- UU\r\nDamage=150\r\n')
  })

  it('INI ; and # inline comments are split off and kept', () => {
    const text = '[General]\nVolume=5 ; master\nEnabled=true # on\n'
    const entries = parseConfigFile(text, { syntax: 'ini' })
    expect(kv(entries, 'Enabled').value).toBe('true')
    expect(kv(entries, 'Volume').inlineDesc).toBe('master')
    expect(serializeConfig(edit(entries, 'Enabled', 'false'))).toBe('[General]\nVolume=5 ; master\nEnabled=false # on\n')
  })
})

describe('schema-typed quoting (P7)', () => {
  it('select is quoted for string options, bare for number / bool options', () => {
    expect(valueNeedsQuote('select', [{ value: 'Easy' }, { value: 'Hard' }])).toBe(true)
    expect(valueNeedsQuote('select', [{ value: 1 }, { value: 2 }])).toBe(false)
    expect(valueNeedsQuote('select', [{ value: true }, { value: false }])).toBe(false)
    expect(valueNeedsQuote('select', [{ value: 1 }, { value: 'x' }])).toBe(true)
    expect(valueNeedsQuote('select')).toBe(true)
  })

  it('unknown / missing schema types keep the existing quoting', () => {
    expect(keyDefNeedsQuote({ type: 'slider' }, true)).toBe(true)
    expect(keyDefNeedsQuote({ type: 'slider' }, false)).toBe(false)
    expect(keyDefNeedsQuote({}, false)).toBe(false)
    expect(keyDefNeedsQuote({ type: 'keybind' }, false)).toBe(true)
    expect(keyDefNeedsQuote({ type: 'int' }, true)).toBe(false)
  })

  it('an edited line is quoted by the schema type, not by the old line', () => {
    const text = 'local C = {\n  Hotkey = F6,\n  MaxHealth = "100",\n}\nreturn C\n'
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const schema = { sections: { Main: { keys: { Hotkey: { type: 'keybind' }, MaxHealth: { type: 'int' } } } } }
    const edited = edit(edit(entries, 'Hotkey', 'Ctrl+F7'), 'MaxHealth', '150')
    const out = serializeConfig(prepareEntriesForSave(edited, buildEntryKeyDefMap(edited, schema)))
    expect(out).toContain('  Hotkey = "Ctrl+F7",')
    expect(out).toContain('  MaxHealth = 150,')
    expectLuaParses(out)
  })

  const selectCase = (keyDef) => {
    // What SchemaRow + ConfigEditorModal do on an optional toggle-on.
    const seed = keyDef.default !== undefined ? String(keyDef.default) : typedDefaultSeed(keyDef.type, keyDef.options)
    const entries = parseConfigFile('local Config = {\n  Enabled = true,\n}\nreturn Config\n', { syntax: 'lua' })
    const out = serializeConfig(appendKeyval(entries, 'Difficulty', seed, { isQuoted: keyDefNeedsQuote(keyDef, false) }))
    expectLuaParses(out)
    return out
  }

  it('optional select with a default is written as a quoted string', () => {
    const out = selectCase({ type: 'select', optional: true, default: 'Hard', options: [{ value: 'Easy' }, { value: 'Hard' }] })
    expect(out).toContain('  Difficulty = "Hard",')
    if (hasLua) expect(luaRead(out, 'C.Difficulty')).toBe('Hard')
  })

  it('optional select without a default seeds its first option (never `Key = ,`)', () => {
    const out = selectCase({ type: 'select', optional: true, options: [{ value: 'Easy' }, { value: 'Hard' }] })
    expect(out).toContain('  Difficulty = "Easy",')
    if (hasLua) expect(luaRead(out, 'C.Difficulty')).toBe('Easy')
  })

  it('optional numeric select stays bare', () => {
    const out = selectCase({ type: 'select', optional: true, options: [{ value: 1 }, { value: 2 }] })
    expect(out).toContain('  Difficulty = 1,')
  })
})

describe('numeric safety (P8)', () => {
  const text = 'local C = {\n  Ratio = 1.5,\n  Count = 10,\n}\nreturn C\n'
  const schema = { sections: { S: { keys: { Ratio: { type: 'float', min: 0, max: 10 }, Count: { type: 'int', default: 3 } } } } }

  it('validates numbers strictly', () => {
    for (const ok of ['0', '-7', '1.5', '2.', '.5', '1e3', '-2.5E-3']) expect(isValidNumber(ok, 'float')).toBe(true)
    for (const bad of ['', ' 1', '1,5', 'ten', '10 -- m', '0x10', '1e']) expect(isValidNumber(bad, 'float')).toBe(false)
    expect(isValidNumber('12', 'int')).toBe(true)
    expect(isValidNumber('12.5', 'int')).toBe(false)
  })

  it('never writes an empty or non-numeric int/float — reverts to the original value', () => {
    for (const bad of ['', 'ten', '1,5', '10 -- m']) {
      const edited = edit(edit(parseConfigFile(text, { syntax: 'lua' }), 'Ratio', bad), 'Count', bad)
      const out = serializeConfig(prepareEntriesForSave(edited, buildEntryKeyDefMap(edited, schema)))
      expect(out, `input ${JSON.stringify(bad)}`).toBe(text)
    }
  })

  it('a new entry with an invalid number falls back to the schema default', () => {
    const entries = appendKeyval(parseConfigFile(text, { syntax: 'lua' }), 'Extra', '', {})
    const withDef = { sections: { S: { keys: { ...schema.sections.S.keys, Extra: { type: 'int', default: 4 } } } } }
    const prepared = prepareEntriesForSave(entries, buildEntryKeyDefMap(entries, withDef))
    expect(kv(prepared, 'Extra').value).toBe('4')
    expect(serializeConfig(prepared)).toContain('  Extra = 4,')
  })

  it('clamps an edited value but never a line the user did not touch', () => {
    const t = 'local C = {\n  Players = 20000,\n  Ratio = 1.5,\n}\nreturn C\n'
    const s = { sections: { S: { keys: { Players: { type: 'int', max: 9999 }, Ratio: { type: 'float', min: 0, max: 10 } } } } }
    const edited = edit(parseConfigFile(t, { syntax: 'lua' }), 'Ratio', '42')
    const out = serializeConfig(prepareEntriesForSave(edited, buildEntryKeyDefMap(edited, s)))
    expect(out).toBe('local C = {\n  Players = 20000,\n  Ratio = 10,\n}\nreturn C\n')
  })

  it('comment mode applies the same rule to originally numeric keys', () => {
    const edited = edit(edit(parseConfigFile(text, { syntax: 'lua' }), 'Ratio', ''), 'Count', '12')
    const out = serializeConfig(prepareEntriesForSave(edited, null))
    expect(out).toBe(text.replace('Count = 10', 'Count = 12'))
  })

  it('the serializer itself never emits an unquoted empty value', () => {
    const entries = edit(parseConfigFile('Mode = fast,\n', { syntax: 'lua' }), 'Mode', '  ')
    expect(serializeConfig(entries)).toBe('Mode = fast,\n')
  })
})

describe('root-level binding: nested keys, functions, block comments (P2 / P3)', () => {
  it('never binds a key inside a sub-table, even with the same name as a root key', () => {
    const text = [
      'local Config = {',
      '  Damage = 1.0,',
      '  Overrides = {',
      '    Damage = 250.0,',
      '  },',
      '}',
      'return Config',
    ].join('\n')
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(kvs(entries).map(e => e.key)).toEqual(['Damage', 'Overrides'])
    const idx = resolveEntryIdx(buildSectionKeyIndex(entries), 'General', 'Damage')
    expect(entries[idx].value).toBe('1.0')
    expect(kv(entries, 'Overrides')).toMatchObject({ readonly: true, multiline: true })
  })

  it('per-weapon sub-tables: the leaf keys are never bound', () => {
    const text = [
      'return {',
      '  Weapons = {',
      '    Pistol = { Damage = 10 },',
      '    Rifle = {',
      '      Damage = 30,',
      '    },',
      '  },',
      '}',
    ].join('\n')
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const index = buildSectionKeyIndex(entries)
    expect(resolveEntryIdx(index, 'Pistol', 'Damage')).toBeUndefined()
    expect(resolveEntryIdx(index, 'Rifle', 'Damage')).toBeUndefined()
    // R is capped at the root table's field level (spec P3): Weapons is the
    // only root field — multi-line, so readonly — and nothing inside it binds.
    expect(kvs(entries).map(e => [e.key, !!e.readonly])).toEqual([['Weapons', true]])
    expect(resolveEntryIdx(index, 'Pistol', 'Pistol')).toBeUndefined()
  })

  it('keys of sibling sub-tables are never bound, even when every field is nested', () => {
    // R is capped at 1, so the only root field is the readonly Weapons table.
    const text = [
      'local Config = {',
      '  Weapons = {',
      '    Pistol = {',
      '      Damage = 10,',
      '      Damage = 12,',
      '    },',
      '    Rifle = {',
      '      Damage = 30,',
      '      Ammo = 5,',
      '    },',
      '  },',
      '}',
      'return Config',
    ].join('\n')
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const index = buildSectionKeyIndex(entries)
    expect(resolveEntryIdx(index, 'Pistol', 'Damage')).toBeUndefined()
    expect(resolveEntryIdx(index, 'Rifle', 'Damage')).toBeUndefined()
    expect(resolveEntryIdx(index, 'Rifle', 'Ammo')).toBeUndefined()
    // Two tables holding one name: only the RETURNED table's field is an
    // entry (root-table model) — B's X passes through untouched.
    const two = parseConfigFile('local A = {\n  X = 1,\n}\nlocal B = {\n  X = 2,\n}\nreturn A', { syntax: 'lua' })
    expect(kvs(two).map(e => [e.key, e.value])).toEqual([['X', '1']])
    expect(two[resolveEntryIdx(buildSectionKeyIndex(two), 'S', 'X')].value).toBe('1')
    // A repeat inside ONE table keeps Lua's last-wins binding.
    const one = parseConfigFile('return {\n  A = 1,\n  A = 2,\n}', { syntax: 'lua' })
    expect(one[resolveEntryIdx(buildSectionKeyIndex(one), 'S', 'A')].value).toBe('2')
  })

  it('ignores assignments inside function bodies; a function value is readonly', () => {
    const text = [
      'local Config = {',
      '  Base = 5,',
      '  Scale = function(x)',
      '    Damage = x * 2',
      '    if x > 1 then Base = 3 end',
      '    return Damage',
      '  end,',
      '  Inline = function(x) return x end,',
      '  Damage = 7,',
      '}',
      'function helper()',
      '  Base = 99',
      'end',
      'return Config',
    ].join('\n')
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(kvs(entries).map(e => e.key)).toEqual(['Base', 'Scale', 'Inline', 'Damage'])
    expect(kv(entries, 'Scale')).toMatchObject({ readonly: true, multiline: true })
    expect(kv(entries, 'Inline').readonly).toBe(true)
    const index = buildSectionKeyIndex(entries)
    expect(entries[resolveEntryIdx(index, 'X', 'Damage')].value).toBe('7')
    expect(entries[resolveEntryIdx(index, 'X', 'Base')].value).toBe('5')
    expect(serializeConfig(entries)).toBe(text)
  })

  it('ignores keys inside --[==[ ]==] block comments', () => {
    const text = 'local C = {\n  --[==[\n  MaxHealth = 999,\n  ]==]\n  MaxHealth = 100,\n}\nreturn C'
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(kvs(entries).map(e => e.value)).toEqual(['100'])
  })

  it('does not read braces inside strings or comments as table depth', () => {
    const text = 'local C = {\n  Open = "{",  -- a } brace\n  Next = 2,\n}\nreturn C'
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(kvs(entries).map(e => [e.key, e.value])).toEqual([['Open', '{'], ['Next', '2']])
  })

  it('a trailing block comment that spans lines does not hide the key — it is one readonly entry', () => {
    const text = 'local C = {\n  Speed = 1.0, --[[ multiplier,\n  still a comment ]]\n  Next = 2,\n}\nreturn C'
    const entries = parseConfigFile(text, { syntax: 'lua' })
    // Spans through the comment's end, so inserts land after `]]` and a
    // removal can never leave half a comment behind.
    expect(kv(entries, 'Speed')).toMatchObject({ value: '1.0', hadComma: true, readonly: true, multiline: true })
    expect(kv(entries, 'Speed').raw).toBe('  Speed = 1.0, --[[ multiplier,\n  still a comment ]]')
    expect(kv(entries, 'Next').value).toBe('2')
    expect(serializeConfig(edit(entries, 'Speed', '2.0'))).toBe(text)
  })

  it('supports return {…}, Config = {…}, and plain globals', () => {
    for (const text of [
      'return {\n  A = 1,\n}',
      'Config = {\n  A = 1,\n}\nreturn Config',
      'A = 1\nB = "x"\nreturn nil',
    ]) {
      const entries = parseConfigFile(text, { syntax: 'lua' })
      expect(kv(entries, 'A')?.value, text).toBe('1')
      expect(kvs(entries).some(e => e.key === 'Config'), text).toBe(false)
    }
  })
})

describe('readonly entries (P4)', () => {
  const text = [
    'local Config = {',
    '  AllowedWeapons = {',
    '    "Pistol",',
    '    "Rifle",',
    '  },',
    '  Width = 800, Height = 600,',
    '  Speed = 1,',
    '}',
    'return Config',
  ].join('\n')
  const schema = {
    sections: {
      Main: {
        keys: {
          AllowedWeapons: { type: 'multi-select', default: ['Shotgun'], options: [{ value: 'Pistol' }, { value: 'Shotgun' }] },
          Width: { type: 'int', default: 1024 },
          Speed: { type: 'int', default: 1 },
        },
      },
    },
  }

  it('a multi-line array is ONE readonly entry; its items are not entries', () => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const arr = kv(entries, 'AllowedWeapons')
    expect(arr).toMatchObject({ multiline: true, readonly: true })
    expect(arr.raw).toBe('  AllowedWeapons = {\n    "Pistol",\n    "Rifle",\n  },')
    expect(arr.value).toBe('{\n    "Pistol",\n    "Rifle",\n  }')
  })

  it('a line with two assignments is readonly and hides the second key', () => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(kv(entries, 'Width').readonly).toBe(true)
    expect(resolveEntryIdx(buildSectionKeyIndex(entries), 'Main', 'Height')).toBeUndefined()
    // Any second item on the line (here a positional one) would be dropped by a rewrite.
    const positional = parseConfigFile('return {\n  A = 1, 2,\n  B = "x, y", C = 3;\n  D = f(1, 2),\n}', { syntax: 'lua' })
    expect(kvs(positional).map(e => [e.key, !!e.readonly])).toEqual([['A', true], ['B', true], ['D', false]])
  })

  it('edits, save normalization and the footer reset leave readonly entries byte-identical', () => {
    let entries = parseConfigFile(text, { syntax: 'lua' })
    entries = edit(edit(entries, 'AllowedWeapons', '{"Shotgun"}'), 'Width', '1024')
    expect(serializeConfig(prepareEntriesForSave(entries, buildEntryKeyDefMap(entries, schema)))).toBe(text)

    const fresh = parseConfigFile(text, { syntax: 'lua' })
    const map = buildEntryKeyDefMap(fresh, schema)
    const reset = resetEntriesToDefaults(fresh, map)
    expect(serializeConfig(reset)).toBe(text)
    // Readonly rows don't count against "all at defaults" (Speed is at default).
    expect(entriesAtDefaults(fresh, map)).toBe(true)
  })
})

describe('appendKeyval — optional toggle-on (P9)', () => {
  it('adds a comma to a comma-less last field (before its inline comment)', () => {
    const text = 'local Config = {\n  Enabled = true,\n  Speed = 1.5 -- last key, no comma\n}\nreturn Config\n'
    const out = serializeConfig(appendKeyval(parseConfigFile(text, { syntax: 'lua' }), 'Bonus', '5'))
    expect(out).toBe('local Config = {\n  Enabled = true,\n  Speed = 1.5, -- last key, no comma\n  Bonus = 5,\n}\nreturn Config\n')
    expectLuaParses(out)
    if (hasLua) expect(luaRead(out, 'C.Bonus + C.Speed')).toBe('6.5')
  })

  it('adds a comma after a comma-less readonly multi-line field', () => {
    const text = 'return {\n  A = 1,\n  List = {\n    "x",\n  } -- items\n}'
    const out = serializeConfig(appendKeyval(parseConfigFile(text, { syntax: 'lua' }), 'B', '2'))
    expect(out).toBe('return {\n  A = 1,\n  List = {\n    "x",\n  }, -- items\n  B = 2,\n}')
    expectLuaParses(out)
  })

  it('lands in the root table, never inside a trailing sub-table', () => {
    const text = 'local Config = {\n  DamageMul = 1.5,\n  Weapons = {\n    Rifle = { Damage = 30 },\n  },\n}\nreturn Config'
    const out = serializeConfig(appendKeyval(parseConfigFile(text, { syntax: 'lua' }), 'LootMul', '2.0'))
    expectLuaParses(out)
    if (hasLua) expect(luaRead(out, 'C.LootMul')).toBe('2.0')
    expect(out).toContain('  },\n  LootMul = 2.0,\n}')
  })

  it.each([
    ['local Config = {}\nreturn Config\n', 'local Config = {\n    Mul = 1.5,\n}\nreturn Config\n'],
    ['return {}', 'return {\n    Mul = 1.5,\n}'],
    ['Config = {} -- all optional\nreturn Config\n', 'Config = {\n    Mul = 1.5,\n} -- all optional\nreturn Config\n'],
  ])('expands the one-line empty root table %j', (text, expected) => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(kvs(entries)).toHaveLength(0)
    const out = serializeConfig(appendKeyval(entries, 'Mul', '1.5'))
    expect(out).toBe(expected)
    expectLuaParses(out)
    if (hasLua) expect(luaRead(out, 'C.Mul')).toBe('1.5')
    // Re-parsed, the new key is a normal bindable root field.
    expect(kv(parseConfigFile(out, { syntax: 'lua' }), 'Mul').value).toBe('1.5')
  })

  it('globals-style config: no comma, inserted before the trailing return', () => {
    const text = 'Debug = false\nLanguage = "auto"\nreturn nil\n'
    const out = serializeConfig(appendKeyval(parseConfigFile(text, { syntax: 'lua' }), 'Extra', '3'))
    expect(out).toBe('Debug = false\nLanguage = "auto"\nExtra = 3\nreturn nil\n')
    if (hasLua) expect(luaRead(out, 'C.Extra')).toBe('3')

    const bare = serializeConfig(appendKeyval(parseConfigFile('Debug = false\n', { syntax: 'lua' }), 'Extra', '3'))
    expect(bare).toBe('Debug = false\nExtra = 3\n')
  })

  it('INI: no comma, inside the matching [Section], copying a sibling\'s = spacing', () => {
    const text = '[General]\nVolume=5 ; master\n\n[Debug]\nlogDamage = false\n'
    const entries = parseConfigFile(text, { syntax: 'ini' })
    const general = serializeConfig(appendKeyval(entries, 'Mute', 'false', { sectionHint: 'General' }))
    expect(general).toBe('[General]\nVolume=5 ; master\nMute=false\n\n[Debug]\nlogDamage = false\n')
    const debug = serializeConfig(appendKeyval(entries, 'Verbose', 'false', { sectionHint: 'Debug' }))
    expect(debug).toBe('[General]\nVolume=5 ; master\n\n[Debug]\nlogDamage = false\nVerbose = false\n')
    const created = serializeConfig(appendKeyval(entries, 'Rate', '2', { sectionHint: 'Extra' }))
    expect(created).toBe('[General]\nVolume=5 ; master\n\n[Debug]\nlogDamage = false\n\n[Extra]\nRate = 2\n')
    // The created section is where resolveEntryIdx (strict INI scoping) looks.
    const reparsed = parseConfigFile(created, { syntax: 'ini' })
    expect(reparsed[resolveEntryIdx(buildSectionKeyIndex(reparsed), 'Extra', 'Rate')].value).toBe('2')
  })

  it('uses CRLF for inserted lines in a CRLF file (incl. one without a final newline)', () => {
    const text = 'return {\r\n\tEnabled = true\r\n}'
    const out = serializeConfig(appendKeyval(parseConfigFile(text, { syntax: 'lua' }), 'Bonus', '5'))
    expect(out).toBe('return {\r\n\tEnabled = true,\r\n\tBonus = 5,\r\n}')

    const globals = 'A = 1\r\nB = 2'
    const g = serializeConfig(appendKeyval(parseConfigFile(globals, { syntax: 'lua' }), 'C', '3'))
    expect(g).toBe('A = 1\r\nB = 2\r\nC = 3')

    const expanded = serializeConfig(appendKeyval(parseConfigFile('local C = {}\r\nreturn C\r\n', { syntax: 'lua' }), 'X', '1'))
    expect(expanded).toBe('local C = {\r\n    X = 1,\r\n}\r\nreturn C\r\n')
  })

  it('places a key into its (decorative) section block inside the root table', () => {
    const text = 'local Config = {\n-- ====[ AUDIO ]====\nVolume = 5\n-- ====[ VIDEO ]====\nFov = 90,\n}\nreturn Config'
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const hint = resolveSectionName(buildSectionKeyIndex(entries), 'Audio', ['Volume'])
    const out = serializeConfig(appendKeyval(entries, 'Mute', 'false', { sectionHint: hint }))
    expect(out).toBe('local Config = {\n-- ====[ AUDIO ]====\nVolume = 5,\nMute = false,\n-- ====[ VIDEO ]====\nFov = 90,\n}\nreturn Config')
    expectLuaParses(out)
  })
})

describe('entry ↔ schema binding for save / reset / defaults (P10)', () => {
  // Schema lists M4 before AK47 and the banners don't equal the ids exactly —
  // the old keyDefByEntry fell back to "first section with that key" and used
  // M4's range/default for AK47's line.
  const text = [
    'local Config = {',
    '-- ====[ AK47 RIFLE ]====',
    'Damage = 10,',
    '-- ====[ M4 CARBINE ]====',
    'Damage = 30,',
    'Nested = { Damage = 250 },',
    '}',
    'return Config',
  ].join('\n')
  const schema = {
    sections: {
      M4: { keys: { Damage: { type: 'int', min: 20, max: 40, default: 30 } } },
      AK47: { keys: { Damage: { type: 'int', min: 1, max: 9, default: 5 }, Unbound: { type: 'int', default: 1 } } },
    },
  }

  it('maps each entry to the keyDef of the row that renders it', () => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const index = buildSectionKeyIndex(entries)
    const map = buildEntryKeyDefMap(entries, schema)
    for (const [sectionId, section] of Object.entries(schema.sections)) {
      for (const keyName of Object.keys(section.keys)) {
        const idx = resolveEntryIdx(index, sectionId, keyName)
        if (idx === undefined) continue
        expect(map[idx]).toMatchObject({ sectionId, keyName, keyDef: section.keys[keyName] })
      }
    }
    expect(Object.keys(map)).toHaveLength(2)
    expect(map[resolveEntryIdx(index, 'AK47', 'Damage')].keyDef.max).toBe(9)
  })

  it('save never clamps an untouched line with another section\'s range', () => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(serializeConfig(prepareEntriesForSave(entries, buildEntryKeyDefMap(entries, schema)))).toBe(text)
  })

  it('reset writes each section\'s own default and leaves unbound lines alone', () => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    const out = serializeConfig(resetEntriesToDefaults(entries, buildEntryKeyDefMap(entries, schema)))
    expect(out).toBe(text.replace('Damage = 10,', 'Damage = 5,'))
  })

  it('compares int/float defaults numerically', () => {
    expect(valueEqualsDefault('25', { type: 'float', default: 25 })).toBe(true)
    expect(valueEqualsDefault('25.00', { type: 'float', default: 25 })).toBe(true)
    expect(valueEqualsDefault('1e1', { type: 'int', default: 10 })).toBe(true)
    expect(valueEqualsDefault('24.9', { type: 'float', default: 25 })).toBe(false)
    expect(valueEqualsDefault('Hard', { type: 'select', default: 'Hard' })).toBe(true)
    expect(valueEqualsDefault('x', { type: 'text' })).toBe(false)

    const entries = parseConfigFile('return {\n  Spartan = 25,\n}', { syntax: 'lua' })
    const map = buildEntryKeyDefMap(entries, { sections: { S: { keys: { Spartan: { type: 'float', default: 25 } } } } })
    expect(entriesAtDefaults(entries, map)).toBe(true)
    // Already numerically at default → reset keeps the file's own text.
    expect(resetEntriesToDefaults(entries, map)).toEqual(entries)
  })

  it('an optional key without a default is "not at default" while present and is removed by reset', () => {
    const entries = parseConfigFile('return {\n  A = 1,\n  Opt = 2,\n}', { syntax: 'lua' })
    const map = buildEntryKeyDefMap(entries, { sections: { S: { keys: { A: { type: 'int', default: 1 }, Opt: { type: 'int', optional: true } } } } })
    expect(entriesAtDefaults(entries, map)).toBe(false)
    expect(serializeConfig(resetEntriesToDefaults(entries, map))).toBe('return {\n  A = 1,\n}')
  })
})

describe('schema tolerance (P11)', () => {
  it('normalizes plain option values, missing keys and null key definitions', () => {
    const schema = normalizeSchema({
      configFile: 'config.lua',
      sections: {
        A: { label: 'A', keys: { Mode: { type: 'select', options: ['Easy', 'Hard'] }, Level: { type: 'select', options: [1, 2] }, Bad: null, Worse: 'x' } },
        B: { label: 'no keys' },
        C: null,
      },
    })
    expect(schema.configFile).toBe('config.lua')
    expect(schema.sections.A.keys.Mode.options).toEqual([{ value: 'Easy' }, { value: 'Hard' }])
    expect(schema.sections.A.keys.Level.options).toEqual([{ value: 1 }, { value: 2 }])
    expect(Object.keys(schema.sections.A.keys)).toEqual(['Mode', 'Level'])
    expect(schema.sections.B.keys).toEqual({})
    expect(schema.sections.C).toBeUndefined()
    // Normalized numeric options drive bare quoting.
    expect(keyDefNeedsQuote(schema.sections.A.keys.Level, true)).toBe(false)
    expect(keyDefNeedsQuote(schema.sections.A.keys.Mode, false)).toBe(true)
  })

  it('keeps well-formed option objects as they are', () => {
    const opts = [{ value: 'Easy', label: 'E' }]
    expect(normalizeSchema({ sections: { A: { keys: { M: { type: 'select', options: opts } } } } }).sections.A.keys.M.options).toEqual(opts)
  })
})

describe('real-world shapes round-trip untouched', () => {
  it.each([
    ['globals (BetterTradeUIv2)', '-- comment\n\nDebug = false\nLanguage = "auto"\n'],
    ['return table with aligned comments (GPS)', 'return {\n    -- Navigation\n    TrailSpacing = 2000,        -- Distance (UU, ~20m)\n    Key = "H",          -- Ctrl+H\n}\n'],
    ['CRLF, no final newline (SkillCustomizer)', '-- header\r\n\r\nreturn {\r\n    -- Melee\r\n    Melee_Skill_Spartan = 25.0,\r\n\r\n}'],
    ['banner comments (PWR)', 'local Config = {\n\n--[[ ====[ GENERATOR RADIUS ]==== ]]\n\nMode = "Multiplier",\nMultiplierValue = 3.0,\n\n}\nreturn Config\n'],
  ])('%s', (_name, text) => {
    const entries = parseConfigFile(text, { syntax: 'lua' })
    expect(serializeConfig(entries)).toBe(text)
    expect(kvs(entries).every(e => !e.readonly)).toBe(true)
  })
})
