// Display helpers for read-only config values — a value the parser can't
// rewrite safely (it spans several lines, shares its line with another
// assignment, or is a function). The editor never changes such a value; it
// only shows it. The raw Lua text is a poor preview on its own: a multi-line
// table collapses to `{ "Pistol", "Rifle", }` with a dangling comma, and
// `Width = 800, Height = 600` would show `800, Height = 600` in the Width row.
//
//   readonlyPreview(value)   one line for the row: whitespace collapsed,
//                            comments dropped, no separator before `}`, and
//                            only this key's own value (or an em dash)
//   readonlyFullValue(value) the whole value on one line (accessible name)
//   readonlyTooltip(value)   the value as written, de-indented (title)
//   valueShape(value)        'list' | 'table' | 'code' | null — for the badge
//   gateValue(entry)         the value enableKey / showWhen checks compare

export const READONLY_EMPTY = '—';

const LONG_OPEN = /\[(=*)\[/y;
const ARIA_MAX = 300;
const TOOLTIP_MAX_CHARS = 2000;
const TOOLTIP_MAX_LINES = 40;

interface Segment {
  kind: 'code' | 'string' | 'longstring' | 'comment';
  text: string;
}

/** Cleaned Lua text plus a per-character "is code" mask (false inside strings). */
interface Cleaned {
  text: string;
  mask: boolean[];
}

/** A top-level token: a word, or a single punctuation character `c`. */
interface TopToken {
  i: number;
  depth: number;
  word?: string;
  c?: string;
}

/** The fields of a config-parser keyval entry that gateValue reads. */
export interface GateEntry {
  value?: string;
  readonly?: boolean;
  isQuoted?: boolean;
}

export type ValueShape = 'list' | 'table' | 'code';

// Split Lua source into code / string / longstring / comment segments, so the
// cleanup below never touches a comma or brace inside a string or comment.
// An unterminated long bracket runs to the end of the value, an unterminated
// quoted string to the end of its line.
function lexSegments(src: string): Segment[] {
  const out: Segment[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'code', text: buf });
    buf = '';
  };
  // `at` is where a long bracket `[=*[` starts; returns its end index.
  const longEnd = (at: number): number => {
    LONG_OPEN.lastIndex = at;
    const m = LONG_OPEN.exec(src);
    if (!m) return -1;
    const close = src.indexOf(`]${m[1]}]`, at + m[0].length);
    return close === -1 ? src.length : close + m[1].length + 2;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      flush();
      let end = longEnd(i + 2);
      if (end === -1) {
        end = src.indexOf('\n', i);
        if (end === -1) end = src.length;
      }
      out.push({ kind: 'comment', text: src.slice(i, end) });
      i = end;
    } else if (c === '"' || c === "'") {
      flush();
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') {
        if (src[j] !== '\\') { j++; continue; }
        // `\z` skips the whitespace after it, line breaks included; a `\`
        // right before a line break continues the string on the next line.
        j += 2;
        if (src[j - 1] === 'z') while (j < src.length && /\s/.test(src[j])) j++;
      }
      j = Math.min(j + 1, src.length);
      out.push({ kind: 'string', text: src.slice(i, j) });
      i = j;
    } else if (c === '[' && longEnd(i) !== -1) {
      flush();
      const end = longEnd(i);
      out.push({ kind: 'longstring', text: src.slice(i, end) });
      i = end;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return out;
}

// Comments out, whitespace collapsed, `,` / `;` before a closing `}` dropped.
// Returns the text plus a per-character "is code" mask (false inside strings).
function cleanLua(value: unknown): Cleaned {
  const merged: Segment[] = [];
  for (const seg of lexSegments(String(value ?? ''))) {
    const s: Segment = seg.kind === 'comment' ? { kind: 'code', text: ' ' } : seg;
    const prev = merged[merged.length - 1];
    if (s.kind === 'code' && prev?.kind === 'code') prev.text += s.text;
    else merged.push({ ...s });
  }
  let text = '';
  const mask: boolean[] = [];
  for (const s of merged) {
    let t = s.text;
    if (s.kind === 'code') {
      t = t.replace(/\s+/g, ' ').replace(/[,;](\s*)\}/g, '$1}').replace(/\{\s+\}/g, '{}');
    } else if (s.kind === 'longstring') {
      t = t.replace(/\s+/g, ' ');
    } else if (t.includes('\n')) {
      // A quoted string continued over lines (`\z`, `\` + line break).
      t = t.replace(/\s*\n\s*/g, ' ');
    }
    text += t;
    for (let k = 0; k < t.length; k++) mask.push(s.kind === 'code');
  }
  // Trim — only code whitespace can sit at either end.
  let from = 0;
  let to = text.length;
  while (from < to && mask[from] && text[from] === ' ') from++;
  while (to > from && mask[to - 1] && text[to - 1] === ' ') to--;
  return { text: text.slice(from, to), mask: mask.slice(from, to) };
}

