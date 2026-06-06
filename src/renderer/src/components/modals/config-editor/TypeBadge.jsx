// Small pill showing the inferred type of a config value. Shared by both
// the schema-driven and comment-driven renderers in ConfigEditorModal.

export default function TypeBadge({ type, hasOptions }) {
  const styles = type === 'bool' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
    : type === 'int' || type === 'float' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
    : type === 'color' ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400'
    : type === 'keybind' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
    : type === 'multi-select' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
    : type === 'list' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
    : hasOptions ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
  const label = type === 'bool' ? 'ON/OFF'
    : type === 'int' ? 'INT'
    : type === 'float' ? 'FLOAT'
    : type === 'color' ? 'COLOR'
    : type === 'keybind' ? 'KEY'
    : type === 'multi-select' ? 'MULTI'
    : type === 'list' ? 'LIST'
    : hasOptions ? 'SELECT'
    : 'TEXT';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full leading-none ${styles}`}>{label}</span>;
}
