// Mod config file parser / serializer.
//
// Supports Lua (a root table — `return { ... }`, `local Config = { ... }
// return Config`, a lone global `Config = { ... }` — or plain `Key = value`
// globals) and INI. The parser emits a flat list of "entries" (keyval /
// comment / section / blank / lua_structure) that preserves enough of the
// original formatting to round-trip unmodified lines verbatim on serialize.
// That's intentional — config files often come from mod authors who care
// about whitespace, decoration, and inline comments, and the ConfigEditor UI
// only mutates `keyval.value`.
//
// Lua files are lexed (strings — incl. `\`-newline / `\z` continuations —
// long brackets, block comments, brace depth and function/if/do block depth)
// and read with an explicit ROOT TABLE model (see findRootTable):
//   a. a chunk-level `return {`            → the returned table is the root;
//   b. `return Name` + the last chunk-level `local Name = {` / `Name = {`
//                                          → that table is the root;
//   c. no returned table, exactly one chunk-level multi-line table opener
//      whose body has a `Key = value` field and no other chunk-level
//      `Key = value` line                  → that table is the root;
//   d. otherwise plain globals: every chunk-level `Key = value` line.
// With a root table ONLY its first-level fields become keyvals; other tables,
// globals and nested keys pass through untouched and never bind to a schema
// row. A field the editor can't rewrite safely (it spans several lines, shares
// its line with another statement, is a function, has code after an inline
// block comment, …) is still a keyval but `readonly: true` — it always
// serializes from `raw`.
//
// Extracted from ConfigEditorModal.jsx as part of the 672-line split.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigSyntax = 'lua' | 'ini';
/** Where a file's keyvals live: a Lua root table, Lua globals, or INI. */
export type Container = 'table' | 'globals' | 'ini';
/** How a Lua root table is found — see findRootTable. */
export type RootKind = 'return' | 'named' | 'sole';

/** Flags any entry kind can carry. */
interface EntryBase {
  raw: string;
  /** Lua only: index just past the line's last code character, -1 when it has none. */
  codeEnd?: number;
  /** Parsed with the sniffed hybrid comment rules (not strict Lua). */
  hybrid?: boolean;
  rootOpen?: boolean;
  rootEmpty?: boolean;
  rootOneLine?: boolean;
  rootClose?: boolean;
  rootKind?: RootKind;
  rootName?: string;
  /** A chunk-level `return` sits on this entry's line(s). */
  returnStmt?: boolean;
  returnsValue?: boolean;
}

export interface BlankEntry extends EntryBase { type: 'blank' }
export interface CommentEntry extends EntryBase { type: 'comment'; text: string }
export interface SectionEntry extends EntryBase { type: 'section'; name: string; decorative?: boolean }
export interface LuaStructureEntry extends EntryBase { type: 'lua_structure' }
export interface KeyvalEntry extends EntryBase {
  type: 'keyval';
  key: string;
  /** Always a string: the editor stores every value as text. */
  value: string;
  origValue?: string;
  isQuoted: boolean;
  quoteChar: string | null;
  syntax: ConfigSyntax;
  format: ConfigSyntax;
  container: Container;
  prefix: string;
  inlineDesc: string | null;
  trailing: string;
  hadComma: boolean;
  sep: string;
  commaAt: number;
  readonly?: boolean;
  multiline?: boolean;
  /** Plain names a second statement on this line assigns (`A = 1; B = 2` → B). */
  assigns?: string[];
  tableId?: number;
}

export type ConfigEntry = BlankEntry | CommentEntry | SectionEntry | LuaStructureEntry | KeyvalEntry;

export interface ParseOptions {
  syntax?: ConfigSyntax | 'auto';
  strict?: boolean;
}

export interface ConfigModel {
  kind: RootKind | 'ini' | 'globals';
  name: string | null;
}

/** keyName → entry index; null when the name is ambiguous (two Lua tables). */
export type KeyBucket = Record<string, number | null>;

export interface SectionKeyIndex {
  keyIndexMap: Record<string, KeyBucket>;
  hasStructuredSections: boolean;
  sectionNames?: string[];
}

/** A localized string ({ en: "...", "zh-TW": "..." }) or a plain string. */
export type I18nText = string | Record<string, string>;

export type SchemaType = 'bool' | 'int' | 'float' | 'string' | 'text' | 'color' | 'keybind' | 'select' | 'list' | 'multi-select';
export type SchemaOptionValue = string | number | boolean;
export interface SchemaOption { value: SchemaOptionValue }

/** One key of hzmm.config.json — see docs/CONFIG_SCHEMA.md "Field reference". */
export interface SchemaKeyDef {
  /** Usually a SchemaType; anything else falls back to inference. */
  type?: string;
  label?: I18nText;
  description?: I18nText;
  default?: unknown;
  optional?: boolean;
  widget?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: SchemaOption[];
  showWhen?: Record<string, unknown>;
  openPath?: { path: string; relativeTo?: 'game' | 'mod'; action?: 'open' | 'reveal' };
}

export interface SchemaSection {
  label?: I18nText;
  collapsed?: boolean;
  enableKey?: string;
  keys: Record<string, SchemaKeyDef>;
}

/** A normalized schema (see normalizeSchema). */
export interface ConfigSchema {
  configFile?: string;
  sections: Record<string, SchemaSection>;
  [field: string]: unknown;
}

/** A schema as read from hzmm.config.json, before normalizeSchema. */
export interface RawConfigSchema {
  sections?: Record<string, unknown>;
  [field: string]: unknown;
}

export interface EntryKeyDef {
  sectionId: string;
  keyName: string;
  keyDef: SchemaKeyDef;
}

export type GuessedType = 'bool' | 'int' | 'float' | 'string';

export interface LuaArrayItem {
  text: string;
  bare: boolean;
  unsupported?: boolean;
}

export interface AppendOptions {
  isQuoted?: boolean;
  format?: ConfigSyntax | 'auto';
  sectionHint?: string | null;
  sectionId?: string | null;
}

// A "user-editable" config file: not the mod's entry-point main.lua and not an
// internal scripts/ file. Shared by ModDetailModal (decides whether to show the
// "Edit config" button) and ConfigEditorModal (which files to load) so the two
// can't drift.
export function isUserConfigFile(f: { name: string; relativePath: string }): boolean {
  return (
    f.name.toLowerCase() !== 'main.lua' &&
    !f.relativePath.toLowerCase().startsWith('scripts/')
  );
}

// i18n helper: resolve localized string from { en: "...", "zh-TW": "..." } objects
export function resolveI18n(obj: I18nText | null | undefined, lang: string): string {
  if (!obj || typeof obj === 'string') return obj || '';
  return obj[lang] || obj['en'] || Object.values(obj)[0] || '';
}

// Which syntax the editor parses a config file as: *.lua → Lua, *.ini / *.cfg
// → INI, anything else is sniffed ('auto').
export function syntaxForFile(name: unknown): ConfigSyntax | 'auto' {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.lua')) return 'lua';
  if (lower.endsWith('.ini') || lower.endsWith('.cfg')) return 'ini';
  return 'auto';
}

