
import { Package, Puzzle, FileText, CheckCircle, RefreshCw, X, Folder, AlertTriangle } from 'lucide-react';

const TYPE_LABELS = {
  'pak-only': { label: 'PAK Resource Mod', icon: Package, color: 'text-indigo-500' },
  'ue4ss-mod': { label: 'UE4SS Script Mod', icon: Puzzle, color: 'text-emerald-500' },
  'hybrid': { label: 'PAK + UE4SS Hybrid', icon: Puzzle, color: 'text-orange-500' },
  'game-structure': { label: 'Game Structure Mod', icon: Folder, color: 'text-amber-500' },
  'complex': { label: 'Complex Mod', icon: FileText, color: 'text-violet-500' },
  'unknown': { label: 'Unknown', icon: FileText, color: 'text-slate-500' },
};

const PreviewModal = ({ isOpen, onClose, previews, loading, onConfirm, onDontShowAgain, t }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Package className="w-5 h-5" style={{ color: 'var(--accent-500)' }} />
            {t.previewTitle || 'Install Preview'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
              <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--accent-500)' }} />
              <p className="text-sm font-medium">{t.previewLoading || 'Analyzing...'}</p>
            </div>
          ) : previews && previews.length > 0 ? (
            <div className="flex flex-col gap-4">
              {previews.map((preview, i) => {
                const typeInfo = TYPE_LABELS[preview.type] || TYPE_LABELS.unknown;
                const TypeIcon = typeInfo.icon;
                return (
                  <div key={i} className="border border-slate-200/60 dark:border-slate-700/40 rounded-2xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-slate-50/60 dark:bg-slate-800/40">
                      <TypeIcon className={`w-5 h-5 ${typeInfo.color} shrink-0 self-start mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{preview.fileName}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                          {t.previewType || 'Type'}: <span className={`font-bold ${typeInfo.color}`}>{typeInfo.label}</span>
                        </p>
                        {preview.mods && preview.mods.length > 0 && (
                          <div className="flex flex-col gap-1 mt-2">
                            {preview.mods.map((mod, j) => (
                              <div key={j} className="flex items-center gap-1.5">
                                {mod.modType === 'PAK'
                                  ? <Package className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                  : <Puzzle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                }
                                <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">{mod.name}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${mod.modType === 'PAK' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>
                                  {mod.modType}
                                </span>
                                {mod.existing && (
                                  <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                                    <AlertTriangle className="w-3 h-3" />
                                    {t.previewReinstall || 'Reinstall'}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {preview.error && (
                      <p className="px-4 py-2 text-[11px] text-rose-500 font-medium">{preview.error}</p>
                    )}
                  </div>
                );
              })}

              <button
                onClick={onConfirm}
                className="w-full py-3 text-sm font-bold rounded-full text-white transition-all duration-300 active:scale-[0.98] shadow-md hover:shadow-lg"
                style={{ background: 'linear-gradient(to right, var(--gradient-from), var(--gradient-to))' }}
              >
                <CheckCircle className="w-4 h-4 inline mr-2" />
                {t.previewConfirm || 'Confirm Install'}
              </button>

              {/* "Don't show again" — mod authors who re-install the same
                  archive often find this dialog redundant. Checkbox flips a
                  setting (skipInstallPreview); Settings tab has a matching
                  toggle to turn it back on. Works as pure accessibility
                  text + native checkbox so it's keyboard-navigable. */}
              {onDontShowAgain && (
                <label className="flex items-center gap-2 pt-1 cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors select-none">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 rounded accent-[var(--accent-500)] cursor-pointer"
                    onChange={(e) => { if (e.target.checked) onDontShowAgain(); }}
                  />
                  <span>{t.previewDontShowAgain || "Don't show this preview again"}</span>
                </label>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PreviewModal;
