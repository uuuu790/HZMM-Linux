// Small pill showing the inferred type of a config value. Shared by both
// the schema-driven and comment-driven renderers in ConfigEditorModal.
// 'table' / 'code' mark a read-only value that is a Lua table with named
// fields or a function — in comment mode, and in schema mode for a read-only
// row whose key has no `type`.

export default function TypeBadge({ type, hasOptions }) {
  const styles = type === 'bool' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
    : type === 'int' || type === 'float' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
    : type === 'color' ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400'
    : type === 'keybind' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
    : type === 'multi-select' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
    : type === 'list' || type === 'table' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
    : hasOptions ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
  const label = type === 'bool' ? 'ON/OFF'
    : type === 'int' ? 'INT'
    : type === 'float' ? 'FLOAT'
    : type === 'color' ? 'COLOR'
    : type === 'keybind' ? 'KEY'
    : type === 'multi-select' ? 'MULTI'
    : type === 'list' ? 'LIST'
    : type === 'table' ? 'TABLE'
    : type === 'code' ? 'CODE'
    : hasOptions ? 'SELECT'
    : 'TEXT';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full leading-none ${styles}`}>{label}</span>;
}

// "Read-only" status pill next to the TypeBadge of a value the editor can't
// rewrite. Shaped like the optional on/off pill, in neutral slate on purpose —
// amber already means SELECT / key capture, and the default accent is orange.
// 10px (the TypeBadge's size and height) rather than the on/off pill's 9px:
// 「唯讀」/「読み取り専用」 are illegible at 9px. One step darker than
// slate-100, which disappears against the modal's frosted surface. `hint`
// (why it's read-only) is the tooltip.
export function ReadonlyBadge({ label, hint }) {
  return (
    <span
      title={hint || undefined}
      className="text-[10px] font-bold uppercase tracking-wider leading-none px-1.5 py-0.5 rounded-full text-slate-600 dark:text-slate-300 bg-slate-200/80 dark:bg-slate-700/60 cursor-help"
    >
      {label}
    </span>
  );
}
