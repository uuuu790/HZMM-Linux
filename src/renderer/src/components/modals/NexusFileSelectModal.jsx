import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Package, Clock, RefreshCw } from 'lucide-react';

// Local copy of the formatters used by NexusModDetailModal. Kept here to
// avoid coupling this lightweight picker to the heavier detail modal file.
function formatBytes(n) {
  if (!n) return '—';
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
function formatDate(ts) {
  if (!ts) return '—';
  // V2 returns ISO 8601 strings; V1/file endpoints return unix seconds.
  try {
    if (typeof ts === 'string') return new Date(ts).toLocaleDateString();
    return new Date(ts * 1000).toLocaleDateString();
  } catch { return '—'; }
}

export default function NexusFileSelectModal({ modName, files, t, onSelect, onClose, installingFileId }) {
  // Close on Escape — standard modal behavior.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !installingFileId) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, installingFileId]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 [-webkit-app-region:no-drag] animate-fade-in"
      onClick={() => { if (!installingFileId) onClose(); }}
    >
      <div
        // Full-width on tiny viewports, capped at 2xl on desktops. max-h
        // covers both header + scrollable list so the modal never overflows
        // the screen even when the list is long.
        className="w-full max-w-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-[0_24px_80px_-12px_rgba(0,0,0,0.25)] dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)] border border-slate-200 dark:border-slate-700 overflow-hidden animate-modal-spring"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-[10px] font-black tracking-widest uppercase text-slate-400 dark:text-slate-500">
              {t.nexusSelectVersion}
            </span>
            <h2 className="text-lg font-black text-slate-800 dark:text-slate-100 line-clamp-1" title={modName}>
              {modName}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={!!installingFileId}
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed [transition:background-color_200ms,color_200ms]"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* File list — fills remaining height, scrolls internally */}
        <div className="flex-1 overflow-y-auto scroll-fade-thumb p-3 sm:p-4 flex flex-col gap-2 min-h-0">
          {files.map((file) => {
            const isInstalling = installingFileId === file.file_id;
            const isDisabled = !!installingFileId && !isInstalling;
            return (
              <button
                key={file.file_id}
                onClick={() => { if (!installingFileId) onSelect(file); }}
                disabled={isDisabled || isInstalling}
                className="text-left flex flex-col gap-2 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800 hover:border-[var(--accent-300)] dark:hover:border-[var(--accent-700)] hover:shadow-[0_8px_24px_rgba(var(--accent-rgb),0.12)] hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:bg-slate-50/50 dark:disabled:hover:bg-slate-800/40"
                style={{ transition: 'background-color 200ms, border-color 200ms, box-shadow 200ms, translate 200ms, scale 100ms, opacity 200ms' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 line-clamp-1">
                      {file.name}
                    </h3>
                    {file.version && (
                      <span className="inline-block mt-0.5 text-[11px] font-mono font-bold" style={{ color: 'var(--accent-600)' }}>
                        v{file.version}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      <Package className="w-3 h-3" />
                      {formatBytes(file.size_in_bytes || (file.size ? file.size * 1024 : 0))}
                    </span>
                    {isInstalling && (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: 'var(--accent-500)' }}>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        {t.nexusInstalling}
                      </span>
                    )}
                  </div>
                </div>
                {file.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                    {file.description}
                  </p>
                )}
                <div className="flex items-center gap-4 text-[11px] text-slate-400 dark:text-slate-500">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(file.uploaded_timestamp)}</span>
                  {typeof file.total_downloads === 'number' && (
                    <span className="flex items-center gap-1"><Download className="w-3 h-3" />{file.total_downloads.toLocaleString()}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
