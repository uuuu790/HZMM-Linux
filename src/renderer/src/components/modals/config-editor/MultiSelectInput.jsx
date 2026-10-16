import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import LiquidGlass from '../../common/LiquidGlass';
import { parseLuaArray, serializeLuaArray } from '../../../utils/config-parser';

// Multi-select rendered as a dropdown panel — much tidier than a row of
// pills once the option count climbs. Trigger shows a short summary,
// click reveals a scrollable checkbox list. Closes on outside click.
//
// Storage stays the same Lua array literal so save/reload round-trips
// through `parseLuaArray` / `serializeLuaArray`.

// Summary text. ConfigEditorModal passes the localized strings; these English
// fallbacks only show when the widget is mounted without them.
export const DEFAULT_MULTI_SELECT_TEXT = {
  none: 'None',
  count: '{count} selected',
};

export default function MultiSelectInput({ value, options, disabled, onChange, text = DEFAULT_MULTI_SELECT_TEXT }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const current = parseLuaArray(value) || [];
  const selectedSet = new Set(current);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Stored array items are ALWAYS strings (parseLuaArray yields strings); a
  // schema option value can be a JSON number/bool. Compare and store everything
  // as strings so a numeric option checks/toggles correctly instead of adding a
  // number `1` alongside the string `"1"` (which serialized to a duplicate).
  const toggle = (v) => {
    const next = new Set(selectedSet);
    if (next.has(v)) next.delete(v); else next.add(v);
    // Preserve schema-declared option order for known options, then
    // append any items already present in the value that aren't part of
    // the schema (custom user entries, schema-removed options). Without
    // the tail, the first toggle silently wipes any non-canonical item.
    const schemaValues = new Set(options.map(o => String(o.value)));
    const ordered = options.map(o => String(o.value)).filter(v2 => next.has(v2));
    for (const item of current) {
      if (!schemaValues.has(item) && next.has(item)) ordered.push(item);
    }
    onChange(serializeLuaArray(ordered));
  };

  const summary = selectedSet.size === 0
    ? text.none
    : selectedSet.size <= 2
      ? [...selectedSet].join(', ')
      : text.count.split('{count}').join(String(selectedSet.size));

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-1"
        style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
      >
        <span className="truncate text-left">{summary}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 ml-2 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <LiquidGlass radius={14} edge={12} strength={26} blur={10} className="lg-menu absolute inset-x-0 mt-1 z-20 rounded-[14px] overflow-hidden">
          <div className="max-h-60 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
            {options.map(opt => {
              const optStr = String(opt.value);
              const isOn = selectedSet.has(optStr);
              return (
                <button
                  key={optStr}
                  type="button"
                  onClick={() => toggle(optStr)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-white/50 dark:hover:bg-white/[0.06] transition-colors text-left"
                >
                  <span
                    className={`shrink-0 w-4 h-4 inline-flex items-center justify-center rounded border transition-all ${isOn ? 'border-transparent' : 'border-slate-300 dark:border-slate-600'}`}
                    style={isOn ? { backgroundColor: 'var(--accent-500)' } : undefined}
                  >
                    {isOn && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </span>
                  <span className="text-slate-700 dark:text-slate-200">{optStr}</span>
                </button>
              );
            })}
          </div>
        </LiquidGlass>
      )}
    </div>
  );
}
