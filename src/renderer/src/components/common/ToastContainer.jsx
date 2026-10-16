
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

const ToastContainer = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col-reverse gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            pointer-events-auto flex items-center gap-3 px-5 py-3.5 min-w-[280px] max-w-[400px]
            rounded-2xl backdrop-blur-xl border
            animate-toast-in
            ${/* Near-opaque tinted surfaces: a translucent (15%) tint let
                 whatever sat BEHIND the toast decide the text contrast —
                 dark page content under light mode made slate-700 text
                 unreadable. 95% tinted panels keep contrast self-contained. */''}
            ${toast.type === 'success'
              ? 'bg-emerald-50/95 dark:bg-emerald-950/90 border-emerald-300/60 dark:border-emerald-500/30 shadow-[0_10px_15px_-3px_rgba(16,185,129,0.15)]'
              : toast.type === 'error'
              ? 'bg-rose-50/95 dark:bg-rose-950/90 border-rose-300/60 dark:border-rose-500/30 shadow-[0_10px_15px_-3px_rgba(244,63,94,0.15)]'
              : toast.type === 'warning'
              ? 'bg-amber-50/95 dark:bg-amber-950/90 border-amber-300/60 dark:border-amber-500/30 shadow-[0_10px_15px_-3px_rgba(245,158,11,0.15)]'
              : 'bg-white/95 dark:bg-slate-900/95 border-slate-200/70 dark:border-white/10 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.2)]'
            }
            transition-all duration-500
          `}
        >
          <div className={`shrink-0 p-1.5 rounded-full ${
            toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
            : toast.type === 'error' ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
            : toast.type === 'warning' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
            : 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300'
          }`}>
            {toast.type === 'success' && <CheckCircle className="w-4 h-4" />}
            {toast.type === 'error' && <X className="w-4 h-4" />}
            {toast.type === 'warning' && <AlertTriangle className="w-4 h-4" />}
            {toast.type === 'info' && <Info className="w-4 h-4" />}
          </div>
          <span className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200 leading-snug">{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-all duration-200 active:scale-90"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