// Keywords that start a statement and can't occur inside an expression
// (`function` can: `x and function() … end`).
const STATEMENT_KW = new Set(['if', 'local', 'for', 'while', 'repeat', 'do', 'return', 'goto', 'break']);
// Block words, as the parser's lexer counts them.
const BLOCK_OPEN = new Set(['function', 'if', 'do', 'repeat']);
const BLOCK_CLOSE = new Set(['end', 'until']);

// The code tokens of a cleaned value that sit OUTSIDE function bodies (a
// body's `=`, `,` and keywords belong to its own statements): words as
// { i, word, depth } and punctuation as { i, c, depth }. `depth` is the
// bracket depth the token sits at (an opening bracket reports the depth
// outside it, a closing one the depth after it).
function topTokens({ text, mask }: Cleaned): TopToken[] {
  const out: TopToken[] = [];
  let depth = 0;
  let block = 0;
  for (let i = 0; i < text.length; i++) {
    if (!mask[i]) continue;
    const c = text[i];
    if (/[A-Za-z_]/.test(c) && (i === 0 || !mask[i - 1] || !/\w/.test(text[i - 1]))) {
      // c matched [A-Za-z_], so \w+ always matches here.
      const word = /^\w+/.exec(text.slice(i))![0];
      if (block > 0) {
        if (BLOCK_OPEN.has(word)) block++;
        else if (BLOCK_CLOSE.has(word)) block--;
      } else if (word === 'function') block = 1;
      else out.push({ i, word, depth });
      i += word.length - 1;
    } else if (block === 0) {
      if (c === '{' || c === '(' || c === '[') out.push({ i, c, depth: depth++ });
      else if (c === '}' || c === ')' || c === ']') out.push({ i, c, depth: --depth });
      else if (c === ',' || c === ';' || c === '=') out.push({ i, c, depth });
    }
  }
  return out;
}

// A bare `=` at text[i] — not part of `==`, `~=`, `<=`, `>=`.
const isAssign = (text: string, i: number): boolean => text[i + 1] !== '=' && !'=~<>'.includes(text[i - 1] || ' ');

// This key's own value out of a line that holds more than one statement:
// cut at the first top-level `,` / `;` (`800, Height = 600`), before the
// target of a second assignment (`800 Height = 600` — a bare `=` can't occur
// inside a Lua expression), before a statement keyword (`1 if A then …`), or
// at a closing bracket with no opener in the value (the root table's `}` in
// `Enabled = false }`).
function ownValue(cleaned: Cleaned): string {
  const { text, mask } = cleaned;
  const cut = (at: number) => text.slice(0, at).trim().replace(/[,;]$/, '').trim();
  for (const t of topTokens(cleaned)) {
    if (t.depth < 0) return cut(t.i);
    if (t.depth !== 0) continue;
    if (t.word) {
      if (t.i > 0 && STATEMENT_KW.has(t.word)) return cut(t.i);
    } else if (t.c === ',' || t.c === ';') {
      return cut(t.i);
    } else if (t.c === '=' && isAssign(text, t.i)) {
      // Back up over the second assignment's target.
      let j = t.i - 1;
      while (j >= 0 && text[j] === ' ') j--;
      if (j >= 0 && mask[j] && text[j] === ']') {
        // `["key"] = …` / `[1] = …` — back up to the matching `[`.
        let d = 0;
        for (; j >= 0; j--) {
          if (!mask[j]) continue;
          if (text[j] === ']') d++;
          else if (text[j] === '[' && --d === 0) { j--; break; }
        }
      } else {
        while (j >= 0 && mask[j] && /[\w.]/.test(text[j])) j--;
      }
      return cut(j + 1);
    }
  }
  return text;
}

