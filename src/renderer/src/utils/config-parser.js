// Mod config file parser / serializer.
//
// Supports INI, Lua, and hybrid formats. The parser emits a flat list of
// "entries" (keyval / comment / section / blank / lua_structure) that
// preserves enough of the original formatting to round-trip unmodified
// lines verbatim on serialize. That's intentional — config files often
// come from mod authors who care about whitespace, decoration, and inline
// comments, and the ConfigEditor UI only mutates `keyval.value`.
//
// Extracted from ConfigEditorModal.jsx as part of the 672-line split.

// i18n helper: resolve localized string from { en: "...", "zh-TW": "..." } objects
export function resolveI18n(obj, lang) {
  if (!obj || typeof obj === 'string') return obj || '';
  return obj[lang] || obj['en'] || Object.values(obj)[0] || '';
}

// Find index of inline Lua `-- comment` while skipping content inside
// quoted strings. Returns -1 if no inline comment present. Mirrors the
// original `/(\s+--\s*.*)$/` semantics: requires whitespace before `--`.
function findInlineCommentStart(s) {
  let inQuote = false;
  let quoteChar = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === '\\' && i + 1 < s.length) { i++; continue; }
      if (c === quoteChar) { inQuote = false; quoteChar = null; }
    } else {
      if (c === '"' || c === "'") { inQuote = true; quoteChar = c; }
      else if ((c === ' ' || c === '\t') && s[i + 1] === '-' && s[i + 2] === '-') {
        return i;
      }
    }
  }
  return -1;
}

// 統一解析 config 檔案（支援 INI / Lua / 混合格式）
export function parseConfigFile(text) {
  const lines = text.split('\n');
  const entries = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行
    if (trimmed === '') { entries.push({ type: 'blank', raw: line }); continue; }

    // Lua block comment --[[ ... ]]
    if (trimmed.includes('--[[') && !inBlockComment) {
      const openIdx = trimmed.indexOf('--[[');
      const closeIdx = trimmed.indexOf(']]', openIdx + 4);
      if (closeIdx !== -1) {
        // 單行 block comment — 嘗試提取 section 名稱 --[[▓▓[ NAME ]▓▓--]]
        const inner = trimmed.slice(openIdx + 4, closeIdx);
        const secMatch = inner.match(/\[\s*(.+?)\s*\]/);
        if (secMatch) {
          const name = secMatch[1].replace(/\s*[-–—]\s*\(.+\)\s*$/, '').trim();
          entries.push({ type: 'section', raw: line, name });
        } else {
          entries.push({ type: 'comment', raw: line, text: '' });
        }
        continue;
      }
      inBlockComment = true;
      entries.push({ type: 'comment', raw: line, text: '' });
      continue;
    }
    if (inBlockComment) { if (trimmed.includes(']]')) inBlockComment = false; entries.push({ type: 'comment', raw: line, text: '' }); continue; }

    // 各種單行註解（-- ; # //）
    if (trimmed.startsWith('--') || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      let commentBody = trimmed.replace(/^(--|;|#|\/\/)\s*/, '');
      // 偵測 section header: -- ====[ NAME ]==== 或 # ====[ NAME ]====
      const secInComment = commentBody.match(/^\W*\[\s*(.+?)\s*\]\W*$/);
      if (secInComment) {
        const name = secInComment[1].replace(/\s*[-–—]\s*\(.+\)\s*$/, '').trim();
        entries.push({ type: 'section', raw: line, name });
        continue;
      }
      // 分隔線、裝飾線、純符號行 → 不顯示文字
      const isDecorative = /^[=\-~*.#[\](){}<>/\\|_\s]+$/.test(commentBody) || commentBody.startsWith('=') || commentBody === '';
      entries.push({ type: 'comment', raw: line, text: isDecorative ? '' : commentBody });
      continue;
    }

    // Lua 結構語法（local X = {, }, return X）
    if (trimmed.match(/^local\s+\w+\s*=\s*\{/) || trimmed === '{' || trimmed === '}' || trimmed.match(/^return\s+\w/)) {
      entries.push({ type: 'lua_structure', raw: line }); continue;
    }

    // INI section [SectionName]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      entries.push({ type: 'section', raw: line, name: trimmed.slice(1, -1) }); continue;
    }

    // key = value（通用，支援 INI 和 Lua）
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+?),?\s*$/);
    if (kvMatch) {
      let value = kvMatch[2].trim();
      if (value.endsWith(',')) value = value.slice(0, -1).trim();

      // 提取行內註解 (-- comment)，保留原始尾段以便存回。
      // 注意：偵測 `--` 時要 skip 引號內部，否則像 `Desc = "TODO -- fix"`
      // 會把 `--` 誤認為註解、把 value 切成 `"TODO`、round-trip 後損壞。
      let inlineDesc = null;
      let trailing = '';
      const dashIdx = findInlineCommentStart(value);
      if (dashIdx !== -1) {
        trailing = value.slice(dashIdx);
        value = value.slice(0, dashIdx).trim();
        const descText = trailing.replace(/^.*?--\s*/, '').trim();
        inlineDesc = descText.replace(/^\d+\s*[-–—]\s*/, '').trim() || null;
      }

      // 去掉引號取裸值
      const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      const bareValue = isQuoted ? value.slice(1, -1) : value;
      // 判斷原始格式（有逗號結尾或在 Lua 結構內 → lua）
      const isLua = line.match(/,\s*$/) || text.includes('--[[');
      entries.push({ type: 'keyval', raw: line, key: kvMatch[1], value: bareValue, isQuoted, format: isLua ? 'lua' : 'ini', inlineDesc, trailing });
      continue;
    }

    // 其他 → 當註解處理
    entries.push({ type: 'comment', raw: line, text: '' });
  }
  return entries;
}

