import { describe, it, expect } from 'vitest';
import {
  parseConfigFile,
  serializeConfig,
  guessValueType,
  appendKeyval,
  removeKeyval,
  removeKeyvalAt,
  valueNeedsQuote,
  parseLuaArray,
  serializeLuaArray,
  buildSectionKeyIndex,
  resolveEntryIdx,
  resolveSectionName,
} from '../../src/renderer/src/utils/config-parser';

// Round-trip is the parser's primary contract: a file goes in, the editor
// mutates only `entries[].value`, then serialize must reproduce the original
// text byte-for-byte for any line that wasn't edited. Mod authors care about
// blank-line spacing, comment decoration, indent style — losing those on save
// is a regression even if the values themselves are correct.

describe('parseConfigFile + serializeConfig round-trip', () => {
  it('preserves a Lua-style config exactly when nothing is edited', () => {
    const text = [
      'local Config = {',
      '  -- [Combat]',
      '  Enabled = true,',
      '  MaxHealth = 100,',
      '  DamageMul = 1.5,',
      '  Name = "Steve",',
      '',
      '  -- [Advanced]',
      '  TickRate = 60,',
      '}',
      'return Config',
    ].join('\n');
    const entries = parseConfigFile(text);
    expect(serializeConfig(entries)).toBe(text);
  });

  it('preserves an INI-style config exactly when nothing is edited', () => {
    const text = [
      '; Game settings',
      '[General]',
      'MaxHealth = 100',
      'Difficulty = "Normal"',
      '',
      '[Audio]',
      'MasterVolume = 0.8',
    ].join('\n');
    const entries = parseConfigFile(text);
    expect(serializeConfig(entries)).toBe(text);
  });

  it('preserves blank lines, decorative comments, and indent', () => {
    const text = [
      '-- ====================',
      '-- [Section]',
      '-- ====================',
      '',
      '    DeepIndent = 1,',
      '',
      '',
    ].join('\n');
    const entries = parseConfigFile(text);
    expect(serializeConfig(entries)).toBe(text);
  });

  it('round-trips after editing only the value of one entry', () => {
    const text = ['Foo = 1,', 'Bar = 2,'].join('\n');
    const entries = parseConfigFile(text);
    const fooIdx = entries.findIndex(e => e.type === 'keyval' && e.key === 'Foo');
    entries[fooIdx] = { ...entries[fooIdx], value: '99' };
    const out = serializeConfig(entries);
    expect(out).toBe('Foo = 99,\nBar = 2,');
  });
});

describe('parseConfigFile — value forms', () => {
  it('detects bool / int / float / string types via guessValueType', () => {
    const text = ['B = true', 'I = 42', 'F = 1.5', 'S = "hi"'].join('\n');
    const entries = parseConfigFile(text).filter(e => e.type === 'keyval');
    expect(guessValueType(entries[0].value)).toBe('bool');
    expect(guessValueType(entries[1].value)).toBe('int');
    expect(guessValueType(entries[2].value)).toBe('float');
    // String value 'hi' (after stripping quotes) — still 'string' to guesser
    expect(guessValueType(entries[3].value)).toBe('string');
  });

  it('strips both single and double quotes from string values', () => {
    const entries = parseConfigFile('A = "double"\nB = \'single\'').filter(e => e.type === 'keyval');
    expect(entries[0].value).toBe('double');
    expect(entries[0].isQuoted).toBe(true);
    expect(entries[1].value).toBe('single');
    expect(entries[1].isQuoted).toBe(true);
  });

  it('captures inline `-- description` comment without losing it on serialize', () => {
    const text = 'X = 5,  -- damage in points';
    const entries = parseConfigFile(text);
    const kv = entries.find(e => e.type === 'keyval');
    expect(kv.inlineDesc).toBe('damage in points');
    // Edit value and ensure the inline comment is retained
    const edited = entries.map(e =>
      e.type === 'keyval' && e.key === 'X' ? { ...e, value: '10' } : e
    );
    expect(serializeConfig(edited)).toContain('-- damage in points');
  });

  it('recognizes `-- [Section]` Lua-comment headers', () => {
    const entries = parseConfigFile('-- [Combat]\nFoo = 1');
    const sec = entries.find(e => e.type === 'section');
    expect(sec).toBeDefined();
    expect(sec.name).toBe('Combat');
  });

  it('recognizes `[Section]` INI-style headers', () => {
    const entries = parseConfigFile('[Audio]\nVolume = 0.5');
    const sec = entries.find(e => e.type === 'section');
    expect(sec.name).toBe('Audio');
  });

  it('treats the empty file as an empty entries list', () => {
    expect(parseConfigFile('')).toEqual([{ type: 'blank', raw: '' }]);
  });
});

