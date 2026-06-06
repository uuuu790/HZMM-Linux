import { useEffect, useRef, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

// Keybind capture widget. Click → "Press a key…" state → next keypress
// becomes the bound combo (e.g. "Ctrl+Shift+F", "F6").
// Escape cancels capture, the X button clears the binding.
//
// We record purely on keydown so the combo we emit reflects the modifier
// state at the moment the main key was pressed. Pure modifier presses
// (Ctrl alone, Shift alone) are ignored — we wait for an actual key.

import { codeToMainKey } from '../../../utils/widget-helpers';

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function buildCombo(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  parts.push(codeToMainKey(e.code));
  return parts.join('+');
}

export default function KeybindInput({ value, onChange }) {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!recording) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      if (MODIFIER_KEYS.has(e.key)) return; // wait for the actual key
      onChange(buildCombo(e));
      setRecording(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, onChange]);

  const display = recording ? '按下任意鍵…' : (value || '點擊設定');

  return (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setRecording((r) => !r)}
        className={`w-full inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono border transition-all duration-200 ${
          recording
            ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300/60 dark:border-amber-700/40 text-amber-700 dark:text-amber-300 animate-pulse'
            : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        <Keyboard className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate flex-1 text-left">{display}</span>
      </button>
      {value && !recording && (
        <button
          type="button"
          title="Clear binding"
          onClick={(e) => { e.stopPropagation(); onChange(''); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
