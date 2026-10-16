import { describe, it, expect } from 'vitest'
import luaparse from 'luaparse'
import {
  parseConfigFile,
  serializeConfig,
  syntaxForFile,
  appendKeyval,
  removeKeyvalAt,
  buildSectionKeyIndex,
  resolveEntryIdx,
  resolveSectionName,
  buildEntryKeyDefMap,
  normalizeSchema,
  parseLuaArray,
  parseLuaArrayItems,
  serializeLuaArray,
} from '../../src/renderer/src/utils/config-parser'

const expectLuaParses = (text) => expect(() => luaparse.parse(text, { luaVersion: '5.3' })).not.toThrow()
const parse = (text, name = 'config.lua') => parseConfigFile(text, { syntax: syntaxForFile(name) })
const kv = (entries, key) => entries.find(e => e.type === 'keyval' && e.key === key)

describe('leading-operator continuation lines', () => {
  it('joins a `..` continuation into one readonly field inside a table', () => {
    const text = 'local Config = {\n    Motd = "Welcome, "\n        .. "have fun!",\n    MaxZombies = 50,\n}\nreturn Config\n'
    const entries = parse(text)
    const motd = kv(entries, 'Motd')
    expect(motd.readonly).toBe(true)
    expect(motd.multiline).toBe(true)
    expect(motd.value).toBe('"Welcome, "\n        .. "have fun!"')
    expect(kv(entries, 'MaxZombies').readonly).toBeUndefined()
    expect(serializeConfig(entries)).toBe(text)
  })

  it('joins an arithmetic continuation of a global, past comment lines', () => {
    const text = 'SpawnDelay = 60\n    -- five minutes\n    * 5\nLootMultiplier = 2\n'
    const entries = parse(text)
    expect(kv(entries, 'SpawnDelay').readonly).toBe(true)
    expect(kv(entries, 'SpawnDelay').raw).toBe('SpawnDelay = 60\n    -- five minutes\n    * 5')
    expect(kv(entries, 'LootMultiplier').value).toBe('2')
  })

  it('never inserts a new global between a field and its continuation', () => {
    const text = 'LootMultiplier = 2\nSpawnDelay = 60\n    * 5\n'
    const out = appendKeyval(parse(text), 'Extra', '3')
    expect(serializeConfig(out)).toBe('LootMultiplier = 2\nSpawnDelay = 60\n    * 5\nExtra = 3\n')
  })

  it('refuses to remove a continued field instead of leaving a dangling operator line', () => {
    const entries = parse('A = 1\nB = 2\n    .. "x"\n')
    const idx = entries.findIndex(e => e.key === 'B')
    expect(removeKeyvalAt(entries, idx)).toBe(entries)
  })

  it('does not join a line after a separator (`A = 1,` then `-5,` is a positional item)', () => {
    const entries = parse('return {\n    A = 1,\n    -5,\n    B = 2,\n}\n')
    expect(kv(entries, 'A').readonly).toBeUndefined()
    expect(kv(entries, 'A').value).toBe('1')
  })

  it('does not treat a following `--` comment as a minus', () => {
    const entries = parse('return {\n    A = 1\n    -- note\n}\n')
    expect(kv(entries, 'A').readonly).toBeUndefined()
  })
})

describe('auto-detected INI with a brace inside a value', () => {
  const sectionOf = (entries, section, key) =>
    resolveEntryIdx(buildSectionKeyIndex(entries), section, key)

  it('stays INI after a brace is saved into a value', () => {
    const text = '[Server]\nName = My Server\nEnabled = true\n\n[Chat]\nColor = red\nEnabled = false\n'
    const entries = parse(text, 'config.txt')
    kv(entries, 'Name').value = '{Clan} Server'
    const saved = serializeConfig(entries)
    const re = parse(saved, 'config.txt')
    expect(buildSectionKeyIndex(re).hasStructuredSections).toBe(true)
    expect(re[sectionOf(re, 'Server', 'Enabled')].value).toBe('true')
    expect(re[sectionOf(re, 'Chat', 'Enabled')].value).toBe('false')
  })

  it('reads a shipped `{player}` template value as INI on first open', () => {
    const entries = parse('[Chat]\nJoinMsg = {player} joined\nEnabled = true\n\n[Loot]\nEnabled = false\n', 'config.txt')
    expect(kv(entries, 'JoinMsg').format).toBe('ini')
    expect(sectionOf(entries, 'Chat', 'Enabled')).toBe(2)
    expect(sectionOf(entries, 'Loot', 'Enabled')).toBe(5)
  })

  it('still sniffs a real Lua table as Lua', () => {
    expect(kv(parse('Config = {\n    A = 1\n}\n', 'config.txt'), 'A').format).toBe('lua')
    expect(kv(parse('Config = { A = 1 }\n', 'config.txt'), 'Config').format).toBe('lua')
    expect(kv(parse('--[[\n[Notes]\n]]\nreturn {\n    A = 1,\n}\n', 'config.txt'), 'A').format).toBe('lua')
  })

  it('keeps a Lua file with a `[Word]` line in a long comment and one-line tables as Lua', () => {
    const text = '--[[\nMyMod settings\n[Usage]\nEdit values below.\n]]\nName = "Bob"\nWeapons = {"Pistol", "Rifle"}\nMaxZombies = 50\n'
    const entries = parse(text, 'config.txt')
    expect(kv(entries, 'Name').format).toBe('lua')
    expect(sectionOf(entries, 'General', 'MaxZombies')).toBe(7)
    kv(entries, 'Name').value = 'say "hi"'
    const saved = serializeConfig(entries)
    expect(saved).toContain('Name = "say \\"hi\\""')
    expectLuaParses(saved)
    expect(kv(parse('--[==[\n[Readme]\n]==]\nWeapons = {"a", "b"}\n', 'config.txt'), 'Weapons').format).toBe('lua')
  })

  it('keeps a header-less INI file INI when a value holds braces (reopen after save)', () => {
    for (const value of ['{Clan} Bob', '{player} joined {server}', '{x']) {
      const entries = parse(`Name = ${value} ; the name\nMotd = hello\n`, 'settings.txt')
      expect(kv(entries, 'Name').format).toBe('ini')
      expect(kv(entries, 'Name').readonly).toBeFalsy()
      kv(entries, 'Motd').value = 'hello all'
      expect(serializeConfig(entries)).toContain('Motd = hello all\n')
    }
  })

  it('still sniffs header-less one-line table fields as Lua', () => {
    for (const line of ['Weapons = {"Pistol", "Rifle"}', 'Tags = {}', 'T = {{1}, {2}}, -- pairs', 'S = {"a}", "b"};', 'X = {"a -- b"}']) {
      expect(kv(parse(`${line}\nMotd = hello\n`, 'settings.txt'), 'Motd').format).toBe('lua')
    }
  })
})