describe('guessValueType', () => {
  it.each([
    ['true', 'bool'],
    ['false', 'bool'],
    ['0', 'int'],
    ['42', 'int'],
    ['-7', 'int'],
    ['1.5', 'float'],
    ['-0.001', 'float'],
    ['hello', 'string'],
    ['', 'string'],
    ['{"a"}', 'string'], // arrays are strings to the guesser
  ])('"%s" → %s', (val, expected) => {
    expect(guessValueType(val)).toBe(expected);
  });
});

describe('valueNeedsQuote', () => {
  it.each([
    ['bool', false],
    ['int', false],
    ['float', false],
    ['string', true],
    ['text', true],
    ['color', true],
    ['keybind', true],
    ['multi-select', false], // arrays serialize themselves
    ['list', false],
  ])('%s → %s', (type, expected) => {
    expect(valueNeedsQuote(type)).toBe(expected);
  });
});

describe('parseLuaArray', () => {
  it('parses a plain string array', () => {
    expect(parseLuaArray('{"a", "b", "c"}')).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for an empty literal', () => {
    expect(parseLuaArray('{}')).toEqual([]);
  });

  it('returns null for non-array input', () => {
    expect(parseLuaArray('hello')).toBeNull();
    expect(parseLuaArray('"a", "b"')).toBeNull();
    expect(parseLuaArray(123)).toBeNull();
  });

  it('handles commas inside quoted strings (quote-aware split)', () => {
    expect(parseLuaArray('{"a, b", "c"}')).toEqual(['a, b', 'c']);
  });

  it('unescapes embedded double quotes', () => {
    expect(parseLuaArray('{"say \\"hi\\"", "ok"}')).toEqual(['say "hi"', 'ok']);
  });

  it('accepts single-quoted entries', () => {
    expect(parseLuaArray("{'a', 'b'}")).toEqual(['a', 'b']);
  });
});

describe('serializeLuaArray', () => {
  it('writes a plain string array', () => {
    expect(serializeLuaArray(['a', 'b', 'c'])).toBe('{"a", "b", "c"}');
  });

  it('writes empty array as {}', () => {
    expect(serializeLuaArray([])).toBe('{}');
  });

  it('escapes inner double quotes', () => {
    expect(serializeLuaArray(['say "hi"'])).toBe('{"say \\"hi\\""}');
  });

  it('returns {} for non-array input (defensive)', () => {
    expect(serializeLuaArray(null)).toBe('{}');
    expect(serializeLuaArray('not-array')).toBe('{}');
  });

  it('round-trips through parseLuaArray for plain strings', () => {
    const arr = ['Pistol', 'Rifle', 'Bow'];
    expect(parseLuaArray(serializeLuaArray(arr))).toEqual(arr);
  });

  it('round-trips strings containing commas and quotes', () => {
    const arr = ['hello, world', 'say "hi"'];
    expect(parseLuaArray(serializeLuaArray(arr))).toEqual(arr);
  });
});

