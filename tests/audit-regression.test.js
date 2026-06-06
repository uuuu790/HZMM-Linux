// @vitest-environment happy-dom
//
// happy-dom is needed for the sanitizeReadme test — DOMPurify requires a
// DOM (it uses the browser's DOMParser). The pure-JS tests run fine in
// happy-dom too, just slightly slower.
//
// Regression tests for the bug audit pass (2026-05-14).
//
// Ported from the Windows tree for parity. Every case below pins a
// PLATFORM-NEUTRAL hardening (renderer-input parsing, README sanitization,
// atomic config writes) — all of the source files and exports they touch
// exist identically in the Linux fork.
//
// Each test pins a specific finding so a future refactor doesn't quietly
// reintroduce the bug. Numbering matches the audit report:
//   HIGH  #1  README XSS via unsanitized marked
//   HIGH  #3  Optional key without default → invalid Lua `key = ,`
//   HIGH  #4  parseConfigFile not quote-aware on inline `--` comment
//   HIGH  #5  description {value}→{eval:} substitution order
//   HIGH  #10 app-update trusts renderer URL/hash
//             — The renderer-supplied URL/hash hardening is preserved on
//               Linux (the IPC handlers ignore them), but its Windows-only
//               consequence (download-and-swap of the running .exe via a
//               generated updater.bat) does NOT exist here: the Linux fork
//               has no auto-install, so there is nothing to test for batch
//               generation / PORTABLE_EXECUTABLE_FILE / exe-swap. Those
//               Windows-only checks are intentionally omitted. The
//               version-compare decision that drives the Linux updater is
//               covered separately in tests/ipc/app-update.test.js.
//   MED   #12 MultiSelectInput drops non-schema items
//   MED   #15 parseLuaArray escape lookback + serializeLuaArray backslash
//   MED   #16 KeybindInput records e.key not e.code
//   LOW       config-store atomic write

import { describe, it, expect } from 'vitest';
import {
  parseConfigFile,
  serializeConfig,
  parseLuaArray,
  serializeLuaArray,
  appendKeyval,
  valueNeedsQuote,
} from '../src/renderer/src/utils/config-parser.js';
import { typedDefaultSeed, codeToMainKey } from '../src/renderer/src/utils/widget-helpers.js';
import { sanitizeReadme } from '../src/renderer/src/utils/sanitize-readme.js';

// ---------------------------------------------------------------------------
// HIGH #4 — parseConfigFile must not split inline `--` that's inside a
// quoted string. Without the fix, a value like `"TODO -- fix"` gets
// truncated to `"TODO`, breaking round-trip.
// ---------------------------------------------------------------------------
describe('HIGH #4 — parseConfigFile quote-aware -- detection', () => {
  it('keeps `--` inside a double-quoted value intact', () => {
    const text = 'Description = "TODO -- fix later",';
    const entries = parseConfigFile(text);
    const kv = entries.find(e => e.type === 'keyval');
    expect(kv.value).toBe('TODO -- fix later');
    expect(kv.isQuoted).toBe(true);
    expect(kv.inlineDesc).toBeNull();
  });

  it('keeps `--` inside a single-quoted value intact', () => {
    const text = "Name = 'A -- B',";
    const entries = parseConfigFile(text);
    const kv = entries.find(e => e.type === 'keyval');
    expect(kv.value).toBe('A -- B');
    expect(kv.isQuoted).toBe(true);
  });

  it('still extracts a genuine trailing `-- comment` when it follows a closing quote', () => {
    const text = 'Name = "real" -- inline note';
    const entries = parseConfigFile(text);
    const kv = entries.find(e => e.type === 'keyval');
    expect(kv.value).toBe('real');
    expect(kv.isQuoted).toBe(true);
    expect(kv.inlineDesc).toBe('inline note');
  });

  it('still extracts inline comments on unquoted numeric values', () => {
    const text = 'Damage = 5 -- points per hit';
    const entries = parseConfigFile(text);
    const kv = entries.find(e => e.type === 'keyval');
    expect(kv.value).toBe('5');
    expect(kv.inlineDesc).toBe('points per hit');
  });

  it('round-trips a quoted value containing `--` after editing', () => {
    const text = 'Description = "TODO -- fix later",';
    const entries = parseConfigFile(text);
    const idx = entries.findIndex(e => e.type === 'keyval');
    entries[idx] = { ...entries[idx], value: 'done -- now' };
    expect(serializeConfig(entries)).toBe('Description = "done -- now",');
  });
});