// 將結構化資料轉回文字
export function serializeConfig(entries) {
  return entries.map((e) => {
    if (e.type === 'keyval') {
      const indent = e.raw.match(/^(\s*)/)?.[1] || '';
      const val = e.isQuoted ? `"${e.value}"` : e.value;
      const comma = e.format === 'lua' && e.raw.match(/,\s*$/) ? ',' : '';
      const trail = e.trailing || '';
      return `${indent}${e.key} = ${val}${comma}${trail}`;
    }
    return e.raw;
  }).join('\n');
}

// 判斷值類型
export function guessValueType(val) {
  if (val === 'true' || val === 'false') return 'bool';
  if (/^-?\d+$/.test(val)) return 'int';
  if (/^-?\d+\.\d+$/.test(val)) return 'float';
  return 'string';
}

// Insert a new keyval entry into an existing entries list. Used by the
// schema-1.2 optional widget when the user toggles a key on — we have to
// add a real entry so the value gets serialized back to config.lua.
//
// Placement strategy:
//   - If `sectionHint` is provided AND the parsed entries contain a
//     matching `type: 'section'` marker (e.g. a `-- [BP_AK47Rifle]`
//     comment), insert the new entry inside that section, right after
//     the section's last keyval (or at the section start if it had
//     none yet). This keeps related keys grouped — without it, a user
//     toggling on AK47.Damage gets the new line dumped at the file
//     bottom instead of inside the BP_AK47Rifle block.
//   - Otherwise: insert after the file's last keyval, falling back to
//     just-before-closing-brace, falling back to end.
//
// `value` is always coerced to string because the rest of the editor
// stores entry values as strings.
export function appendKeyval(entries, key, value, options = {}) {
  const { isQuoted = false, format = 'lua', sectionHint = null } = options;
  const valueStr = String(value);
  const literal = isQuoted ? `"${valueStr}"` : valueStr;
  const trailingComma = format === 'lua' ? ',' : '';
  const newEntry = {
    type: 'keyval',
    raw: `${key} = ${literal}${trailingComma}`,
    key,
    value: valueStr,
    isQuoted,
    format,
    inlineDesc: null,
    trailing: '',
  };

  let insertIdx = -1;

  if (sectionHint) {
    // Find the section marker matching the hint.
    let sectionStart = -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].type === 'section' && entries[i].name === sectionHint) {
        sectionStart = i;
        break;
      }
    }
    if (sectionStart !== -1) {
      // Find where this section ends — at the next section marker, or
      // at the closing `}` of the table, whichever comes first.
      let sectionEnd = entries.length;
      for (let i = sectionStart + 1; i < entries.length; i++) {
        const e = entries[i];
        if (e.type === 'section') { sectionEnd = i; break; }
        if (e.type === 'lua_structure' && e.raw.trim() === '}') { sectionEnd = i; break; }
      }
      // Insert after the section's last keyval, otherwise immediately
      // after the section header.
      for (let i = sectionEnd - 1; i > sectionStart; i--) {
        if (entries[i].type === 'keyval') { insertIdx = i + 1; break; }
      }
      if (insertIdx === -1) insertIdx = sectionStart + 1;
    }
  }

  if (insertIdx === -1) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'keyval') { insertIdx = i + 1; break; }
    }
  }
  if (insertIdx === -1) {
    const closeIdx = entries.findIndex(e => e.type === 'lua_structure' && e.raw.trim() === '}');
    insertIdx = closeIdx !== -1 ? closeIdx : entries.length;
  }

  // Inherit indentation from the nearest preceding line so the new
  // line visually slots in. Without this the new key looks like an
  // outdented stranger next to its 2-space-indented siblings.
  let indent = '';
  for (let i = insertIdx - 1; i >= 0; i--) {
    const prev = entries[i];
    if (prev.type === 'blank') continue;
    const m = (prev.raw || '').match(/^([ \t]+)/);
    if (m) indent = m[1];
    break;
  }
  if (indent) newEntry.raw = `${indent}${newEntry.raw}`;

  return [...entries.slice(0, insertIdx), newEntry, ...entries.slice(insertIdx)];
}

