import { memo, useState, useEffect } from 'react';
import { Download, ThumbsUp, RefreshCw, Play, User, Check } from 'lucide-react';

// Format large numbers as "1.2k" / "3.4M" / "567"
function formatCount(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

// entrance:
//   'slide' — default staggered slide-up entrance (used for standalone grid loads)
//   'fade'  — each card fades in individually (legacy; kept for flexibility)
//   'none'  — no per-card animation (used when the parent layer handles the
//             fade itself, so we don't double up animations and fight over
//             opacity transitions mid-crossfade)
function NexusModCardImpl({ mod, t, onClick, onQuickInstall, installing, installingAny, installed, index = 0, entrance = 'slide', selfMod = false }) {
  // Brief "just installed" flash — mirror the installing prop going
  // true → false, then clear the green check after ~1.5s so the next
  // install session isn't still greeted with success state.
  const [justDone, setJustDone] = useState(false);
  const [wasInstalling, setWasInstalling] = useState(false);
  useEffect(() => {
    if (installing) {
      setWasInstalling(true);
    } else if (wasInstalling) {
      setWasInstalling(false);
      setJustDone(true);
      const tid = setTimeout(() => setJustDone(false), 1600);
      return () => clearTimeout(tid);
    }
  }, [installing, wasInstalling]);

  const thumb = mod.picture_url;
  const author = mod.author || mod.uploaded_by || '—';
  const version = mod.version || '';
  const downloads = mod.mod_downloads ?? mod.mod_unique_downloads ?? 0;
  const endorsements = mod.endorsement_count ?? 0;
  const adult = mod.contains_adult_content;

  // Stagger the card entrance so the grid streams in instead of popping.
  // Tight stagger (25ms) + shortish duration → matches the Settings tab feel:
  // a fast cascade of items popping into place rather than a slow parade.
  // Cap at 20 items so late cards (already past the fold) don't wait too long.
  const delayMs = entrance === 'slide' ? Math.min(index, 20) * 25 : 0;
  const entranceClass = entrance === 'fade' ? 'animate-fade-in' : entrance === 'slide' ? 'animate-slide-up' : '';

  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col rounded-2xl bg-white/60 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-700/50 overflow-hidden cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_12px_28px_rgba(0,0,0,0.4)] hover:border-slate-300/70 dark:hover:border-slate-600/70 ${entranceClass}`}
      style={{
        animationFillMode: 'both',
        animationDelay: `${delayMs}ms`,
        // Slide entrance is snappy (350ms) to keep the cascade feel tight —
        // longer durations make late cards feel like they drag in.
        animationDuration: entrance === 'slide' ? '350ms' : entrance === 'fade' ? '380ms' : '420ms',
        // Hover transition scoped to the properties we actually animate.
        // Important: Tailwind 4's -translate-y / scale / rotate utilities
        // write to the *independent* CSS `translate` / `scale` / `rotate`
        // properties, not the legacy `transform` shorthand — so they must be
        // listed explicitly or the hover lift becomes a hard snap instead of
        // a smooth rise. (`transition-all` would catch them automatically
        // but also runs on every inherited property on hover enter/leave,
        // which is expensive when scrolling past many cards.)
        transition: 'transform 300ms, translate 300ms, scale 300ms, box-shadow 300ms, border-color 300ms, background-color 300ms',
        // NOTE: we intentionally do NOT use `content-visibility: auto` here.
        // That property skips layout/paint for off-screen cards, which saves
        // initial render cost — but then pays that cost at scroll time, the
        // first time each card enters the viewport. With only ~70 mods,
        // eagerly rendering everything up front is cheap (a one-time cost
        // the bootup skeleton masks) and eliminates scroll jank entirely.
        // `contain: layout paint` still isolates each card's reflow/paint
        // from its siblings, so the grid's layout cost stays bounded.
        contain: 'layout paint',
      }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] bg-slate-100 dark:bg-slate-800 overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt={mod.name}
            loading="lazy"
            // decoding="async" moves JPEG/PNG decode off the main thread —
            // critical for scroll smoothness because lazy-loaded images decode
            // at the moment they enter viewport, which is exactly the worst
            // time to stall the compositor.
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-[1.03]"
            // Tailwind 4's scale-[1.03] sets the `scale` property directly,
            // not `transform: scale(...)` — list both so the zoom transitions
            // regardless of which mode Tailwind emits.
            style={{ transition: 'transform 500ms, scale 500ms' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
            <span className="text-4xl font-black">?</span>
          </div>
        )}
        {adult && (
          <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-black tracking-widest uppercase bg-red-500 text-white rounded-full shadow-md">
            18+
          </span>
        )}
        {version && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 text-[10px] font-mono font-bold bg-black/60 backdrop-blur-sm text-white rounded-full">
            v{version}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 p-4 flex-1">
        <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug">
          {mod.name}
        </h3>
        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
          <User className="w-3 h-3" />
          <span className="truncate">{author}</span>
        </div>
        {mod.summary && (
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed flex-1">
            {mod.summary}
          </p>
        )}

        {/* Stats + install */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-auto">
          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 min-w-0">
            <span className="flex items-center gap-1" title={t.nexusDownloads}>
              <Download className="w-3 h-3" />
              {formatCount(downloads)}
            </span>
            <span className="flex items-center gap-1" title={t.nexusEndorsements}>
              <ThumbsUp className="w-3 h-3" />
              {formatCount(endorsements)}
            </span>
          </div>
          {selfMod ? (
            // Self-mod (HZMM itself) — no install button. A subtle pill
            // replaces it so the footer doesn't look broken/unbalanced.
            <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200/60 dark:border-slate-700/60">
              {t.nexusSelfModBadge || 'This app'}
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); if (!installingAny && !justDone) onQuickInstall(); }}
              disabled={installingAny || justDone}
              title={installed ? t.nexusInstalledLabel : t.nexusInstallLatest}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full active:scale-95 [transition:background-color_300ms,box-shadow_300ms,color_300ms,transform_100ms,scale_100ms] ${
                justDone
                  ? 'bg-emerald-500 text-white'
                  : installed && !installing
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40'
                  : installingAny
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'text-white'
              }`}
              style={justDone
                ? { boxShadow: '0 4px 10px -2px rgba(16, 185, 129, 0.5)' }
                : installed && !installing && !installingAny
                ? undefined
                : !installingAny
                ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 10px -2px rgba(var(--accent-rgb), 0.4)' }
                : undefined}
            >
              {justDone
                ? <Check className="w-3 h-3" />
                : installing
                ? <RefreshCw className="w-3 h-3 animate-spin" />
                : installed
                ? <Check className="w-3 h-3" />
                : <Play className="w-3 h-3 fill-current" />}
              <span className="hidden sm:inline">
                {justDone
                  ? t.nexusInstalledToast
                  : installing
                  ? t.nexusInstalling
                  : installed
                  ? t.nexusInstalledLabel
                  : t.nexusInstall}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Memo with a custom equality check: re-render only when something this card
// actually paints has changed. Callbacks (onClick / onQuickInstall) are ignored
// because NexusTab recreates them per render but their behavior is stable per
// mod — the closures just capture the latest mod object. Re-running them on
// stale refs is fine; they read nothing that mutates between renders.
export default memo(NexusModCardImpl, (prev, next) => (
  prev.mod === next.mod &&
  prev.t === next.t &&
  prev.installing === next.installing &&
  prev.installingAny === next.installingAny &&
  prev.installed === next.installed &&
  prev.index === next.index &&
  prev.entrance === next.entrance &&
  prev.selfMod === next.selfMod
));
