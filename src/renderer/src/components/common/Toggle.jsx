// Shared on/off switch: accent track when on, slate track when off, white
// spring-eased knob. `label` names the setting for screen readers.
//
// The knob is positioned with the `translate` property, not `transform`, so
// the toggle-bounce keyframes (transform: scale) can play without fighting
// the position. Offsets are measured inside the 1px track border.
const SIZES = {
  sm: { track: 'w-8 h-4', knob: 'h-3 w-3', off: '1px', on: '17px' },
  md: { track: 'w-11 h-6', knob: 'h-[18px] w-[18px]', off: '2px', on: '22px' },
};

export default function Toggle({ checked, onChange, size = 'md', label, disabled = false, className = '' }) {
  const s = SIZES[size] || SIZES.md;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        const knob = e.currentTarget.firstElementChild;
        if (knob) { knob.classList.remove('toggle-bounce'); void knob.offsetWidth; knob.classList.add('toggle-bounce'); }
        onChange(!checked);
      }}
      className={`relative inline-block shrink-0 rounded-full shadow-inner border border-black/5 dark:border-white/10 transition-colors duration-300 active:scale-90 disabled:opacity-50 disabled:pointer-events-none ${s.track} ${checked ? '' : 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400/80 dark:hover:bg-slate-600'} ${className}`}
      style={checked ? { backgroundColor: 'var(--accent-500)' } : undefined}
    >
      <span
        className={`absolute left-0 top-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] ${s.knob}`}
        style={{
          translate: `${checked ? s.on : s.off} -50%`,
          transition: 'translate 450ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </button>
  );
}