// Remove keyval entries with the given key. When `sectionHint` is provided,
// only entries inside that section are removed — needed when the schema has
// the same key name under multiple sections (a flat key filter would also
// drop the unrelated sibling entries). Without `sectionHint`, falls back to
// flat removal for backwards-compat with sectionless config.lua schemas.
export function removeKeyval(entries, key, sectionHint = null) {
  if (!sectionHint) {
    return entries.filter(e => !(e.type === 'keyval' && e.key === key));
  }
  let currentSection = '';
  return entries.filter(e => {
    if (e.type === 'section') { currentSection = e.name || ''; return true; }
    if (e.type === 'keyval' && e.key === key && currentSection === sectionHint) return false;
    return true;
  });
}

// Decide whether a value of the given schema type should be quoted when
// serialized back into Lua. Numbers / bools / array-literals stay bare;
// everything textual (color, keybind, generic strings) gets double-quoted.
export function valueNeedsQuote(type) {
  return type === 'string' || type === 'text' || type === 'color' || type === 'keybind';
}

// A close-quote is escaped only when preceded by an odd number of
// backslashes. Single-char lookback (`s[i-1] !== '\\'`) wrongly treats
// `\\"` (literal backslash + close quote) as escaped → merges items.
function isQuoteEscaped(s, idx) {
  let count = 0;
  for (let j = idx - 1; j >= 0 && s[j] === '\\'; j--) count++;
  return count % 2 === 1;
}

// Parse a Lua-style array literal like `{"a", "b", "c"}` into a JS string
// array. Returns null when the input doesn't look like an array literal,
// so callers can distinguish "empty list" from "not a list at all".
//
// Quote-aware split (so commas inside strings don't break the parse).
// Doesn't try to handle nested tables — multi-select / list widgets are
// flat string arrays by design.
export function parseLuaArray(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') return [];
  const items = [];
  let current = '';
  let inQuote = false;
  let quoteChar = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (!inQuote && (c === '"' || c === "'")) { inQuote = true; quoteChar = c; current += c; }
    else if (inQuote && c === quoteChar && !isQuoteEscaped(inner, i)) { inQuote = false; quoteChar = null; current += c; }
    else if (!inQuote && c === ',') { items.push(current.trim()); current = ''; }
    else current += c;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items.map(raw => {
    const t = raw.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return unescapeLuaString(t.slice(1, -1));
    }
    return t;
  });
}

// Single-pass unescape for the subset of Lua escape sequences we emit:
// `\\` → `\`, `\"` → `"`, `\'` → `'`. Anything else stays literal.
function unescapeLuaString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === '\\' || next === '"' || next === "'") { out += next; i++; continue; }
    }
    out += s[i];
  }
  return out;
}

// Serialize a JS string array back into a Lua array literal. Always
// double-quotes each item and escapes inner quotes. Empty array becomes
// `{}`.
export function serializeLuaArray(arr) {
  if (!Array.isArray(arr)) return '{}';
  if (arr.length === 0) return '{}';
  // Escape backslash BEFORE quote so `\` → `\\` doesn't double-escape the
  // quote we just wrote. Pair with parseLuaArray's escape-aware close-quote
  // detection so values containing `\` round-trip cleanly.
  return '{' + arr.map(s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ') + '}';
}