describe('appendKeyval', () => {
  it('appends after the last keyval when no section hint', () => {
    const entries = parseConfigFile('A = 1,\nB = 2,');
    const out = appendKeyval(entries, 'C', '3', { format: 'lua' });
    const keyvals = out.filter(e => e.type === 'keyval').map(e => e.key);
    expect(keyvals).toEqual(['A', 'B', 'C']);
  });

  it('inserts inside the matching section when sectionHint matches', () => {
    const text = [
      '-- [Combat]',
      'Damage = 10,',
      '-- [Audio]',
      'Volume = 0.5,',
    ].join('\n');
    const entries = parseConfigFile(text);
    const out = appendKeyval(entries, 'Health', '100', { format: 'lua', sectionHint: 'Combat' });
    const keyvals = out.filter(e => e.type === 'keyval').map(e => e.key);
    // Health should land between Damage and Volume — inside Combat
    expect(keyvals).toEqual(['Damage', 'Health', 'Volume']);
  });

  it('falls back to file-end when sectionHint does not match anything', () => {
    const entries = parseConfigFile('A = 1,\nB = 2,');
    const out = appendKeyval(entries, 'C', '3', { format: 'lua', sectionHint: 'NoSuchSection' });
    const keyvals = out.filter(e => e.type === 'keyval').map(e => e.key);
    expect(keyvals).toEqual(['A', 'B', 'C']);
  });

  it('inherits indent from preceding line', () => {
    const entries = parseConfigFile('local Config = {\n  Foo = 1,\n}');
    const out = appendKeyval(entries, 'Bar', '2', { format: 'lua' });
    const newEntry = out.find(e => e.type === 'keyval' && e.key === 'Bar');
    expect(newEntry.raw.startsWith('  ')).toBe(true); // 2-space indent inherited
  });

  it('quotes the value when isQuoted is true', () => {
    const entries = parseConfigFile('A = 1,');
    const out = appendKeyval(entries, 'Name', 'Steve', { format: 'lua', isQuoted: true });
    const newEntry = out.find(e => e.type === 'keyval' && e.key === 'Name');
    expect(newEntry.raw).toContain('"Steve"');
  });
});

describe('removeKeyvalAt', () => {
  it('removes the keyval at the given index', () => {
    const entries = parseConfigFile('A = 1\nB = 2\nC = 3');
    const out = removeKeyvalAt(entries, 1);
    const keyvals = out.filter(e => e.type === 'keyval').map(e => e.key);
    expect(keyvals).toEqual(['A', 'C']);
  });

  it('removes every line of a repeated key in the same table (Lua must read nil)', () => {
    // Lua's last-wins: removing only one `A = …` would bring the other back.
    const entries = parseConfigFile('A = 1\nA = 2\nB = 3');
    const out = removeKeyvalAt(entries, 0);
    const keyvals = out.filter(e => e.type === 'keyval');
    expect(keyvals.map(e => e.key)).toEqual(['B']);
  });

  it('returns the list unchanged for an out-of-range or non-keyval index', () => {
    const entries = parseConfigFile('-- header\nA = 1');
    expect(removeKeyvalAt(entries, 99)).toEqual(entries);
    expect(removeKeyvalAt(entries, -1)).toEqual(entries);
    expect(removeKeyvalAt(entries, undefined)).toEqual(entries);
    expect(removeKeyvalAt(entries, 0)).toEqual(entries); // index 0 is the comment
  });
});

describe('inline comment + trailing comma (regression: #2 save corruption)', () => {
  it('parses a quoted value that has BOTH a trailing comma and an inline comment', () => {
    const kv = parseConfigFile('  Name = "AK47", -- gun').find(e => e.type === 'keyval');
    expect(kv.value).toBe('AK47');
    expect(kv.isQuoted).toBe(true);
    expect(kv.hadComma).toBe(true);
  });

  it('round-trips a quoted value with comma + comment unchanged', () => {
    const text = '  Name = "AK47", -- gun';
    expect(serializeConfig(parseConfigFile(text))).toBe(text);
  });

  it('preserves quotes AND comma AND comment after editing the value', () => {
    const entries = parseConfigFile('  Name = "AK47", -- gun');
    entries.find(e => e.type === 'keyval').value = 'M16';
    // Before the fix this serialized to `Name = M16 -- gun` (a Lua syntax error).
    expect(serializeConfig(entries)).toBe('  Name = "M16", -- gun');
  });

  it('guesses int (not string) for a numeric value with comma + comment', () => {
    const kv = parseConfigFile('  Damage = 10, -- base').find(e => e.type === 'keyval');
    expect(kv.value).toBe('10');
    expect(guessValueType(kv.value)).toBe('int');
    expect(kv.hadComma).toBe(true);
  });

  it('keeps the comma after editing a numeric value with comma + comment', () => {
    const entries = parseConfigFile('  Damage = 10, -- base');
    entries.find(e => e.type === 'keyval').value = '25';
    expect(serializeConfig(entries)).toBe('  Damage = 25, -- base');
  });

  it('still handles a trailing comma with no comment', () => {
    const text = '  TickRate = 60,';
    expect(serializeConfig(parseConfigFile(text))).toBe(text);
  });

  it('still handles an inline comment with no trailing comma', () => {
    const text = '  Mode = fast -- speed';
    expect(serializeConfig(parseConfigFile(text))).toBe(text);
  });

  it('does not treat -- inside a quoted string as a comment', () => {
    const kv = parseConfigFile('  Desc = "TODO -- fix",').find(e => e.type === 'keyval');
    expect(kv.value).toBe('TODO -- fix');
    expect(kv.isQuoted).toBe(true);
    expect(kv.hadComma).toBe(true);
  });
});