describe('leading-operator lookahead in sniffed hybrid files', () => {
  it.each(['*** Loot ***', '==========', '<Loot>'])('does not join the decoration line %s', (deco) => {
    const text = `-- c\nMaxZombies = 50\n${deco}\nLootRate = 2\n`
    const entries = parse(text, 'config.txt')
    expect(kv(entries, 'MaxZombies').readonly).toBeUndefined()
    expect(kv(entries, 'MaxZombies').value).toBe('50')
    expect(kv(entries, 'LootRate').value).toBe('2')
    expect(serializeConfig(entries)).toBe(text)
  })

  it('still joins a real continuation that ends with an operand', () => {
    const entries = parse('-- c\nMotd = "a"\n    .. "b"\nMaxZombies = 50\n', 'config.txt')
    expect(kv(entries, 'Motd').readonly).toBe(true)
    expect(kv(entries, 'MaxZombies').value).toBe('50')
  })
})

describe('section/key index with Object.prototype names', () => {
  it('indexes fields named constructor / toString / valueOf without throwing', () => {
    for (const text of ['return {\n    constructor = 1,\n    MaxHealth = 5,\n}\n', 'return {\n    toString = true,\n}\n']) {
      const entries = parse(text)
      expect(() => buildSectionKeyIndex(entries)).not.toThrow()
    }
    const entries = parse('return {\n    constructor = 1,\n}\n')
    expect(resolveEntryIdx(buildSectionKeyIndex(entries), '', 'constructor')).toBe(1)
    expect(parse('[General]\nconstructor=1\n', 'config.ini').length).toBeGreaterThan(0)
    expect(() => buildSectionKeyIndex(parse('[General]\nconstructor=1\n', 'config.ini'))).not.toThrow()
  })

  it('does not resolve an absent key or section to an inherited member', () => {
    const index = buildSectionKeyIndex(parse('return {\n    A = 1,\n}\n'))
    expect(resolveEntryIdx(index, 'constructor', 'A')).toBe(1)
    expect(resolveEntryIdx(index, '', 'toString')).toBeUndefined()
    expect(resolveEntryIdx(index, 'toString', 'valueOf')).toBeUndefined()
    // A hand-built plain-object index gets the same own-property lookups.
    expect(resolveEntryIdx({ keyIndexMap: { '': { A: 0 } }, hasStructuredSections: false }, '', 'constructor')).toBeUndefined()
  })

  it('a `__proto__` banner does not pollute Object.prototype', () => {
    const entries = parse('return {\n    -- ====[ __proto__ ]====\n    optional = 1,\n    readonly = 2,\n}\n')
    const index = buildSectionKeyIndex(entries)
    expect(({}).optional).toBeUndefined()
    expect(({}).readonly).toBeUndefined()
    expect(resolveEntryIdx(index, '__proto__', 'optional')).toBe(2)
    const schema = normalizeSchema({ sections: { Main: { keys: { optional: { type: 'int' } } } } })
    expect(buildEntryKeyDefMap(entries, schema)[2].keyName).toBe('optional')
  })
})

