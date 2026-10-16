import { useMemo, useRef } from 'react';
import { RotateCcw, Lock } from 'lucide-react';
import TypeBadge, { ReadonlyBadge } from './TypeBadge';
import { typedDefaultSeed, isValidNumber, clampToRange } from '../../../utils/widget-helpers';
import { readonlyPreview, readonlyFullValue, readonlyTooltip } from '../../../utils/readonly-preview';
import OpenPathButton from './OpenPathButton';
import ColorPicker from './ColorPicker';
import KeybindInput from './KeybindInput';
import SliderInput from './SliderInput';
import MultiSelectInput from './MultiSelectInput';
import SingleSelectDropdown from './SingleSelectDropdown';
import StringListInput from './StringListInput';

// Read-only UI text. ConfigEditorModal passes the localized strings; these
// English fallbacks only show when a renderer is mounted without them.
export const DEFAULT_READONLY_TEXT = {
  badge: 'Read-only',
  hint: "Read-only here: this value spans several lines, shares its line with another setting, or is code. Edit the file directly (write arrays on one line).",
  noteTitle: 'Some settings are read-only here',
  note: "Their value spans several lines, shares its line with another setting, or is code, so HZMM can't rewrite it safely. To change one, edit the config file directly.",
};

// id of the editor's single read-only note; each read-only value points its
// aria-describedby at it instead of repeating the explanation per row. The
// renderers show the note whenever they render a read-only row.
export const READONLY_NOTE_ID = 'config-editor-readonly-note';

// The one explanation at the top of the editor content, shown while at least
// one read-only row is visible.
export function ReadonlyNote({ text = DEFAULT_READONLY_TEXT, className = '' }) {
  return (
    <div
      id={READONLY_NOTE_ID}
      role="note"
      className={`flex items-start gap-3 px-4 py-3 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/30 ${className}`}
    >
      <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-200/70 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300">
        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 pt-px">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-snug">{text.noteTitle}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">{text.note}</p>
      </div>
    </div>
  );
}

// A value the editor shows but never rewrites. Read-only is not disabled:
// full-contrast text in the same box metrics as the neighbouring inputs,
// focusable so keyboard and screen-reader users get the full value too.
// The tooltip shows the value as the file has it, then why it's read-only.
export function ReadonlyValue({ value, isQuoted = false, label = '', hint = '', describedBy }) {
  const { preview, full, tooltip } = useMemo(() => ({
    preview: readonlyPreview(value, { isQuoted }),
    full: readonlyFullValue(value, { isQuoted }),
    tooltip: isQuoted ? String(value ?? '') : readonlyTooltip(value),
  }), [value, isQuoted]);
  return (
    <div
      role="textbox"
      aria-readonly="true"
      aria-label={label ? `${label}: ${full}` : full}
      aria-describedby={describedBy}
      tabIndex={0}
      title={hint ? `${tooltip}\n\n${hint}` : tooltip}
      className="w-full flex items-center gap-2 pl-3 pr-2.5 py-2 text-sm font-mono rounded-xl bg-slate-100 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 cursor-default hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:border-[color:var(--accent-400)] transition-colors duration-200"
      style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.25)' }}
    >
      <span className="flex-1 min-w-0 truncate">{preview}</span>
      <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </div>
  );
}

/**
 * Renders a single key row inside a schema section. The parent
 * (SchemaRenderer) does the schema walking, search filtering, showWhen
 * resolution, and i18n resolution; this component just handles the row's
 * markup, widget dispatch, reset button, and optional toggle.
 *
 * Props are pre-derived by the caller — i.e. `label` / `description` are the
 * already-resolved strings (with i18n + {value}/{eval:} interpolation
 * applied), `currentValue` is a string, `defaultStr` is the canonical
 * default string or null, and the various boolean flags reflect the row's
 * effective state in the current section/search context.
 *
 * `readonly` rows (a value the parser can't rewrite safely — multi-line,
 * two assignments on one line, a function) show a cleaned-up preview of the
 * value (ReadonlyValue) and a "Read-only" pill whose tooltip is
 * `readonlyText.hint`; the explanation itself is the editor's one
 * ReadonlyNote. `sectionGated` / `widgetDisabled` really disable the controls
 * (the disabled attribute, via <fieldset disabled> for the child widgets),
 * so the keyboard can't edit them either.
 *
 * `readonlyText.keybind` / `readonlyText.multiSelect` also carry the keybind
 * and multi-select widgets' localized strings (the renderers pass
 * `readonlyText` through as the rows' one text bundle); the widgets fall back
 * to English without them.
 */
