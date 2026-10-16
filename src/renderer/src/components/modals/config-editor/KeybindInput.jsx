import { useEffect, useRef, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

// Keybind capture widget. Click → "Press a key…" state → next keypress
// becomes the bound combo in UE4SS Key names (e.g. "Ctrl+Shift+F", "F6",
// "Alt+ONE", "NUM_ONE"; format in utils/keybind.ts).
// Escape cancels capture, the X button clears the binding.
//
// We record purely on keydown so the combo we emit reflects the modifier
// state at the moment the main key was pressed. Keys with no UE4SS Key
// equivalent — including pure modifier presses (Ctrl alone, Shift alone) —
// are ignored and we keep waiting for a usable key.
//
// Recording is tied to focus: the button focuses itself when recording
// starts, and focus moving anywhere else (another keybind, the search box)
// cancels it. So only one widget ever records, and keys typed elsewhere are
// never swallowed.

import { buildKeybind, normalizeKeybind } from '../../../utils/keybind';

// UI text. ConfigEditorModal passes the localized strings; these English
// fallbacks only show when the widget is mounted without them.
export const DEFAULT_KEYBIND_TEXT = {
  recording: 'Press any key…',
  empty: 'Click to set',
  clear: 'Clear binding',
};

export default function KeybindInput({ value, onChange, text = DEFAULT_KEYBIND_TEXT }) {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef(null);

  // HZMM <= 1.6.0 stored main keys UE4SS can't resolve ("Numpad1", "ArrowUp",
  // "Meta+Comma"). ConfigEditorModal converts them on load (and the next save
  // writes the new form); normalizing here too keeps the display right for any
  // value that reaches the widget another way. Uninterpretable values show as-is.
  const normalized = value ? normalizeKeybind(value) : value;

  useEffect(() => {
    if (!recording) return;
    const handler = (e) => {
      // Focus left without a blur reaching us — stop, and let the key through.
      if (document.activeElement !== buttonRef.current) { setRecording(false); return; }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      const combo = buildKeybind(e);
      if (!combo) return; // modifier-only or no UE4SS Key — keep recording
      onChange(combo);
      setRecording(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, onChange]);

  const display = recording ? text.recording : (normalized || text.empty);

  return (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!recording) buttonRef.current?.focus();
          setRecording(!recording);
        }}
        onBlur={() => setRecording(false)}
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
          title={text.clear}
          aria-label={text.clear}
          onClick={(e) => { e.stopPropagation(); onChange(''); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