// Regression: Nexus report 2026-07-20 — "config button opens a window and
// nothing shows up". A Lua config whose keys sit under DECORATIVE comment
// banners (--[[ ====[ NAME ]==== ]]) was treated as "structured", which
// disabled the flat-lookup fallback; since banner names rarely equal the
// schema's section ids (banner "UPGRADE STORAGE EXTRA CAPACITY" vs schema id
// "UpgradeStorage"), every schema key resolved to undefined and the editor
// rendered two empty section headers. Real INI [Section] files must KEEP the
// strict scoping (audit 2026-05-14: cross-scope key leak).
describe('buildSectionKeyIndex + resolveEntryIdx — decorative vs real sections', () => {
  const luaWithBanners = [
    '--[[ ============================================================',
    '  VehicleStorageMod config',
    '  ============================================================ ]]',
    'local Config = {',
    '',
    '--[[ ====[ UPGRADE STORAGE EXTRA CAPACITY ]==== ]]',
    'Lv1Extra = 5,',
    'Lv2Extra = 10,',
    '',
    '-- ====[ VEHICLE STORAGE ]====',
    'Mode = "All",',
    'Slots = 80,',
    '}',
    'return Config',
  ].join('\n');

  it('marks comment-banner sections as decorative, INI sections as real', () => {
    const entries = parseConfigFile(luaWithBanners);
    const sections = entries.filter(e => e.type === 'section');
    expect(sections.map(s => s.name)).toEqual(['UPGRADE STORAGE EXTRA CAPACITY', 'VEHICLE STORAGE']);
    expect(sections.every(s => s.decorative === true)).toBe(true);

    const iniSections = parseConfigFile('[Combat]\nenabled=true').filter(e => e.type === 'section');
    expect(iniSections[0].decorative).toBeUndefined();
  });

  it('resolves schema keys across decorative banners whose names differ from schema ids', () => {
    const entries = parseConfigFile(luaWithBanners);
    const index = buildSectionKeyIndex(entries);
    expect(index.hasStructuredSections).toBe(false);

    // Schema section ids that do NOT match the banner text — the reported case.
    for (const [sectionId, keyName] of [
      ['UpgradeStorage', 'Lv1Extra'],
      ['UpgradeStorage', 'Lv2Extra'],
      ['VehicleStorage', 'Mode'],
      ['VehicleStorage', 'Slots'],
    ]) {
      const idx = resolveEntryIdx(index, sectionId, keyName);
      expect(idx, `${sectionId}.${keyName}`).not.toBeUndefined();
      expect(entries[idx].key).toBe(keyName);
    }
  });

  it('still resolves via exact match when banner names equal schema ids', () => {
    const entries = parseConfigFile('-- [Combat]\nDamage = 10,\n-- [Movement]\nSpeed = 2,');
    const index = buildSectionKeyIndex(entries);
    const idx = resolveEntryIdx(index, 'Combat', 'Damage');
    expect(entries[idx].value).toBe('10');
  });

  it('keeps strict scoping for real INI sections (no cross-scope leak)', () => {
    const ini = ['[DamageNumbers]', 'enabled = true', '[IncomingDamage]', 'enabled = false'].join('\n');
    const entries = parseConfigFile(ini);
    const index = buildSectionKeyIndex(entries);
    expect(index.hasStructuredSections).toBe(true);

    expect(entries[resolveEntryIdx(index, 'DamageNumbers', 'enabled')].value).toBe('true');
    expect(entries[resolveEntryIdx(index, 'IncomingDamage', 'enabled')].value).toBe('false');
    // A schema section id with no matching real section must NOT leak a key
    // from another scope.
    expect(resolveEntryIdx(index, 'HitMarker', 'enabled')).toBeUndefined();
  });

  it('sectionless config still resolves from the flat bucket', () => {
    const entries = parseConfigFile('Radius = 25,\nShowRing = true,');
    const index = buildSectionKeyIndex(entries);
    expect(index.hasStructuredSections).toBe(false);
    expect(entries[resolveEntryIdx(index, 'GeneratorRadius', 'Radius')].value).toBe('25');
  });
});