// A brace in a Lua table-constructor position: a line whose code ends with
// `{` (a multi-line table opener), a line that is only a closing `}` (`},`
// `};` `})`), or `return {`. A brace inside an INI value (`Name = {Clan} X`)
// is none of these.
const LUA_TABLE_LINE_RE = /^[ \t]*(?![;#])(?:[^\r\n]*\{[ \t]*(?:--[^\r\n]*)?|\}[ \t]*[,;)]?[ \t]*(?:--[^\r\n]*)?|return[ \t]*\{[^\r\n]*)\r?$/m;

const LUA_KEYWORD_LINE_RE = /^[ \t]*(--|local\s|return\b|function\b)/m;

// A one-line table field: `Key = { ... }` whose opening brace closes at the
// end of the value (quotes skipped; a trailing `,` / `;` / `--` comment is
// fine). `Name = {Clan} Bob` / `Msg = {player} joined {server}` are INI
// values: their first brace closes before the value ends.
const ONE_LINE_TABLE_FIELD_RE = /^[ \t]*[^=\s;#[\]]+[ \t]*=[ \t]*(\{.*)$/gm;
function hasOneLineTableField(text: string): boolean {
  for (const m of text.matchAll(ONE_LINE_TABLE_FIELD_RE)) {
    const v = m[1];
    let depth = 0;
    let q: string | null = null;
    for (let i = 0; i < v.length; i++) {
      const c = v[i];
      if (q) {
        if (c === '\\') i++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        if (/^[ \t]*[,;]?[ \t]*(--.*)?\r?$/.test(v.slice(i + 1))) return true;
        break;
      }
    }
  }
  return false;
}

// 'auto' sniffing: `[Section]` headers without a Lua table constructor → INI
// (unless braces come with another Lua signal — a `[Word]` line inside a long
// comment of a Lua file with one-line tables); any Lua signal (a table
// constructor, a `--` comment line, local/return/function, a field's trailing
// comma) → Lua; plain `key = value` text — braces inside a value included —
// stays INI.
function detectSyntax(text: string): ConfigSyntax {
  const hasBraces = /[{}]/.test(text);
  if (/^[ \t]*\[[^[\]=]+\][ \t]*\r?$/m.test(text) && !LUA_TABLE_LINE_RE.test(text) &&
    !(hasBraces && LUA_KEYWORD_LINE_RE.test(text))) return 'ini';
  if (LUA_TABLE_LINE_RE.test(text) || hasOneLineTableField(text) ||
    LUA_KEYWORD_LINE_RE.test(text) || /,[ \t]*(--.*)?\r?$/m.test(text)) {
    return 'lua';
  }
  return 'ini';
}

const leadingWs = (s: unknown): string => (String(s || '').match(/^[ \t]*/) || [''])[0];
const lineCount = (raw: unknown): number => String(raw ?? '').split('\n').length;

// Number forms shared with widget-helpers (isValidNumber) and guessValueType:
// the Lua numerals the editor reads and writes (no hex, no inf/nan).
export const INT_RE = /^-?\d+$/;
export const FLOAT_RE = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

// ---------------------------------------------------------------------------
// INI lines
// ---------------------------------------------------------------------------

// INI key: anything but `=`, whitespace, `;`, `#`, `[`, `]` (so `window-width`
// and `Audio.Volume` bind too).
const INI_KEYVAL_RE = /^(\s*)([^=\s;#[\]]+)(\s*=\s*)/;
const INI_KEY_RE = /^[^=\s;#[\]]+$/;

// Where an INI line's inline comment starts, scanning from `from` — the value
// start, never inside the key / `=` prefix. A comment is `;`, `#` or `--`
// preceded by whitespace. A `;` right at the value start is a comment too
// when the prefix ends in whitespace (`Key = ; note` is an empty value), but
// `#` / `--` there belong to the value (`Color = #FF0000 ; main`). Only a
// quote AT the value start opens a quoted value (INI has no escapes: it
// closes at the next same quote); an apostrophe mid-value is plain text.
// Returns the index of the comment (or of the whitespace before it), or -1.
function findIniCommentStart(s: string, from: number): number {
  let i = from;
  const q = s[i];
  if (q === '"' || q === "'") {
    const close = s.indexOf(q, i + 1);
    if (close === -1) return -1;
    i = close + 1;
  } else if (q === ';' && i > 0 && (s[i - 1] === ' ' || s[i - 1] === '\t')) {
    return i;
  }
  for (; i < s.length; i++) {
    const c = s[i];
    if ((c === ' ' || c === '\t') && (s[i + 1] === ';' || s[i + 1] === '#' || s.startsWith('--', i + 1))) return i;
  }
  return -1;
}

const isIniQuoted = (code: string): boolean =>
  code.length >= 2 && (code[0] === '"' || code[0] === "'") && code.endsWith(code[0]);

// `[Section]`, optionally followed by a `;` / `#` comment.
const INI_SECTION_RE = /^\[([^\]]*)\]\s*(?:[;#].*)?$/;

// `bannersAreSections`: a comment banner (`; ====[ Audio ]====`) only groups
// keys in a file WITHOUT real `[Section]`s — next to real ones it's just a
// comment, or rows would bind across the real section boundaries.
function parseIniLine(line: string, bannersAreSections = true): ConfigEntry {
  const body = line.endsWith('\r') ? line.slice(0, -1) : line;
  const trimmed = body.trim();
  // 空行
  if (trimmed === '') return { type: 'blank', raw: line };
  // 各種單行註解（-- ; # //）
  if (/^(--|;|#|\/\/)/.test(trimmed)) return commentEntry(line, trimmed, bannersAreSections);
  // INI section [SectionName]
  const sec = INI_SECTION_RE.exec(trimmed);
  if (sec) return { type: 'section', raw: line, name: sec[1].trim() };
  const m = INI_KEYVAL_RE.exec(body);
  // 其他 → 當註解處理
  if (!m) return { type: 'comment', raw: line, text: '' };
  // INI values are taken literally: no escapes, a trailing comma is part of
  // the value, surrounding quotes only strip.
  const valueStart = m[0].length;
  const at = findIniCommentStart(body, valueStart);
  const code = body.slice(valueStart, at === -1 ? body.length : at).replace(/\s+$/, '');
  const codeEnd = valueStart + code.length;
  const isQuoted = isIniQuoted(code);
  const value = isQuoted ? code.slice(1, -1) : code;
  const trailing = body.slice(codeEnd);
  return {
    type: 'keyval',
    raw: line,
    key: m[2],
    value,
    origValue: value,
    isQuoted,
    quoteChar: isQuoted ? code[0] : null,
    syntax: 'ini',
    format: 'ini',
    container: 'ini',
    prefix: m[0],
    inlineDesc: describeTrailing(trailing),
    trailing,
    hadComma: false,
    sep: ',',
    commaAt: codeEnd,
  };
}

function parseIni(text: string): ConfigEntry[] {
  const lines = text.split('\n');
  const hasRealSections = lines.some(l => INI_SECTION_RE.test(l.trim()));
  return lines.map(l => parseIniLine(l, !hasRealSections));
}

// Does `literal`, written after `Key = ` and followed by the line's own
// `trailing` comment, read back as `value` (surrounding whitespace aside —
// INI readers trim it) with that comment — and only it — split off?
function iniReadsBack(literal: string, value: string, trailing: string): boolean {
  const e = parseIniLine(`k = ${literal}${trailing}`);
  return e.type === 'keyval' && e.trailing.trim() === trailing.trim() &&
    (e.value === value || (!e.isQuoted && e.value === value.trim()));
}

// The literal for an INI value: bare when that reads back intact, otherwise
// quoted — a value holding ` ;` / ` #` / ` --`, starting with `;`, wrapped in
// quotes itself, or one a following comment would run into (`'`). An
// already-quoted line keeps its quote char when it can; a value holding `"`
// prefers `'`.
function iniLiteral(value: string, quoteChar: string | null, trailing = ''): string {
  const q1 = quoteChar === "'" || (!quoteChar && value.includes('"') && !value.includes("'")) ? "'" : '"';
  const q2 = q1 === '"' ? "'" : '"';
  const candidates = [...(quoteChar ? [] : [value]), `${q1}${value}${q1}`, `${q2}${value}${q2}`];
  return candidates.find(c => iniReadsBack(c, value, trailing)) ?? candidates[0];
}

// ---------------------------------------------------------------------------
// Lua lexing
// ---------------------------------------------------------------------------

type Quote = '"' | "'";

/** What a line leaves open for the next one (see lexLuaLine). */
type LongState =
  | { quote: Quote; z?: boolean; close?: undefined; comment?: undefined }
  | { close: string; comment: boolean; quote?: undefined; z?: undefined };

interface LexState {
  long: LongState | null;
  brace: number;
  paren: number;
  block: number;
  min: number;
}

interface LexResult {
  commentAt: number;
  codeEnd: number;
  codeAfterComment: boolean;
}

/** One lexed line of a Lua file (see lexLua). */
interface LineInfo extends LexResult {
  line: string;
  body: string;
  start: LexState;
  end: LexState;
  skip: boolean;
}

interface ShortScan {
  end: number;
  cont?: boolean;
  z?: boolean;
}

interface RootTable {
  kind: RootKind;
  name: string;
  open: number;
  close: number;
  oneLine: boolean;
  empty: boolean;
}

const LONG_OPEN = /^\[(=*)\[/;
const BLOCK_OPEN = new Set(['function', 'if', 'do', 'repeat']);
const BLOCK_CLOSE = new Set(['end', 'until']);
const LUA_KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);

// Scan a short string from `i` (just past the opening quote, or the start of a
// continuation line). `z` is true while a `\z` escape is still skipping
// whitespace. Returns { end } — the index past the closing quote — or, when
// the line ends inside the string, { end: -1, cont, z }: `cont` is true when
// Lua continues the string on the next line (a `\` right before the line
// break, or a `\z` still skipping whitespace).
function scanShortString(s: string, i: number, q: string, z = false): ShortScan {
  while (i < s.length) {
    const c = s[i];
    if (z) {
      if (c === ' ' || c === '\t' || c === '\f' || c === '\v') { i++; continue; }
      z = false;
    }
    if (c === q) return { end: i + 1 };
    if (c === '\\') {
      if (i + 1 >= s.length) return { end: -1, cont: true, z: false };
      if (s[i + 1] === 'z') { z = true; i += 2; continue; }
      i += 2;
      continue;
    }
    i++;
  }
  return { end: -1, cont: z, z };
}

// Lex one line of Lua, updating the multi-line state `st` in place:
//   long  — an open long string / block comment ({ close: ']==]', comment })
//           or a short string continued on the next line ({ quote, z })
//   brace / paren — `{` / `(` depth outside strings and comments
//   block — function/if/do/repeat blocks still waiting for end/until
//   min   — the lowest brace depth reached on this line
// Returns { commentAt, codeEnd, codeAfterComment }: where the line's first
// comment starts (-1 if none), the index just past its last code character
// (string contents count as code; -1 if the line has none), and whether code
// follows a comment that started on this line (`X = 5 --[[a]] + 3`).
function lexLuaLine(s: string, st: LexState): LexResult {
  let commentAt = -1;
  let codeEnd = -1;
  let codeAfterComment = false;
  const code = (end: number) => {
    codeEnd = end;
    if (commentAt !== -1) codeAfterComment = true;
  };
  st.min = st.brace;
  let i = 0;
  while (i < s.length) {
    const long = st.long;
    if (long) {
      if (long.quote) {
        const r = scanShortString(s, i, long.quote, long.z);
        if (r.end === -1) {
          if (i < s.length) code(s.length);
          st.long = r.cont ? { quote: long.quote, z: r.z } : null;
          break;
        }
        st.long = null;
        i = r.end;
        code(i);
        continue;
      }
      const close = s.indexOf(long.close, i);
      if (close === -1) {
        if (!long.comment && i < s.length) code(s.length);
        break;
      }
      i = close + long.close.length;
      st.long = null;
      if (!long.comment) code(i);
      continue;
    }
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      i++;
    } else if (c === '-' && s[i + 1] === '-') {
      if (commentAt === -1) commentAt = i;
      const m = LONG_OPEN.exec(s.slice(i + 2));
      if (!m) break; // line comment: rest of the line
      st.long = { close: `]${m[1]}]`, comment: true };
      i += 2 + m[0].length;
    } else if (c === '[' && LONG_OPEN.test(s.slice(i))) {
      const m = LONG_OPEN.exec(s.slice(i))!; // just tested
      st.long = { close: `]${m[1]}]`, comment: false };
      i += m[0].length;
      code(i);
    } else if (c === '"' || c === "'") {
      const r = scanShortString(s, i + 1, c);
      if (r.end === -1) {
        // Unterminated on this line: continued (`\` / `\z`) or a syntax error.
        code(s.length);
        if (r.cont) st.long = { quote: c, z: r.z };
        break;
      }
      i = r.end;
      code(i);
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /\w/.test(s[j])) j++;
      const word = s.slice(i, j);
      if (BLOCK_OPEN.has(word)) st.block++;
      else if (BLOCK_CLOSE.has(word)) st.block--;
      i = j;
      code(i);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      // Skip a numeral whole so the letters of `0xEnd` / `1e5` never read as keywords.
      i++;
      while (i < s.length && /[\w.]/.test(s[i])) i++;
      code(i);
    } else {
      if (c === '{') st.brace++;
      else if (c === '}') st.min = Math.min(st.min, --st.brace);
      else if (c === '(') st.paren++;
      else if (c === ')') st.paren--;
      i++;
      code(i);
    }
  }
  return { commentAt, codeEnd, codeAfterComment };
}

// Walk one line's value code with the lexer's string / long-bracket / comment
// skipping and report what makes it unsafe to rewrite:
//   secondField — a top-level `,` / `;` followed by more code (`1, B = 2`,
//                 `1, 2`): rewriting the value would drop it;
//   bareEq      — a top-level `=` that isn't `==` `~=` `<=` `>=`
//                 (`1920 Height = 1080`, `1 if A then B = 2 end`): a second
//                 statement shares the line;
//   assigns     — the plain names those extra statements assign (`Height`).
function scanLuaValue(code: string): { secondField: boolean; bareEq: boolean; assigns: string[] } {
  let depth = 0;
  let secondField = false;
  let bareEq = false;
  const assigns: string[] = [];
  let i = 0;
  const skipLong = (at: number): number => {
    const m = LONG_OPEN.exec(code.slice(at));
    if (!m) return -1;
    const close = code.indexOf(`]${m[1]}]`, at + m[0].length);
    return close === -1 ? code.length : close + m[1].length + 2;
  };
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      const r = scanShortString(code, i + 1, c);
      if (r.end === -1) break;
      i = r.end;
      continue;
    }
    if (c === '-' && code[i + 1] === '-') {
      const end = skipLong(i + 2);
      if (end === -1) break; // line comment: nothing after it counts
      i = end;
      continue;
    }
    if (c === '[') {
      const end = skipLong(i);
      if (end !== -1) { i = end; continue; }
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (depth <= 0) {
      if ((c === ',' || c === ';') && code.slice(i + 1).trim() !== '') secondField = true;
      else if (c === '=' && code[i + 1] !== '=' && !'=~<>'.includes(code[i - 1] || '')) {
        bareEq = true;
        // The plain name right before the `=` (not `a.b =` / `a:b =`).
        let end = i;
        while (end > 0 && /\s/.test(code[end - 1])) end--;
        let start = end;
        while (start > 0 && /\w/.test(code[start - 1])) start--;
        const name = code.slice(start, end);
        if (/^[A-Za-z_]/.test(name) && !/[.:]/.test(code[start - 1] || '') && !LUA_KEYWORDS.has(name)) assigns.push(name);
      }
    }
    i++;
  }
  return { secondField, bareEq, assigns };
}

// `{ ... }` and nothing else: one balanced table constructor.
export function isLuaTableLiteral(value: unknown): boolean {
  const code = String(value ?? '').trim();
  if (!code.startsWith('{') || !code.endsWith('}')) return false;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'") {
      const r = scanShortString(code, i + 1, c);
      if (r.end === -1) return false;
      i = r.end - 1;
    } else if (c === '-' && code[i + 1] === '-') {
      return false;
    } else if (c === '[' && LONG_OPEN.test(code.slice(i))) {
      const m = LONG_OPEN.exec(code.slice(i))!; // just tested
      const close = code.indexOf(`]${m[1]}]`, i + m[0].length);
      if (close === -1) return false;
      i = close + m[1].length + 1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0 && i !== code.length - 1) return false;
    }
  }
  return depth === 0;
}

const KEYVAL_RE = /^(\s*)([A-Za-z_]\w*)(\s*=(?!=)\s*)/;
// A value whose code ends with a binary operator continues on the next line.
const TRAILING_OP_RE = /(?:[-+*/%^<>=~&|]|\.\.|\b(?:and|or|not))$/;
// A line whose code starts with a binary operator continues the expression
// on the line before it (`Motd = "a"` / `.. "b"`). `--` is a comment.
const LEADING_OP_RE = /^(?:\.\.|-(?!-)|[+*/%^<>=~&|]|(?:and|or)\b)/;
// Chunk-level root table forms (matched against a line's code, comments cut).
const OPENER_RE = /^(?:local\s+)?([A-Za-z_]\w*)\s*(?:<\s*[A-Za-z_]\w*\s*>\s*)?=\s*\{/;
const EMPTY_OPENER_RE = /^(?:(?:local\s+)?[A-Za-z_]\w*\s*(?:<\s*[A-Za-z_]\w*\s*>\s*)?=|return)\s*\{\s*\}/;
const RETURN_TABLE_RE = /^return\s*\{/;
const RETURN_NAME_RE = /^return\s+([A-Za-z_]\w*)\s*;?$/;

const LUA_UNESCAPE: Record<string, string> = { '\\': '\\', '"': '"', "'": "'", n: '\n', t: '\t', r: '\r' };

// Unescape the Lua escapes the editor round-trips: \\ \" \' \n \t \r.
// Anything else stays literal.
function unescapeLuaString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && LUA_UNESCAPE[s[i + 1]] !== undefined) {
      out += LUA_UNESCAPE[s[i + 1]];
      i++;
      continue;
    }
    out += s[i];
  }
  return out;
}

// Escape text for a Lua quoted string: backslash, the quote char, newline, CR, tab.
export function escapeLuaString(s: unknown, quoteChar = '"'): string {
  let out = '';
  for (const ch of String(s)) {
    if (ch === '\\') out += '\\\\';
    else if (ch === quoteChar) out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out;
}

// Does a quoted string's body hold an escape outside \\ \" \' \n \t \r?
function hasUnsupportedEscape(body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') continue;
    if (LUA_UNESCAPE[body[i + 1]] === undefined) return true;
    i++;
  }
  return false;
}

// A value that is exactly one Lua string literal → its decoded text. A
// single-line long string (`[[...]]`) decodes too and is rewritten as a
// double-quoted string if edited. `unsupported` flags escapes we can't
// re-encode faithfully (\x41, \65, \z …) — such an entry becomes readonly.
function parseLuaScalar(code: string): { quoteChar: string; value: string; unsupported: boolean } | null {
  const q = code[0];
  if (q === '"' || q === "'") {
    let i = 1;
    while (i < code.length && code[i] !== q) i += code[i] === '\\' ? 2 : 1;
    if (i !== code.length - 1) return null;
    const body = code.slice(1, -1);
    return { quoteChar: q, value: unescapeLuaString(body), unsupported: hasUnsupportedEscape(body) };
  }
  const m = /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(code);
  if (m && !m[2].includes(`]${m[1]}]`)) return { quoteChar: '"', value: m[2], unsupported: false };
  return null;
}

// Inline comment text for comment-mode descriptions.
function describeTrailing(trailing: unknown): string | null {
  let t = String(trailing || '').trim();
  if (!t) return null;
  if (/^--\[=*\[/.test(t)) t = t.replace(/\]=*\]$/, '');
  t = t.replace(/^(--(\[=*\[)?|;|#)\s*/, '').trim();
  return t.replace(/^\d+\s*[-–—]\s*/, '').trim() || null;
}

const cleanSectionName = (s: string): string => s.replace(/\s*[-–—]\s*\(.+\)\s*$/, '').trim();

// Classify a full-line comment. `allowSection` is false inside sub-tables and
// function bodies — a banner there doesn't group root-level keys.
function commentEntry(raw: string, trimmed: string, allowSection: boolean): CommentEntry | SectionEntry {
  const block = /^--\[(=*)\[/.exec(trimmed);
  if (block) {
    const closeIdx = trimmed.indexOf(`]${block[1]}]`, block[0].length);
    if (allowSection && closeIdx !== -1) {
      // 單行 block comment — 嘗試提取 section 名稱 --[[▓▓[ NAME ]▓▓--]]
      const secMatch = trimmed.slice(block[0].length, closeIdx).match(/\[\s*(.+?)\s*\]/);
      // decorative: comment banners group keys visually but don't create a
      // real scope — Lua table keys all share one flat namespace.
      if (secMatch) return { type: 'section', raw, name: cleanSectionName(secMatch[1]), decorative: true };
    }
    return { type: 'comment', raw, text: '' };
  }
  const commentBody = trimmed.replace(/^(--|;|#|\/\/)\s*/, '');
  // 偵測 section header: -- ====[ NAME ]==== 或 # ====[ NAME ]====
  const secInComment = allowSection && commentBody.match(/^\W*\[\s*(.+?)\s*\]\W*$/);
  if (secInComment) return { type: 'section', raw, name: cleanSectionName(secInComment[1]), decorative: true };
  // 分隔線、裝飾線、純符號行 → 不顯示文字
  const isDecorative = /^[=\-~*.#[\](){}<>/\\|_\s]+$/.test(commentBody) || commentBody.startsWith('=') || commentBody === '';
  return { type: 'comment', raw, text: isDecorative ? '' : commentBody };
}

// Lex every line of a Lua file: { line, body, start, end, skip, commentAt,
// codeEnd, codeAfterComment }.
function lexLua(text: string, commentRe: RegExp): LineInfo[] {
  const st: LexState = { long: null, brace: 0, paren: 0, block: 0, min: 0 };
  return text.split('\n').map((line) => {
    const cr = line.endsWith('\r') ? '\r' : '';
    const body = cr ? line.slice(0, -1) : line;
    const start = { ...st };
    // `#` / `//` (and, in sniffed hybrid files, `;`) lines are treated as
    // comments — don't count their braces.
    const skip = !st.long && commentRe.test(body.trimStart());
    let lx: LexResult = { commentAt: -1, codeEnd: -1, codeAfterComment: false };
    if (skip) st.min = st.brace;
    else lx = lexLuaLine(body, st);
    return { line, body, start, end: { ...st }, skip, ...lx };
  });
}

// The statement-level `return` in a chunk-level line's code — at its start or
// after a `;` (`local Config = {}; return Config`) — as { value } (true when it
// returns something other than nothing / nil), or null. Strings are blanked
// first so a `"; return"` inside one isn't mistaken for a statement.
function chunkReturn(code: string): { value: boolean } | null {
  const bare = code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[(=*)\[[\s\S]*?\]\1\]/g, '""');
  const m = /(?:^|;)\s*return\b(.*)$/.exec(bare);
  if (!m) return null;
  const rest = m[1].replace(/;\s*$/, '').trim();
  return { value: rest !== '' && rest !== 'nil' };
}

// A line that starts at chunk level: outside every table, parenthesis,
// block and string / comment.
const atChunkLevel = (li: LineInfo): boolean =>
  !li.skip && !li.start.long && li.start.brace === 0 && li.start.paren <= 0 && li.start.block <= 0;
// The line's code with a trailing comment cut off ('' when it has no code).
const codeText = (li: LineInfo): string => (li.codeEnd === -1 ? '' : li.body.slice(0, li.codeEnd)).trim();
// A `Key = value` line starting at brace depth `depth`, outside blocks/strings.
const isFieldLine = (li: LineInfo, depth: number): boolean =>
  !li.skip && !li.start.long && li.start.brace === depth && li.start.paren <= 0 && li.start.block <= 0 &&
  KEYVAL_RE.test(li.body);

// The root table (see the header): { kind: 'return' | 'named' | 'sole', name,
// open, close, oneLine, empty } — `open` / `close` are line indexes (`close`
// is -1 for a one-line or unterminated table) — or null for plain globals.
function findRootTable(info: LineInfo[]): RootTable | null {
  const top: number[] = [];
  info.forEach((li, k) => { if (atChunkLevel(li)) top.push(k); });
  const tableAt = (k: number, kind: RootKind, name: string): RootTable => {
    const li = info[k];
    const oneLine = li.end.brace <= 0;
    let close = -1;
    if (!oneLine) {
      for (let j = k + 1; j < info.length; j++) {
        if (info[j].end.min < 1) { close = j; break; }
      }
    }
    return { kind, name, open: k, close, oneLine, empty: oneLine && EMPTY_OPENER_RE.test(codeText(li)) };
  };

  // a. `return {`
  for (let x = top.length - 1; x >= 0; x--) {
    const li = info[top[x]];
    if (!li.codeAfterComment && RETURN_TABLE_RE.test(codeText(li))) return tableAt(top[x], 'return', 'return');
  }
  // b. `return Name` → the last chunk-level `local Name = {` / `Name = {` before it.
  for (let x = top.length - 1; x >= 0; x--) {
    const li = info[top[x]];
    const m = li.codeAfterComment ? null : RETURN_NAME_RE.exec(codeText(li));
    if (!m) continue;
    for (let y = x - 1; y >= 0; y--) {
      const o = info[top[y]];
      const om = o.codeAfterComment ? null : OPENER_RE.exec(codeText(o));
      if (om && om[1] === m[1]) return tableAt(top[y], 'named', m[1]);
    }
    break;
  }
  // c. one multi-line table holding `Key = value` fields and nothing else at chunk level.
  const openers = top.filter(k => info[k].end.brace > 0 && !info[k].codeAfterComment && OPENER_RE.test(codeText(info[k])));
  if (openers.length !== 1) return null;
  const k = openers[0];
  const t = tableAt(k, 'sole', OPENER_RE.exec(codeText(info[k]))![1]); // openers matched OPENER_RE
  const end = t.close === -1 ? info.length - 1 : t.close;
  let hasField = false;
  for (let j = k + 1; j <= end && !hasField; j++) hasField = isFieldLine(info[j], 1);
  if (!hasField) return null;
  if (top.some(j => j !== k && KEYVAL_RE.test(info[j].body))) return null;
  return t;
}

// Line-comment prefixes besides `--`. A real .lua file (strict) reads a
// leading `;` as an empty statement followed by code (`;B = 2` inside a
// table); sniffed hybrid files ('auto') keep treating it as a comment.
const HYBRID_COMMENT_RE = /^(#|\/\/|;)/;
const STRICT_COMMENT_RE = /^(#|\/\/)/;

function parseLua(text: string, strict = false): ConfigEntry[] {
  const commentRe = strict ? STRICT_COMMENT_RE : HYBRID_COMMENT_RE;
  const info = lexLua(text, commentRe);
  const root = findRootTable(info);
  const container = root ? 'table' : 'globals';
  const fieldDepth = root ? 1 : 0;
  const inRoot = (k: number) => !root || (!root.oneLine && k > root.open && (root.close === -1 || k <= root.close));
  const tail = (li: LineInfo) => (li.codeEnd === -1 ? '' : li.body.slice(0, li.codeEnd)).replace(/\s+$/, '');
  // The value is still open after this line: an unclosed brace / paren /
  // function block, or a long string, continued short string or block
  // comment — a block comment opened on a field's line makes the comment's
  // lines part of that field's entry.
  const stillOpen = (li: LineInfo, base: number) =>
    li.end.brace > base || li.end.paren > 0 || li.end.block > 0 || !!li.end.long;

  const entries: ConfigEntry[] = [];
  const firstLine: number[] = []; // entry index → its first line
  for (let i = 0; i < info.length; i++) {
    const li = info[i];
    const trimmed = li.body.trim();
    firstLine.push(i);
    if (li.start.long) {
      entries.push(li.start.long.comment
        ? { type: 'comment', raw: li.line, text: '', codeEnd: li.codeEnd }
        : { type: 'lua_structure', raw: li.line, codeEnd: li.codeEnd });
      continue;
    }
    if (trimmed === '') { entries.push({ type: 'blank', raw: li.line, codeEnd: -1 }); continue; }
    if (trimmed.startsWith('--') || commentRe.test(trimmed)) {
      const allowSection = li.start.block <= 0 && li.start.brace <= fieldDepth;
      entries.push({ ...commentEntry(li.line, trimmed, allowSection), codeEnd: li.codeEnd });
      continue;
    }
    if (isFieldLine(li, fieldDepth) && inRoot(i)) {
      // A root-level field. Its value may continue over following lines
      // (unclosed `{`, long / continued string, function body, trailing
      // operator, a next code line starting with an operator, a block
      // comment opened on its line) — all of them become ONE readonly entry.
      const m = KEYVAL_RE.exec(li.body)!; // isFieldLine tested KEYVAL_RE
      const base = li.start.brace;
      let pending = li.codeEnd <= m[0].length || TRAILING_OP_RE.test(tail(li));
      let j = i;
      for (;;) {
        while (j < info.length - 1 && (stillOpen(info[j], base) || pending)) {
          j++;
          if (info[j].codeEnd !== -1) pending = TRAILING_OP_RE.test(tail(info[j]));
        }
        // Complete so far — unless it has no separator yet and the next code
        // line (past blank / comment lines) starts with a binary operator.
        let lc = j;
        while (lc > i && info[lc].codeEnd === -1) lc--;
        if (/[,;]$/.test(tail(info[lc]))) break;
        let k = j + 1;
        while (k < info.length && info[k].codeEnd === -1 && !info[k].start.long && !info[k].end.long) k++;
        const next = info[k];
        if (!next || next.skip || next.start.long || next.codeEnd === -1 ||
          !LEADING_OP_RE.test(next.body.trimStart())) break;
        // Sniffed hybrid files: a decoration line (`=====`, `*** Loot ***`,
        // `<Loot>`) starts AND ends with an operator; a real continuation
        // (`.. "b"`, `* 5`) ends with an operand.
        if (!strict && TRAILING_OP_RE.test(tail(next))) break;
        j = k;
        pending = TRAILING_OP_RE.test(tail(next));
      }
      const kv = { ...buildLuaKeyval(info, i, j, m, container), tableId: 0 };
      // A chunk-level field sharing its (first or closing) line with a
      // `return` (`A = 1; return A`) ends the chunk too.
      if (!root) {
        const ret = chunkReturn(codeText(li)) ||
          (j > i && info[j].end.brace <= base && info[j].end.block <= 0 ? chunkReturn(codeText(info[j])) : null);
        if (ret) {
          kv.returnStmt = true;
          if (ret.value) kv.returnsValue = true;
        }
      }
      entries.push(kv);
      i = j;
      continue;
    }
    // Lua 結構語法（local X = {, }, return X, sub-table / function lines）
    const e: LuaStructureEntry = { type: 'lua_structure', raw: li.line, codeEnd: li.codeEnd };
    const ret = atChunkLevel(li) ? chunkReturn(codeText(li)) : null;
    if (ret) {
      // `return` ends the chunk — nothing may be inserted after this line.
      e.returnStmt = true;
      if (ret.value) e.returnsValue = true;
    }
    entries.push(e);
  }

  if (root) {
    const entryOfLine = (line: number): number => {
      for (let k = firstLine.length - 1; k >= 0; k--) if (firstLine[k] <= line) return k;
      return -1;
    };
    const o = entryOfLine(root.open);
    if (o !== -1) {
      const flag = root.oneLine ? (root.empty ? 'rootEmpty' : 'rootOneLine') : 'rootOpen';
      entries[o] = { ...entries[o], [flag]: true, rootKind: root.kind, rootName: root.name };
    }
    if (root.close !== -1) {
      const c = entryOfLine(root.close);
      if (c !== -1) entries[c] = { ...entries[c], rootClose: true };
    }
  }
  // Remember a hybrid (sniffed) parse, so the self-checks re-parse the same
  // way — a `;` comment read as code could otherwise shift block depth.
  if (!strict) for (const e of entries) e.hybrid = true;
  return entries;
}

function buildLuaKeyval(info: LineInfo[], i: number, j: number, m: RegExpExecArray, container: Container): KeyvalEntry {
  const first = info[i];
  const prefix = m[0];
  const vs = prefix.length;
  const base = { type: 'keyval' as const, key: m[2], syntax: 'lua' as const, format: 'lua' as const, container, prefix };
  // The entry's last line that has code — a trailing block comment's lines
  // have none. A missing separator would go right after that code.
  let lc = j;
  while (lc > i && info[lc].codeEnd === -1) lc--;
  const last = info[lc];
  const codeEnd = lc === i ? Math.max(first.codeEnd, vs) : last.codeEnd;
  let offset = 0;
  for (let k = i; k < lc; k++) offset += info[k].line.length + 1;
  const code = lc === i
    ? first.body.slice(vs, codeEnd)
    : [first.body.slice(vs), ...info.slice(i + 1, lc).map((li) => li.body), last.body.slice(0, codeEnd)].join('\n');
  const sepChar = code.slice(-1);
  const hadComma = sepChar === ',' || sepChar === ';';
  const value = (hadComma ? code.slice(0, -1) : code).trim();
  const trailing = last.body.slice(codeEnd);
  const common = {
    ...base,
    raw: info.slice(i, j + 1).map((li) => li.line).join('\n'),
    value,
    origValue: value,
    trailing,
    hadComma,
    sep: hadComma ? sepChar : ',',
    commaAt: offset + codeEnd,
  };

  if (i === j) {
    const scalar = parseLuaScalar(value);
    const shape = scanLuaValue(value);
    const readonly = value === '' || /^function\b/.test(value) || first.codeAfterComment ||
      shape.secondField || shape.bareEq || first.end.brace < first.start.brace || !!scalar?.unsupported ||
      !!parseLuaArrayItems(value)?.some(it => it.unsupported);
    return {
      ...common,
      value: scalar ? scalar.value : value,
      origValue: scalar ? scalar.value : value,
      isQuoted: !!scalar,
      quoteChar: scalar ? scalar.quoteChar : null,
      inlineDesc: describeTrailing(trailing),
      ...(readonly ? { readonly: true } : {}),
      ...(shape.assigns.length ? { assigns: shape.assigns } : {}),
    };
  }

  const firstTrail = first.commentAt === -1 ? '' : first.body.slice(first.commentAt);
  return {
    ...common,
    isQuoted: false,
    quoteChar: null,
    inlineDesc: describeTrailing(firstTrail) ?? describeTrailing(trailing),
    multiline: true,
    readonly: true,
  };
}

// 統一解析 config 檔案。opts.syntax: 'lua' | 'ini' | 'auto' (default — sniff).
export function parseConfigFile(text: string, opts: ParseOptions = {}): ConfigEntry[] {
  const syntax = opts.syntax === 'lua' || opts.syntax === 'ini' ? opts.syntax : detectSyntax(text);
  // A .lua file (syntax 'lua') is lexed as strict Lua; a sniffed one keeps the
  // hybrid comment rules. opts.strict overrides (the self-checks' re-parse).
  return syntax === 'ini' ? parseIni(text) : parseLua(text, opts.strict ?? opts.syntax === 'lua');
}

// How a parsed file is read: { kind, name } with kind 'ini', 'globals', or
// the root table's form — 'return' (`return {`), 'named' (`return Name`) or
// 'sole' (the only chunk-level table, no return) — and its name.
export function configModel(entries: ConfigEntry[]): ConfigModel {
  const root = entries.find(e => e.rootOpen || e.rootEmpty || e.rootOneLine);
  // parseLua sets rootKind / rootName together with the root flags.
  if (root) return { kind: root.rootKind!, name: root.rootName! };
  const kv = entries.find(e => e.type === 'keyval');
  if (kv?.format === 'ini' || entries.some(e => e.type === 'section' && !e.decorative)) return { kind: 'ini', name: null };
  return { kind: 'globals', name: null };
}
const modelKey = (entries: ConfigEntry[]): string => { const m = configModel(entries); return `${m.kind}:${m.name}`; };

// Literal for a rebuilt / new Lua line: strings are escaped; an unquoted
// empty value is never emitted bare (`Key = ,`).
function formatLuaLiteral(value: string, { isQuoted, quoteChar }: { isQuoted: boolean; quoteChar: string | null }): string {
  if (!isQuoted) return value.trim() === '' ? '""' : value;
  const q = quoteChar === "'" ? "'" : '"';
  return `${q}${escapeLuaString(value, q)}${q}`;
}

function serializeIniKeyval(e: KeyvalEntry, rawValue: string, raw: string): string {
  const cr = raw.endsWith('\r') ? '\r' : '';
  // INI has no escapes: a line break can't be part of a value (it would start
  // a new line of the file) — it is written as a space.
  const value = rawValue.replace(/\r\n|\r|\n/g, ' ');
  const prefix = e.prefix ?? `${leadingWs(raw)}${e.key} = `;
  let trailing = e.trailing || '';
  if (value.trim() === '' && !e.isQuoted) {
    // An emptied value is written as `Key =` / `Key=` (the line's own
    // prefix). A `;` comment stays (after a space, so it still reads as a
    // comment); a `#` / `--` one would read back as the value — dropped.
    const t = trailing.trimStart();
    return `${prefix.replace(/[ \t]+$/, '')}${t.startsWith(';') ? ` ${t}` : ''}${cr}`;
  }
  if (trailing && !/^[ \t]/.test(trailing)) trailing = ` ${trailing}`;
  const literal = iniLiteral(value, e.isQuoted ? e.quoteChar || '"' : null, trailing);
  return `${prefix}${literal}${trailing}${cr}`;
}

function serializeKeyval(e: KeyvalEntry): string {
  const raw = e.raw || '';
  // Untouched parsed line → emit `raw` verbatim. This preserves the exact
  // original formatting (spacing around `=`, single vs double quotes, and a
  // trailing `\r` on CRLF files). Readonly entries (multi-line values, two
  // statements on one line, functions) are never rebuilt.
  if (e.readonly || (e.origValue !== undefined && e.value === e.origValue)) return raw;
  const value = String(e.value ?? '');
  if ((e.syntax || e.format) === 'ini') return serializeIniKeyval(e, value, raw);
  // A Lua value cleared to nothing would write `Key = ,` — keep the line.
  if (!e.isQuoted && value.trim() === '' && e.origValue !== undefined) return raw;
  // Rebuild from the parsed pieces: the original `indent key = ` prefix, the
  // separator recorded at parse time (not re-derived from raw — with an
  // inline comment the raw line ends in the comment, not the comma), the
  // trailing comment, and the line's own EOL.
  const prefix = e.prefix ?? `${leadingWs(raw)}${e.key} = `;
  const comma = e.hadComma ? (e.sep || ',') : '';
  const cr = raw.endsWith('\r') ? '\r' : '';
  return `${prefix}${formatLuaLiteral(value, e)}${comma}${e.trailing || ''}${cr}`;
}

// 將結構化資料轉回文字
export function serializeConfig(entries: ConfigEntry[]): string {
  return entries.map((e) => (e.type === 'keyval' ? serializeKeyval(e) : e.raw)).join('\n');
}

// Build the sectionName → keyName → entryIndex lookup for the schema renderer.
// `hasStructuredSections` is true only when the file has a REAL section marker
// (an INI `[Section]` line). Decorative comment banners (`-- ====[ NAME ]====`,
// parsed with `decorative: true`) still bucket keys — schemas whose section ids
// match the banner names resolve via the exact hit — but they must NOT flip the
// file to "structured": Lua table keys share one flat namespace, and banner
// names rarely equal schema section ids (e.g. banner "UPGRADE STORAGE EXTRA
// CAPACITY" vs schema id "UpgradeStorage"). Treating banners as scopes made
// every key lookup miss and the editor rendered an empty schema.
//
// The map and its buckets are prototype-free: a key or section named
// `constructor` / `__proto__` is just a name. `sectionNames` lists every
// section marker's name — also a banner with no fields under it yet, which
// has no bucket but is still where its keys belong (resolveSectionName).
export function buildSectionKeyIndex(entries: ConfigEntry[]): SectionKeyIndex {
  const keyIndexMap: Record<string, KeyBucket> = Object.create(null);
  const sectionNames: string[] = [];
  let currentSection = '';
  let hasStructuredSections = false;
  entries.forEach((e, i) => {
    if (e.type === 'section') {
      currentSection = e.name || '';
      if (!e.decorative) hasStructuredSections = true;
      if (currentSection !== '' && !sectionNames.includes(currentSection)) sectionNames.push(currentSection);
    } else if (e.type === 'keyval') {
      if (!keyIndexMap[currentSection]) keyIndexMap[currentSection] = Object.create(null);
      const bucket = keyIndexMap[currentSection];
      const prev = bucket[e.key];
      // A repeat in the same table keeps the later line (Lua's last-wins); the
      // same name in two different Lua tables is ambiguous → null, which
      // resolveEntryIdx never binds.
      bucket[e.key] = prev === null || (prev !== undefined && (entries[prev] as KeyvalEntry).tableId !== e.tableId) ? null : i;
    }
  });
  return { keyIndexMap, hasStructuredSections, sectionNames };
}

// Own-property lookup, so an index built by hand as a plain object never
// yields an inherited member (`constructor`, `toString`).
const own = <T>(obj: Record<string, T> | null | undefined, key: string): T | undefined =>
  (obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

// Section names are compared case- and punctuation-insensitively, because a
// decorative banner is prose ("UPGRADE STORAGE EXTRA CAPACITY") while a schema
// section id is an identifier ("UpgradeStorage").
const normSection = (s: unknown): string => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Find the FILE's section name for a schema section id: exact, then normalized
// equality, then "the banner expands the id" prefix. A prefix hit only counts
// when exactly one banner matches — two candidates mean we can't tell them
// apart, and guessing would silently bind the row to the wrong block.
// Returns undefined when nothing matches confidently.
// Candidates are every section marker in the file, not only the ones that
// already hold a field.
function matchSectionByName({ keyIndexMap, sectionNames = [] }: SectionKeyIndex, sectionId: string): string | undefined {
  if (own(keyIndexMap, sectionId)) return sectionId;
  const want = normSection(sectionId);
  if (!want) return undefined;
  const names = [...new Set([...sectionNames, ...Object.keys(keyIndexMap)])].filter(n => n !== '');
  const exact = names.find(n => normSection(n) === want);
  if (exact !== undefined) return exact;
  const prefixed = names.filter(n => normSection(n).startsWith(want));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

// Resolve a schema (sectionId, keyName) to an entry index against the lookup
// built above. Structured (INI) configs get strict per-section scoping so a
// key name repeated under two `[Section]`s can't leak across scopes.
//
// Flat configs (no sections, or decorative banners only) try the banner whose
// name matches the schema section, then fall back to scanning every bucket —
// but ONLY when the key name is unique in the file. A key repeated under two
// banners (`Damage` under both `[ AK47 ]` and `[ M4 ]`) is ambiguous: the old
// first-hit scan bound both schema rows to the same entry, so the M4 row
// displayed AK47's value and editing it overwrote AK47's line. Unresolvable
// ambiguity returns undefined — the row is hidden rather than wired to the
// wrong line, matching how a real INI section behaves when it can't be found.
//
// A bucket entry of `null` (the name repeats in two different Lua tables) is
// ambiguous too: it stops the lookup without binding.
export function resolveEntryIdx(index: SectionKeyIndex, sectionId: string, keyName: string): number | undefined {
  const { keyIndexMap, hasStructuredSections } = index;
  const exact = own(own(keyIndexMap, sectionId), keyName);
  if (exact !== undefined) return exact ?? undefined;
  if (hasStructuredSections) return undefined;

  const byName = matchSectionByName(index, sectionId);
  const inBanner = byName === undefined ? undefined : own(own(keyIndexMap, byName), keyName);
  if (inBanner !== undefined) return inBanner ?? undefined;

  const owners = Object.values(keyIndexMap).filter(b => own(b, keyName) !== undefined);
  return owners.length === 1 ? own(owners[0], keyName) ?? undefined : undefined;
}

// entryIdx → { sectionId, keyName, keyDef } — the SAME binding the rendered
// rows use (resolveEntryIdx), so save-time clamping, the footer reset and the
// "all at defaults" check touch exactly the lines the rows show. Entries no
// schema key resolves to are absent. When two schema keys resolve to one entry
// the first in schema order wins.
export function buildEntryKeyDefMap(entries: ConfigEntry[], schema: ConfigSchema | null | undefined): Record<number, EntryKeyDef> {
  const map: Record<number, EntryKeyDef> = {};
  if (!schema?.sections) return map;
  const index = buildSectionKeyIndex(entries);
  for (const [sectionId, section] of Object.entries(schema.sections)) {
    for (const [keyName, keyDef] of Object.entries(section?.keys || {})) {
      if (!keyDef || typeof keyDef !== 'object') continue;
      const idx = resolveEntryIdx(index, sectionId, keyName);
      if (idx !== undefined && !(idx in map)) map[idx] = { sectionId, keyName, keyDef };
    }
  }
  return map;
}

// Tolerate common schema slips instead of crashing the editor: a section
// without `keys` is empty, a null / non-object key definition is skipped, and
// `options` written as plain values (["Easy","Hard"] / [1,2]) become {value}.
export function normalizeSchema(schema: RawConfigSchema | null | undefined): ConfigSchema | null | undefined {
  if (!schema || typeof schema !== 'object') return schema;
  const sections: Record<string, SchemaSection> = {};
  for (const [id, rawSection] of Object.entries(schema.sections || {})) {
    if (!rawSection || typeof rawSection !== 'object') continue;
    // Untrusted JSON: only the shape checks below make it a SchemaSection.
    const section = rawSection as Omit<SchemaSection, 'keys'> & { keys?: unknown };
    const keys: Record<string, SchemaKeyDef> = {};
    const rawKeys = section.keys && typeof section.keys === 'object' ? section.keys as Record<string, unknown> : {};
    for (const [keyName, rawDef] of Object.entries(rawKeys)) {
      if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) continue;
      const def = rawDef as Omit<SchemaKeyDef, 'options'> & { options?: unknown };
      if (def.options === undefined) { keys[keyName] = def as SchemaKeyDef; continue; }
      const options: SchemaOption[] = Array.isArray(def.options)
        ? def.options
          .filter((o: unknown) => o !== null && o !== undefined && (typeof o !== 'object' || 'value' in o))
          .map((o: SchemaOption | SchemaOptionValue) => (typeof o === 'object' ? o : { value: o }))
        : [];
      keys[keyName] = { ...def, options: options.length ? options : undefined };
    }
    sections[id] = { ...section, keys };
  }
  return { ...schema, sections };
}

// Map a schema section id onto the section name the file ACTUALLY uses, so
// writes land where resolveEntryIdx reads from. Needed because a decorative
// banner's text rarely equals the schema's section id ("UPGRADE STORAGE EXTRA
// CAPACITY" vs "UpgradeStorage") — appendKeyval matches section markers by
// name, so handing it the raw schema id silently missed and dumped every
// toggled-on key at the file bottom.
//
// Resolution order mirrors resolveEntryIdx so reads and writes agree: exact /
// normalized banner name first, then locate the section via one of the schema
// section's own keys. That sibling lookup only trusts a key that lives in
// exactly ONE bucket — an ambiguous key (same name under several banners)
// would otherwise point the append at whichever banner happened to come first.
// Falls back to the schema id when nothing resolves (sectionless files, or a
// section whose keys are all absent) — that's appendKeyval's existing "append
// after the last keyval" path.
export function resolveSectionName(index: SectionKeyIndex, sectionId: string, keyNames: string[] = []): string {
  const { keyIndexMap, hasStructuredSections } = index;
  if (own(keyIndexMap, sectionId) || hasStructuredSections) return sectionId;
  const byName = matchSectionByName(index, sectionId);
  if (byName !== undefined) return byName;
  for (const keyName of keyNames) {
    const owners = Object.entries(keyIndexMap).filter(([, b]) => own(b, keyName) !== undefined);
    if (owners.length === 1) return owners[0][0];
  }
  return sectionId;
}

// 判斷值類型 — every form isValidNumber accepts is a number: int is `-?\d+`
// only; `.5`, `3.`, `1e3`, `-2.5E-3` are float.
export function guessValueType(val: unknown): GuessedType {
  const s = String(val ?? '');
  if (s === 'true' || s === 'false') return 'bool';
  if (INT_RE.test(s)) return 'int';
  if (FLOAT_RE.test(s)) return 'float';
  return 'string';
}

// The first entry from index `from` through `to` that has code on it, or null.
// An entry with code on it. `codeEnd` is Lua-only; a missing one means no code.
const hasCode = (e: ConfigEntry): boolean => e.type === 'keyval' || (e.codeEnd ?? -1) >= 0;

function nextCodeEntry(entries: ConfigEntry[], from: number, to = entries.length - 1): ConfigEntry | null {
  for (let i = from; i <= to && i < entries.length; i++) {
    if (hasCode(entries[i])) return entries[i];
  }
  return null;
}

// A table line whose code starts with a field separator (`;B = 2`, `, C = 3`).
const leadsWithSeparator = (e: ConfigEntry | null | undefined): boolean => !!e && e.type !== 'keyval' && /^[ \t]*[,;]/.test(e.raw || '');

// Give a keyval a trailing comma (before any inline comment) so a field can
// follow it inside a table.
function withComma(e: KeyvalEntry): KeyvalEntry {
  const cr = /\r$/.test(e.raw) ? 1 : 0;
  const at = Number.isInteger(e.commaAt) ? e.commaAt : e.raw.length - cr - (e.trailing || '').length;
  return { ...e, raw: `${e.raw.slice(0, at)},${e.raw.slice(at)}`, hadComma: true, sep: ',' };
}

// The same entries with every parsed keyval back at its original value — the
// file's structure without the unsaved edits, for the self-checks below.
const structureOnly = (entries: ConfigEntry[]): ConfigEntry[] =>
  entries.map(e => (e.type === 'keyval' && e.origValue !== undefined && e.value !== e.origValue ? { ...e, value: e.origValue } : e));

const reparse = (entries: ConfigEntry[], syntax: ConfigSyntax): ConfigEntry[] =>
  parseConfigFile(serializeConfig(entries), { syntax, strict: syntax === 'lua' && !entries.some(e => e.hybrid) });

// Name of the real INI `[Section]` each entry sits in ('' before the first).
function iniScopes(entries: ConfigEntry[]): string[] {
  let cur = '';
  return entries.map(e => {
    if (e.type === 'section' && !e.decorative) cur = e.name || '';
    return cur;
  });
}

// Insert a new keyval entry into an existing entries list. Used by the
// schema-1.2 optional widget when the user toggles a key on — we have to
// add a real entry so the value gets serialized back to the config file.
//
// Placement depends on how the file is read (see configModel):
//   - Lua root table: after the last field of the `sectionHint` block inside
//     the table, else after the last field, else just before the table's
//     closing `}`. A one-line empty root (`local Config = {}`, `return {}`)
//     is expanded onto separate lines first. The last code line before the
//     new one (a field, a positional item, `["k"] = v`, a sub-table's `}`)
//     gets a trailing comma if it lacks one, and the new line ends with one.
//   - Lua globals: `Key = value` without a comma (unless the neighbouring
//     line carries one — a brace-less field list), after the last global and
//     before a chunk-level `return`.
//   - INI: no comma, inside the matching `[Section]` (created at the end if the
//     file has sections but not this one), copying a sibling's `=` spacing. An
//     empty value is written `Key =`; a value that would read back differently
//     bare (` ; x`, ` # x`) is quoted.
// New lines copy a sibling's indentation and use CRLF when the file does.
// `options.format` ('lua' | 'ini' | 'auto') only matters for a file with no
// keyvals and no root table to read the container from. `options.sectionId`
// (the schema section id, optional) is checked like `sectionHint` below.
//
// REFUSAL CONTRACT: when the key can't be added safely, appendKeyval returns
// the ORIGINAL `entries` array itself (same identity) — callers test
// `result === entries` to tell the user nothing was added. It refuses when:
//   - the root table is a one-line non-empty table (`local C = { A = 1 }`),
//     or has no closing line to insert before;
//   - the key can't be written as a plain key (a Lua keyword / non-identifier,
//     an INI key with `=`, whitespace, `;`, `#`, `[`, `]`);
//   - the target table / INI section already has a line for that key (the
//     row was ambiguous — another line would only shadow or be shadowed);
//   - the self-check fails: the result is serialized and re-parsed, and the
//     new key must come back as an editable field that resolveEntryIdx binds
//     (for `sectionHint` / `sectionId`) to exactly the inserted line, with the
//     file still read the same way (same model, same root table) and every
//     other field unchanged.
//
// `value` is always coerced to string because the rest of the editor
// stores entry values as strings.
export function appendKeyval(entries: ConfigEntry[], key: unknown, value: unknown, options: AppendOptions = {}): ConfigEntry[] {
  const { isQuoted = false, format = 'lua', sectionHint = null, sectionId = null } = options;
  const keyStr = String(key ?? '');
  const valueStr = String(value ?? '');
  const kvIdx: number[] = [];
  entries.forEach((e, i) => { if (e.type === 'keyval') kvIdx.push(i); });
  // kvIdx holds keyval positions only, so `entries[i] as KeyvalEntry` below is safe.
  const firstKv = kvIdx.length ? entries[kvIdx[0]] as KeyvalEntry : null;
  const hasRealSections = entries.some(e => e.type === 'section' && !e.decorative);
  const rootIdx = entries.findIndex(e => e.rootOpen || e.rootEmpty || e.rootOneLine);
  const container = firstKv?.container ||
    (rootIdx !== -1 ? 'table' : hasRealSections || format === 'ini' ? 'ini' : 'globals');
  const syntax = container === 'ini' ? 'ini' : 'lua';
  const nl = entries.some(e => /\r$/.test(e.raw || '')) ? '\r' : '';

  if (syntax === 'lua' ? !/^[A-Za-z_]\w*$/.test(keyStr) || LUA_KEYWORDS.has(keyStr)
    : !INI_KEY_RE.test(keyStr) || /^(--|\/\/)/.test(keyStr)) return entries;

  const openIdx = entries.findIndex(e => e.rootOpen);
  const closeIdx = entries.findIndex(e => e.rootClose);
  const expandIdx = container === 'table' ? entries.findIndex(e => e.rootEmpty) : -1;
  if (container === 'table' && expandIdx === -1 && (openIdx === -1 || closeIdx === -1)) return entries;
  const insideRoot = (idx: number) => openIdx < idx && idx <= closeIdx;

  // One Lua table (or the global namespace) per file: any existing line for
  // the key — its own, or a second statement on another field's readonly
  // line (`A = 1; Key = 2`) — means the row was ambiguous: refuse instead of
  // adding a shadow.
  if (syntax === 'lua' && kvIdx.some(i => {
    const e = entries[i] as KeyvalEntry;
    return e.key === keyStr || e.assigns?.includes(keyStr);
  })) return entries;
  // A globals file that returns a value (`return setmetatable(...)`,
  // `local Config = {}; return Config`) hands the mod what it returns — a new
  // global would never reach it, so don't write one.
  if (container === 'globals' && entries.some(e => e.returnsValue)) return entries;

  // The last field to insert after. Inside a Lua table that's the last line
  // with code, not just the last bound field — an unbound item after it
  // (`;B = 2`, `"x",`, `["k"] = v`) must stay before the new line, or its
  // leading separator would follow the new line's comma (`,;` doesn't parse).
  const isAnchor = (i: number) => entries[i].type === 'keyval' ||
    (container === 'table' && hasCode(entries[i]) && !entries[i].rootOpen && !entries[i].rootClose && insideRoot(i));
  const lastKvIn = (from: number, to: number) => {
    for (let i = to - 1; i >= from; i--) if (isAnchor(i)) return i;
    return -1;
  };
  // Appending at the very end goes before a final empty line so the file
  // keeps its trailing newline.
  let endIdx = entries.length;
  if (endIdx > 0 && entries[endIdx - 1].type === 'blank' && entries[endIdx - 1].raw === '') endIdx--;

  let insertIdx = -1;
  let newSection = false;

  if (expandIdx === -1) {
    const secStart = sectionHint
      ? entries.findIndex((e, i) => e.type === 'section' && e.name === sectionHint && (container !== 'table' || insideRoot(i)))
      : -1;
    if (secStart !== -1) {
      // The section ends at the next section marker or the root table's `}`.
      let secEnd = entries.length;
      for (let i = secStart + 1; i < entries.length; i++) {
        if (entries[i].type === 'section') { secEnd = i; break; }
        if (entries[i].rootClose) { secEnd = i + 1; break; }
      }
      const last = lastKvIn(secStart + 1, secEnd);
      insertIdx = last !== -1 ? last + 1 : secStart + 1;
    } else if (sectionHint && container === 'ini' && hasRealSections) {
      newSection = true;
      insertIdx = endIdx;
    }

    if (insertIdx === -1) {
      if (container === 'table') {
        const last = lastKvIn(openIdx + 1, closeIdx);
        insertIdx = last !== -1 ? last + 1 : closeIdx;
      } else if (kvIdx.length) insertIdx = kvIdx[kvIdx.length - 1] + 1;
      else if (container === 'globals') {
        const ret = entries.findIndex(e => e.returnStmt);
        insertIdx = ret !== -1 ? ret : endIdx;
      } else insertIdx = endIdx;
    }
    // Never past the line that closes the root table (it may be a field:
    // `B = 2 }`) — the new line goes before it.
    if (container === 'table' && insertIdx > closeIdx) insertIdx = closeIdx;
    // Nor past a chunk-level `return`: Lua requires it to be the last
    // statement, so a line after it doesn't load.
    if (container === 'globals') {
      const ret = entries.findIndex(e => e.returnStmt);
      if (ret !== -1 && insertIdx > ret) insertIdx = ret;
    }
    if (container === 'ini') {
      const scopes = iniScopes(entries);
      const scope = newSection ? sectionHint : scopes[Math.max(0, insertIdx - 1)] ?? '';
      if (kvIdx.some(i => (entries[i] as KeyvalEntry).key === keyStr && scopes[i] === scope)) return entries;
    }
  }

  // Indentation: the neighbouring field's, else the last code line's inside
  // the root table, else the first field's, else the root opener's + 4.
  const anchor = insertIdx > 0 ? entries[insertIdx - 1] : null;
  let indent = '';
  if (expandIdx !== -1) indent = `${leadingWs(entries[expandIdx].raw)}    `;
  else if (anchor?.type === 'keyval') indent = leadingWs(anchor.raw);
  else if (container === 'table') {
    let codeLine: ConfigEntry | null = null;
    for (let i = insertIdx - 1; i > openIdx && !codeLine; i--) {
      if (hasCode(entries[i])) codeLine = entries[i];
    }
    indent = codeLine ? leadingWs(codeLine.raw) : firstKv ? leadingWs(firstKv.raw) : `${leadingWs(entries[openIdx].raw)}    `;
  } else if (firstKv) indent = leadingWs(firstKv.raw);

  let eq = ' = ';
  const sibling = anchor?.type === 'keyval' ? anchor : firstKv;
  if (syntax === 'ini' && sibling?.prefix) {
    eq = sibling.prefix.slice(leadingWs(sibling.prefix).length + sibling.key.length) || ' = ';
  }

  let literal: string;
  let quoted: boolean;
  if (syntax === 'ini') {
    quoted = !!isQuoted && valueStr !== '';
    literal = valueStr.trim() === '' && !quoted ? '' : iniLiteral(valueStr, quoted ? '"' : null);
  } else {
    quoted = isQuoted || valueStr.trim() === '';
    literal = formatLuaLiteral(valueStr, { isQuoted: quoted, quoteChar: '"' });
  }
  // Table fields always end with a comma — unless the next code line in the
  // table starts with its own separator (`;B = 2`, `, C = 3`): `,;` doesn't
  // parse, so that separator follows the new field instead. Globals get none
  // — unless the file is a brace-less field list whose siblings end with
  // commas (a table body the mod wraps itself), whose own convention is kept.
  const nextCode = container === 'table' && expandIdx === -1 ? nextCodeEntry(entries, insertIdx, closeIdx) : null;
  const comma = (container === 'table' && !leadsWithSeparator(nextCode)) ||
    (container === 'globals' && sibling?.hadComma && sibling.sep === ',') ? ',' : '';
  const prefix = `${indent}${keyStr}${eq}`;
  const text = syntax === 'ini' && literal === '' ? prefix.replace(/[ \t]+$/, '') : `${prefix}${literal}${comma}`;
  const newEntry: KeyvalEntry = {
    type: 'keyval',
    raw: text,
    key: keyStr,
    value: valueStr,
    isQuoted: quoted,
    quoteChar: quoted ? '"' : null,
    syntax,
    format: syntax,
    container,
    prefix,
    inlineDesc: null,
    trailing: '',
    hadComma: !!comma,
    sep: ',',
    commaAt: prefix.length + literal.length,
    ...(syntax === 'lua' ? { tableId: 0 } : {}),
  };

  const out = entries.slice();
  let newIdx: number;
  if (expandIdx !== -1) {
    const e = entries[expandIdx];
    const cr = /\r$/.test(e.raw) ? '\r' : '';
    const body = cr ? e.raw.slice(0, -1) : e.raw;
    const open = body.indexOf('{');
    const close = body.indexOf('}', open);
    newEntry.raw += nl;
    const rootInfo = { ...e };
    delete rootInfo.rootEmpty;
    out.splice(expandIdx, 1,
      { ...rootInfo, type: 'lua_structure', raw: `${body.slice(0, open + 1)}${nl}`, rootOpen: true, codeEnd: open + 1 },
      newEntry,
      { type: 'lua_structure', raw: `${leadingWs(body)}${body.slice(close)}${cr}`, rootClose: true, codeEnd: leadingWs(body).length + 1 });
    newIdx = expandIdx + 1;
  } else {
    if (container === 'table') {
      // The last code line before the new one, inside the root table, must
      // end with a separator (or be the table's own `{`).
      for (let i = insertIdx - 1; i >= openIdx; i--) {
        const e = out[i];
        if (e.type === 'keyval') {
          if (!e.hadComma) out[i] = withComma(e);
          break;
        }
        if (e.codeEnd === undefined || !(e.codeEnd >= 0)) continue;
        const last = e.raw[e.codeEnd - 1];
        if (last !== ',' && last !== ';' && last !== '{') {
          out[i] = { ...e, raw: `${e.raw.slice(0, e.codeEnd)},${e.raw.slice(e.codeEnd)}`, codeEnd: e.codeEnd + 1 };
        }
        break;
      }
    }
    const toInsert: ConfigEntry[] = [];
    if (newSection) {
      if (insertIdx > 0 && entries[insertIdx - 1].type !== 'blank') toInsert.push({ type: 'blank', raw: '' });
      // newSection is only set when sectionHint is non-empty.
      toInsert.push({ type: 'section', raw: `[${sectionHint}]`, name: sectionHint! });
    }
    toInsert.push(newEntry);
    const atEnd = insertIdx >= entries.length;
    toInsert.forEach((e, k) => { if (!(atEnd && k === toInsert.length - 1)) e.raw += nl; });
    // Becoming the new last line: the old last line now needs its own EOL.
    if (atEnd && nl && insertIdx > 0 && !/\r$/.test(out[insertIdx - 1].raw)) {
      out[insertIdx - 1] = { ...out[insertIdx - 1], raw: `${out[insertIdx - 1].raw}\r` };
    }
    out.splice(insertIdx, 0, ...toInsert);
    newIdx = insertIdx + toInsert.length - 1;
  }

  return verifyAppend(entries, out, newIdx, { key: keyStr, value: valueStr, quoted, syntax, sectionHint, sectionId })
    ? out
    : entries;
}

// appendKeyval's self-check (see its REFUSAL CONTRACT).
interface AppendCheck {
  key: string;
  value: string;
  quoted: boolean;
  syntax: ConfigSyntax;
  sectionHint: string | null;
  sectionId: string | null;
}

function verifyAppend(before: ConfigEntry[], out: ConfigEntry[], newIdx: number,
  { key, value, quoted, syntax, sectionHint, sectionId }: AppendCheck): boolean {
  const probe = structureOnly(out);
  let line = 0;
  for (let k = 0; k < newIdx; k++) line += lineCount(probe[k].raw);
  let re: ConfigEntry[];
  try {
    re = reparse(probe, syntax);
  } catch {
    return false;
  }
  let reIdx = -1;
  for (let k = 0, l = 0; k < re.length && l <= line; l += lineCount(re[k].raw), k++) {
    if (l === line) { reIdx = k; break; }
  }
  const ne = re[reIdx];
  if (!ne || ne.type !== 'keyval' || ne.key !== key || ne.readonly) return false;
  if (ne.value !== value && (quoted || ne.value !== value.trim())) return false;
  if (syntax === 'lua' && modelKey(re) !== modelKey(reparse(structureOnly(before), syntax))) return false;
  const index = buildSectionKeyIndex(re);
  if (resolveEntryIdx(index, sectionHint ?? '', key) !== reIdx) return false;
  if (sectionId !== null && sectionId !== undefined && resolveEntryIdx(index, sectionId, key) !== reIdx) return false;
  const others = (list: ConfigEntry[], skip: number) => list
    .filter((e, k): e is KeyvalEntry => k !== skip && e.type === 'keyval')
    .map(e => `${e.key}\u0000${e.value}\u0000${!!e.readonly}`);
  const a = others(probe, newIdx);
  const b = others(re, reIdx);
  return a.length === b.length && a.every((s, k) => s === b[k]);
}

// Every line that defines the same key as entries[idx] in the same table: all
// of a Lua file's fields share one table (the root table, or the globals) —
// including a readonly line whose second statement assigns the key
// (`A = 1; Key = 2`) — and an INI key is scoped by its `[Section]`.
function sameKeyLines(entries: ConfigEntry[], idx: number): number[] {
  const target = entries[idx] as KeyvalEntry; // callers pass a keyval index
  if (target.format === 'ini') {
    const scopes = iniScopes(entries);
    return entries.map((e, k) => (e.type === 'keyval' && e.key === target.key && scopes[k] === scopes[idx] ? k : -1)).filter(k => k >= 0);
  }
  return entries.map((e, k) => (e.type === 'keyval' && e.format !== 'ini' &&
    (e.key === target.key || e.assigns?.includes(target.key)) ? k : -1)).filter(k => k >= 0);
}

// Remove every line of the keys at `idxs` (see sameKeyLines), so the mod
// really reads nil. Refuses — returns `entries` itself — when one of those
// lines is readonly (it may share its line with other code) or when the
// removal would change how the file is read (e.g. a globals file left with a
// single table would be re-read as that table's fields, or a lone global
// table losing its last field would turn into a plain global).
export function removeKeyvalsAt(entries: ConfigEntry[], idxs: number[]): ConfigEntry[] {
  // Every index in `drop` (and every idx past the first check) is a keyval.
  const kv = (k: number) => entries[k] as KeyvalEntry;
  const drop = new Set<number>();
  for (const idx of idxs) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= entries.length || entries[idx].type !== 'keyval') return entries;
    for (const k of sameKeyLines(entries, idx)) drop.add(k);
  }
  if (!drop.size || [...drop].some(k => kv(k).readonly)) return entries;
  // Inside a table, a removed field's successor that starts with its own
  // separator (`;B = 2`, `, C = 3`) would then follow `{` or the previous
  // field's separator — `{;` / `,;` don't parse.
  for (const k of drop) {
    if (kv(k).container !== 'table') continue;
    let n = k + 1;
    while (n < entries.length && (drop.has(n) || !hasCode(entries[n]))) n++;
    if (leadsWithSeparator(entries[n])) return entries;
  }
  const out = entries.filter((_, k) => !drop.has(k));
  if (kv(idxs[0]).format !== 'ini') {
    try {
      if (modelKey(reparse(structureOnly(out), 'lua')) !== modelKey(reparse(structureOnly(entries), 'lua'))) return entries;
    } catch {
      return entries;
    }
  }
  return out;
}

// Remove a key by the index resolveEntryIdx handed the row being toggled off
// — every line of that key in the same table goes (Lua's last-wins would
// otherwise bring an earlier duplicate back to life). Index-based on purpose:
// the old (key, sectionHint) filter re-derived the target by matching the
// schema's section id against the file's section names, which never matched
// for decorative banners, so toggling an optional key off silently did
// nothing. Same refusal contract as removeKeyvalsAt: the original array is
// returned when the key can't be removed safely.
export function removeKeyvalAt(entries: ConfigEntry[], idx: number): ConfigEntry[] {
  if (!Number.isInteger(idx) || idx < 0 || idx >= entries.length) return entries;
  if (entries[idx].type !== 'keyval') return entries;
  return removeKeyvalsAt(entries, [idx]);
}

// Remove keyval entries with the given key. When `sectionHint` is provided,
// only entries inside that section are removed — needed when the schema has
// the same key name under multiple sections (a flat key filter would also
// drop the unrelated sibling entries). Without `sectionHint`, falls back to
// flat removal for backwards-compat with sectionless config.lua schemas.
export function removeKeyval(entries: ConfigEntry[], key: string, sectionHint: string | null = null): ConfigEntry[] {
  if (!sectionHint) {
    return entries.filter(e => !(e.type === 'keyval' && e.key === key));
  }
  // If the file has no section marker matching the hint — the common case where
  // a schema groups keys under named sections but config.lua is flat (every key
  // lives in the '' bucket) — there's nothing to scope removal to. Fall back to
  // flat removal, otherwise the optional-key toggle-off silently does nothing.
  const hasMatchingSection = entries.some(e => e.type === 'section' && (e.name || '') === sectionHint);
  if (!hasMatchingSection) {
    return entries.filter(e => !(e.type === 'keyval' && e.key === key));
  }
  let currentSection = '';
  return entries.filter(e => {
    if (e.type === 'section') { currentSection = e.name || ''; return true; }
    if (e.type === 'keyval' && e.key === key && currentSection === sectionHint) return false;
    return true;
  });
}

// Decide whether a value of the given schema type is written as a quoted
// string. Numbers / bools / array-literals stay bare; textual types (color,
// keybind, text) are quoted. A select is quoted unless every option value is
// a number or boolean.
// `options` may still hold plain values (`["Easy", "Hard"]`) on a schema that
// hasn't been through normalizeSchema.
export function valueNeedsQuote(type: string | undefined, options?: unknown): boolean {
  if (type === 'select') {
    const values: unknown[] = Array.isArray(options)
      ? options.map((o: unknown) => (o && typeof o === 'object' ? (o as SchemaOption).value : o))
      : [];
    return !(values.length > 0 && values.every(v => typeof v === 'number' || typeof v === 'boolean'));
  }
  return type === 'string' || type === 'text' || type === 'color' || type === 'keybind';
}

const KNOWN_TYPES: ReadonlySet<string> = new Set<SchemaType>(['bool', 'int', 'float', 'string', 'text', 'color', 'keybind', 'select', 'list', 'multi-select']);

// A schema type the editor has a widget for (anything else is inferred).
export const isKnownType = (type: unknown): type is SchemaType => KNOWN_TYPES.has(type as string);

// Quoting for a value written under `keyDef`: a known schema type decides; an
// unknown or missing type keeps `fallback` (the line's existing quoting).
export function keyDefNeedsQuote(keyDef: SchemaKeyDef | null | undefined, fallback?: unknown): boolean {
  return keyDef && isKnownType(keyDef.type) ? valueNeedsQuote(keyDef.type, keyDef.options) : !!fallback;
}

// A close-quote is escaped only when preceded by an odd number of
// backslashes. Single-char lookback (`s[i-1] !== '\\'`) wrongly treats
// `\\"` (literal backslash + close quote) as escaped → merges items.
function isQuoteEscaped(s: string, idx: number): boolean {
  let count = 0;
  for (let j = idx - 1; j >= 0 && s[j] === '\\'; j--) count++;
  return count % 2 === 1;
}

// Parse a Lua-style array literal into its items: [{ text, bare }] — `text`
// is the decoded string for a quoted item, the item's code for a bare one.
// A quoted item with an escape we can't re-encode (\x41, \65, \u{..}, \z)
// also carries `unsupported: true` — its keyval is readonly, like a scalar
// string's. Returns null when the input doesn't look like an array literal.
// Quote-aware split on `,` and `;` (so separators inside strings don't break
// the parse); nested tables are not handled — list / multi-select widgets are
// flat by design.
export function parseLuaArrayItems(value: unknown): LuaArrayItem[] | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];
  const items: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (!inQuote && (c === '"' || c === "'")) { inQuote = true; quoteChar = c; current += c; }
    else if (inQuote && c === quoteChar && !isQuoteEscaped(inner, i)) { inQuote = false; quoteChar = null; current += c; }
    else if (!inQuote && (c === ',' || c === ';')) { items.push(current.trim()); current = ''; }
    else current += c;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items.map(raw => {
    const t = raw.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      const body = t.slice(1, -1);
      return { text: unescapeLuaString(body), bare: false, ...(hasUnsupportedEscape(body) ? { unsupported: true } : {}) };
    }
    return { text: t, bare: true };
  });
}

// Parse a Lua-style array literal like `{"a", "b", "c"}` into a JS string
// array. Returns null when the input doesn't look like an array literal,
// so callers can distinguish "empty list" from "not a list at all".
export function parseLuaArray(value: unknown): string[] | null {
  const items = parseLuaArrayItems(value);
  return items ? items.map(i => i.text) : null;
}

// Serialize an array back into a Lua array literal. Strings are double-quoted
// (escaped like any Lua string, so they round-trip through parseLuaArray);
// JS numbers and booleans are written bare, as is any item `isBare(item, i)`
// says to keep bare (e.g. an unchanged bare number from the file). Empty
// array becomes `{}`.
export function serializeLuaArray(arr: unknown, isBare: ((item: unknown, i: number) => boolean) | null = null): string {
  if (!Array.isArray(arr)) return '{}';
  if (arr.length === 0) return '{}';
  return '{' + arr.map((s: unknown, i: number) => {
    if ((typeof s === 'number' && Number.isFinite(s)) || typeof s === 'boolean') return String(s);
    if (isBare && isBare(s, i)) return String(s);
    return `"${escapeLuaString(s, '"')}"`;
  }).join(', ') + '}';
}