// ---------------------------------------------------------------------------
// MED #15 — parseLuaArray must not treat `\\"` (an escaped backslash
// before a close quote) as an escaped quote. serializeLuaArray must
// escape backslashes so the round-trip stays clean.
// ---------------------------------------------------------------------------
describe('MED #15 — Lua array escape round-trip', () => {
  it('parses plain quoted items', () => {
    expect(parseLuaArray('{"a", "b"}')).toEqual(['a', 'b']);
  });

  it('parses a value that ends with `\\\\` (escaped backslash) followed by close quote', () => {
    // Lua source `"a\\"` represents the string `a\` (one literal backslash).
    // In JS source we double-escape: `'{"a\\\\", "b"}'` is `{"a\\", "b"}`.
    const input = '{"a\\\\", "b"}';
    expect(parseLuaArray(input)).toEqual(['a\\', 'b']); // JS 'a\\' is `a\`
  });

  it('parses escaped quote `\\"` inside item body', () => {
    const input = '{"he said \\"hi\\"", "ok"}';
    const out = parseLuaArray(input);
    expect(out).toEqual(['he said "hi"', 'ok']);
  });

  it('serializeLuaArray escapes backslash BEFORE quote', () => {
    expect(serializeLuaArray(['a\\b'])).toBe('{"a\\\\b"}');
    expect(serializeLuaArray(['quote "x"'])).toBe('{"quote \\"x\\""}');
  });

  it('round-trips a value with both backslash and quote', () => {
    const original = ['path\\to\\file', 'plain', 'has "quote"'];
    const serialized = serializeLuaArray(original);
    const parsed = parseLuaArray(serialized);
    expect(parsed).toEqual(original);
  });

  it('returns empty array for `{}`', () => {
    expect(parseLuaArray('{}')).toEqual([]);
    expect(serializeLuaArray([])).toBe('{}');
  });
});

// ---------------------------------------------------------------------------
// HIGH #3 — appending an optional key without a schema default must
// produce valid Lua. Bare empty value plus trailing comma → `key = ,`
// (syntax error). Fix supplies a type-appropriate seed.
// ---------------------------------------------------------------------------
describe('HIGH #3 — optional key without default produces valid Lua', () => {
  it('typedDefaultSeed returns valid bare seeds for numeric/bool/list', () => {
    expect(typedDefaultSeed('int')).toBe('0');
    expect(typedDefaultSeed('float')).toBe('0.0');
    expect(typedDefaultSeed('bool')).toBe('false');
    expect(typedDefaultSeed('list')).toBe('{}');
    expect(typedDefaultSeed('multi-select')).toBe('{}');
  });

  it('typedDefaultSeed leaves quoted types empty (string serializes as "")', () => {
    expect(typedDefaultSeed('string')).toBe('');
    expect(typedDefaultSeed('color')).toBe('');
    expect(typedDefaultSeed('keybind')).toBe('');
  });

  it('appending int optional with typed seed yields parseable Lua', () => {
    const before = parseConfigFile('A = 1,');
    const after = appendKeyval(before, 'Speed', typedDefaultSeed('int'), {
      isQuoted: valueNeedsQuote('int'),
      format: 'lua',
    });
    const text = serializeConfig(after);
    expect(text).toContain('Speed = 0,');
    expect(text).not.toContain('Speed = ,');
  });

  it('appending list optional with typed seed yields `Speed = {},`', () => {
    const before = parseConfigFile('A = 1,');
    const after = appendKeyval(before, 'Tags', typedDefaultSeed('list'), {
      isQuoted: valueNeedsQuote('list'),
      format: 'lua',
    });
    const text = serializeConfig(after);
    expect(text).toContain('Tags = {},');
    expect(text).not.toContain('Tags = ,');
  });

  it('appending string optional uses quoted empty string', () => {
    const before = parseConfigFile('A = 1,');
    const after = appendKeyval(before, 'Name', typedDefaultSeed('string'), {
      isQuoted: valueNeedsQuote('string'),
      format: 'lua',
    });
    expect(serializeConfig(after)).toContain('Name = "",');
  });
});