describe('array items', () => {
  it('splits `;`-separated items', () => {
    expect(parseLuaArray('{"Pistol"; "Rifle"}')).toEqual(['Pistol', 'Rifle'])
    expect(parseLuaArray('{"a;b"; 1}')).toEqual(['a;b', '1'])
    expect(serializeLuaArray([...parseLuaArray('{"Pistol"; "Rifle"}'), 'Shotgun'])).toBe('{"Pistol", "Rifle", "Shotgun"}')
  })

  it('flags items with escapes outside \\\\ \\" \\\' \\n \\t \\r', () => {
    for (const lit of ['"\\65lice"', '"\\x41"', '"caf\\u{E9}"', '"a\\z   b"', '"\\228\\184\\173"']) {
      expect(parseLuaArrayItems(`{${lit}, "b"}`)[0].unsupported).toBe(true)
    }
    expect(parseLuaArrayItems('{"a\\"b\\n", "c\\\\"}')).toEqual([{ text: 'a"b\n', bare: false }, { text: 'c\\', bare: false }])
  })

  it('makes an array keyval with such an item readonly, so it saves verbatim', () => {
    const text = 'local Config = {\n  L = {"\\x41", "b"},\n  M = {"\\65", "Fire"},\n  T = {"caf\\u{E9}", "Rifle"},\n  Ok = {"a", "b\\n"},\n}\nreturn Config\n'
    const entries = parse(text)
    for (const key of ['L', 'M', 'T']) expect(kv(entries, key).readonly).toBe(true)
    expect(kv(entries, 'Ok').readonly).toBeUndefined()
    for (const key of ['L', 'M', 'T']) kv(entries, key).value = serializeLuaArray(['x'])
    expect(serializeConfig(entries)).toBe(text)
  })
})

describe('leading field separators next to an insert / removal', () => {
  const leadSemi = 'local Config = {\n    -- ====[ General ]====\n    A = 1\n    -- ====[ Combat ]====\n    ;B = 2\n}\nreturn Config\n'
  const leadComma = 'local Config = {\n    -- ====[ General ]====\n    A = 1,\n    B = 2\n    -- ====[ Combat ]====\n    , C = 3\n}\nreturn Config\n'

  for (const [name, text] of [['`;B = 2`', leadSemi], ['`, C = 3`', leadComma]]) {
    it(`inserting under a banner before ${name} still parses`, () => {
      expectLuaParses(text)
      const entries = parse(text)
      const hint = resolveSectionName(buildSectionKeyIndex(entries), 'General', ['A'])
      const out = appendKeyval(entries, 'NewKey', '5', { sectionHint: hint, sectionId: 'General' })
      expect(out).not.toBe(entries)
      const saved = serializeConfig(out)
      expectLuaParses(saved)
      expect(saved).toContain('    NewKey = 5\n    -- ====[ Combat ]====')
      // A second insert after it keeps the file valid too.
      const out2 = appendKeyval(parse(saved), 'Other', '6', { sectionHint: hint, sectionId: 'General' })
      expect(out2).not.toBe(out)
      expectLuaParses(serializeConfig(out2))
    })
  }

  it('refuses to remove the field right before a `;B = 2` line', () => {
    const entries = parse(leadSemi)
    const idx = entries.findIndex(e => e.key === 'A')
    expect(removeKeyvalAt(entries, idx)).toBe(entries)
  })

  it('removals that leave a valid table still go through', () => {
    const entries = parse(leadComma)
    const out = removeKeyvalAt(entries, entries.findIndex(e => e.key === 'A'))
    expect(out).not.toBe(entries)
    expectLuaParses(serializeConfig(out))
  })
})

describe('optional key under a banner with no fields yet', () => {
  const fileWith = (banner) =>
    `local Config = {\n    -- ====[ GENERAL ]====\n    A = 1,\n\n    -- ====[ ${banner} ]====\n    -- (all optional)\n\n    -- ====[ MISC ]====\n    M = 1,\n}\nreturn Config\n`

  for (const banner of ['EXTRA FEATURES', 'Extra Features Settings', 'ExtraFeatures']) {
    it(`inserts under "${banner}" for schema section ExtraFeatures`, () => {
      let entries = parse(fileWith(banner))
      for (const key of ['X1', 'X2']) {
        const hint = resolveSectionName(buildSectionKeyIndex(entries), 'ExtraFeatures', ['X1', 'X2'])
        expect(hint).toBe(banner)
        const out = appendKeyval(entries, key, '0', { sectionHint: hint, sectionId: 'ExtraFeatures' })
        expect(out).not.toBe(entries)
        entries = parse(serializeConfig(out))
      }
      const saved = serializeConfig(entries)
      expect(saved).toContain(`-- ====[ ${banner} ]====\n    X1 = 0,\n    X2 = 0,\n    -- (all optional)\n`)
      expect(saved).toContain('M = 1,\n}')
    })
  }

  it('an ambiguous prefix across two banners still resolves to nothing', () => {
    const entries = parse('return {\n    -- ====[ Loot Settings ]====\n    A = 1,\n    -- ====[ Loot Tables ]====\n}\n')
    expect(resolveSectionName(buildSectionKeyIndex(entries), 'Loot', ['X'])).toBe('Loot')
  })
})
