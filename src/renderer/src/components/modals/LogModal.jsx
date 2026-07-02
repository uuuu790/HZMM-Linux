
import { FileText, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const LogModal = ({ isOpen, onClose, loading, logLines, onOpenLogFile, t }) => {
  useEscapeKey(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-modal-title"
        className="relative w-full max-w-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 id="log-modal-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-sky-500" /> {t.viewLogs}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={onOpenLogFile} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:text-sky-600 dark:hover:text-sky-400 transition-colors border border-slate-200 dark:border-slate-700">
              <ExternalLink className="w-3 h-3" /> {t.openLogFile}
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-4 max-h-[60vh] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <p className="text-sm font-medium">{t.logLoading}</p>
            </div>
          ) : logLines && logLines.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
              <FileText className="w-8 h-8" />
              <p className="text-sm font-medium">{t.logEmpty}</p>
            </div>
          ) : logLines ? (
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800/60 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300 overflow-x-auto [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/60 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80">
              {logLines.map((line, i) => {
                // Match the level token only when it's a real log-level
                // prefix (e.g. ` ERROR ` / `[ERROR]`), not arbitrary
                // substrings inside message bodies that happen to contain
                // the word "error" or "warning".
                const isError = /\b(ERROR|FATAL)\b/i.test(line.slice(0, 32));
                const isWarn = !isError && /\bWARN(?:ING)?\b/i.test(line.slice(0, 32));
                return (
                  <div key={i} className={`py-0.5 ${isError ? 'text-red-600 dark:text-red-400' : isWarn ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                    {line}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default LogModal;