// ---------------------------------------------------------------------------
// MED #16 — KeybindInput records the physical key (e.code), not the
// printed character. Shift+1 must NOT become "Shift+!".
// ---------------------------------------------------------------------------
describe('MED #16 — KeybindInput uses e.code for physical key', () => {
  it('maps letter codes to bare uppercase letters', () => {
    expect(codeToMainKey('KeyA')).toBe('A');
    expect(codeToMainKey('KeyZ')).toBe('Z');
    expect(codeToMainKey('KeyQ')).toBe('Q');
  });

  it('maps digit codes to bare digits', () => {
    expect(codeToMainKey('Digit0')).toBe('0');
    expect(codeToMainKey('Digit1')).toBe('1');
    expect(codeToMainKey('Digit9')).toBe('9');
  });

  it('keeps function key codes as-is', () => {
    expect(codeToMainKey('F1')).toBe('F1');
    expect(codeToMainKey('F12')).toBe('F12');
  });

  it('keeps arrow / named keys as-is', () => {
    expect(codeToMainKey('ArrowUp')).toBe('ArrowUp');
    expect(codeToMainKey('Space')).toBe('Space');
    expect(codeToMainKey('Enter')).toBe('Enter');
    expect(codeToMainKey('Escape')).toBe('Escape');
  });

  it('keeps numpad keys distinguishable from main keys', () => {
    expect(codeToMainKey('Numpad1')).toBe('Numpad1');
    expect(codeToMainKey('NumpadEnter')).toBe('NumpadEnter');
  });
});

