// Slider widget for numeric keys. Native <input type="range"> paired with
// a small text input on the right so the user can either drag or type.
//
// Schema must declare both `min` and `max` for the slider to work — the
// renderer is responsible for falling back to a plain input when those
// aren't present.

export default function SliderInput({ value, min, max, step, type, disabled, onChange }) {
  const isInt = type === 'int';
  const stepValue = step ?? (isInt ? 1 : 0.1);
  const numValue = (() => {
    const n = isInt ? parseInt(value, 10) : parseFloat(value);
    if (isNaN(n)) return min;
    return n;
  })();

  const commit = (raw) => {
    let n = isInt ? parseInt(raw, 10) : parseFloat(raw);
    if (isNaN(n)) n = min;
    n = Math.max(min, Math.min(max, n));
    onChange(isInt ? String(Math.round(n)) : String(parseFloat(n.toFixed(4))));
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
        className="flex-1 h-1.5 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 cursor-pointer focus:outline-none"
        style={{ accentColor: 'var(--accent-500)' }}
      />
      <input
        type="text"
        inputMode={isInt ? 'numeric' : 'decimal'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        disabled={disabled}
        className="w-14 px-2 py-1 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 text-center"
        style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
      />
    </div>
  );
}