export default function SchemaRow({
  keyName,
  keyDef,
  entryIdx,
  currentValue,
  isPresent,
  isOptional,
  readonly = false,
  isQuoted = false,
  readonlyText = DEFAULT_READONLY_TEXT,
  type,
  label,
  description,
  options,
  defaultStr,
  canReset,
  widgetDisabled,
  sectionGated,
  sectionHint,
  sectionId = null,
  onUpdateValue,
  onAddOptional,
  onRemoveOptional,
  modFilename,
  addToast,
}) {
  const toggleDisabled = readonly || sectionGated;
  const handleToggleOptional = () => {
    if (toggleDisabled) return;
    if (isPresent) {
      // Remove by the exact index the parent resolved for this row — matching
      // on (key, section) again would drop unrelated same-named siblings, or
      // (when the file groups keys under decorative banners whose names differ
      // from the schema's section ids) match nothing and silently no-op.
      onRemoveOptional?.(entryIdx);
    } else {
      // Optional keys without a schema default need a type-appropriate
      // seed. Bare `''` for int/float/bool/list/multi-select produces
      // `key = ,` (Lua syntax error) because those types serialize unquoted.
      // A select without a default seeds with its first option.
      const seed = defaultStr ?? typedDefaultSeed(type, options);
      // sectionHint lets the parser place the new line inside its proper
      // section in config.lua (rather than dumping every toggle-on at the
      // file bottom). It's the file's own section name, already mapped from
      // the schema section id by the parent. sectionId (the schema's own id)
      // lets the parser's self-check confirm the line binds back to this row.
      onAddOptional?.(keyName, seed, type, sectionHint, keyDef, sectionId);
    }
  };

  // int / float text input: a value that isn't a valid number is never kept —
  // blur reverts to the last valid value typed (or the value at focus).
  const isNumeric = type === 'int' || type === 'float';
  const lastValid = useRef(currentValue);
  // Every edit path goes through here: a disabled row (gated section,
  // optional key switched off, read-only value) never writes.
  const update = (v) => { if (!widgetDisabled) onUpdateValue(entryIdx, v); };

  return (
    <div className={`group flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-opacity duration-300 ${sectionGated ? 'opacity-30' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</label>
          <TypeBadge type={type} hasOptions={!!options} />
          {readonly && <ReadonlyBadge label={readonlyText.badge} hint={readonlyText.hint} />}
          {isOptional && (
            <span className={`text-[9px] font-bold uppercase tracking-widest leading-none px-1.5 py-0.5 rounded-full ${isPresent ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30' : 'text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800'}`}>
              {isPresent ? 'on' : 'off'}
            </span>
          )}
        </div>
        {description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-snug">{description}</p>}
      </div>

      {canReset && (
        <button
          type="button"
          title={`Reset to default (${defaultStr})`}
          disabled={widgetDisabled}
          onClick={() => update(defaultStr)}
          className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-200"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}

      {keyDef.openPath && (
        <fieldset disabled={sectionGated} className="shrink-0 min-w-0">
          <OpenPathButton modFilename={modFilename} spec={keyDef.openPath} addToast={addToast} />
        </fieldset>
      )}

      {isOptional && (
        <button
          type="button"
          onClick={handleToggleOptional}
          disabled={toggleDisabled}
          aria-pressed={isPresent}
          title={isPresent ? 'Disable — remove from config.lua' : 'Enable — write to config.lua'}
          className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 disabled:pointer-events-none ${readonly && !sectionGated ? 'opacity-40' : ''} ${!isPresent ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
          style={isPresent ? { backgroundColor: 'var(--accent-500)' } : undefined}
        >
          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${isPresent ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      )}

      {/* <fieldset disabled> also disables the controls inside child widgets
          (color picker, keybind capture) — mouse AND keyboard. A read-only
          preview is not a form control, so it stays focusable. A gated row
          is already dimmed as a whole; only an optional key that's switched
          off dims its widget. */}
      <fieldset
        disabled={widgetDisabled}
        className={`shrink-0 w-44 min-w-0 transition-all duration-300 ${widgetDisabled && !readonly ? 'pointer-events-none select-none' : ''} ${widgetDisabled && !readonly && !sectionGated ? 'opacity-40' : ''}`}
      >
        {readonly ? (
          <ReadonlyValue
            value={currentValue}
            isQuoted={isQuoted}
            label={label}
            hint={readonlyText.hint}
            describedBy={READONLY_NOTE_ID}
          />
        ) : type === 'bool' ? (
          <button
            type="button"
            aria-pressed={currentValue === 'true'}
            aria-label={label}
            disabled={widgetDisabled}
            onClick={() => update(currentValue === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${currentValue !== 'true' ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
            style={currentValue === 'true' ? { backgroundColor: 'var(--accent-500)' } : undefined}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${currentValue === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        ) : type === 'color' ? (
          <ColorPicker value={currentValue} onChange={update} />
        ) : type === 'keybind' ? (
          <KeybindInput value={currentValue} onChange={update} text={readonlyText.keybind} />
        ) : keyDef.widget === 'slider' && (type === 'int' || type === 'float') && keyDef.min !== undefined && keyDef.max !== undefined ? (
          <SliderInput
            value={currentValue}
            min={keyDef.min}
            max={keyDef.max}
            step={keyDef.step}
            type={type}
            disabled={widgetDisabled}
            onChange={update}
          />
        ) : type === 'multi-select' ? (
          <MultiSelectInput
            value={currentValue}
            options={options || []}
            disabled={widgetDisabled}
            onChange={update}
            text={readonlyText.multiSelect}
          />
        ) : type === 'list' ? (
          <StringListInput
            value={currentValue}
            disabled={widgetDisabled}
            onChange={update}
          />
        ) : options ? (
          // 2 options or fewer fit nicely as side-by-side pills.
          // 3+ options become a dropdown — pills wrap awkwardly
          // and feel cluttered once you can't see the "row" at
          // a glance.
          options.length <= 2 ? (
            <div className="grid gap-1.5 justify-end" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
              {options.map(opt => {
                // Stored entry values are ALWAYS strings; a schema option value
                // can be a JSON number/bool (e.g. `{value: 0}`). Compare and
                // write as strings so a numeric option highlights and persists
                // correctly instead of `0 === "0"` always being false.
                const optStr = String(opt.value);
                const isActive = optStr === currentValue;
                return (
                  <button
                    key={optStr}
                    type="button"
                    aria-pressed={isActive}
                    disabled={widgetDisabled}
                    onClick={() => update(optStr)}
                    className={`py-1.5 text-xs font-bold rounded-full text-center transition-all duration-300 active:scale-90 ${
                      !isActive ? 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/50 dark:border-slate-700/50' : 'text-white border border-transparent'
                    }`}
                    style={isActive ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 8px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
                  >
                    {optStr}
                  </button>
                );
              })}
            </div>
          ) : (
            <SingleSelectDropdown
              value={currentValue}
              options={options}
              disabled={widgetDisabled}
              onChange={update}
            />
          )
        ) : (
          <input
            type="text"
            inputMode={type === 'int' ? 'numeric' : type === 'float' ? 'decimal' : 'text'}
            value={currentValue}
            aria-label={label}
            disabled={widgetDisabled}
            onChange={(e) => {
              if (widgetDisabled) return;
              if (isNumeric && isValidNumber(e.target.value, type)) lastValid.current = e.target.value;
              update(e.target.value);
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '';
              if (widgetDisabled || !isNumeric) return;
              const raw = e.target.value;
              if (!isValidNumber(raw, type)) {
                if (lastValid.current !== raw) update(lastValid.current);
                return;
              }
              // min/max clamping on blur — same rule as save, so rounding can
              // never push the result back out of range.
              const clamped = clampToRange(raw, { min: keyDef.min, max: keyDef.max, type });
              if (clamped !== raw) update(clamped);
            }}
            className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 transition-all duration-200"
            style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent-400)';
              lastValid.current = currentValue;
            }}
          />
        )}
      </fieldset>
    </div>
  );
}
