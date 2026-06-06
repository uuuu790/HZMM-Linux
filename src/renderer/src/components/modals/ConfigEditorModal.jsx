import { useState, useEffect, useMemo } from 'react';
import { X, FileText, Save, RotateCcw, Sliders, RefreshCw, Search } from 'lucide-react';
import { cleanModName } from '../../constants/modIcons';
import { parseConfigFile, serializeConfig, appendKeyval, removeKeyval, valueNeedsQuote, serializeLuaArray } from '../../utils/config-parser';
import { buildKeyMatcher, countSchemaMatches } from '../../utils/config-search';
import SchemaRenderer from './config-editor/SchemaRenderer';
import CommentModeRenderer from './config-editor/CommentModeRenderer';

// Config editor modal — orchestrates schema-driven vs comment-driven rendering.
// Parsing / serialization lives in utils/config-parser; the two render modes
// live in ./config-editor/SchemaRenderer and ./config-editor/CommentModeRenderer.
// This file is just the state machine, data loading, and modal chrome.

// Serialize a schema-declared `default` into the same string form we store
// in `entries[].value`. Used by both the reset handler and the
// "is everything at default already?" check, so the comparison stays
// consistent with what reset would actually write.
function defaultToValueStr(keyDef) {
  if (!keyDef || keyDef.default === undefined || keyDef.default === null) return null;
  if (Array.isArray(keyDef.default)) return serializeLuaArray(keyDef.default);
  if (keyDef.type === 'float' && typeof keyDef.default === 'number' && Number.isInteger(keyDef.default)) {
    return keyDef.default.toFixed(1);
  }
  return String(keyDef.default);
}

