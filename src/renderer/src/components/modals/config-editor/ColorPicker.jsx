// Hex color input. Wraps the native <input type="color"> for the picker
// affordance, but renders a glass-style swatch + hex label so the control
// matches the rest of the editor visually. Stores `#RRGGBB` strings.
//
// Mod-author contract: keys with `"type": "color"` get this widget. The
// underlying value is always a quoted string in config.lua — the parser
// already strips quotes, so we never see them here.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalize(value) {
  // Native picker rejects malformed input. Coerce common alternatives so
  // mods that store "3b82f6" (no #) or "#fff" (3-digit) still display.
  if (typeof value !== 'string') return '#000000';
  const trimmed = value.trim();
  if (HEX_RE.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const c = trimmed.slice(1);
    return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`.toLowerCase();
  }
  return '#000000';
}

export default function ColorPicker({ value, onChange }) {
  const display = typeof value === 'string' ? value : '';
  const safe = normalize(display);

  return (
    <label className="relative flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700/50 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors duration-200">
      <span
        className="w-5 h-5 rounded-md border border-black/10 dark:border-white/10 shadow-inner shrink-0"
        style={{ backgroundColor: safe }}
      />
      <span className="font-mono text-xs text-slate-700 dark:text-slate-200 truncate flex-1">{display || safe}</span>
      <input
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
    </label>
  );
}
