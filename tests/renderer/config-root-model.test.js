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
  configModel,
  buildSectionKeyIndex,
  resolveEntryIdx,
  resolveSectionName,
  buildEntryKeyDefMap,
  keyDefNeedsQuote,
  guessValueType,
  normalizeSchema,
} from '../../src/renderer/src/utils/config-parser'
import {
  prepareEntriesForSave,
  resetEntriesToDefaults,
  defaultToValueStr,
  typedDefaultSeed,
} from '../../src/renderer/src/utils/widget-helpers'

// Root-table model (round 2, R1 / R8): a Lua config is read through ONE root
// table — `return {`, `return Name` + its `local Name = {` / `Name = {`, or the
// only chunk-level table — or as plain globals. Only that table's first-level
// fields bind; other tables and globals pass through untouched. Saving (edits,
// emptied lists, optional keys switched off / on, the footer reset) must never
// change which model a file is read with. Outputs are loaded with Lua 5.4 when
// a `lua` binary is on PATH (or LUA_BIN).

const LUA_BIN = process.env.LUA_BIN || 'lua'
const hasLua = spawnSync(LUA_BIN, ['-v']).status === 0

// tostring(<expr>) with `C` = the chunk's return value (or its globals).
function luaRead(text, expr) {
  const file = path.join(os.tmpdir(), `hzmm-root-${process.pid}-${Math.random().toString(36).slice(2)}.lua`)
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
const model = (entries) => { const m = configModel(entries); return `${m.kind}:${m.name}` }
const idxOf = (entries, key, section = 'Main') => resolveEntryIdx(buildSectionKeyIndex(entries), section, key)

// ConfigEditorModal + SchemaRow glue, reduced to what these tests drive.
class Editor {
  constructor(text, schema, file = 'config.lua') {
    this.file = file
    this.syntax = file.endsWith('.ini') ? 'ini' : 'lua'
    this.schema = normalizeSchema(schema)
    this.entries = parse(text, this.syntax)
  }
  idx(key, section = 'Main') { return idxOf(this.entries, key, section) }
  set(key, value, section = 'Main') {
    const i = this.idx(key, section)
    this.entries = this.entries.map((e, j) => (j === i && !e.readonly ? { ...e, value } : e))
  }
  // Returns false when the parser refused (the array came back unchanged).
  toggle(key, section = 'Main') {
    const before = this.entries
    const i = this.idx(key, section)
    if (i !== undefined) {
      this.entries = removeKeyvalAt(this.entries, i)
    } else {
      const def = this.schema.sections[section].keys[key]
      const index = buildSectionKeyIndex(this.entries)
      const hint = resolveSectionName(index, section, Object.keys(this.schema.sections[section].keys))
      const seed = defaultToValueStr(def) ?? typedDefaultSeed(def.type, def.options)
      const isQuoted = this.syntax !== 'ini' && keyDefNeedsQuote(def, guessValueType(String(seed)) === 'string')
      this.entries = appendKeyval(this.entries, key, seed, { isQuoted, format: this.syntax, sectionHint: hint })
    }
    return this.entries !== before
  }
  reset() { this.entries = resetEntriesToDefaults(this.entries, buildEntryKeyDefMap(this.entries, this.schema)) }
  // Save, then re-open from the written text like the modal does.
  save() {
    const text = serializeConfig(prepareEntriesForSave(this.entries, buildEntryKeyDefMap(this.entries, this.schema)))
    this.entries = parse(text, this.syntax)
    return text
  }
}

describe('root table detection', () => {
  it('a. `return {` — a chunk-level global beside it is not bound (break-F1a)', () => {
    const text = 'CONFIG_VERSION = 2\n\nreturn {\n  Enabled = true,\n  Speed = 5,\n}\n'
    const entries = parse(text)
    expect(model(entries)).toBe('return:return')
    expect(kvs(entries).map(e => e.key)).toEqual(['Enabled', 'Speed'])
    expect(idxOf(entries, 'CONFIG_VERSION')).toBeUndefined()
    expect(serializeConfig(entries)).toBe(text)
  })

  it('b. `return Config` + `local Config = {` — globals / other tables never bind (DOC-ROOT-GLOBAL, DOC-LOCAL-TABLE-BINDS)', () => {
    const text = [
      'ModVersion = "1.0"',
      'local Defaults = {',
      '    Speed = 1,',
      '    MaxHealth = 50,',
      '}',
      'local Config = {',
      '    MaxHealth = 100,',
      '}',
      'Debug = false',
      'local Helpers = {',
      '    X = 2,',
      '}',
      'return Config',
      '',
    ].join('\n')
    const entries = parse(text)
    expect(model(entries)).toBe('named:Config')
    expect(kvs(entries).map(e => [e.key, e.value])).toEqual([['MaxHealth', '100']])
    for (const key of ['ModVersion', 'Speed', 'Debug', 'X']) expect(idxOf(entries, key), key).toBeUndefined()
    expect(serializeConfig(entries)).toBe(text)
  })

  it('b. the table named by `return` wins, whatever its form (`Config = {`, `local C <const> = {`)', () => {
    expect(model(parse('Config = {\n  A = 1,\n}\nreturn Config'))).toBe('named:Config')
    const attrib = parse('local C <const> = {\n  A = 1,\n}\nreturn C\n')
    expect(model(attrib)).toBe('named:C')
    expect(kvs(attrib).map(e => e.key)).toEqual(['A'])
  })

  it('c. a lone chunk-level table with `Key = value` fields and no other globals is the root', () => {
    const entries = parse('-- settings\nConfig = {\n  A = 1,\n  B = "x",\n}\n')
    expect(model(entries)).toBe('sole:Config')
    expect(kvs(entries).map(e => e.key)).toEqual(['A', 'B'])
  })

  it('d. otherwise plain globals: a second global, or a table without fields, keeps the file globals', () => {
    const withGlobal = parse('Enabled = true\nWeapons = {\n    Pistol = 5,\n}\n')
    expect(model(withGlobal)).toBe('globals:null')
    expect(kvs(withGlobal).map(e => [e.key, !!e.readonly])).toEqual([['Enabled', false], ['Weapons', true]])
    const list = parse('Items = {\n  "a",\n  "b",\n}\n')
    expect(model(list)).toBe('globals:null')
    expect(kvs(list).map(e => [e.key, !!e.readonly])).toEqual([['Items', true]])
    const plain = parse('Debug = false\nBlacklist = {}\nreturn nil\n')
    expect(model(plain)).toBe('globals:null')
    // one-line tables are ordinary editable values
    expect(kvs(plain).map(e => [e.key, e.value, !!e.readonly])).toEqual([['Debug', 'false', false], ['Blacklist', '{}', false]])
  })

  it('a one-line NON-empty root yields no fields and every insert is refused (same array back)', () => {
    for (const text of ['local Config = { MaxHealth = 100 }\nreturn Config\n', 'return { MaxHealth = 100 }\n']) {
      const entries = parse(text)
      expect(kvs(entries)).toHaveLength(0)
      expect(entries.some(e => e.rootOneLine)).toBe(true)
      expect(appendKeyval(entries, 'Bonus', '3')).toBe(entries)
    }
  })

  it('a one-line EMPTY root is expanded and the new field lands inside it', () => {
    const entries = parse('local Config = {} -- all optional\nreturn Config\n')
    const out = appendKeyval(entries, 'Mul', '1.5')
    expect(out).not.toBe(entries)
    const text = serializeConfig(out)
    expect(text).toBe('local Config = {\n    Mul = 1.5,\n} -- all optional\nreturn Config\n')
    expect(model(parse(text))).toBe('named:Config')
    if (hasLua) expect(luaRead(text, 'C.Mul')).toBe('1.5')
  })
})

describe('optional keys land in the root table (break-F1, break-F6, DOC-ROOT-GLOBAL)', () => {
  const schema = {
    sections: {
      Main: {
        keys: {
          MaxHealth: { type: 'int' },
          Speed: { type: 'int' },
          Extra: { type: 'int', optional: true, default: 7 },
        },
      },
    },
  }
  it.each([
    ['global before the table', 'ModVersion = "1.0"\nlocal Config = {\n    Speed = 1,\n}\nreturn Config\n'],
    ['global after the table', 'local Config = {\n    MaxHealth = 100,\n}\nDebug = false\nreturn Config\n'],
    ['helper table after the root', 'local Config = {\n    Speed = 1,\n}\nlocal Helpers = {\n    X = 2,\n}\nreturn Config\n'],
    ['return table + global', 'CONFIG_VERSION = 2\n\nreturn {\n  Speed = 5,\n}\n'],
  ])('%s', (_name, text) => {
    const ed = new Editor(text, schema)
    const m = model(ed.entries)
    expect(ed.toggle('Extra')).toBe(true)
    const out = ed.save()
    expectLuaParses(out)
    expect(model(ed.entries)).toBe(m)
    expect(ed.entries[ed.idx('Extra')].value).toBe('7')
    if (hasLua) expect(luaRead(out, 'C.Extra')).toBe('7')
    // the neighbouring tables / globals are untouched: every original line survives
    const outLines = out.split('\n')
    for (const line of text.split('\n')) expect(outLines).toContain(line)
  })

  it('same key in a helper table and in the root: binds the root field; off → nil, on → back in the root', () => {
    const text = 'local Defaults = {\n    Speed = 1,\n}\nlocal Config = {\n    Speed = 2,\n}\nreturn Config\n'
    const ed = new Editor(text, { sections: { Main: { keys: { Speed: { type: 'int', optional: true, default: 9 } } } } })
    expect(ed.entries[ed.idx('Speed')].value).toBe('2')
    expect(ed.toggle('Speed')).toBe(true)
    const off = ed.save()
    expect(off).toBe('local Defaults = {\n    Speed = 1,\n}\nlocal Config = {\n}\nreturn Config\n')
    if (hasLua) expect(luaRead(off, 'C.Speed')).toBe('nil')
    expect(ed.toggle('Speed')).toBe(true)
    const on = ed.save()
    expect(on).toBe('local Defaults = {\n    Speed = 1,\n}\nlocal Config = {\n    Speed = 9,\n}\nreturn Config\n')
    // pressing it again cannot add a shadow line: the key is present now
    expect(ed.idx('Speed')).not.toBeUndefined()
  })
})

describe('appendKeyval refusal contract (R8): the ORIGINAL array comes back', () => {
  const base = () => parse('local Config = {\n  A = 1,\n}\nreturn Config\n')

  it('refuses keys it cannot write as plain keys', () => {
    const entries = base()
    for (const key of ['end', 'a b', '1x', 'x-y', '', 'return']) expect(appendKeyval(entries, key, '1'), key).toBe(entries)
    const ini = parse('[S]\nA = 1\n', 'ini')
    for (const key of ['a b', 'a=b', 'a;b', '[x]', '--x']) expect(appendKeyval(ini, key, '1', { format: 'ini', sectionHint: 'S' }), key).toBe(ini)
  })

  it('refuses a key the table already has (own line or a second statement on another line)', () => {
    const entries = base()
    expect(appendKeyval(entries, 'A', '2')).toBe(entries)
    const hidden = parse('Ratio = 3; Hotkey = 3\n')
    expect(kvs(hidden)[0]).toMatchObject({ key: 'Ratio', readonly: true, assigns: ['Hotkey'] })
    expect(appendKeyval(hidden, 'Hotkey', '1')).toBe(hidden)
  })

  it('refuses when the root table has no closing line', () => {
    const entries = parse('local Config = {\n  A = 1,\nreturn Config\n')
    expect(appendKeyval(entries, 'B', '2')).toBe(entries)
  })

  it('self-check: refuses a value that would not read back as the same field', () => {
    const entries = base()
    // `B = 1 --,` would comment its own comma out; `B = a = 1,` is two statements.
    expect(appendKeyval(entries, 'B', '1 --', { isQuoted: false })).toBe(entries)
    expect(appendKeyval(entries, 'B', 'a = 1', { isQuoted: false })).toBe(entries)
    // …while a quoted value with the same text is fine.
    const ok = appendKeyval(entries, 'B', '1 --', { isQuoted: true })
    expect(ok).not.toBe(entries)
    expect(serializeConfig(ok)).toBe('local Config = {\n  A = 1,\n  B = "1 --",\n}\nreturn Config\n')
  })

  it('self-check: entries whose markers no longer match the text are refused, never written outside the table', () => {
    // The closing marker moved to `return Config`: the insert would land after `}`.
    const stale = parse('local Config = {\n  A = 1,\n}\nreturn Config\n')
      .filter(e => e.type !== 'keyval')
      .map(e => {
        if (e.rootClose) { const copy = { ...e }; delete copy.rootClose; return copy }
        return e.returnStmt ? { ...e, rootClose: true } : e
      })
    expect(appendKeyval(stale, 'B', '2')).toBe(stale)
  })

  it('checks the schema section id too when the caller passes it', () => {
    const entries = parse('return {\n  -- ====[ AUDIO ]====\n  Volume = 5,\n  -- ====[ VIDEO ]====\n  Fov = 90,\n}\n')
    const out = appendKeyval(entries, 'Mute', 'false', { sectionHint: 'AUDIO', sectionId: 'Audio' })
    expect(serializeConfig(out)).toContain('  Volume = 5,\n  Mute = false,\n  -- ====[ VIDEO ]====')
  })
})

describe('saving never changes how a file is read (save → re-parse cycles on every shape)', () => {
  const schema = {
    sections: {
      Main: {
        keys: {
          Speed: { type: 'int', default: 1 },
          Blacklist: { type: 'list' },
          Opt: { type: 'bool', optional: true },
          Extra: { type: 'int', optional: true, default: 7 },
        },
      },
    },
  }
  const shapes = {
    'return table': 'return {\n    Speed = 5,\n    Blacklist = {"zombie"},\n    Opt = true,\n}\n',
    'local + return': '-- header\nlocal Config = {\n    Speed = 5,\n    Blacklist = {"zombie"},\n    Opt = true,\n}\nreturn Config\n',
    'global + return': 'Config = {\n    Speed = 5,\n    Blacklist = {"zombie"},\n    Opt = true,\n}\nreturn Config\n',
    'lone global table': 'Config = {\n    Speed = 5,\n    Blacklist = {"zombie"},\n    Opt = true,\n}\n',
    'plain globals': 'Speed = 5\nBlacklist = {"zombie"}\nOpt = true\n',
    'globals + return nil': '-- globals\nSpeed = 5\nBlacklist = {"zombie"}\nOpt = true\nreturn nil\n',
    'CRLF return table': 'return {\r\n    Speed = 5,\r\n    Blacklist = {"zombie"},\r\n    Opt = true,\r\n}',
  }
  const pathOf = (m) => (m.startsWith('sole:') ? `C.${m.slice(5)}` : 'C')

  it.each(Object.entries(shapes))('%s', (_name, text) => {
    const ed = new Editor(text, schema)
    const m0 = model(ed.entries)
    const P = pathOf(m0)
    const steps = [
      ['edit a scalar', () => ed.set('Speed', '6')],
      ['empty a list', () => ed.set('Blacklist', '{}')],
      ['switch an optional key off', () => expect(ed.toggle('Opt')).toBe(true)],
      ['switch another optional key on', () => expect(ed.toggle('Extra')).toBe(true)],
      ['switch the first one back on', () => expect(ed.toggle('Opt')).toBe(true)],
      ['footer reset', () => ed.reset()],
    ]
    for (const [label, step] of steps) {
      step()
      const out = ed.save()
      expect(model(ed.entries), `${label}: ${JSON.stringify(out)}`).toBe(m0)
      expectLuaParses(out)
      // every schema key still binds (Opt/Extra only while present)
      expect(ed.idx('Speed'), label).not.toBeUndefined()
      expect(ed.idx('Blacklist'), label).not.toBeUndefined()
    }
    const out = serializeConfig(ed.entries)
    // after the reset: Speed back at its default, Opt (no default) removed, Extra at its default
    expect(ed.entries[ed.idx('Speed')].value).toBe('1')
    expect(ed.idx('Opt')).toBeUndefined()
    expect(ed.entries[ed.idx('Extra')].value).toBe('7')
    if (hasLua) {
      expect(luaRead(out, `${P}.Speed`)).toBe('1')
      expect(luaRead(out, `#${P}.Blacklist`)).toBe('0')
      expect(luaRead(out, `${P}.Opt`)).toBe('nil')
      expect(luaRead(out, `${P}.Extra`)).toBe('7')
    }
  })

  it('break-F1a: emptying the only list of a globals file keeps it globals; an optional key is a new global', () => {
    const ed = new Editor('Blacklist = {"zombie"}\n', { sections: { General: { keys: { Blacklist: { type: 'list' }, DebugMode: { type: 'bool', optional: true, default: false } } } } })
    ed.set('Blacklist', '{}', 'General')
    expect(ed.save()).toBe('Blacklist = {}\n')
    expect(model(ed.entries)).toBe('globals:null')
    expect(ed.idx('Blacklist', 'General')).not.toBeUndefined()
    expect(ed.toggle('DebugMode', 'General')).toBe(true)
    const out = ed.save()
    expect(out).toBe('Blacklist = {}\nDebugMode = false\n')
    if (hasLua) {
      expect(luaRead(out, 'C.DebugMode')).toBe('false')
      expect(luaRead(out, 'next(C.Blacklist)')).toBe('nil')
    }
  })

  it('break-F1b: a removal that would turn a globals file into a table file is refused', () => {
    const text = 'Enabled = true\nWeapons = {\n    Pistol = 5,\n}\n'
    const entries = parse(text)
    const idx = idxOf(entries, 'Enabled')
    // Without Enabled the file would read as the table `Weapons`: refuse.
    expect(removeKeyvalAt(entries, idx)).toBe(entries)
    const reset = resetEntriesToDefaults(entries, buildEntryKeyDefMap(entries, { sections: { Main: { keys: { Enabled: { type: 'bool', optional: true } } } } }))
    expect(serializeConfig(reset)).toBe(text)
  })

  it('footer reset: when removing every optional key at once would change the model, only the last one stays', () => {
    const text = 'A = 1\nT = {\n    X = 1,\n}\nB = 2\n'
    const entries = parse(text)
    const schema = { sections: { Main: { keys: { A: { type: 'int', optional: true }, B: { type: 'int', optional: true } } } } }
    const out = serializeConfig(resetEntriesToDefaults(entries, buildEntryKeyDefMap(entries, schema)))
    expect(out).toBe('T = {\n    X = 1,\n}\nB = 2\n')
    expect(model(parse(out))).toBe('globals:null')
  })

  it('a lone global table losing its last field would turn into a plain global: refused', () => {
    const entries = parse('Config = {\n    Opt = 1,\n}\n')
    expect(model(entries)).toBe('sole:Config')
    expect(removeKeyvalAt(entries, idxOf(entries, 'Opt'))).toBe(entries)
    // A named (returned) table can lose its last field — `return Config` still names it.
    const named = parse('local Config = {\n    Opt = 1,\n}\nreturn Config\n')
    const out = removeKeyvalAt(named, idxOf(named, 'Opt'))
    expect(serializeConfig(out)).toBe('local Config = {\n}\nreturn Config\n')
    expect(model(parse(serializeConfig(out)))).toBe('named:Config')
  })

  it('INI files keep their [Section] scoping through the same cycle', () => {
    const ini = '[Main]\nSpeed = 5\nOpt = true\n\n[Other]\nOpt = false\n'
    const ed = new Editor(ini, { sections: { Main: { keys: { Speed: { type: 'int', default: 1 }, Opt: { type: 'bool', optional: true } } } } }, 'settings.ini')
    expect(ed.toggle('Opt')).toBe(true)
    expect(ed.save()).toBe('[Main]\nSpeed = 5\n\n[Other]\nOpt = false\n')
    expect(ed.toggle('Opt')).toBe(true)
    expect(ed.save()).toBe('[Main]\nSpeed = 5\nOpt = false\n\n[Other]\nOpt = false\n')
    expect(model(ed.entries)).toBe('ini:null')
  })
})
