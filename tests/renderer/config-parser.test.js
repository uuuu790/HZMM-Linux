import { describe, it, expect } from 'vitest';
import {
  parseConfigFile,
  serializeConfig,
  guessValueType,
  appendKeyval,
  removeKeyval,
  valueNeedsQuote,
  parseLuaArray,
  serializeLuaArray,
} from '../../src/renderer/src/utils/config-parser.js';

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

describe('removeKeyval', () => {
  it('removes the matching keyval entry', () => {
    const entries = parseConfigFile('A = 1\nB = 2\nC = 3');
    const out = removeKeyval(entries, 'B');
    const keyvals = out.filter(e => e.type === 'keyval').map(e => e.key);
    expect(keyvals).toEqual(['A', 'C']);
  });

  it('returns the list unchanged if the key is not present', () => {
    const entries = parseConfigFile('A = 1');
    const out = removeKeyval(entries, 'Nope');
    expect(out).toEqual(entries);
  });

  it('removes all entries with the same key (defensive against duplicates)', () => {
    const entries = parseConfigFile('A = 1\nA = 2\nB = 3');
    const out = removeKeyval(entries, 'A');
    const keyvals = out.filter(e => e.type === 'keyval').map(e => e.key);
    expect(keyvals).toEqual(['B']);
  });
});
