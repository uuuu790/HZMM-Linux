import { useState, useEffect, useMemo } from 'react';
import { X, FileText, Save, RotateCcw, Sliders, RefreshCw, Search } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { cleanModName } from '../../constants/modIcons';
import {
  parseConfigFile, serializeConfig, appendKeyval, removeKeyvalAt, keyDefNeedsQuote, isUserConfigFile,
  syntaxForFile, normalizeSchema, buildEntryKeyDefMap, guessValueType, isKnownType,
} from '../../utils/config-parser';
import { buildKeyMatcher, countSchemaMatches } from '../../utils/config-search';
import { prepareEntriesForSave, resetEntriesToDefaults, entriesAtDefaults, normalizeKeybindEntries } from '../../utils/widget-helpers';
import { TOAST_LONG_DURATION_MS } from '../../hooks/useToast';
import SchemaRenderer from './config-editor/SchemaRenderer';
import CommentModeRenderer from './config-editor/CommentModeRenderer';
import { DEFAULT_READONLY_TEXT } from './config-editor/SchemaRow';
import { DEFAULT_KEYBIND_TEXT } from './config-editor/KeybindInput';
import { DEFAULT_MULTI_SELECT_TEXT } from './config-editor/MultiSelectInput';

// Config editor modal — orchestrates schema-driven vs comment-driven rendering.
// Parsing / serialization lives in utils/config-parser; the two render modes
// live in ./config-editor/SchemaRenderer and ./config-editor/CommentModeRenderer.
// This file is just the state machine, data loading, and modal chrome.
// Save normalization and the footer reset live in utils/widget-helpers and
// bind entries to schema keys with buildEntryKeyDefMap — the same
// resolveEntryIdx binding SchemaRenderer uses for its rows.

// Parse one config file into entries tagged with their file (handleSave
// groups by `_file`). *.lua parses as Lua, *.ini / *.cfg as INI, the rest is
// sniffed.
const parseFileEntries = (text, file) =>
  parseConfigFile(text, { syntax: syntaxForFile(file.relativePath) }).map(e => ({ ...e, _file: file }));

// Re-parse a file just saved from `fileEntries`. A sniffed file keeps the
// syntax it was loaded as (its keyvals' `format`), still with the hybrid
// (non-strict) Lua rules — an edited value (`{Clan} Bob`, a trailing `,` in an
// INI value) must not flip the re-parse to the other syntax.
const reparseSavedFile = (text, file, fileEntries) => {
  const format = syntaxForFile(file.relativePath) === 'auto' && fileEntries.find(e => e.type === 'keyval')?.format;
  if (!format) return parseFileEntries(text, file);
  return parseConfigFile(text, { syntax: format, strict: false }).map(e => ({ ...e, _file: file }));
};

// Schema mode: entries as the editor starts from them — pre-1.4 keybind
// values already converted (see normalizeKeybindEntries). Snapshot this as
// "original" too, so opening the editor alone doesn't enable Save.
const withSchemaFixups = (entries, schema) => normalizeKeybindEntries(entries, buildEntryKeyDefMap(entries, schema));

// ipcRenderer.invoke wraps a main-process throw as
// "Error invoking remote method 'x': Error: <message>" — keep the message.
const ipcErrorMessage = (err) =>
  String(err?.message || err || '').replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '');

// The main process refuses to write a config.lua that no longer parses
// (services/lua-syntax.ts): "Lua syntax error in <path>: [line:col] <msg>".
// A parse failure without a position (e.g. nesting too deep) has no [l:c].
const LUA_SYNTAX_ERROR_RE = /^Lua syntax error in (.+?): (?:\[(\d+):\d+\]\s*)?([\s\S]*)$/;

// Toast tags: a new toast of the same kind replaces the one still showing,
// so a save that succeeds on retry clears the previous attempt's error.
const SAVE_TOAST_TAG = 'config-editor-save';
const OPTIONAL_TOAST_TAG = 'config-editor-optional';

const fill = (template, values) =>
  Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);

/**
 * One file that failed to save → `{ title, detail }` for the error toast. A
 * Lua syntax refusal is localized and names the line; the parser's own
 * (English) message becomes the detail. Any other failure keeps the generic
 * "failed to save" title with the raw reason as the detail.
 */