const ConfigEditorModal = ({ isOpen, mod, onClose, t, lang, addToast }) => {
  const [configFiles, setConfigFiles] = useState([]);
  const [_selectedFile, setSelectedFile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [originalEntries, setOriginalEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schema, setSchema] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Build matcher + counts once per (schema, query, lang) — SchemaRenderer
  // gets the matcher prop, the modal renders the "N / total" hint.
  const matcher = useMemo(() => buildKeyMatcher(searchQuery, lang), [searchQuery, lang]);
  const searchCounts = useMemo(
    () => (schema ? countSchemaMatches(schema, matcher, lang) : { matched: 0, total: 0 }),
    [schema, matcher, lang]
  );
  const searchActive = !!searchQuery.trim();

  // Reset search whenever the modal opens for a different mod — stale queries
  // from a previous mod's schema are confusing.
  useEffect(() => { setSearchQuery(''); }, [mod]);

  useEffect(() => {
    if (!isOpen || !mod || !window.api) return;
    setLoading(true);
    setConfigFiles([]);
    setSelectedFile(null);
    setEntries([]);
    setOriginalEntries([]);
    setSchema(null);

    let cancelled = false;

    (async () => {
      try {
        // --- Try schema-driven mode first ---
        let loadedSchema = null;
        if (window.api.mods.getConfigSchema) {
          try { loadedSchema = await window.api.mods.getConfigSchema(mod.filename); } catch { /* ignore */ }
        }
        if (cancelled) return;

        if (loadedSchema?.configFile && loadedSchema?.sections) {
          // Schema mode: read only the target config file
          try {
            const text = await window.api.mods.readConfig(mod.filename, loadedSchema.configFile);
            if (cancelled) return;
            const parsed = parseConfigFile(text);
            const file = { name: loadedSchema.configFile, relativePath: loadedSchema.configFile };
            parsed.forEach(e => { e._file = file; });
            setSchema(loadedSchema);
            setConfigFiles([file]);
            setSelectedFile(file);
            setEntries(parsed);
            setOriginalEntries(JSON.parse(JSON.stringify(parsed)));
          } catch {
            // Config file not found — fall through to comment mode
            loadedSchema = null;
          }
        }

        if (!loadedSchema) {
          // --- Fallback: comment-driven mode ---
          const files = await window.api.mods.getConfigFiles(mod.filename);
          if (cancelled) return;
          const filtered = (files || []).filter(f =>
            f.name.toLowerCase() !== 'main.lua' &&
            !f.relativePath.toLowerCase().startsWith('scripts/')
          );

          const allEntries = [];
          const validFiles = [];
          for (const file of filtered) {
            try {
              const text = await window.api.mods.readConfig(mod.filename, file.relativePath);
              if (cancelled) return;
              const parsed = parseConfigFile(text);
              const hasKeyval = parsed.some(e => e.type === 'keyval');
              if (hasKeyval) {
                validFiles.push(file);
                parsed.forEach(e => { e._file = file; });
                allEntries.push(...parsed);
              }
            } catch { /* skip */ }
          }
          if (cancelled) return;

          setConfigFiles(validFiles);
          setSelectedFile(validFiles.length > 0 ? validFiles[0] : null);
          setEntries(allEntries);
          setOriginalEntries(JSON.parse(JSON.stringify(allEntries)));
        }
      } catch {
        if (!cancelled) setConfigFiles([]);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [isOpen, mod]);

  const updateValue = (idx, newValue) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, value: newValue } : e));
  };

  // Schema 1.2 optional widget — toggle on adds the key to entries (so it
  // serializes back into config.lua), toggle off removes it entirely so
  // the mod's `if Config.X ~= nil` check treats it as disabled.
  //
  // The new entry must inherit `_file` from existing entries; handleSave
  // groups entries by `e._file?.relativePath` and silently drops anything
  // without it. Without this tag the toggle-on appeared to work in the UI
  // but nothing was written to config.lua on save.
  const addOptionalEntry = (keyName, value, type, sectionHint = null) => {
    const isQuoted = valueNeedsQuote(type);
    setEntries(prev => {
      const fileRef = prev.find(e => e._file)?._file ?? null;
      const updated = appendKeyval(prev, keyName, value, { isQuoted, format: 'lua', sectionHint });
      if (fileRef) {
        const newEntry = updated.find(e => e.type === 'keyval' && e.key === keyName && !e._file);
        if (newEntry) newEntry._file = fileRef;
      }
      return updated;
    });
  };
  const removeOptionalEntry = (keyName, sectionHint = null) => {
    setEntries(prev => removeKeyval(prev, keyName, sectionHint));
  };

  const handleSave = async () => {
    if (!mod || configFiles.length === 0) return;

    setSaving(true);
    // Clamp numeric entries against schema min/max BEFORE persisting.
    // SliderInput / plain numeric inputs only clamp on blur, so a user
    // who types out-of-range and immediately clicks Save (mousedown
    // before input blur) would otherwise persist an unbounded value.
    const normalizedEntries = entries.map((e, i) => {
      if (e.type !== 'keyval') return e;
      const def = keyDefByEntry?.[i];
      if (!def || (def.min === undefined && def.max === undefined)) return e;
      const isInt = def.type === 'int';
      const isFloat = def.type === 'float';
      if (!isInt && !isFloat) return e;
      let n = isInt ? parseInt(e.value, 10) : parseFloat(e.value);
      if (isNaN(n)) return e;
      if (def.min !== undefined) n = Math.max(def.min, n);
      if (def.max !== undefined) n = Math.min(def.max, n);
      const newStr = isInt ? String(Math.round(n)) : String(parseFloat(n.toFixed(4)));
      return newStr === e.value ? e : { ...e, value: newStr };
    });
    try {
      // 按檔案分組儲存
      for (const file of configFiles) {
        const fileEntries = normalizedEntries.filter(e => e._file?.relativePath === file.relativePath);
        const text = serializeConfig(fileEntries);
        await window.api.mods.saveConfig(mod.filename, file.relativePath, text);
      }
      setEntries(normalizedEntries);
      setOriginalEntries(JSON.parse(JSON.stringify(normalizedEntries)));
      addToast(t.toastConfigSaved, 'success');
    } catch {
      addToast(t.toastConfigError, 'error');
    }
    setSaving(false);
  };

  // entryIdx → keyDef. Walk entries linearly, tracking the current INI/Lua
  // section marker so each keyval pairs with its containing section's keyDef.
  // Flat keyName→keyDef collapses cross-section duplicates (e.g. `enabled`
  // repeated under [DamageNumbers] / [IncomingDamage] / ...) and resets every
  // row to the same `default`. Sectionless configs (config.lua without
  // section markers) fall back to the first matching key across sections.
  const keyDefByEntry = useMemo(() => {
    if (!schema) return null;
    const map = {};
    let currentSection = '';
    entries.forEach((e, i) => {
      if (e.type === 'section') {
        currentSection = e.name || '';
      } else if (e.type === 'keyval') {
        const exact = schema.sections?.[currentSection]?.keys?.[e.key];
        if (exact) {
          map[i] = exact;
        } else {
          for (const sec of Object.values(schema.sections || {})) {
            if (sec.keys?.[e.key]) { map[i] = sec.keys[e.key]; break; }
          }
        }
      }
    });
    return map;
  }, [schema, entries]);

  const handleReset = () => {
    // Schema mode:
    //  - Key with schema `default`: reset value to that default.
    //  - Optional key WITHOUT default: reset means absent → remove entry.
    //  - Non-optional key without default: nothing to reset to, leave alone.
    // Comment mode has no schema → discard unsaved edits.
    if (!keyDefByEntry) {
      setEntries(JSON.parse(JSON.stringify(originalEntries)));
      return;
    }
    setEntries(prev => {
      const out = [];
      prev.forEach((entry, i) => {
        if (entry.type !== 'keyval') { out.push(entry); return; }
        const def = keyDefByEntry[i];
        const defaultStr = defaultToValueStr(def);
        if (defaultStr === null) {
          if (def?.optional) return; // drop — revert to "absent"
          out.push(entry);
          return;
        }
        out.push({ ...entry, value: defaultStr });
      });
      return out;
    });
  };

  const hasChanges = JSON.stringify(entries) !== JSON.stringify(originalEntries);
  const keyvalEntries = entries.filter(e => e.type === 'keyval');

  // Is every keyval already at its schema default? If so, reset would be a
  // no-op — disable the button. Comment mode has no schema, so fall back to
  // the legacy "no unsaved changes" disable rule.
  const allAtDefaults = useMemo(() => {
    if (!keyDefByEntry) return !hasChanges;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type !== 'keyval') continue;
      const def = keyDefByEntry[i];
      const defaultStr = defaultToValueStr(def);
      if (defaultStr === null) {
        // Optional key currently present is by definition "not at default"
        // (default = absent). Non-optional keys without a default don't
        // participate in the reset.
        if (def?.optional) return false;
        continue;
      }
      if (entry.value !== defaultStr) return false;
    }
    return true;
  }, [entries, keyDefByEntry, hasChanges]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-2 sm:p-4 [-webkit-app-region:no-drag]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[92vh] sm:max-h-[88vh] lg:max-h-[85vh] bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-2xl sm:rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] animate-modal-spring flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <div className="p-2.5 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' }}>
            <Sliders className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-black text-slate-800 dark:text-white tracking-tight truncate">{t.configEditor}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">{cleanModName(mod?.customName || mod?.title || mod?.filename || '')}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-90">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search bar — only meaningful in schema mode */}
        {schema && (
          <div className="px-6 pt-3 pb-1 border-b border-slate-200/60 dark:border-slate-700/50">
            <div className="relative flex items-center">
              <Search className="absolute left-3 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.configSearchPlaceholder || 'Search settings…'}
                className="w-full pl-9 pr-24 py-2 text-sm rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 transition-all duration-200"
                style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--accent-400)'; }}
                onBlur={(e) => { e.target.style.borderColor = ''; }}
              />
              {searchActive && (
                <>
                  <span className="absolute right-9 text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 tabular-nums">
                    {searchCounts.matched}/{searchCounts.total}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title={t.configSearchClear || 'Clear search'}
                    className="absolute right-2 w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 dark:text-slate-500">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
          ) : configFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-10 h-10 mb-1" />
              <p className="text-sm font-medium">{t.configNoFiles}</p>
            </div>
          ) : keyvalEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-10 h-10 mb-1" />
              <p className="text-sm font-medium">{t.configNoFiles}</p>
            </div>
          ) : schema ? (
            <SchemaRenderer
              schema={schema}
              entries={entries}
              lang={lang}
              onUpdateValue={updateValue}
              onAddOptional={addOptionalEntry}
              onRemoveOptional={removeOptionalEntry}
              modFilename={mod?.filename}
              addToast={addToast}
              searchActive={searchActive}
              matcher={matcher}
              noMatchLabel={t.configSearchNoMatch || 'No settings match your search.'}
            />
          ) : (
            <CommentModeRenderer entries={entries} lang={lang} onUpdateValue={updateValue} />
          )}
        </div>

        {/* Footer */}
        {keyvalEntries.length > 0 && (
          <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200/60 dark:border-slate-700/50">
            <button
              onClick={handleReset}
              disabled={allAtDefaults}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-300 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.configReset}
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--accent-500)', boxShadow: '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)' }}
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? t.configSaving : hasChanges ? t.configSave : t.configSaved}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigEditorModal;
