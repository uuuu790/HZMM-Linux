// Small pure helpers shared by config-editor widgets and ConfigEditorModal.
// Live here (not inside the .jsx files) so the Vitest node-env test runner
// can import them without needing a JSX transform.

import {
  serializeLuaArray, parseLuaArray, parseLuaArrayItems, guessValueType, isKnownType, valueNeedsQuote,
  isLuaTableLiteral, removeKeyvalAt, removeKeyvalsAt, INT_RE, FLOAT_RE,
  type ConfigEntry, type EntryKeyDef, type KeyvalEntry, type SchemaKeyDef, type SchemaOption, type SchemaType,
} from './config-parser';
import { normalizeKeybind } from './keybind';

/** entry index → its schema binding (buildEntryKeyDefMap); null in comment mode. */
export type KeyDefMap = Record<number, EntryKeyDef> | null | undefined;

type NumType = 'int' | 'float';

// Strict number check for an int / float value. Anything else (empty, "ten",
// "1,5", "10 -- m") is never written to the file: widgets revert it on blur
// and prepareEntriesForSave reverts whatever is left at save.
export function isValidNumber(value: unknown, type: string | null | undefined): boolean {
  const s = String(value ?? '');
  // Finite only: Lua reads `1e999` as math.huge, which no setting expects.
  return (type === 'int' ? INT_RE : FLOAT_RE).test(s) && Number.isFinite(Number(s));
}

