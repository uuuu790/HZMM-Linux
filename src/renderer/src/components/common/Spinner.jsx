/**
 * Generic ring spinner. Used for Suspense fallbacks, async loading states,
 * and inline indicators. The default `size="md"` + `block=true` matches the
 * inline pattern previously duplicated across all lazy-loaded tab boundaries
 * (`<div className="flex items-center justify-center py-20">...`).
 *
 * Props:
 *   size  — 'sm' (w-4 h-4 / border-2) | 'md' (w-6 h-6 / border-2) | 'lg' (w-16 h-16 / border-4)
 *   block — when true, wrap in a centered `py-20` block (Suspense default).
 *           Set false for inline use next to text or inside small UI rows.
 */
export default function Spinner({ size = 'md', block = true }) {
  const ring = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-16 h-16 border-4',
  }[size] || 'w-6 h-6 border-2';

  const dot = (
    <div
      className={`${ring} border-slate-300 dark:border-slate-600 border-t-transparent rounded-full animate-spin`}
    />
  );

  if (!block) return dot;

  return (
    <div className="flex items-center justify-center py-20">
      {dot}
    </div>
  );
}
