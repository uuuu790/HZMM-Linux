import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { parseLuaArray, serializeLuaArray } from '../../../utils/config-parser';

// Multi-select rendered as a dropdown panel — much tidier than a row of
// pills once the option count climbs. Trigger shows a short summary,
// click reveals a scrollable checkbox list. Closes on outside click.
//
// Storage stays the same Lua array literal so save/reload round-trips
// through `parseLuaArray` / `serializeLuaArray`.

export default function MultiSelectInput({ value, options, disabled, onChange }) {
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

  const toggle = (v) => {
    const next = new Set(selectedSet);
    if (next.has(v)) next.delete(v); else next.add(v);
    // Preserve schema-declared option order for known options, then
    // append any items already present in the value that aren't part of
    // the schema (custom user entries, schema-removed options). Without
    // the tail, the first toggle silently wipes any non-canonical item.
    const schemaValues = new Set(options.map(o => o.value));
    const ordered = options.map(o => o.value).filter(v2 => next.has(v2));
    for (const item of current) {
      if (!schemaValues.has(item) && next.has(item)) ordered.push(item);
    }
    onChange(serializeLuaArray(ordered));
  };

  const summary = selectedSet.size === 0
    ? '無'
    : selectedSet.size <= 2
      ? [...selectedSet].join(', ')
      : `已選 ${selectedSet.size} 個`;

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
        <div className="absolute inset-x-0 mt-1 z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700/50 shadow-xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
            {options.map(opt => {
              const isOn = selectedSet.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors text-left"
                >
                  <span
                    className={`shrink-0 w-4 h-4 inline-flex items-center justify-center rounded border transition-all ${isOn ? 'border-transparent' : 'border-slate-300 dark:border-slate-600'}`}
                    style={isOn ? { backgroundColor: 'var(--accent-500)' } : undefined}
                  >
                    {isOn && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </span>
                  <span className="text-slate-700 dark:text-slate-200">{opt.value}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