// Regression: the flat-lookup fallback above made READS work for decorative
// banners, but the WRITE path still re-derived its target by matching the
// schema's section id against the file's section names. Toggling an optional
// key off matched nothing and silently did nothing; toggling one on dumped the
// new line at the file bottom instead of inside its banner block. Reads and
// writes must agree: resolution happens once (resolveEntryIdx /
// resolveSectionName) and both sides consume its answer.
describe('optional-key writes agree with resolveEntryIdx (decorative banners)', () => {
  const lua = [
    'local Config = {',
    '-- ====[ UPGRADE STORAGE EXTRA CAPACITY ]====',
    'Lv1Extra = 5,',
    '-- ====[ VEHICLE STORAGE ]====',
    'Slots = 80,',
    '}',
  ].join('\n');

  it('removes the key the schema row actually resolved to', () => {
    const entries = parseConfigFile(lua);
    const index = buildSectionKeyIndex(entries);
    // Schema section id ≠ banner text — the reported case.
    const idx = resolveEntryIdx(index, 'UpgradeStorage', 'Lv1Extra');
    const out = removeKeyvalAt(entries, idx);
    expect(out.filter(e => e.type === 'keyval').map(e => e.key)).toEqual(['Slots']);
  });

  it('maps a schema section id onto the file section name for appends', () => {
    const entries = parseConfigFile(lua);
    const index = buildSectionKeyIndex(entries);
    const hint = resolveSectionName(index, 'UpgradeStorage', ['Lv1Extra', 'Lv2Extra']);
    expect(hint).toBe('UPGRADE STORAGE EXTRA CAPACITY');

    const out = appendKeyval(entries, 'Lv2Extra', 10, { sectionHint: hint });
    const lines = serializeConfig(out).split('\n');
    // New key lands inside its own banner block, not after the last keyval.
    expect(lines.indexOf('Lv2Extra = 10,')).toBe(lines.indexOf('Lv1Extra = 5,') + 1);
  });

  it('prefers an exact section match and never crosses real INI scopes', () => {
    const ini = ['[DamageNumbers]', 'enabled = true', '[IncomingDamage]', 'shown = false'].join('\n');
    const index = buildSectionKeyIndex(parseConfigFile(ini));
    expect(resolveSectionName(index, 'DamageNumbers', ['enabled'])).toBe('DamageNumbers');
    // Unknown INI section: must NOT borrow another scope's name.
    expect(resolveSectionName(index, 'HitMarker', ['enabled'])).toBe('HitMarker');
  });

  it('falls back to the schema id when the section has no key in the file yet', () => {
    const index = buildSectionKeyIndex(parseConfigFile(lua));
    expect(resolveSectionName(index, 'Unmatched', ['NothingHere'])).toBe('Unmatched');
  });
});

