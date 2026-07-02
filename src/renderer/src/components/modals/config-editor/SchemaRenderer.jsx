import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import SchemaRow from './SchemaRow';
import { resolveI18n, guessValueType } from '../../../utils/config-parser';
import { evalArithmetic } from '../../../utils/safe-expr';

// Convert a JSON-typed `default` value to the string form we store in `entries`.
// Floats keep at least one decimal so 3.0 doesn't degrade to "3" — the Lua
// runtime treats them the same, but the visible round-trip stays clean.
function defaultToString(def, type) {
  if (def === undefined || def === null) return null;
  if (type === 'float' && typeof def === 'number') {
    return Number.isInteger(def) ? def.toFixed(1) : String(def);
  }
  return String(def);
}

// Schema-driven renderer — walks through hzmm.config.json's sections/keys
// structure and renders labeled controls for each. Supports:
//   - type: bool / int / float / string / color / keybind
//     (int/float honor optional min/max clamping on blur)
//   - options: [{ value }] → pill selector
//   - showWhen: { dependencyKey: expectedValue } → conditional visibility
//   - enableKey on section → section-wide disable (all but the enableKey)
//   - openPath: { path, relativeTo, action } → jump-to-file button
//   - section.collapsed: true → section starts folded; click header to expand
//   - keyDef.optional: true → key may be absent from config.lua. Renders a
//     small toggle next to the input; toggle off removes the key from the
//     file, toggle on inserts it with the schema default.
//   - searchActive + matcher → filter keys/sections, auto-expand matched