// Is `value` at the schema default? int / float compare numerically ("25"
// equals a default of 25.0 / "25.0"); list / multi-select compare their items
// (`{1, 2}` equals `{"1", "2"}`); everything else compares strings.
export function valueEqualsDefault(value: unknown, keyDef: SchemaKeyDef): boolean {
  const def = defaultToValueStr(keyDef);
  if (def === null) return false;
  if ((keyDef.type === 'int' || keyDef.type === 'float') && FLOAT_RE.test(String(value)) && FLOAT_RE.test(def)) {
    return Number(value) === Number(def);
  }
  if (keyDef.type === 'list' || keyDef.type === 'multi-select') {
    const a = parseLuaArray(String(value ?? ''));
    const b = parseLuaArray(def);
    if (a && b) return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return value === def;
}

// Serialize a schema-declared `default` into the same string form we store
// in `entries[].value`. Shared by ConfigEditorModal (reset handler + the
// "already at default?" check) and SchemaRenderer (per-row reset target,
// optional-key seed) so the two never diverge. Array defaults (list /
// multi-select) MUST go through serializeLuaArray so they round-trip through
// parseLuaArray — a bare String(["Fire","Ice"]) would write broken Lua; JSON
// numbers in them stay bare numbers. Floats keep at least one decimal so 3.0
// doesn't degrade to "3". Keybind defaults written in the pre-1.4 format
// ("Numpad1") are converted, so they compare equal to the converted value the
// editor shows.
export function defaultToValueStr(keyDef: SchemaKeyDef | null | undefined): string | null {
  if (!keyDef || keyDef.default === undefined || keyDef.default === null) return null;
  if (Array.isArray(keyDef.default)) return serializeLuaArray(keyDef.default);
  if (keyDef.type === 'float' && typeof keyDef.default === 'number' && Number.isInteger(keyDef.default)) {
    return keyDef.default.toFixed(1);
  }
  if (keyDef.type === 'keybind') return normalizeKeybind(String(keyDef.default));
  return String(keyDef.default);
}

// Convert keybind values stored in the pre-1.4 format ("Ctrl+1", "Numpad1")
// to UE4SS Key names. Only `value` changes: `origValue` keeps the file's text,
// so the line is rewritten on the next save, while the caller snapshots the
// converted entries as "original" — opening the editor alone isn't an edit.
export function normalizeKeybindEntries(entries: ConfigEntry[], keyDefMap: KeyDefMap): ConfigEntry[] {
  if (!keyDefMap) return entries;
  return entries.map((e, i) => {
    if (e.type !== 'keyval' || e.readonly || keyDefMap[i]?.keyDef?.type !== 'keybind' || !e.value) return e;
    const value = normalizeKeybind(e.value);
    return value === e.value ? e : { ...e, value };
  });
}

// Type-appropriate seed for optional keys lacking a schema default.
// Strings/color/keybind serialize quoted (`key = "",`) so empty is fine.
// Numbers/bools/lists serialize bare — empty would emit `key = ,` which
// is a Lua syntax error. A key with `options` (a select) seeds with its
// first option's value, so the file never holds an off-list value.
export function typedDefaultSeed(type: string | null | undefined, options?: unknown): string {
  if (type !== 'list' && type !== 'multi-select' && Array.isArray(options) && options.length > 0) {
    const first: unknown = options[0];
    return String(first && typeof first === 'object' ? (first as SchemaOption).value : first);
  }
  switch (type) {
    case 'bool': return 'false';
    case 'int': return '0';
    case 'float': return '0.0';
    case 'list':
    case 'multi-select': return '{}';
    default: return '';
  }
}

// The type a schema row edits `entry` as (mirrors SchemaRenderer's row type):
// a known schema type wins; an unknown / missing one is inferred from the
// value the file had when it was read (`origValue`) — never from what is being
// typed — and a quoted value is text even when it looks like a number. A key
// that is absent, or a line switched on in this session (no origValue), is
// typed by its default (a string default is text even when it reads "0042" or
// "true"; an array default is a list), then by its value. An array default
// keeps a one-line array in the file a list too.
export function inferKeyType(
  keyDef: SchemaKeyDef | null | undefined,
  entry: Partial<Pick<KeyvalEntry, 'value' | 'origValue' | 'isQuoted'>> | null | undefined,
): SchemaType {
  if (isKnownType(keyDef?.type)) return keyDef.type;
  if (entry?.isQuoted) return 'string';
  const def = keyDef?.default;
  if (entry?.origValue !== undefined) {
    if (Array.isArray(def) && isLuaTableLiteral(entry.origValue) && parseLuaArray(entry.origValue)) return 'list';
    return guessValueType(entry.origValue);
  }
  if (Array.isArray(def)) return 'list';
  if (typeof def === 'boolean') return 'bool';
  if (typeof def === 'number' && Number.isFinite(def)) return Number.isInteger(def) ? 'int' : 'float';
  if (typeof def === 'string' || !entry) return 'string';
  return guessValueType(entry.value);
}

// Clamp a valid number string into the keyDef's min/max. An in-range value
// keeps its original string, so "3.0" isn't degraded to "3". A clamped float
// is the bound itself, never rounded (max 0.00004 must not become "0"); an
// int is rounded, and rounding never pushes it back out of range.
export function clampToRange(value: string, keyDef: Pick<SchemaKeyDef, 'min' | 'max' | 'type'>): string {
  const { min, max } = keyDef;
  if (min === undefined && max === undefined) return value;
  const n = Number(value);
  let clamped = n;
  if (min !== undefined) clamped = Math.max(min, clamped);
  if (max !== undefined) clamped = Math.min(max, clamped);
  if (clamped === n) return value;
  const outside = (r: number) => (min !== undefined && r < min) || (max !== undefined && r > max);
  if (keyDef.type === 'int') {
    const r = Math.round(clamped);
    if (!outside(r)) return String(r);
    // Outside and not below min → above max, so max is set.
    return String(min !== undefined && r < min ? Math.ceil(min) : Math.floor(max!));
  }
  return String(clamped);
}

const LUA_NUMERAL_RE = /^-?(?:0[xX](?:[0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?|\.[0-9a-fA-F]+)(?:[pP][-+]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/;
const isNumberOrBool = (v: string) => v === 'true' || v === 'false' || LUA_NUMERAL_RE.test(v);
const LUA_WORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'for', 'function', 'goto', 'if', 'in',
  'local', 'not', 'or', 'repeat', 'return', 'then', 'until', 'while']);
// `Name` / `Key.F6` — a (dotted) name that isn't a keyword.
const isNamePath = (v: string) => /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(v) && v.split('.').every(p => !LUA_WORDS.has(p));

// May an edited value on a bare Lua line of unknown type stay bare?
//   schema mode  — only a number / true / false, or a table constructor that
//                  replaces one (anything else is text: quoted);
//   comment mode — also nil, a name / dotted name (`Key.F6`) or a table
//                  constructor: the raw Lua the author wrote is kept editable,
//                  while free text (`Very Hard`) is quoted instead of
//                  producing a file that doesn't load.
function mayStayBare(value: string, origValue: string | undefined, schemaMode: boolean): boolean {
  if (isNumberOrBool(value)) return true;
  if (schemaMode) return isLuaTableLiteral(origValue) && isLuaTableLiteral(value);
  return value === 'nil' || isNamePath(value) || isLuaTableLiteral(value);
}

// A list / multi-select value re-serialized so numbers stay numbers: an item
// equal to a multi-select option (or an item of the array `default`) whose
// schema value is a JSON number is bare, and so is an item that was bare in
// the file (`Slots = {1, 2}`) and is unchanged. Everything else is a quoted
// string.
function arrayWithBareNumbers(value: string, origValue: string | undefined, keyDef: SchemaKeyDef): string {
  const items = parseLuaArray(value);
  if (!items) return value;
  const optValue = (o: unknown) => (o && typeof o === 'object' ? (o as SchemaOption).value : o);
  const numericOptions = new Set([
    ...(keyDef.type === 'multi-select' ? (keyDef.options || []).map(optValue) : []),
    ...(Array.isArray(keyDef.default) ? keyDef.default as unknown[] : []),
  ].filter(v => typeof v === 'number' && Number.isFinite(v)).map(String));
  const pool = (parseLuaArrayItems(origValue ?? '') || []).filter(it => it.bare).map(it => it.text);
  const bare = items.map((item) => {
    if (numericOptions.has(item) && LUA_NUMERAL_RE.test(item)) return true;
    const k = pool.indexOf(item);
    if (k === -1) return false;
    pool.splice(k, 1);
    return true;
  });
  return serializeLuaArray(items, (_, i) => bare[i]);
}

// Normalize entries right before they're serialized. Only edited / newly
// added keyvals change — an untouched line (value === origValue) and every
// readonly entry are written back verbatim. `keyDefMap` comes from
// buildEntryKeyDefMap (null in comment mode). The value's type is the schema
// type when it is one the editor knows, else inferred from the ORIGINAL value
// (inferKeyType; comment mode: an unquoted original number is a number, a
// quoted "1234" is text):
//   - int / float (declared or inferred): an invalid number reverts to the
//     line's original value (or the schema default); a valid edit of a schema
//     key is clamped to min/max (SliderInput / inputs only clamp on blur, so a
//     value typed and saved without blurring would otherwise be persisted
//     unbounded).
//   - in Lua files, quoting follows a known schema type (text/color/keybind/
//     string selects quoted, numbers/bools/lists bare). A bare line of unknown
//     type stays bare only for a value that is still a literal of its kind
//     (see mayStayBare) — anything else is written quoted; clearing it keeps
//     the line. list / multi-select values keep numbers bare
//     (arrayWithBareNumbers). INI lines keep their own quoting — the
//     serializer only adds quotes a value needs to read back intact.
export function prepareEntriesForSave(entries: ConfigEntry[], keyDefMap: KeyDefMap): ConfigEntry[] {
  return entries.map((e, i) => {
    if (e.type !== 'keyval' || e.readonly) return e;
    if (e.origValue !== undefined && e.value === e.origValue) return e;
    const isLua = e.format !== 'ini';
    const def = keyDefMap?.[i]?.keyDef || null;
    const known = def && isKnownType(def.type) ? def.type : null;
    const type = known || (keyDefMap ? inferKeyType(def, e) : (e.isQuoted ? 'string' : guessValueType(e.origValue ?? '')));
    // A key without a schema type that its array default makes a list is
    // written like a declared list (bare table, numbers kept bare).
    const quoteType = known || (type === 'list' ? 'list' : null);
    let numType: NumType | null = type === 'int' || type === 'float' ? type : null;
    if (!keyDefMap && numType) numType = 'float';

    let value = String(e.value ?? '');
    // INI has no escapes: a line break would split the line — write a space.
    if (!isLua) value = value.replace(/\r\n|\r|\n/g, ' ');
    if (numType && !isValidNumber(value, numType)) {
      const d = defaultToValueStr(def);
      value = e.origValue ?? (d !== null && isValidNumber(d, numType) ? d : typedDefaultSeed(numType));
    }
    if (def && numType && value !== e.origValue && isValidNumber(value, numType)) value = clampToRange(value, { ...def, type: numType });

    let isQuoted = e.isQuoted;
    if (isLua) {
      if (quoteType) {
        // quoteType is set only with a schema def: a known type, or a list
        // inferred from the def's array default.
        isQuoted = valueNeedsQuote(quoteType, def!.options);
        if ((quoteType === 'list' || quoteType === 'multi-select') && value !== e.origValue) value = arrayWithBareNumbers(value, e.origValue, def!);
      } else if (!e.isQuoted && !numType) {
        if (value.trim() === '') value = e.origValue ?? value;
        else isQuoted = !mayStayBare(value, e.origValue, !!keyDefMap);
      }
    }
    if (value === e.value && isQuoted === e.isQuoted) return e;
    return { ...e, value, isQuoted, quoteChar: e.quoteChar || '"' };
  });
}

// Footer "Reset to defaults". Uses the rows' own entry ↔ key binding
// (buildEntryKeyDefMap), so an entry no row shows is never touched, and a
// readonly one never is either:
//   - key with a schema default → that default (kept as-is when it's already
//     numerically equal, so "25" vs 25.0 isn't a spurious edit);
//   - optional key without a default → removed (its default is "absent"),
//     every line of it in the same table, like the row's toggle
//     (removeKeyvalAt — a key it refuses to remove stays);
//   - any other key → left alone.
export function resetEntriesToDefaults(entries: ConfigEntry[], keyDefMap: KeyDefMap): ConfigEntry[] {
  const remove: ConfigEntry[] = [];
  let out = entries.map((e, i) => {
    if (e.type !== 'keyval' || e.readonly) return e;
    const def = keyDefMap?.[i]?.keyDef;
    if (!def) return e;
    const defaultStr = defaultToValueStr(def);
    if (defaultStr === null) {
      if (def.optional) remove.push(e);
      return e;
    }
    return valueEqualsDefault(e.value, def) ? e : { ...e, value: defaultStr };
  });
  if (!remove.length) return out;
  // All at once (one safety check); if that's refused, key by key so only
  // the key that can't go stays.
  const together = removeKeyvalsAt(out, remove.map(target => out.indexOf(target)));
  if (together !== out) return together;
  for (const target of remove) {
    const idx = out.indexOf(target);
    if (idx !== -1) out = removeKeyvalAt(out, idx);
  }
  return out;
}

// Would the footer reset change anything? Same binding and rules as
// resetEntriesToDefaults: a present optional key without a default is "not at
// default" (its default is absent).
export function entriesAtDefaults(entries: ConfigEntry[], keyDefMap: KeyDefMap): boolean {
  return entries.every((e, i) => {
    if (e.type !== 'keyval' || e.readonly) return true;
    const def = keyDefMap?.[i]?.keyDef;
    if (!def) return true;
    if (defaultToValueStr(def) === null) return !def.optional;
    return valueEqualsDefault(e.value, def);
  });
}
