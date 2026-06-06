// Loading-state placeholder that mirrors NexusModCard's silhouette so the
// grid doesn't collapse height when we're waiting on a V2 GraphQL response.
// Uses the existing `animate-pulse` keyframe + a faint slate base for the animate-pulse
// sweep — same visual language as the module card skeleton.

export default function NexusModCardSkeleton({ index = 0 }) {
  const delayMs = Math.min(index, 15) * 35;
  return (
    <div
      className="relative flex flex-col rounded-2xl bg-white/60 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-700/50 overflow-hidden animate-slide-up"
      style={{
        animationFillMode: 'both',
        animationDelay: `${delayMs}ms`,
        animationDuration: '420ms',
        // Match the real card — no content-visibility skip, just sibling
        // isolation via `contain`. Skeletons only live for 150ms anyway so
        // the cost savings from skipping paint were negligible.
        contain: 'layout paint',
      }}
    >
      {/* Thumbnail skeleton */}
      <div className="relative aspect-[16/9] bg-slate-200/70 dark:bg-slate-800/80 overflow-hidden animate-pulse">
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/10 to-transparent" />
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        {/* Title lines */}
        <div className="h-4 w-3/4 rounded-md bg-slate-200/70 dark:bg-slate-800/80 animate-pulse" />
        <div className="h-3 w-1/3 rounded-md bg-slate-200/50 dark:bg-slate-800/60 animate-pulse" />
        {/* Summary lines */}
        <div className="h-2.5 w-full rounded-md bg-slate-200/40 dark:bg-slate-800/50 animate-pulse mt-1" />
        <div className="h-2.5 w-5/6 rounded-md bg-slate-200/40 dark:bg-slate-800/50 animate-pulse" />
        {/* Footer row */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-auto">
          <div className="h-3 w-16 rounded-md bg-slate-200/50 dark:bg-slate-800/60 animate-pulse" />
          <div className="h-7 w-20 rounded-full bg-slate-200/70 dark:bg-slate-800/80 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
