import { RotateCcw } from 'lucide-react';
import TypeBadge from './TypeBadge';
import OpenPathButton from './OpenPathButton';
import ColorPicker from './ColorPicker';
import KeybindInput from './KeybindInput';
import SliderInput from './SliderInput';
import MultiSelectInput from './MultiSelectInput';
import SingleSelectDropdown from './SingleSelectDropdown';
import StringListInput from './StringListInput';

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
 */
export default function SchemaRow({
  keyName,
  keyDef,
  entryIdx,
  currentValue,
  isPresent,
  isOptional,
  type,
  label,
  description,
  options,
  defaultStr,
  canReset,
  widgetDisabled,
  sectionGated,
  sectionId,
  onUpdateValue,
  onAddOptional,
  onRemoveOptional,
  modFilename,
  addToast,
}) {
  const handleToggleOptional = () => {
    if (isPresent) {
      // sectionHint scopes removal to this section only — without it, an
      // optional key shared across sections drops every sibling entry too.
      onRemoveOptional?.(keyName, sectionId);
    } else {
      const seed = defaultStr ?? '';
      // sectionHint lets the parser place the new line inside its proper
      // section in config.lua (rather than dumping every toggle-on at the
      // file bottom).
      onAddOptional?.(keyName, seed, type, sectionId);
    }
  };

  return (
    <div className={`group flex items-center gap-4 py-3.5 border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition-opacity duration-300 ${sectionGated ? 'opacity-30' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <label className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</label>
          <TypeBadge type={type} hasOptions={!!options} />
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
          onClick={() => onUpdateValue(entryIdx, defaultStr)}
          className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-90 opacity-0 group-hover:opacity-100 transition-all duration-200"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}

      {keyDef.openPath && (
        <OpenPathButton modFilename={modFilename} spec={keyDef.openPath} addToast={addToast} />
      )}

      {isOptional && (
        <button
          type="button"
          onClick={handleToggleOptional}
          title={isPresent ? 'Disable — remove from config.lua' : 'Enable — write to config.lua'}
          className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${!isPresent ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
          style={isPresent ? { backgroundColor: 'var(--accent-500)' } : undefined}
        >
          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${isPresent ? 'translate-x-5' : 'translate-x-1'}`} />
        </button>
      )}

      <div className={`shrink-0 w-44 transition-all duration-300 ${widgetDisabled ? 'opacity-40 pointer-events-none select-none' : ''}`}>
        {type === 'bool' ? (
          <button
            onClick={() => isPresent && onUpdateValue(entryIdx, currentValue === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${currentValue !== 'true' ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
            style={currentValue === 'true' ? { backgroundColor: 'var(--accent-500)' } : undefined}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${currentValue === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        ) : type === 'color' ? (
          <ColorPicker value={currentValue} onChange={(v) => isPresent && onUpdateValue(entryIdx, v)} />
        ) : type === 'keybind' ? (
          <KeybindInput value={currentValue} onChange={(v) => isPresent && onUpdateValue(entryIdx, v)} />
        ) : keyDef.widget === 'slider' && (type === 'int' || type === 'float') && keyDef.min !== undefined && keyDef.max !== undefined ? (
          <SliderInput
            value={currentValue}
            min={keyDef.min}
            max={keyDef.max}
            step={keyDef.step}
            type={type}
            disabled={!isPresent}
            onChange={(v) => isPresent && onUpdateValue(entryIdx, v)}
          />
        ) : type === 'multi-select' ? (
          <MultiSelectInput
            value={currentValue}
            options={options || []}
            disabled={!isPresent}
            onChange={(v) => isPresent && onUpdateValue(entryIdx, v)}
          />
        ) : type === 'list' ? (
          <StringListInput
            value={currentValue}
            disabled={!isPresent}
            onChange={(v) => isPresent && onUpdateValue(entryIdx, v)}
          />
        ) : options ? (
          // 2 options or fewer fit nicely as side-by-side pills.
          // 3+ options become a dropdown — pills wrap awkwardly
          // and feel cluttered once you can't see the "row" at
          // a glance.
          options.length <= 2 ? (
            <div className="grid gap-1.5 justify-end" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
              {options.map(opt => {
                const isActive = opt.value === currentValue;
                return (
                  <button
                    key={opt.value}
                    onClick={() => isPresent && onUpdateValue(entryIdx, opt.value)}
                    className={`py-1.5 text-xs font-bold rounded-full text-center transition-all duration-300 active:scale-90 ${
                      !isActive ? 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/50 dark:border-slate-700/50' : 'text-white border border-transparent'
                    }`}
                    style={isActive ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 8px -2px rgba(var(--accent-rgb), 0.4)' } : undefined}
                  >
                    {opt.value}
                  </button>
                );
              })}
            </div>
          ) : (
            <SingleSelectDropdown
              value={currentValue}
              options={options}
              disabled={!isPresent}
              onChange={(v) => isPresent && onUpdateValue(entryIdx, v)}
            />
          )
        ) : (
          <input
            type="text"
            inputMode={type === 'int' ? 'numeric' : type === 'float' ? 'decimal' : 'text'}
            value={currentValue}
            onChange={(e) => isPresent && onUpdateValue(entryIdx, e.target.value)}
            onBlur={(e) => {
              // min/max clamping on blur
              e.target.style.borderColor = '';
              if (!isPresent) return;
              if (keyDef.min !== undefined || keyDef.max !== undefined) {
                let num = type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                if (isNaN(num)) return;
                if (keyDef.min !== undefined && num < keyDef.min) num = keyDef.min;
                if (keyDef.max !== undefined && num > keyDef.max) num = keyDef.max;
                const clamped = type === 'int' ? String(num) : String(parseFloat(num.toFixed(4)));
                if (clamped !== e.target.value) onUpdateValue(entryIdx, clamped);
              }
            }}
            className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 transition-all duration-200"
            style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--accent-400)'; }}
          />
        )}
      </div>
    </div>
  );
}
