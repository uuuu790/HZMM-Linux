import { useRef } from 'react';
import TypeBadge, { ReadonlyBadge } from './TypeBadge';
import { ReadonlyNote, ReadonlyValue, DEFAULT_READONLY_TEXT, READONLY_NOTE_ID } from './SchemaRow';
import { guessValueType } from '../../../utils/config-parser';
import { isValidNumber } from '../../../utils/widget-helpers';
import { readonlyPreview, valueShape, gateValue } from '../../../utils/readonly-preview';

// Comment-driven renderer — legacy fallback for mods that don't ship a
// hzmm.config.json schema. It parses the surrounding comments to infer:
//   - Description: "KeyName - desc" or lang-tagged "KeyName.zh-TW - desc"
//   - Options: repeated `"value" : desc` comment lines (≥2 → select)
//   - Active-when dependency: `Key = "Value"` in a preceding comment
//   - Section enable: any `Enable*` keyval with value=false disables siblings
//     (really disabled — <fieldset disabled> — not just unclickable)
//
// The value type comes from the ORIGINAL value, so typing into a number
// field can't flip it to text; a quoted value is text even when it looks like
// a number ("1234"). A number field that holds something that isn't a number
// on blur reverts to the last valid value. Readonly entries (multi-line
// values, two assignments on one line) show a read-only preview and a
// "Read-only" pill; one ReadonlyNote at the top explains them. A table value
// is badged LIST / TABLE, a function CODE.
//
// Used when ConfigEditorModal can't find a schema file for the mod.

// Keys and language codes go into the description regexes literally — an INI
// key may hold regex syntax (`+Paths`, `C++`), which would otherwise throw
// and take the whole renderer down.
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Widget type of a comment-mode row, from the value as the file had it. Only
// an unquoted number is numeric. A read-only line is typed by this key's own
// value (`800` in `Width = 800, Height = 600`).
export function commentValueType(entry) {
  if (entry.isQuoted) return 'string';
  const raw = entry.origValue ?? entry.value;
  return guessValueType(entry.readonly ? readonlyPreview(raw) : raw);
}