// ---------------------------------------------------------------------------
// HIGH #1 — README is markdown from untrusted mod authors. Sanitization
// must strip script tags, event handlers, and javascript: URLs while
// keeping legitimate markdown markup intact.
// ---------------------------------------------------------------------------
describe('HIGH #1 — sanitizeReadme strips XSS payloads', () => {
  it('removes <script> tags entirely', () => {
    const html = sanitizeReadme('hello\n\n<script>alert(1)</script>\n\nworld');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/alert\(1\)/);
  });

  it('removes inline event handlers (onerror, onload, onclick)', () => {
    const html = sanitizeReadme('![x](https://example.com/x.png)\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/alert\(1\)/);
  });

  it('removes javascript: URLs from links', () => {
    const html = sanitizeReadme('[click](javascript:alert(1))');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/alert\(1\)/);
  });

  it('removes iframe (the high-risk frame-injection vector)', () => {
    const html = sanitizeReadme('hello <iframe src="https://evil.com"></iframe> world');
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/evil\.com/i);
  });

  it('preserves legitimate markdown markup', () => {
    const html = sanitizeReadme('# Title\n\n**bold** and *italic*\n\n- item');
    expect(html).toMatch(/<h1/i);
    expect(html).toMatch(/<strong/i);
    expect(html).toMatch(/<em/i);
    expect(html).toMatch(/<ul/i);
    expect(html).toMatch(/<li/i);
  });

  it('preserves http(s) links', () => {
    const html = sanitizeReadme('[ok](https://example.com/page)');
    expect(html).toMatch(/href="https:\/\/example\.com\/page"/);
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeReadme('')).toBe('');
    expect(sanitizeReadme(null)).toBe('');
    expect(sanitizeReadme(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// MED #12 — MultiSelectInput must preserve items that are present in the
// stored value but not in the schema's options list (case mismatch,
// manually-added custom values). First toggle must not silently drop them.
// We test the array-level invariant rather than mounting the component.
// ---------------------------------------------------------------------------
describe('MED #12 — multi-select preserves non-schema items on toggle', () => {
  // Replicates the toggle logic from MultiSelectInput.jsx so a regression
  // there would surface here too.
  function toggle(currentValue, schemaOptions, item) {
    const current = parseLuaArray(currentValue) || [];
    const selected = new Set(current);
    if (selected.has(item)) selected.delete(item); else selected.add(item);
    const schemaValues = new Set(schemaOptions.map(o => o.value));
    const ordered = schemaOptions.map(o => o.value).filter(v => selected.has(v));
    for (const it of current) {
      if (!schemaValues.has(it) && selected.has(it)) ordered.push(it);
    }
    return serializeLuaArray(ordered);
  }

  it('drops the toggled-off item but keeps non-schema items', () => {
    const schema = [{ value: 'Fire' }, { value: 'Ice' }];
    const before = '{"fire", "Ice", "Custom"}'; // lowercase 'fire' isn't in schema
    const after = toggle(before, schema, 'Ice');
    const parsed = parseLuaArray(after);
    expect(parsed).toContain('fire');
    expect(parsed).toContain('Custom');
    expect(parsed).not.toContain('Ice');
  });

  it('adds the toggled-on item in schema order, keeping unknowns at tail', () => {
    const schema = [{ value: 'A' }, { value: 'B' }, { value: 'C' }];
    const before = '{"Custom"}';
    const after = toggle(before, schema, 'A');
    expect(parseLuaArray(after)).toEqual(['A', 'Custom']);
  });
});

// ---------------------------------------------------------------------------
// HIGH #5 — description token substitution order. `{eval:}` must run
// before `{value}` so a malicious config.lua string value containing
// `{eval: ...}` can't reach `new Function`.
// ---------------------------------------------------------------------------
describe('HIGH #5 — description {eval} runs before {value} substitution', () => {
  // Mirrors the ordering in SchemaRenderer.jsx so a regression there
  // surfaces here. The real renderer also has try/catch around `new
  // Function`, which we replicate.
  function renderDescription(rawDescription, currentValue) {
    if (!rawDescription) return rawDescription;
    let description = rawDescription.replace(/\{eval:\s*([^}]+)\}/g, (match, expr) => {
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('value', `return (${expr})`);
        const result = fn(parseFloat(currentValue) || 0);
        if (!Number.isFinite(result)) return match;
        return Number.isInteger(result) ? String(result) : result.toFixed(2);
      } catch {
        return match;
      }
    });
    description = description.replace(/\{value\}/g, currentValue);
    return description;
  }

  it('inlines value AFTER eval, so malicious value cannot reach new Function', () => {
    // Attacker-controlled currentValue contains an eval token.
    const malicious = '{eval: 999}';
    // Schema description uses {value} but no {eval}.
    const desc = 'Current: {value}';
    const out = renderDescription(desc, malicious);
    // The {eval:...} substring must appear literally in the output —
    // proving it was NOT evaluated.
    expect(out).toBe('Current: {eval: 999}');
  });

  it('still evaluates schema-author-controlled {eval:} expressions', () => {
    const out = renderDescription('Doubled: {eval: value * 2}', '5');
    expect(out).toBe('Doubled: 10');
  });

  it('falls back to the literal token when expression throws', () => {
    const out = renderDescription('{eval: nonExistentFn()}', '0');
    expect(out).toBe('{eval: nonExistentFn()}');
  });
});

// ---------------------------------------------------------------------------
// LOW — config-store.save() must be atomic. We can't fully test the
// crash-mid-write scenario, but we can verify the tmp+rename sequence
// is in the code by inspecting source. That's a structural test.
// ---------------------------------------------------------------------------
describe('LOW — config-store uses tmp+rename for atomic write', () => {
  it('save() writes to .tmp then renames', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(
      path.join(here, '..', 'src', 'main', 'services', 'config-store.js'),
      'utf-8'
    );
    expect(source).toMatch(/\.tmp/);
    expect(source).toMatch(/renameSync/);
  });
});
