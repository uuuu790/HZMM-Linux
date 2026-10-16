import { useRef } from 'react';
import { isValidNumber, clampToRange } from '../../../utils/widget-helpers';

// Slider widget for numeric keys. Native <input type="range"> paired with
// a small text input on the right so the user can either drag or type.
//
// Schema must declare both `min` and `max` for the slider to work — the
// renderer is responsible for falling back to a plain input when those
// aren't present.

export default function SliderInput({ value, min, max, step, type, disabled, onChange }) {
  const isInt = type === 'int';
  const stepValue = step ?? (isInt ? 1 : 0.1);
  // Last valid number typed (or the value at focus): an invalid entry in the
  // text box ("", "ten", "1,5") reverts to it on blur instead of being saved.
  const lastValid = useRef(value);
  const numValue = (() => {
    const n = isInt ? parseInt(value, 10) : parseFloat(value);
    if (isNaN(n)) return min;
    return n;
  })();

  // Round to the stored precision, then clamp with the save-time rule, which
  // never lets the rounding push the value back out of [min, max]. A float at
  // or past a bound isn't rounded first: it becomes the bound itself, so a
  // tiny max (0.00004) never rounds to 0.
  const commit = (raw) => {
    const n = Number(raw);
    const rounded = isInt ? String(Math.round(n)) : (n <= min || n >= max ? String(n) : String(parseFloat(n.toFixed(4))));
    onChange(clampToRange(rounded, { min, max, type }));
  };

  return (
    <div className={`flex items-center gap-2 w-full ${disabled ? 'pointer-events-none' : ''}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={stepValue}
        value={numValue}
        onChange={(e) => commit(e.target.value)}
        disabled={disabled}
        className="flex-1 min-w-0 h-1.5 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 cursor-pointer focus:outline-none"
        style={{ accentColor: 'var(--accent-500)' }}
      />
      <input
        type="text"
        inputMode={isInt ? 'numeric' : 'decimal'}
        value={value}
        onFocus={() => { lastValid.current = value; }}
        onChange={(e) => {
          if (isValidNumber(e.target.value, type)) lastValid.current = e.target.value;
          onChange(e.target.value);
        }}
        onBlur={(e) => {
          const raw = e.target.value;
          if (!isValidNumber(raw, type)) {
            if (lastValid.current !== raw) onChange(lastValid.current);
          } else if (Number(raw) < min || Number(raw) > max) {
            // Clamp only out-of-range input; an in-range value keeps its
            // text, so a focus + blur doesn't turn "25.0" into "25".
            commit(raw);
          }
        }}
        disabled={disabled}
        className="w-14 px-2 py-1 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 text-center"
        style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
      />
    </div>
  );
}