export default function CommentModeRenderer({ entries, lang, onUpdateValue, readonlyText = DEFAULT_READONLY_TEXT }) {
  // entry index → last valid number typed (or the value at focus).
  const lastValid = useRef({});
  const hasReadonly = entries.some(e => e.type === 'keyval' && e.readonly);
  return (
    <div className="flex flex-col gap-1">
      {/* First in the column: a section header after it keeps its mt-3, so
          the gap below the note matches the schema editor's. */}
      {hasReadonly && <ReadonlyNote text={readonlyText} />}
      {entries.map((entry, idx) => {
        if (entry.type === 'section') {
          // 只顯示下方有 keyval 的 section
          let hasKeys = false;
          for (let j = idx + 1; j < entries.length; j++) {
            if (entries[j].type === 'section') break;
            if (entries[j].type === 'keyval') { hasKeys = true; break; }
          }
          if (!hasKeys) return null;
          return (
            <div key={idx} className="mt-3 mb-1 first:mt-0">
              <h4 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-500)' }}>{entry.name}</h4>
              <div className="h-px mt-1" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.2)' }} />
            </div>
          );
        }
        if (entry.type !== 'keyval') return null;

        const valType = commentValueType(entry);
        const isNumeric = valType === 'int' || valType === 'float';
        const globalIdx = idx;
        // Badge: a table / function value says so instead of TEXT.
        const shape = entry.isQuoted ? null : valueShape(entry.origValue ?? entry.value);

        // 取得描述：往上搜尋 "KeyName - ..." 或 "KeyName.lang - ..." 格式的註解
        // 多語言：優先 "KeyName.zh-TW - ..." 格式，fallback 到 "KeyName - ..."
        let description = null;
        let descriptionFallback = null;
        for (let i = idx - 1; i >= 0; i--) {
          const e = entries[i];
          if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure') break;
          if (e.type !== 'comment' || !e.text) continue;
          // Try language-specific: "KeyName.zh-TW - description"
          if (lang) {
            const ml = e.text.match(new RegExp(`^${escapeRegExp(entry.key)}\\.${escapeRegExp(lang)}\\s*[-:–—]\\s*(.+)`, 'i'));
            if (ml) { description = ml[1].trim(); break; }
          }
          // Fallback: "KeyName - description" (no language tag)
          if (!descriptionFallback) {
            const m = e.text.match(new RegExp(`^${escapeRegExp(entry.key)}\\s*[-:–—]\\s*(.+)`, 'i'));
            if (m) descriptionFallback = m[1].trim();
          }
        }
        if (!description) description = descriptionFallback;
        // 沒找到，取上方緊鄰 comment block 最頂部的描述
        if (!description) {
          for (let i = idx - 1; i >= 0; i--) {
            const e = entries[i];
            if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
            if (e.type === 'comment' && !e.text) break;
            if (e.type === 'comment' && e.text) description = e.text;
          }
        }
        // 行內註解
        if (!description && entry.inlineDesc) {
          description = entry.inlineDesc;
        }
        // 往下找描述
        if (!description) {
          for (let i = idx + 1; i < entries.length; i++) {
            const e = entries[i];
            if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
            if (e.type === 'comment' && !e.text) continue;
            if (e.type === 'comment' && e.text) { description = e.text; break; }
          }
        }
        // fallback: key 名稱轉可讀格式
        if (!description) {
          description = entry.key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
        }
        if (description.length > 60) description = description.slice(0, 60) + '...';

        // 從上方註解偵測選項列表（"value" : desc 和 "value".lang : desc 格式）
        let options = null;
        if (valType === 'string' && !entry.readonly && !shape) {
          const optMap = new Map();
          for (let i = idx - 1; i >= 0; i--) {
            const e = entries[i];
            if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
            if (e.type === 'comment' && e.text) {
              if (lang) {
                const mlMatch = e.text.match(new RegExp(`^"(.+?)"\\s*\\.\\s*${escapeRegExp(lang)}\\s*[:：\\-–—]\\s*(.+)`, 'i'));
                if (mlMatch) {
                  const existing = optMap.get(mlMatch[1]) || {};
                  existing.langDesc = mlMatch[2].trim();
                  optMap.set(mlMatch[1], existing);
                  continue;
                }
              }
              const optMatch = e.text.match(/^"(.+?)"\s*[:：\-–—]\s*(.+)/);
              if (optMatch) {
                const existing = optMap.get(optMatch[1]) || {};
                if (!existing.defaultDesc) existing.defaultDesc = optMatch[2].trim();
                optMap.set(optMatch[1], existing);
              }
            }
          }
          if (optMap.size >= 2) {
            options = [...optMap.entries()].reverse().map(([value, descs]) => ({
              value,
              label: descs.langDesc || descs.defaultDesc || value
            }));
          }
        }

        // 偵測條件依賴
        let isDisabled = false;

        // Both checks compare a read-only line's own value (gateValue:
        // `false` in `EnableX = false, Other = 1`); null never gates.
        // 1. 明確註解：Active when Key = "Value"
        for (let i = idx - 1; i >= 0; i--) {
          const e = entries[i];
          if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
          if (e.type === 'comment' && e.text) {
            const depMatch = e.text.match(/(\w+)\s*=\s*"(.+?)"/);
            if (depMatch) {
              const depEntry = entries.find(en => en.type === 'keyval' && en.key === depMatch[1]);
              const depValue = gateValue(depEntry);
              if (depEntry && depValue !== null && depValue !== depMatch[2]) isDisabled = true;
              break;
            }
          }
        }

        // 2. Section Enable 開關
        if (!isDisabled && !entry.key.match(/^Enable/i)) {
          for (let i = idx - 1; i >= 0; i--) {
            if (entries[i].type === 'section') break;
            if (entries[i].type === 'keyval' && entries[i].key.match(/^Enable/i)) {
              if (gateValue(entries[i]) === 'false') isDisabled = true;
              break;
            }
          }
        }

        // A row switched off by its Enable* key / dependency never writes.
        const update = (v) => { if (!isDisabled) onUpdateValue(globalIdx, v); };

        return (
          <div key={idx} className={`flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-opacity duration-300 ${isDisabled ? 'opacity-30' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{entry.key}</label>
                <TypeBadge type={shape || valType} hasOptions={!!options} />
                {entry.readonly && <ReadonlyBadge label={readonlyText.badge} hint={readonlyText.hint} />}
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-snug">{description}</p>
            </div>
            <fieldset
              disabled={isDisabled}
              className={`shrink-0 w-44 min-w-0 transition-all duration-300 ${isDisabled ? 'pointer-events-none select-none' : ''}`}
            >
              {entry.readonly ? (
                <ReadonlyValue
                  value={entry.value}
                  isQuoted={!!entry.isQuoted}
                  label={entry.key}
                  hint={readonlyText.hint}
                  describedBy={READONLY_NOTE_ID}
                />
              ) : valType === 'bool' ? (
                <button
                  type="button"
                  aria-pressed={entry.value === 'true'}
                  aria-label={entry.key}
                  disabled={isDisabled}
                  onClick={() => update(entry.value === 'true' ? 'false' : 'true')}
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${entry.value !== 'true' ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                  style={entry.value === 'true' ? { backgroundColor: 'var(--accent-500)' } : undefined}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${entry.value === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              ) : options ? (
                <div className="grid gap-1.5 justify-end" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
                  {options.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={opt.value === entry.value}
                      disabled={isDisabled}
                      onClick={() => update(opt.value)}
                      className={`py-1.5 text-xs font-bold rounded-full text-center transition-all duration-300 active:scale-90 ${
                        opt.value !== entry.value ? 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/50 dark:border-slate-700/50' : 'text-white border border-transparent'
                      }`}
                      style={opt.value === entry.value ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 8px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
                    >
                      {opt.value}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  inputMode={valType === 'int' ? 'numeric' : valType === 'float' ? 'decimal' : 'text'}
                  value={entry.value}
                  aria-label={entry.key}
                  disabled={isDisabled}
                  onChange={(e) => {
                    if (isNumeric && isValidNumber(e.target.value, 'float')) lastValid.current[globalIdx] = e.target.value;
                    update(e.target.value);
                  }}
                  className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 transition-all duration-200"
                  style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--accent-400)';
                    lastValid.current[globalIdx] = entry.value;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '';
                    const last = lastValid.current[globalIdx] ?? entry.origValue;
                    if (isNumeric && !isValidNumber(e.target.value, 'float') && last !== e.target.value) update(last);
                  }}
                />
              )}
            </fieldset>
          </div>
        );
      })}
    </div>
  );
}