// Regression: with the flat first-hit fallback, a key name repeated under two
// decorative banners bound BOTH schema rows to the first occurrence — the
// second weapon's row displayed the first weapon's value, and editing it
// silently overwrote the first weapon's line. Section names are now matched
// case/punctuation-insensitively (banner prose vs schema identifier), and the
// flat fallback only fires for a key that exists exactly once in the file.
describe('duplicate key names across decorative banners', () => {
  const weapons = [
    '-- ====[ AK47 RIFLE ]====',
    'Damage = 30,',
    'Recoil = 1.2,',
    '-- ====[ M4 CARBINE ]====',
    'Damage = 25,',
    'Ammo = 30,',
  ].join('\n');

  const entries = parseConfigFile(weapons);
  const index = buildSectionKeyIndex(entries);
  const valueAt = (idx) => entries[idx]?.value;

  it('binds each schema section to its own banner via normalized name match', () => {
    expect(valueAt(resolveEntryIdx(index, 'Ak47Rifle', 'Damage'))).toBe('30');
    expect(valueAt(resolveEntryIdx(index, 'M4Carbine', 'Damage'))).toBe('25');
  });

  it('matches a banner that expands the schema id (prefix), when unambiguous', () => {
    // "AK47 RIFLE" starts with "AK47" — and it's the only banner that does.
    expect(valueAt(resolveEntryIdx(index, 'AK47', 'Damage'))).toBe('30');
    expect(resolveSectionName(index, 'M4', ['Damage'])).toBe('M4 CARBINE');
  });

  it('hides the row instead of binding it to the wrong line when unresolvable', () => {
    // Schema ids that match no banner + a key that exists twice → ambiguous.
    expect(resolveEntryIdx(index, 'Weapon1', 'Damage')).toBeUndefined();
    expect(resolveEntryIdx(index, 'Weapon2', 'Damage')).toBeUndefined();
    // A key that exists only once still resolves through the flat fallback.
    expect(valueAt(resolveEntryIdx(index, 'Weapon1', 'Ammo'))).toBe('30');
  });

  it('does not let an ambiguous sibling key steer an append', () => {
    // 'Damage' lives under both banners → unusable; 'Recoil' is unique → wins.
    expect(resolveSectionName(index, 'Weapon1', ['Damage'])).toBe('Weapon1');
    expect(resolveSectionName(index, 'Weapon1', ['Damage', 'Recoil'])).toBe('AK47 RIFLE');
  });
});

describe('CRLF + quote-style preservation (bug #11)', () => {
  it('round-trips a CRLF file with keyval + comment lines exactly', () => {
    const text = 'Damage = 100\r\n-- note\r\nName = "AK47"\r\n';
    // Previously keyval lines were rebuilt LF-only, mixing EOLs with the
    // CRLF-preserving comment/blank lines. Now unmodified lines are verbatim.
    expect(serializeConfig(parseConfigFile(text))).toBe(text);
  });

  it('keeps CRLF on a line whose value was edited', () => {
    const entries = parseConfigFile('Name = "AK47"\r\nDamage = 100\r\n');
    const nameIdx = entries.findIndex(e => e.type === 'keyval' && e.key === 'Name');
    entries[nameIdx] = { ...entries[nameIdx], value: 'M4' };
    expect(serializeConfig(entries)).toBe('Name = "M4"\r\nDamage = 100\r\n');
  });

  it('round-trips a single-quoted value verbatim when unmodified', () => {
    const text = "Name = 'AK47',\n";
    expect(serializeConfig(parseConfigFile(text))).toBe(text);
  });

  it('preserves the single-quote style when the value is edited', () => {
    const entries = parseConfigFile("Name = 'AK47',\n");
    entries[0] = { ...entries[0], value: 'M4' };
    expect(serializeConfig(entries)).toBe("Name = 'M4',\n");
  });

  it('preserves unusual spacing around = on an unmodified line', () => {
    const text = 'Damage=100\n';
    expect(serializeConfig(parseConfigFile(text))).toBe(text);
  });
});

describe('removeKeyval — section-less config with a sectionHint (bug #7)', () => {
  it('removes the key even when the file has no matching section marker', () => {
    // Schema groups "Cheats" under a "General" section, but config.lua is flat.
    const entries = parseConfigFile('Cheats = true,\n');
    const out = removeKeyval(entries, 'Cheats', 'General');
    expect(out.some(e => e.type === 'keyval' && e.key === 'Cheats')).toBe(false);
  });

  it('still scopes removal to the matching section when sections DO exist', () => {
    const entries = parseConfigFile('-- [A]\nShared = 1\n-- [B]\nShared = 2\n');
    const out = removeKeyval(entries, 'Shared', 'B');
    const remaining = out.filter(e => e.type === 'keyval' && e.key === 'Shared');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].value).toBe('1'); // A's Shared survives
  });
});