/**
 * One-line preview of a read-only value for its row.
 * @param value entry.value
 * @param opts isQuoted: the value is a decoded string (show its text, never
 *   parse it as code)
 */
export function readonlyPreview(value: unknown, { isQuoted = false }: { isQuoted?: boolean } = {}): string {
  if (isQuoted) return String(value ?? '').replace(/\s+/g, ' ').trim() || READONLY_EMPTY;
  return ownValue(cleanLua(value)) || READONLY_EMPTY;
}

const cap = (s: string, max: number): string => {
  if (s.length <= max) return s;
  let end = max - 1;
  // Never split a surrogate pair (an emoji would leave a lone half).
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return `${s.slice(0, end).trimEnd()}…`;
};

/** The whole value on one line (comments dropped), for the accessible name. */
export function readonlyFullValue(value: unknown, { isQuoted = false }: { isQuoted?: boolean } = {}): string {
  const text = isQuoted ? String(value ?? '').replace(/\s+/g, ' ').trim() : cleanLua(value).text;
  return cap(text, ARIA_MAX) || READONLY_EMPTY;
}

/** The value as the file has it, de-indented and capped, for a title tooltip. */
export function readonlyTooltip(value: unknown): string {
  const lines = String(value ?? '').replace(/\r/g, '').split('\n');
  // The first line starts right after `Key =`; the rest carry the file's
  // indentation. Strip what they all share. (`[ \t]*` matches every line.)
  const indents = lines.slice(1).filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  let out = [lines[0].trim(), ...lines.slice(1).map((l) => l.slice(common).trimEnd())];
  if (out.length > TOOLTIP_MAX_LINES) out = [...out.slice(0, TOOLTIP_MAX_LINES), '…'];
  return cap(out.join('\n'), TOOLTIP_MAX_CHARS);
}

// A quoted string with nothing to decode, and a bare scalar (`false`, `5`,
// `-1.5`, `nil`).
const PLAIN_STRING = /^(["'])((?:(?!\1)[^\\\n])*)\1$/;
const PLAIN_SCALAR = /^[\w.+-]+$/;

/**
 * The value an enableKey / Enable* gate or a showWhen / "Active when"
 * dependency compares — an editable entry's value, or a read-only entry's own
 * value (`false` in `Enabled = false, Debug = false`, `Hard` in
 * `Mode = "Hard", Other = 1`). null when a read-only value isn't a plain
 * scalar (a table, a function, a string with escapes): such a value must
 * neither switch a gate on nor off.
 * @param entry a keyval entry
 */
export function gateValue(entry: GateEntry | null | undefined): string | null | undefined {
  if (!entry?.readonly) return entry?.value;
  // A read-only string is read-only mostly because it keeps an escape the
  // parser can't decode (`"\72ard"` stays `\72ard`) — its text isn't the
  // real value, so any backslash means "not a plain value".
  if (entry.isQuoted) return String(entry.value ?? '').includes('\\') ? null : entry.value;
  const own = ownValue(cleanLua(entry.value));
  const str = PLAIN_STRING.exec(own);
  if (str) return str[2];
  return PLAIN_SCALAR.test(own) ? own : null;
}

/**
 * The kind of a raw (unquoted) value: 'code' for a function, 'table' for a
 * table constructor with named fields, 'list' for one with only positional
 * items, null otherwise. Only this key's own value counts.
 */
export function valueShape(value: unknown): ValueShape | null {
  const own = ownValue(cleanLua(value));
  if (/^function\b/.test(own)) return 'code';
  if (!own.startsWith('{') || !own.endsWith('}')) return null;
  // Named field = a bare `=` directly inside the outer braces.
  const cleaned = cleanLua(own);
  const named = topTokens(cleaned).some((t) => t.c === '=' && t.depth === 1 && isAssign(cleaned.text, t.i));
  return named ? 'table' : 'list';
}
