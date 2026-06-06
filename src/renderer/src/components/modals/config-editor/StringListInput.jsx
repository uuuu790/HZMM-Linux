import { Plus, X } from 'lucide-react';
import { parseLuaArray, serializeLuaArray } from '../../../utils/config-parser';

// Free-form list of strings (no schema-defined options). Each entry has
// its own row with a text input and a delete button; "+ 新增" appends a
// blank entry.
//
// Storage: same Lua array literal as MultiSelectInput (`{"a","b"}`),
// serialized via parseLuaArray / serializeLuaArray.

export default function StringListInput({ value, disabled, onChange }) {
  const items = parseLuaArray(value) || [];

  const replace = (next) => onChange(serializeLuaArray(next));
  const setItem = (i, v) => replace(items.map((it, idx) => (idx === i ? v : it)));
  const removeItem = (i) => replace(items.filter((_, idx) => idx !== i));
  const addItem = () => replace([...items, '']);

  return (
    <div className={`flex flex-col gap-1 w-full ${disabled ? 'pointer-events-none' : ''}`}>
      {items.length === 0 && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic text-center py-1">empty</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={item}
            onChange={(e) => setItem(i, e.target.value)}
            disabled={disabled}
            className="flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1"
            style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.2)' }}
          />
          <button
            type="button"
            onClick={() => removeItem(i)}
            disabled={disabled}
            title="Remove"
            className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 active:scale-90 transition-all"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        disabled={disabled}
        className="w-full inline-flex items-center justify-center gap-1 py-1 text-[11px] font-bold rounded-md text-slate-500 dark:text-slate-400 bg-slate-100/70 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 border border-dashed border-slate-300 dark:border-slate-600 active:scale-95 transition-all"
      >
        <Plus className="w-3 h-3" />
        新增
      </button>
    </div>
  );
}
