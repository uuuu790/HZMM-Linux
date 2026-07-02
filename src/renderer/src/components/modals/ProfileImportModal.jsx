import { DownloadCloud, RefreshCw, X, ExternalLink, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const fmt = (s, vars) => (s || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

const ProfileImportModal = ({ isOpen, missing, auto, manual, allMissing, downloading, progress, premium, onConfirm, onApplyAnyway, onCancel, t }) => {
  useEscapeKey(downloading ? () => {} : onCancel, isOpen);
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={downloading ? undefined : onCancel} />
      <div role="dialog" aria-modal="true" aria-labelledby="profile-import-title"
        className="relative w-full max-w-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 id="profile-import-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <DownloadCloud className="w-5 h-5" style={{ color: 'var(--accent-500)' }} />
            {t.profileMissingTitle}
          </h3>
          {!downloading && (
            <button onClick={onCancel} aria-label="Close" className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{fmt(t.profileMissingDesc, { n: missing.length })}</p>

          {auto.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{fmt(t.profileAutoSection, { n: auto.length })}</p>
              <div className="flex flex-col gap-1.5">
                {auto.map(s => (
                  <div key={s.filename} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg bg-slate-100/70 dark:bg-slate-800/60">
                    <DownloadCloud className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="truncate">{s.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {manual.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">{fmt(t.profileManualSection, { n: manual.length })}</p>
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{t.profileManualHint}</p>
              <div className="flex flex-col gap-1.5">
                {manual.map(s => (
                  s.modId ? (
                    <button key={s.filename}
                      onClick={() => window.open(`https://www.nexusmods.com/humanitz/mods/${s.modId}`)}
                      className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-slate-100/70 dark:bg-slate-800/60 text-left hover:bg-slate-200/70 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200">
                      <span className="truncate flex-1">{s.displayName}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  ) : (
                    <div key={s.filename}
                      className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-slate-100/70 dark:bg-slate-800/60 text-left text-slate-500 dark:text-slate-400">
                      <span className="truncate flex-1">{s.displayName}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {!premium && auto.length === 0 && manual.some(s => s.modId) && (
            <p className="text-[11px] text-slate-400 mt-3">{t.profilePremiumHint}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/50 flex items-center justify-end gap-2">
          {downloading ? (
            <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-500)' }} />
              {fmt(t.profileDownloading, { current: progress?.current ?? 0, total: progress?.total ?? auto.length })}
            </span>
          ) : (
            <>
              {!allMissing && (
                <button onClick={onApplyAnyway} className="px-4 py-2 text-sm font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  {t.profileApplyAnyway}
                </button>
              )}
              {auto.length > 0 && (
                <button onClick={onConfirm} className="px-4 py-2 text-sm font-bold rounded-full text-white transition-all active:scale-95" style={{ backgroundColor: 'var(--accent-500)' }}>
                  {t.profileDownloadBtn}
                </button>
              )}
              {allMissing && auto.length === 0 && (
                <button onClick={onCancel} className="px-4 py-2 text-sm font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  {t.confirmCancel}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ProfileImportModal;
