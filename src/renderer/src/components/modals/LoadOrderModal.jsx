import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowDownUp, GripVertical, Trophy, AlertTriangle, X, Check } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// Load order is the engine's case-insensitive alphabetical mount order of the
// ENABLED-form filename; the later mount wins conflicts. Mirrors
// comparePakNames in main/ipc/mods-order.js.
const loadName = (m) => (m.filename || '').replace(/\.disabled$/i, '');
const cmpName = (a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

const LoadOrderModal = ({ isOpen, onClose, pakMods, conflicts, onApply, applying, t }) => {
  useEscapeKey(onClose, isOpen);
  const [order, setOrder] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);

  // Current on-disk load order — both the initial list and the "unchanged"
  // baseline the apply button compares against.
  const baseline = useMemo(
    () => [...(pakMods || [])].sort((a, b) => cmpName(loadName(a), loadName(b))),
    [pakMods]
  );

  useEffect(() => {
    if (isOpen) {
      setOrder(baseline);
      setDragIndex(null);
    }
  }, [isOpen, baseline]);

  const changed = useMemo(
    () => order.map(m => m.filename).join('\n') !== baseline.map(m => m.filename).join('\n'),
    [order, baseline]
  );

  // Live conflict verdicts under the DRAGGED order (not the on-disk one), so
  // the trophy moves while dragging and previews the post-apply outcome.
  // A mod that loses ANY of its groups shows the amber badge.
  const verdicts = useMemo(() => {
    const posOf = new Map(order.map((m, i) => [m.filename, i]));
    const winners = new Set();
    const losers = new Set();
    for (const c of conflicts || []) {
      const present = (c.mods || []).filter(fn => posOf.has(fn));
      if (present.length < 2) continue;
      const winner = present.reduce((w, fn) => (posOf.get(fn) > posOf.get(w) ? fn : w), present[0]);
      for (const fn of present) (fn === winner ? winners : losers).add(fn);
    }
    for (const fn of losers) winners.delete(fn);
    return { winners, losers };
  }, [conflicts, order]);

  const handleDragOver = useCallback((e, overIndex) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === overIndex) return;
    setOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(overIndex, 0, moved);
      return next;
    });
    setDragIndex(overIndex);
  }, [dragIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="load-order-modal-title"
        className="relative w-full max-w-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 id="load-order-modal-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ArrowDownUp className="w-5 h-5 text-sky-500" /> {t.loadOrder || 'Load order'}
          </h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-3">
          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{t.loadOrderHint || 'Drag to reorder — lower rows load later and win conflicts. Files are renamed on apply.'}</p>
        </div>

        <div className="p-6 pt-3 max-h-[55vh] overflow-y-auto">
          {order.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 font-medium">{t.loadOrderEmpty || 'No PAK mods installed'}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {order.map((mod, i) => {
                const isDragging = dragIndex === i;
                const isLoser = verdicts.losers.has(mod.filename);
                const isWinner = verdicts.winners.has(mod.filename);
                return (
                  <div
                    key={mod.filename}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={(e) => e.preventDefault()}
                    onDragEnd={() => setDragIndex(null)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-grab active:cursor-grabbing select-none transition-colors duration-150 ${isDragging ? 'border-sky-400/70 bg-sky-50/70 dark:bg-sky-900/25' : 'border-slate-200/70 dark:border-slate-700/60 bg-white/60 dark:bg-slate-800/60'} ${!mod.enabled ? 'opacity-55' : ''}`}
                  >
                    <GripVertical className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600" />
                    <span className="shrink-0 w-8 text-[11px] font-mono font-bold text-slate-400 dark:text-slate-500">{String(i + 1).padStart(2, '0')}</span>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200 truncate">{mod.customName || mod.title || mod.filename}</span>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate">{mod.filename}</span>
                    </div>
                    {!mod.enabled && (
                      <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">{t.disabled || 'Disabled'}</span>
                    )}
                    {isLoser && (
                      <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50" title={t.conflictDetected || 'Conflict detected'}>
                        <AlertTriangle className="w-3 h-3" /> {t.conflict || 'Conflict'}
                      </span>
                    )}
                    {isWinner && (
                      <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/25 text-emerald-600 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/50">
                        <Trophy className="w-3 h-3" /> {t.conflictWinner || 'Active'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-95"
          >
            {t.confirmCancel || 'Cancel'}
          </button>
          <button
            onClick={async () => { const ok = await onApply(order.map(m => m.filename)); if (ok) onClose(); }}
            disabled={!changed || applying}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-full border transition-all duration-300 active:scale-95 bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-400/40 dark:border-sky-500/30 ${(!changed || applying) ? 'opacity-50 pointer-events-none' : 'hover:bg-sky-500/20 hover:border-sky-500/60'}`}
          >
            <Check className={`w-3.5 h-3.5 ${applying ? 'animate-spin' : ''}`} />
            {applying ? (t.updating || 'Applying') : (t.loadOrderApply || 'Apply order')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoadOrderModal;
