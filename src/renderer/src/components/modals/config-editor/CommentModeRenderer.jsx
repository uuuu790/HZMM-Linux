import TypeBadge from './TypeBadge';
import { guessValueType } from '../../../utils/config-parser';

// Comment-driven renderer — legacy fallback for mods that don't ship a
// hzmm.config.json schema. It parses the surrounding comments to infer:
//   - Description: "KeyName - desc" or lang-tagged "KeyName.zh-TW - desc"
//   - Options: repeated `"value" : desc` comment lines (≥2 → select)
//   - Active-when dependency: `Key = "Value"` in a preceding comment
//   - Section enable: any `Enable*` keyval with value=false disables siblings
//
// Used when ConfigEditorModal can't find a schema file for the mod.

export default function CommentModeRenderer({ entries, lang, onUpdateValue }) {
  return (
    <div className="flex flex-col gap-1">
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

        const valType = guessValueType(entry.value);
        const globalIdx = idx;

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
            const ml = e.text.match(new RegExp(`^${entry.key}\\.${lang}\\s*[-:–—]\\s*(.+)`, 'i'));
            if (ml) { description = ml[1].trim(); break; }
          }
          // Fallback: "KeyName - description" (no language tag)
          if (!descriptionFallback) {
            const m = e.text.match(new RegExp(`^${entry.key}\\s*[-:–—]\\s*(.+)`, 'i'));
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
        if (valType === 'string') {
          const optMap = new Map();
          for (let i = idx - 1; i >= 0; i--) {
            const e = entries[i];
            if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
            if (e.type === 'comment' && e.text) {
              if (lang) {
                const mlMatch = e.text.match(new RegExp(`^"(.+?)"\\s*\\.\\s*${lang}\\s*[:：\\-–—]\\s*(.+)`, 'i'));
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

        // 1. 明確註解：Active when Key = "Value"
        for (let i = idx - 1; i >= 0; i--) {
          const e = entries[i];
          if (e.type === 'keyval' || e.type === 'section' || e.type === 'lua_structure' || e.type === 'blank') break;
          if (e.type === 'comment' && e.text) {
            const depMatch = e.text.match(/(\w+)\s*=\s*"(.+?)"/);
            if (depMatch) {
              const depEntry = entries.find(en => en.type === 'keyval' && en.key === depMatch[1]);
              if (depEntry && depEntry.value !== depMatch[2]) isDisabled = true;
              break;
            }
          }
        }

        // 2. Section Enable 開關
        if (!isDisabled && !entry.key.match(/^Enable/i)) {
          for (let i = idx - 1; i >= 0; i--) {
            if (entries[i].type === 'section') break;
            if (entries[i].type === 'keyval' && entries[i].key.match(/^Enable/i)) {
              if (entries[i].value === 'false') isDisabled = true;
              break;
            }
          }
        }

        return (
          <div key={idx} className={`flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-opacity duration-300 ${isDisabled ? 'opacity-30' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{entry.key}</label>
                <TypeBadge type={valType} hasOptions={!!options} />
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-snug">{description}</p>
            </div>
            <div className={`shrink-0 w-44 transition-all duration-300 ${isDisabled ? 'pointer-events-none select-none' : ''}`}>
              {valType === 'bool' ? (
                <button
                  onClick={() => onUpdateValue(globalIdx, entry.value === 'true' ? 'false' : 'true')}
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
                      onClick={() => onUpdateValue(globalIdx, opt.value)}
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
                  onChange={(e) => onUpdateValue(globalIdx, e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 transition-all duration-200"
                  style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--accent-400)'; }}
                  onBlur={(e) => { e.target.style.borderColor = ''; }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
