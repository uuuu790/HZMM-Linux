import { Puzzle, Package, AlertTriangle, DownloadCloud, RefreshCw, CheckCircle, UploadCloud, ArrowUpCircle, ShieldCheck, Save, ChevronRight } from 'lucide-react'
import AnimatedNumber from '../common/AnimatedNumber'

const STAT_CARD = 'group w-full bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-full py-3.5 px-5 md:px-6 shadow-sm flex items-center transition-all duration-500 hover:shadow-md hover:-translate-y-0.5 hover:border-[rgba(var(--accent-rgb),0.35)] active:scale-[0.99]'

const TONES = {
  sky: { chip: 'bg-sky-100 dark:bg-sky-900/40 text-sky-500 dark:text-sky-400' },
  emerald: { chip: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-500 dark:text-emerald-400' },
  amber: { chip: 'bg-amber-100 dark:bg-amber-900/40 text-amber-500 dark:text-amber-400' },
  slate: { chip: 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500' },
  accent: { chip: '', style: { backgroundColor: 'rgba(var(--accent-rgb), 0.12)', color: 'var(--accent-500)' } },
}

export default function DashboardTab({
  t,
  modules,
  isDark: _isDark,
  isDragging,
  setIsDragging,
  fileInputRef,
  handleDrop,
  handleImportFiles,
  addToast: _addToast,
  ue4ssStatus,
  ue4ssProgress,
  ue4ssVersion,
  isProcessing,
  handleUe4ssAction,
  handleUe4ssManualInstall,
  handleInstallWithPreview,
  modUpdateCount = 0,
  conflicts,
  handleConflictScan,
  backups = [],
  backupLoading,
  handleBackup,
  onOpenModules,
}) {
  // Local-zip fallback entry: same subtle icon button in both actionable
  // states, tooltip carries the explanation.
  const manualInstallButton = (
    <button
      onClick={handleUe4ssManualInstall}
      title={t.manualInstallHint || t.manualInstall || 'Install from ZIP'}
      aria-label={t.manualInstall || 'Install from ZIP'}
      className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-800/60 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 hover:shadow-sm transition-all duration-300 active:scale-90"
    >
      <UploadCloud className="w-3.5 h-3.5" />
    </button>
  );
  return (
    <div className="flex flex-col gap-4 animate-zoom-in duration-500">

      {/* UE4SS Engine Status */}
      <div className={`
        relative overflow-hidden backdrop-blur-xl border rounded-full py-4 px-6 md:px-8 flex items-center gap-5 shadow-sm transition-all duration-700 hover:shadow-md hover:-translate-y-0.5
        ${isProcessing ? '' :
          ue4ssStatus === 'uninstalled' ? 'bg-white/60 dark:bg-slate-900/60 border-slate-200 dark:border-white/10' :
          ue4ssStatus === 'update' ? 'bg-amber-50/80 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50' :
          'bg-emerald-50/80 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50'
        }
      `}
      style={isProcessing ? { backgroundColor: 'rgba(var(--accent-rgb), 0.05)', borderColor: 'var(--accent-200)' } : undefined}>
        <div className={`
          w-12 h-12 rounded-full flex items-center justify-center shrink-0 border shadow-inner transition-colors duration-700
          ${isProcessing ? '' :
            ue4ssStatus === 'uninstalled' ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400' :
            ue4ssStatus === 'update' ? 'bg-amber-100 dark:bg-amber-900/50 border-amber-200 dark:border-amber-700 text-amber-500 dark:text-amber-400' :
            'bg-emerald-100 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-700 text-emerald-500 dark:text-emerald-400'
          }
        `}
        style={isProcessing ? { backgroundColor: 'var(--accent-100)', borderColor: 'var(--accent-200)', color: 'var(--accent-500)' } : undefined}>
          {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Puzzle className="w-5 h-5" />}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-1">
            <h4 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate transition-colors duration-700">{t.engine}</h4>
            {!isProcessing && (
              <>
                {ue4ssStatus === 'uninstalled' && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0 transition-colors duration-700 shadow-inner">{t.notInstalled}</span>}
                {ue4ssStatus === 'update' && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-300/50 dark:border-amber-700 animate-pulse shrink-0 transition-colors duration-700"><AlertTriangle className="w-3 h-3" /> {t.updateAvailable}</span>}
                {ue4ssStatus === 'installed' && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300/50 dark:border-emerald-700 shrink-0 transition-colors duration-700 shadow-inner"><CheckCircle className="w-3 h-3" /> {t.installed}</span>}
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate transition-colors duration-700">
            {isProcessing ? t.processing :
             ue4ssStatus === 'uninstalled' ? t.status_uninstalled :
             ue4ssStatus === 'update' ? t.status_update : t.status_ok}
          </p>
        </div>

        <div className="shrink-0 ml-4 hidden sm:flex items-center gap-3 justify-end min-w-[140px]">
          {isProcessing ? (
            <div className="flex items-center gap-3">
              <div className="w-28 h-2.5 bg-slate-200/80 dark:bg-slate-800/80 rounded-full overflow-hidden shadow-inner relative transition-colors duration-700">
                <div className="absolute left-0 top-0 bottom-0 transition-all duration-700 ease-out rounded-full shimmer-sweep" style={{ width: `${ue4ssProgress}%`, overflow: 'hidden', background: 'linear-gradient(to right, var(--accent-400), var(--accent-500))' }}>
                  <div className="absolute inset-0 rounded-full" />
                </div>
              </div>
              <span className="text-[11px] font-bold tabular-nums min-w-[2.5rem] text-right" style={{ color: 'var(--accent-500)' }}>{Math.round(ue4ssProgress)}%</span>
            </div>
          ) : (
            <>
              {ue4ssStatus === 'uninstalled' && (
                <div className="flex items-center gap-2 w-full">
                  <button onClick={handleUe4ssAction} className="flex flex-1 items-center justify-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold rounded-full transition-all duration-300 shadow-sm hover:shadow-md whitespace-nowrap active:scale-95">
                    <DownloadCloud className="w-3.5 h-3.5" /> {t.deploy}
                  </button>
                  {manualInstallButton}
                </div>
              )}
              {ue4ssStatus === 'update' && (
                <>
                  {ue4ssVersion && <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 font-mono hidden md:block transition-colors duration-700">{ue4ssVersion}</span>}
                  <button onClick={handleUe4ssAction} className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-full transition-all duration-300 shadow-sm hover:shadow-[0_10px_15px_-3px_rgba(245,158,11,0.3)] whitespace-nowrap active:scale-95"><RefreshCw className="w-3.5 h-3.5" /> {t.update}</button>
                  {manualInstallButton}
                </>
              )}
              {ue4ssStatus === 'installed' && (
                <div className="flex items-center gap-2 text-[11px] bg-white/50 dark:bg-slate-800/50 px-3 py-1.5 rounded-full border border-emerald-100 dark:border-emerald-800/50 transition-colors duration-700 shadow-inner">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">{t.version}: <span className="font-mono text-slate-700 dark:text-slate-200">{ue4ssVersion || 'N/A'}</span></span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Dropzone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`
          group relative overflow-hidden w-full py-8 md:py-10 mt-2 mb-2 rounded-[2.5rem] border-2 border-dashed flex flex-col items-center justify-center transition-all duration-500 cursor-pointer
          ${isDragging
            ? 'scale-[1.01]'
            : 'bg-white/40 dark:bg-slate-900/40 border-slate-300 dark:border-slate-700 hover:bg-white/60 dark:hover:bg-slate-800/60'
          }
        `}
        style={isDragging
          ? { backgroundColor: 'rgba(var(--accent-rgb), 0.05)', borderColor: 'var(--accent-500)', boxShadow: '0 0 30px rgba(var(--accent-rgb), 0.15)' }
          : undefined
        }
        onMouseEnter={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = 'var(--accent-400)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.1)'; } }}
        onMouseLeave={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; } }}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept=".zip,.rar,.7z,.pak"
          onChange={async (e) => {
            if (e.target.files && e.target.files.length > 0 && window.api) {
              const paths = Array.from(e.target.files).map(f => window.api.system.getPathForFile(f)).filter(Boolean);
              if (paths.length > 0) {
                await handleInstallWithPreview(paths);
              }
            }
            e.target.value = null;
          }}
        />

        <button
          onClick={(e) => { e.stopPropagation(); handleImportFiles(); }}
          className="absolute top-4 right-4 md:top-5 md:right-6 flex items-center gap-1.5 px-3 py-1.5 bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-full border border-slate-200/60 dark:border-slate-600/60 shadow-sm transition-all duration-300 hover:-translate-y-0.5 active:scale-95 z-10"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.05)'; e.currentTarget.style.color = 'var(--accent-600)'; e.currentTarget.style.borderColor = 'var(--accent-300)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = ''; e.currentTarget.style.borderColor = ''; }}
        >
          <DownloadCloud className="w-3.5 h-3.5" />
          {t.importMod}
        </button>

        <div className={`p-4 rounded-full mb-3 transition-all duration-500 shadow-sm group-hover:scale-110 ${isDragging ? 'text-white animate-bounce' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}
          style={isDragging ? { backgroundColor: 'var(--accent-500)' } : undefined}
>
          <UploadCloud className="w-8 h-8" />
        </div>
        <h4 className={`text-lg font-bold transition-colors duration-500 ${isDragging ? '' : 'text-slate-700 dark:text-slate-200'}`}
          style={isDragging ? { color: 'var(--accent-600)' } : undefined}>
          {isDragging ? t.dropzoneActive : t.dropzoneTitle}
        </h4>
        <p className={`text-xs font-medium mt-1 transition-colors duration-500 ${isDragging ? '' : 'text-slate-500 dark:text-slate-400'}`}
          style={isDragging ? { color: 'rgba(var(--accent-rgb), 0.8)' } : undefined}>
          {t.dropzoneDesc}
        </p>
      </div>

      {/* Library counts — click through to the library pre-filtered */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        {[
          { type: 'PAK', title: t.pakTitle, icon: Package, chip: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-500 dark:text-indigo-400', tilt: 'group-hover:rotate-6' },
          { type: 'UE4SS', title: t.ue4ssTitle, icon: Puzzle, chip: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-500 dark:text-emerald-400', tilt: 'group-hover:-rotate-6' },
        ].map(({ type, title, icon: Icon, chip, tilt }) => {
          const ofType = modules.filter(m => m.type === type);
          const enabledCount = ofType.filter(m => m.enabled).length;
          return (
            <button
              key={type}
              onClick={() => onOpenModules?.(type)}
              title={t.modules}
              className={`${STAT_CARD} justify-between`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2.5 rounded-full shadow-inner transition-transform duration-500 group-hover:scale-110 ${tilt} ${chip}`}><Icon className="w-5 h-5"/></div>
                <div className="flex flex-col items-start min-w-0">
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 transition-colors duration-700">{title}</h4>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{(t.dashEnabledCount || '{n}').replace('{n}', enabledCount)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-2xl font-black text-slate-700 dark:text-slate-100 transition-colors duration-700"><AnimatedNumber value={ofType.length} /> <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 ml-1 transition-colors duration-700">{t.installed}</span></div>
                <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 transition-transform duration-300 group-hover:translate-x-0.5" />
              </div>
            </button>
          );
        })}
      </div>

      {/* At-a-glance health: updates, conflicts, last backup — each one is
          also the shortcut to deal with it. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(() => {
          const latestBackup = backups.find(b => !b.legacy);
          const backupDate = latestBackup
            ? (latestBackup.date ? new Date(latestBackup.date).toLocaleDateString() : latestBackup.timestamp?.slice(0, 10).replace(/-/g, '/'))
            : null;
          const conflictCount = Array.isArray(conflicts) ? conflicts.length : null;
          const items = [
            {
              key: 'updates',
              icon: modUpdateCount > 0 ? ArrowUpCircle : CheckCircle,
              tone: modUpdateCount > 0 ? TONES.sky : TONES.emerald,
              text: modUpdateCount > 0 ? (t.updateNotifyBody || '{n}').replace('{n}', modUpdateCount) : t.dashAllUpToDate,
              onClick: () => onOpenModules?.('all'),
            },
            {
              key: 'conflicts',
              icon: conflictCount ? AlertTriangle : ShieldCheck,
              tone: conflictCount === null ? TONES.slate : conflictCount > 0 ? TONES.amber : TONES.emerald,
              text: conflictCount === null ? t.dashConflictsUnscanned : conflictCount > 0 ? `${conflictCount} ${t.conflictFound}` : t.conflictNone,
              onClick: handleConflictScan,
            },
            {
              key: 'backup',
              icon: backupLoading ? RefreshCw : Save,
              spin: backupLoading,
              tone: TONES.accent,
              text: backupDate ? `${t.dashLastBackup} · ${backupDate}` : t.backupEmpty,
              action: t.backupCreate,
              onClick: handleBackup,
            },
          ];
          return items.map(({ key, icon: Icon, spin, tone, text, action, onClick }) => (
            <button key={key} onClick={onClick} disabled={key === 'backup' && backupLoading} className={`${STAT_CARD} gap-3 disabled:opacity-70`}>
              <div className={`p-2.5 rounded-full shadow-inner shrink-0 transition-transform duration-500 group-hover:scale-110 ${tone.chip}`} style={tone.style}>
                <Icon className={`w-5 h-5 ${spin ? 'animate-spin' : ''}`} />
              </div>
              <span className="flex-1 min-w-0 text-left text-sm font-bold text-slate-700 dark:text-slate-200 truncate transition-colors duration-700">{text}</span>
              {action
                ? <span className="shrink-0 text-[11px] font-bold transition-colors duration-300" style={{ color: 'var(--accent-500)' }}>{action}</span>
                : <ChevronRight className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600 transition-transform duration-300 group-hover:translate-x-0.5" />}
            </button>
          ));
        })()}
      </div>

    </div>
  )
}