export default function SchemaRenderer({
  schema,
  entries,
  lang,
  onUpdateValue,
  onAddOptional,
  onRemoveOptional,
  modFilename,
  addToast,
  searchActive = false,
  matcher = null,
  noMatchLabel = 'No settings match your search.',
}) {
  // Lookup map: sectionName → keyName → entry index. Nested because INI/Lua
  // configs may repeat the same key name across sections (e.g. `enabled`
  // under both [DamageNumbers] and [IncomingDamage]). Sectionless keyvals
  // (config.lua without section markers) live under '' and act as a fallback
  // for schemas that group keys logically without matching a real section
  // header in the file.
  // Memoized on [entries] so the O(n) walk runs once per entries change, not on
  // every render — onUpdateValue replaces the entries array on each keystroke.
  // `hasStructuredSections`: when the config has any real section markers, the
  // user's file is structured — don't bleed sectionless top-level keys into
  // section scope. The '' fallback is only for the legacy case where config.lua
  // has no section markers at all and every key lives in the '' bucket.
  const { keyIndexMap, hasStructuredSections } = useMemo(() => {
    const map = {};
    let currentSection = '';
    entries.forEach((e, i) => {
      if (e.type === 'section') {
        currentSection = e.name || '';
      } else if (e.type === 'keyval') {
        if (!map[currentSection]) map[currentSection] = {};
        map[currentSection][e.key] = i;
      }
    });
    return { keyIndexMap: map, hasStructuredSections: Object.keys(map).some(k => k !== '') };
  }, [entries]);
  const resolveEntryIdx = (sectionId, keyName) => {
    const exact = keyIndexMap[sectionId]?.[keyName];
    if (exact !== undefined) return exact;
    if (hasStructuredSections) return undefined;
    return keyIndexMap['']?.[keyName];
  };

  // Per-section open/closed state. Initial state honors `section.collapsed`
  // from the schema. State is local to this mount — closing the modal
  // resets to schema defaults next time, which is the simplest semantics
  // and matches "the author chose this default for a reason".
  //
  // Crowd safeguard: when a schema has more than ~10 sections (e.g. a
  // weapon-customizer mod with one section per gun), rendering every key
  // up-front can freeze the modal for seconds while React commits hundreds
  // of rows. We auto-collapse all sections in that case so only the section
  // headers paint immediately. The author's explicit `collapsed` value
  // still wins — they may know best for their mod.
  const [openSections, setOpenSections] = useState(() => {
    const init = {};
    const sectionEntries = Object.entries(schema.sections || {});
    const tooManySections = sectionEntries.length > 10;
    sectionEntries.forEach(([id, s]) => {
      if (typeof s.collapsed === 'boolean') {
        init[id] = !s.collapsed;
      } else {
        init[id] = !tooManySections;
      }
    });
    return init;
  });
  const toggleSection = (id) => setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const getValue = (sectionId, keyName) => {
    const idx = resolveEntryIdx(sectionId, keyName);
    return idx !== undefined ? entries[idx].value : undefined;
  };

  // When searching, pre-compute which keys match in each section. Storing
  // matched key names in a Set per section gives O(1) "should I render this
  // key" checks during the main render loop, instead of running the matcher
  // twice (once for the count, once per key).
  const matchInfo = useMemo(() => {
    if (!searchActive || !matcher) return null;
    const info = {};
    let total = 0;
    for (const [sectionId, section] of Object.entries(schema.sections || {})) {
      const sectionLabel = resolveI18n(section.label, lang);
      const matched = new Set();
      for (const [keyName, keyDef] of Object.entries(section.keys || {})) {
        if (matcher(keyName, keyDef, sectionId, sectionLabel)) matched.add(keyName);
      }
      info[sectionId] = matched;
      total += matched.size;
    }
    info.__total = total;
    return info;
  }, [searchActive, matcher, schema, lang]);

  // Empty state when searching matches nothing.
  if (searchActive && matchInfo && matchInfo.__total === 0) {
    return (
      <div className="py-16 text-center text-sm font-medium text-slate-400 dark:text-slate-500">
        {noMatchLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {Object.entries(schema.sections).map(([sectionId, section]) => {
        // Hide whole section when searching and it has no matches.
        if (searchActive && matchInfo) {
          const matched = matchInfo[sectionId];
          if (!matched || matched.size === 0) return null;
        }

        const sectionLabel = resolveI18n(section.label, lang);
        const enableKey = section.enableKey;
        const sectionDisabled = enableKey && getValue(sectionId, enableKey) === 'false';
        // While searching, force every visible section open so the user
        // sees the matches without extra clicks. Search ends → restore
        // user/schema state.
        const isOpen = searchActive ? true : !!openSections[sectionId];

        return (
          <div key={sectionId}>
            {/* Section header — click to toggle when not searching */}
            <div
              className={`mt-3 mb-1 first:mt-0 select-none group ${searchActive ? '' : 'cursor-pointer'}`}
              onClick={searchActive ? undefined : () => toggleSection(sectionId)}
            >
              <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest transition-opacity duration-200 group-hover:opacity-80" style={{ color: 'var(--accent-500)' }}>
                <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${isOpen ? '' : '-rotate-90'}`} />
                {sectionLabel}
              </h4>
              <div className="h-px mt-1" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.2)' }} />
            </div>

            {/* Keys — only rendered when section is open */}
            {isOpen && Object.entries(section.keys).map(([keyName, keyDef]) => {
              // Skip non-matching keys when searching.
              if (searchActive && matchInfo && !matchInfo[sectionId].has(keyName)) return null;

              const isOptional = !!keyDef.optional;
              const entryIdx = resolveEntryIdx(sectionId, keyName);
              const isPresent = entryIdx !== undefined;
              // Non-optional keys must exist in config to render. Optional
              // keys render even when absent — toggle is off, input is dim.
              if (!isOptional && !isPresent) return null;

              const type = keyDef.type || (isPresent ? guessValueType(entries[entryIdx].value) : 'string');
              const currentValue = isPresent
                ? entries[entryIdx].value
                : (defaultToString(keyDef.default, type) || '');
              const label = resolveI18n(keyDef.label, lang) || keyName;
              const rawDescription = resolveI18n(keyDef.description, lang);
              let description = rawDescription;
              if (rawDescription) {
                // {eval: <arithmetic>} lets a schema show a computed number from
                // the current value (e.g. "{eval: value * 60} per minute"). The
                // schema ships inside an UNTRUSTED mod folder, so this MUST NOT
                // use new Function/eval (that was an RCE under the renderer's
                // unsafe-eval CSP). evalArithmetic parses a math-only grammar and
                // touches no JS scope — see utils/safe-expr.js.
                description = rawDescription.replace(/\{eval:\s*([^}]+)\}/g, (match, expr) => {
                  const result = evalArithmetic(expr, parseFloat(currentValue) || 0);
                  if (result === null) return match;
                  return Number.isInteger(result) ? String(result) : result.toFixed(2);
                });
                description = description.replace(/\{value\}/g, currentValue);
              }

              // showWhen conditional visibility — bypass while searching so
              // a hidden dependent key still surfaces if it matches.
              if (!searchActive && keyDef.showWhen) {
                const visible = Object.entries(keyDef.showWhen).every(([depKey, depVal]) => getValue(sectionId, depKey) === String(depVal));
                if (!visible) return null;
              }

              // Two ways a row's widget gets disabled:
              //   1. The whole section is gated off via enableKey (and this
              //      key isn't the gate itself).
              //   2. The key is optional and currently absent from
              //      config.lua — toggle on first to edit.
              const sectionGated = sectionDisabled && keyName !== enableKey;
              const isOptionalOff = isOptional && !isPresent;
              const widgetDisabled = sectionGated || isOptionalOff;

              // default reset — only meaningful when (a) schema declared a default,
              // (b) current value diverges from it, and (c) the row is editable.
              const defaultStr = defaultToString(keyDef.default, type);
              const canReset = isPresent && defaultStr !== null && defaultStr !== currentValue && !widgetDisabled;

              return (
                <SchemaRow
                  key={keyName}
                  keyName={keyName}
                  keyDef={keyDef}
                  entryIdx={entryIdx}
                  currentValue={currentValue}
                  isPresent={isPresent}
                  isOptional={isOptional}
                  type={type}
                  label={label}
                  description={description}
                  options={keyDef.options}
                  defaultStr={defaultStr}
                  canReset={canReset}
                  widgetDisabled={widgetDisabled}
                  sectionGated={sectionGated}
                  sectionId={sectionId}
                  onUpdateValue={onUpdateValue}
                  onAddOptional={onAddOptional}
                  onRemoveOptional={onRemoveOptional}
                  modFilename={modFilename}
                  addToast={addToast}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
