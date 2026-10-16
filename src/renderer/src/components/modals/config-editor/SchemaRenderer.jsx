import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import SchemaRow, { ReadonlyNote, DEFAULT_READONLY_TEXT } from './SchemaRow';
import { resolveI18n, guessValueType, buildSectionKeyIndex, resolveEntryIdx as resolveEntryIdxIn, resolveSectionName } from '../../../utils/config-parser';
import { evalArithmetic } from '../../../utils/safe-expr';
import { defaultToValueStr, valueEqualsDefault, inferKeyType } from '../../../utils/widget-helpers';
import { readonlyPreview, valueShape, gateValue } from '../../../utils/readonly-preview';

// Serialize a schema-declared `default` to the string form stored in `entries`.
// Shared with ConfigEditorModal via utils/widget-helpers so array defaults
// (list / multi-select) round-trip through serializeLuaArray/parseLuaArray
// instead of degrading to a bare "Fire,Ice".

// Types SchemaRow has a widget for. Anything else ("number", "boolean",
// "slider", a missing type) is inferred from the value.
const WIDGET_TYPES = new Set(['bool', 'int', 'float', 'string', 'text', 'color', 'keybind', 'select', 'list', 'multi-select']);

// A row's widget type — widget-helpers' inferKeyType, the same inference
// prepareEntriesForSave validates with. An unknown / missing schema type is
// inferred from the value the file had when it was read (`origValue`), never
// from the value being typed — otherwise typing "1," into a number turns the
// row into a text box mid-edit and the number checks stop running. A quoted
// value is text even when it looks like a number ("1234"). A line switched on
// in this session has no origValue: its schema default decides, then its value.
// A read-only value only needs a badge: LIST / TABLE / CODE for a table or
// function, else the type of this key's own value (`800` in `800, H = 600`).
// (Exported for the UI tests.)
export function inferRowType(keyDef, entry) {
  if (entry?.readonly && !entry.isQuoted && !WIDGET_TYPES.has(keyDef?.type)) {
    const raw = entry.origValue ?? entry.value;
    return valueShape(raw) || guessValueType(readonlyPreview(raw));
  }
  return inferKeyType(keyDef, entry);
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
//   - a readonly entry (multi-line value, two assignments on one line,
//     function) renders as a read-only preview with a "Read-only" pill; one
//     ReadonlyNote at the top explains it while such a row is visible

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
  readonlyText = DEFAULT_READONLY_TEXT,
}) {
  // Lookup map: sectionName → keyName → entry index, plus the structured-file
  // flag. Semantics live in config-parser.buildSectionKeyIndex/resolveEntryIdx
  // (shared so unit tests exercise the real logic): strict per-section scoping
  // only for real INI `[Section]` files; decorative comment banners fall back
  // to a flat scan because Lua keys share one namespace.
  // Memoized on [entries] so the O(n) walk runs once per entries change, not on
  // every render — onUpdateValue replaces the entries array on each keystroke.
  const sectionKeyIndex = useMemo(() => buildSectionKeyIndex(entries), [entries]);
  const resolveEntryIdx = (sectionId, keyName) => resolveEntryIdxIn(sectionKeyIndex, sectionId, keyName);

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

  // The value enableKey / showWhen compare — a read-only row's own scalar
  // (`false` in `Enabled = false, Debug = false`), null when it has none.
  const getValue = (sectionId, keyName) => {
    const idx = resolveEntryIdx(sectionId, keyName);
    return idx !== undefined ? gateValue(entries[idx]) : undefined;
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

  // Set while rendering the rows below: at least one read-only row is on
  // screen (not filtered out, not hidden by showWhen, not in a folded
  // section) → show the one explanation at the top.
  let readonlyVisible = false;

  const sectionNodes = Object.entries(schema.sections).map(([sectionId, section]) => {
    // Hide whole section when searching and it has no matches.
    if (searchActive && matchInfo) {
      const matched = matchInfo[sectionId];
      if (!matched || matched.size === 0) return null;
    }

    const sectionLabel = resolveI18n(section.label, lang) || sectionId;
    // The section name as it appears IN THE FILE — what appendKeyval needs
    // to place a toggled-on key inside the right block. Differs from
    // sectionId whenever the file groups keys under decorative banners.
    const sectionHint = resolveSectionName(sectionKeyIndex, sectionId, Object.keys(section.keys || {}));
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
        {isOpen && Object.entries(section.keys || {}).map(([keyName, keyDef]) => {
          // Skip non-matching keys when searching.
          if (searchActive && matchInfo && !matchInfo[sectionId].has(keyName)) return null;

          const isOptional = !!keyDef.optional;
          const entryIdx = resolveEntryIdx(sectionId, keyName);
          const isPresent = entryIdx !== undefined;
          // Non-optional keys must exist in config to render. Optional
          // keys render even when absent — toggle is off, input is dim.
          if (!isOptional && !isPresent) return null;

          const type = inferRowType(keyDef, isPresent ? entries[entryIdx] : null);
          // Readonly: the parser couldn't isolate a safely rewritable value.
          const readonly = isPresent && !!entries[entryIdx].readonly;
          const currentValue = isPresent
            ? entries[entryIdx].value
            : (defaultToValueStr(keyDef) || '');
          const label = resolveI18n(keyDef.label, lang) || keyName;
          const rawDescription = resolveI18n(keyDef.description, lang);
          let description = rawDescription;
          // {value} / {eval:} of a read-only row use this key's own value
          // (`30`, not `30, NightLength = 10`).
          const shownValue = readonly ? readonlyPreview(currentValue, { isQuoted: !!entries[entryIdx].isQuoted }) : currentValue;
          if (rawDescription) {
            // {eval: <arithmetic>} lets a schema show a computed number from
            // the current value (e.g. "{eval: value * 60} per minute"). The
            // schema ships inside an UNTRUSTED mod folder, so this MUST NOT
            // use new Function/eval (that was an RCE under the renderer's
            // unsafe-eval CSP). evalArithmetic parses a math-only grammar and
            // touches no JS scope — see utils/safe-expr.ts.
            description = rawDescription.replace(/\{eval:\s*([^}]+)\}/g, (match, expr) => {
              const result = evalArithmetic(expr, parseFloat(shownValue) || 0);
              if (result === null) return match;
              return Number.isInteger(result) ? String(result) : result.toFixed(2);
            });
            description = description.replace(/\{value\}/g, () => shownValue);
          }

          // showWhen conditional visibility — bypass while searching so
          // a hidden dependent key still surfaces if it matches. A read-only
          // dependency without a plain value (null) never hides the row.
          if (!searchActive && keyDef.showWhen) {
            const visible = Object.entries(keyDef.showWhen).every(([depKey, depVal]) => {
              const v = getValue(sectionId, depKey);
              return v === null || v === String(depVal);
            });
            if (!visible) return null;
          }

          // Three ways a row's widget gets disabled (SchemaRow sets the
          // disabled attribute, so the keyboard can't edit it either):
          //   1. The whole section is gated off via enableKey (and this
          //      key isn't the gate itself) — its optional switch too.
          //   2. The key is optional and currently absent from
          //      config.lua — toggle on first to edit.
          //   3. The value is read-only (shown, never rewritten).
          const sectionGated = sectionDisabled && keyName !== enableKey;
          const isOptionalOff = isOptional && !isPresent;
          const widgetDisabled = sectionGated || isOptionalOff || readonly;

          // default reset — only meaningful when (a) schema declared a default,
          // (b) current value diverges from it (numerically for int/float),
          // and (c) the row is editable.
          const defaultStr = defaultToValueStr(keyDef);
          const canReset = isPresent && defaultStr !== null && !valueEqualsDefault(currentValue, keyDef) && !widgetDisabled;
          if (readonly) readonlyVisible = true;

          return (
            <SchemaRow
              key={keyName}
              keyName={keyName}
              keyDef={keyDef}
              entryIdx={entryIdx}
              currentValue={currentValue}
              isPresent={isPresent}
              isOptional={isOptional}
              readonly={readonly}
              isQuoted={isPresent && !!entries[entryIdx].isQuoted}
              readonlyText={readonlyText}
              type={type}
              label={label}
              description={description}
              options={keyDef.options}
              defaultStr={defaultStr}
              canReset={canReset}
              widgetDisabled={widgetDisabled}
              sectionGated={sectionGated}
              sectionHint={sectionHint}
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
  });

  return (
    <>
      {readonlyVisible && <ReadonlyNote text={readonlyText} className="mb-4" />}
      <div className="flex flex-col gap-1">{sectionNodes}</div>
    </>
  );
}
