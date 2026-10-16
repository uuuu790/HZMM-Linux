import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import LiquidGlass from '../../common/LiquidGlass';

// Single-select dropdown — same panel chrome as MultiSelectInput so the
// editor has one visual idiom for "pick from a list" instead of two
// (native <select> looks foreign next to the multi-select panel).
//
// Behavioural difference vs MultiSelectInput: clicking an option emits
// the value and auto-closes the panel.

export default function SingleSelectDropdown({ value, options, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (v) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-1"
        style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
      >
        <span className="truncate text-left">{value || '...'}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 ml-2 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <LiquidGlass radius={14} edge={12} strength={26} blur={10} className="lg-menu absolute inset-x-0 mt-1 z-20 rounded-[14px] overflow-hidden">
          <div className="max-h-60 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
            {options.map(opt => {
              // Stored values are strings; option values may be JSON numbers/bools.
              // Compare/emit as strings so numeric options select correctly.
              const optStr = String(opt.value);
              const isOn = optStr === value;
              return (
                <button
                  key={optStr}
                  type="button"
                  onClick={() => handleSelect(optStr)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left ${isOn ? 'bg-white/40 dark:bg-white/[0.07]' : 'hover:bg-white/50 dark:hover:bg-white/[0.06]'}`}
                >
                  <span className="shrink-0 w-4 h-4 inline-flex items-center justify-center">
                    {isOn && <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent-500)' }} strokeWidth={3} />}
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
