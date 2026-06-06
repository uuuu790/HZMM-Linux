
import { Trash2, AlertTriangle } from 'lucide-react';

const ConfirmModal = ({ isOpen, title, description, onConfirm, onCancel, t, confirmVariant = 'danger' }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 [-webkit-app-region:no-drag]" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)] p-6 md:p-8 animate-modal-spring flex flex-col items-center text-center gap-4"
      >
        <div className={`p-4 rounded-full ${confirmVariant === 'danger' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-500' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-500'}`}>
          {confirmVariant === 'danger' ? <Trash2 className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
        </div>

        <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tight">{title}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed whitespace-pre-line">{description}</p>

        <div className="flex items-center gap-3 w-full mt-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-300 active:scale-95"
          >
            {t.confirmCancel}
          </button>
          <button
            onClick={() => { onConfirm(); onCancel(); }}
            className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-full text-white transition-all duration-300 active:scale-95 ${
              confirmVariant === 'danger'
                ? 'bg-rose-500 hover:bg-rose-600 shadow-[0_10px_15px_-3px_rgba(244,63,94,0.3)]'
                : 'bg-amber-500 hover:bg-amber-600 shadow-[0_10px_15px_-3px_rgba(245,158,11,0.3)]'
            }`}
          >
            {t.confirmYes}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