export function describeSaveFailure(fileName, reason, t = {}) {
  const m = LUA_SYNTAX_ERROR_RE.exec(String(reason || ''));
  if (m) {
    const [, , line, message] = m;
    const template = line
      ? t.toastConfigSyntaxErrorLine || 'Syntax error on line {line} of {file} — not saved'
      : t.toastConfigSyntaxError || 'Syntax error in {file} — not saved';
    return { title: fill(template, { file: fileName, line: line ?? '' }), detail: message.trim() };
  }
  return { title: `${t.toastConfigError || 'Failed to save config'}: ${fileName}`, detail: String(reason || '').trim() };
}

// Error toast body: each failed file's title, its raw detail in small mono
// type underneath (ToastContainer renders the message inside its text span).
function SaveFailureMessage({ failures }) {
  return failures.map((f, i) => (
    <span key={i} className={`block ${i > 0 ? 'mt-2' : ''}`}>
      <span className="block text-balance">{f.title}</span>
      {f.detail && (
        <span className="block mt-1 font-mono text-[11px] font-medium leading-snug text-slate-500 dark:text-slate-400 break-words">
          {f.detail}
        </span>
      )}
    </span>
  ));
}

const ConfigEditorModal = ({ isOpen, mod, onClose, t, lang, addToast }) => {
  useEscapeKey(onClose, isOpen);
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

  // Read-only row strings (pill, its tooltip, the one note at the top), plus
  // the keybind and multi-select widgets' strings — the renderers hand this
  // bundle to every row unchanged.
  const readonlyText = useMemo(() => ({
    badge: t.configReadonlyBadge || DEFAULT_READONLY_TEXT.badge,
    hint: t.configReadonlyHint || DEFAULT_READONLY_TEXT.hint,
    noteTitle: t.configReadonlyNoteTitle || DEFAULT_READONLY_TEXT.noteTitle,
    note: t.configReadonlyNote || DEFAULT_READONLY_TEXT.note,
    keybind: {
      recording: t.configKeybindRecording || DEFAULT_KEYBIND_TEXT.recording,
      empty: t.configKeybindEmpty || DEFAULT_KEYBIND_TEXT.empty,
      clear: t.configKeybindClear || DEFAULT_KEYBIND_TEXT.clear,
    },
    multiSelect: {
      none: t.configMultiSelectNone || DEFAULT_MULTI_SELECT_TEXT.none,
      count: t.configMultiSelectCount || DEFAULT_MULTI_SELECT_TEXT.count,
    },
  }), [t]);

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
          let text = null;
          try {
            text = await window.api.mods.readConfig(mod.filename, loadedSchema.configFile);
          } catch {
            // Config file not found — fall through to comment mode
            loadedSchema = null;
          }
          if (cancelled) return;
          if (loadedSchema) {
            try {
              const file = { name: loadedSchema.configFile, relativePath: loadedSchema.configFile };
              // Tolerate schema slips (section without keys, null key, plain
              // option values) instead of crashing the renderer.
              const normalized = normalizeSchema(loadedSchema);
              const parsed = withSchemaFixups(parseFileEntries(text, file), normalized);
              setSchema(normalized);
              setConfigFiles([file]);
              setSelectedFile(file);
              setEntries(parsed);
              setOriginalEntries(JSON.parse(JSON.stringify(parsed)));
            } catch (err) {
              // The file was read, but parsing it / binding it to the schema
              // threw — not a missing file: log it, then still offer comment mode.
              console.error('Config schema binding failed:', err);
              loadedSchema = null;
            }
          }
        }

        if (!loadedSchema) {
          // --- Fallback: comment-driven mode ---
          const files = await window.api.mods.getConfigFiles(mod.filename);
          if (cancelled) return;
          const filtered = (files || []).filter(isUserConfigFile);

          const allEntries = [];
          const validFiles = [];
          for (const file of filtered) {
            try {
              const text = await window.api.mods.readConfig(mod.filename, file.relativePath);
              if (cancelled) return;
              const parsed = parseFileEntries(text, file);
              const hasKeyval = parsed.some(e => e.type === 'keyval');
              if (hasKeyval) {
                validFiles.push(file);
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

  // Readonly entries (multi-line values, two assignments on one line,
  // functions) are never edited — the widgets are disabled, this is the
  // backstop.
  const updateValue = (idx, newValue) => {
    setEntries(prev => prev.map((e, i) => (i === idx && !e.readonly ? { ...e, value: newValue } : e)));
  };

  // Schema 1.2 optional widget — toggle on adds the key to entries (so it
  // serializes back into config.lua), toggle off removes it entirely so
  // the mod's `if Config.X ~= nil` check treats it as disabled.
  //
  // Every entry appendKeyval adds must inherit `_file` from existing entries
  // (the new keyval, and the `{` / `}` lines of an expanded one-line
  // `local Config = {}`); handleSave groups entries by `e._file?.relativePath`
  // and silently drops anything without it.
  //
  // appendKeyval returns the SAME array when it finds no safe place for the
  // line (e.g. a one-line `local Config = { A = 1 }`). That refusal gets an
  // error toast instead of a toggle that silently stays off — computed from
  // the rendered entries, not inside a setEntries updater, which React may
  // run lazily (or twice) and would toast more than once.
  const fileRefOf = () => entries.find(e => e._file)?._file ?? configFiles[0] ?? null;
  const toastOptionalRefused = (template, keyName, fileRef) => {
    const file = fileRef?.name || fileRef?.relativePath || 'config.lua';
    const message = fill(template, { key: keyName, file });
    addToast(<span className="block text-balance">{message}</span>, 'error', { duration: TOAST_LONG_DURATION_MS, tag: OPTIONAL_TOAST_TAG });
  };
  // sectionId (the schema section id) lets appendKeyval's self-check confirm
  // the new line binds back to this very row.
  const addOptionalEntry = (keyName, value, type, sectionHint = null, keyDef = null, sectionId = null) => {
    const fileRef = fileRefOf();
    const format = fileRef ? syntaxForFile(fileRef.relativePath) : 'lua';
    // Lua: quoting follows the schema type. An unknown / missing one follows
    // the type the row edits the key as (`type`, from inferKeyType — its
    // default decides: a "0042" default stays text, an array default is a
    // list), so the line is written the way prepareEntriesForSave and the
    // reopened row read it; with `options` it quotes like a select. INI values
    // are never quoted — INI readers take the rest of the line literally.
    // A sniffed ('auto') file reports its syntax on its parsed keyvals.
    const isIni = (entries.find(e => e.type === 'keyval')?.format ?? format) === 'ini';
    const quoteDef = isKnownType(keyDef?.type)
      ? keyDef
      : { ...keyDef, type: keyDef?.options && type === 'string' ? 'select' : type };
    const isQuoted = !isIni && keyDefNeedsQuote(quoteDef, guessValueType(String(value)) === 'string');
    const updated = appendKeyval(entries, keyName, value, { isQuoted, format, sectionHint, sectionId });
    if (updated === entries) {
      toastOptionalRefused(t.toastConfigOptionalRefused || '“{key}” can’t be added automatically — edit {file} by hand.', keyName, fileRef);
      return;
    }
    setEntries(fileRef ? updated.map(e => (e._file ? e : { ...e, _file: fileRef })) : updated);
  };
  // removeKeyvalAt follows the same refusal contract (same array back) when
  // a line of the key is readonly, or removing it would change how the file
  // is read — the toggle then stays on and the user is told why.
  const removeOptionalEntry = (entryIdx) => {
    const updated = removeKeyvalAt(entries, entryIdx);
    if (updated === entries) {
      toastOptionalRefused(
        t.toastConfigOptionalRemoveRefused || '“{key}” can’t be removed automatically — edit {file} by hand.',
        entries[entryIdx]?.key ?? '', fileRefOf(),
      );
      return;
    }
    setEntries(updated);
  };

  // entryIdx → { sectionId, keyName, keyDef }, built with the SAME
  // resolveEntryIdx binding SchemaRenderer uses for its rows — so save-time
  // clamping, the footer reset and the "all at defaults" check only ever
  // touch the lines the rows show (never a nested or unrelated same-named
  // key). Comment mode has no schema → null.
  const keyDefMap = useMemo(() => (schema ? buildEntryKeyDefMap(entries, schema) : null), [schema, entries]);

  const handleSave = async () => {
    if (!mod || configFiles.length === 0) return;

    setSaving(true);
    // Validate / clamp / quote edited values BEFORE persisting: an invalid
    // number reverts, an out-of-range one is clamped (inputs only clamp on
    // blur, and Save's mousedown can beat the blur), text is quoted by type.
    const normalizedEntries = prepareEntriesForSave(entries, keyDefMap);
    // 按檔案分組儲存 — save each file independently so one failure doesn't
    // abort the rest, and report exactly which files failed and why.
    const failures = [];
    const saved = {};
    for (const file of configFiles) {
      const fileEntries = normalizedEntries.filter(e => e._file?.relativePath === file.relativePath);
      const text = serializeConfig(fileEntries);
      try {
        await window.api.mods.saveConfig(mod.filename, file.relativePath, text);
        saved[file.relativePath] = { text, fileEntries };
      } catch (err) {
        failures.push(describeSaveFailure(file.name || file.relativePath, ipcErrorMessage(err), t));
      }
    }
    if (failures.length === 0) {
      // Re-parse what was written so `raw` / `origValue` describe the file on
      // disk again (inserted lines, added commas, rebuilt values).
      const reparsed = configFiles.flatMap(file => {
        const { text, fileEntries } = saved[file.relativePath];
        return reparseSavedFile(text, file, fileEntries);
      });
      const fresh = schema ? withSchemaFixups(reparsed, schema) : reparsed;
      setEntries(fresh);
      setOriginalEntries(JSON.parse(JSON.stringify(fresh)));
      addToast(t.toastConfigSaved, 'success', { tag: SAVE_TOAST_TAG });
    } else {
      // Some/all files failed. Keep the dirty state so Save stays enabled for a
      // retry (re-writing the succeeded files is idempotent), and name the
      // failures instead of a generic error that hides what's half-saved.
      // Long-lived: the reason (e.g. which line broke) takes a while to read.
      addToast(<SaveFailureMessage failures={failures} />, 'error', { duration: TOAST_LONG_DURATION_MS, tag: SAVE_TOAST_TAG });
    }
    setSaving(false);
  };

  const handleReset = () => {
    // Schema mode: see resetEntriesToDefaults (default → value, optional
    // without default → removed, unbound / readonly entries untouched).
    // Comment mode has no schema → discard unsaved edits.
    if (!keyDefMap) {
      setEntries(JSON.parse(JSON.stringify(originalEntries)));
      return;
    }
    setEntries(prev => resetEntriesToDefaults(prev, buildEntryKeyDefMap(prev, schema)));
  };

  // Memoize: both run on every render (incl. every keystroke), and a large mod
  // can have hundreds of keyval entries — double-stringifying them per render
  // is the heaviest per-render cost in this modal.
  const hasChanges = useMemo(
    () => JSON.stringify(entries) !== JSON.stringify(originalEntries),
    [entries, originalEntries]
  );
  const keyvalEntries = useMemo(() => entries.filter(e => e.type === 'keyval'), [entries]);
  // The schema editor also renders for a file with no keyvals yet (e.g. an
  // all-optional `local Config = {}`) as long as some key can be switched on;
  // with nothing to show at all, the "no editable config" state is clearer.
  const showSchema = !!schema && (keyvalEntries.length > 0 ||
    Object.values(schema.sections).some(s => Object.values(s.keys).some(d => d.optional)));

  // Is every keyval already at its schema default? If so, reset would be a
  // no-op — disable the button. Comment mode has no schema, so fall back to
  // the legacy "no unsaved changes" disable rule.
  const allAtDefaults = useMemo(
    () => (keyDefMap ? entriesAtDefaults(entries, keyDefMap) : !hasChanges),
    [entries, keyDefMap, hasChanges]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-2 sm:p-4 [-webkit-app-region:no-drag]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-editor-modal-title"
        className="relative w-full max-w-2xl max-h-[92vh] sm:max-h-[88vh] lg:max-h-[85vh] bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-2xl sm:rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] animate-modal-spring flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <div className="p-2.5 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' }}>
            <Sliders className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="config-editor-modal-title" className="text-base font-black text-slate-800 dark:text-white tracking-tight truncate">{t.configEditor}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">{cleanModName(mod?.customName || mod?.title || mod?.filename || '')}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-90">
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
          ) : showSchema ? (
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
              readonlyText={readonlyText}
            />
          ) : keyvalEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500 gap-2">
              <FileText className="w-10 h-10 mb-1" />
              <p className="text-sm font-medium">{t.configNoFiles}</p>
            </div>
          ) : (
            <CommentModeRenderer entries={entries} lang={lang} onUpdateValue={updateValue} readonlyText={readonlyText} />
          )}
        </div>

        {/* Footer */}
        {(keyvalEntries.length > 0 || showSchema) && (
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
