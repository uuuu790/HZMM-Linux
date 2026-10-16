import { useState, useRef, useCallback } from 'react';
import { Trash2, ChevronDown, CheckSquare, Square, AlertTriangle, Pencil, ArrowUpCircle, Link2, History, Sliders } from 'lucide-react';
import { getModIcon, cleanModName } from '../../constants/modIcons';
import ModDetailModal from '../modals/ModDetailModal';
import GlassCard from './GlassCard';
import Toggle from './Toggle';

// Mod name with an explicit rename button. Clicking the name itself falls
// through to the row (opens details); only the pencil enters edit mode.
function InlineModName({ mod, onRename, t }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  const displayName = mod.customName || cleanModName(mod.title || mod.filename);
  const originalName = cleanModName(mod.title || mod.filename);
  const hasCustomName = !!mod.customName;

  const startEdit = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setEditing(true);
    setValue(displayName);
    // Auto-focus after React renders the input
    requestAnimationFrame(() => inputRef.current?.select());
  }, [displayName]);

  const save = useCallback(() => {
    setEditing(false);
    const trimmed = value.trim();
    // If empty or same as original filename-derived name → clear custom name
    if (!trimmed || trimmed === originalName) {
      if (hasCustomName) onRename(mod.id, null);
    } else if (trimmed !== mod.customName) {
      onRename(mod.id, trimmed);
    }
  }, [value, originalName, hasCustomName, mod.id, mod.customName, onRename]);

  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0 flex-1" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 bg-white/80 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-600 rounded-md px-2 py-0.5 outline-none focus:border-[var(--accent-400)] focus:ring-1 focus:ring-[var(--accent-400)] w-full min-w-0 transition-colors duration-200"
          style={{ maxWidth: '280px' }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-300">
        {displayName}
      </h4>
      <button
        type="button"
        onClick={startEdit}
        title={t.renameMod || 'Rename'}
        aria-label={t.renameMod || 'Rename'}
        className="shrink-0 p-1 rounded-full text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-80 focus-visible:opacity-100 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-[opacity,color,background-color] duration-200"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
}

const ModuleList = ({ modules, type, subtype, title, icon: Icon, colorClass, activeModuleId, onModuleClick, onToggle, onUninstallLocal, onOpenConfig, onRenameMod, t, lang, configSet, newlyInstalledMods, selectedMods, onToggleSelect, onRangeSelect, conflictModSet, modUpdateMap, updatingModId, updateProgress, onUpdateMod, nexusApiKey, nexusLinkedSet, onLinkMod, rollbackMap, onRollbackMod }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const lastClickedRef = useRef(null);

  const filteredModules = modules.filter(m => m.type === type && (!subtype || m.subtype === subtype));
  if (filteredModules.length === 0) return null;

  const hasSelection = selectedMods && selectedMods.size > 0;

  const handleRowClick = (mod, modKey, index, e) => {
    // Ctrl+Click = toggle single selection
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect(mod.filename);
      lastClickedRef.current = index;
      return;
    }
    // Shift+Click = range selection
    if (e.shiftKey && lastClickedRef.current !== null && onRangeSelect) {
      e.preventDefault();
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);
      const filenames = filteredModules.slice(start, end + 1).map(m => m.filename);
      onRangeSelect(filenames);
      return;
    }
    // Normal click = expand/collapse detail
    onModuleClick(modKey);
  };

  const handleCheckboxClick = (mod, index, e) => {
    e.stopPropagation();
    // Shift+Click checkbox = range select
    if (e.shiftKey && lastClickedRef.current !== null && onRangeSelect) {
      const start = Math.min(lastClickedRef.current, index);
      const end = Math.max(lastClickedRef.current, index);
      const filenames = filteredModules.slice(start, end + 1).map(m => m.filename);
      onRangeSelect(filenames);
    } else {
      onToggleSelect(mod.filename);
    }
    lastClickedRef.current = index;
  };

  return (
    <div className="animate-slide-up">
      <div
        className={`flex items-center gap-2 px-4 cursor-pointer group transition-all duration-300 outline-none focus:outline-none active:outline-none [-webkit-tap-highlight-color:transparent] rounded-full py-1 ${isExpanded ? 'mb-3' : 'mb-1'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Icon className={`w-5 h-5 ${colorClass} dark:opacity-90 transition-transform duration-500 ${!isExpanded && 'scale-90 opacity-70 rotate-12'}`} />
        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 tracking-wide transition-colors duration-300 group-hover:text-slate-900 dark:group-hover:text-white">{title}</h3>
        <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold transition-colors duration-700 shadow-inner">{filteredModules.length}</span>

        <div className="ml-auto p-1 rounded-full bg-transparent group-hover:bg-slate-200/50 dark:group-hover:bg-slate-800/50 transition-all duration-300 group-hover:shadow-sm">
          <ChevronDown className={`w-5 h-5 text-slate-400 dark:text-slate-500 transition-transform duration-500 ease-out ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
        </div>
      </div>

      <div className={`grid transition-all duration-500 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden flex flex-col gap-2 px-2 py-1">
          {filteredModules.map((mod, index) => {
            const iconInfo = getModIcon(mod);
            const modKey = mod.id || mod.filename;
            const isSelected = selectedMods?.has(mod.filename);
            const updateInfo = modUpdateMap?.get(mod.filename);
            const updateBusy = updateInfo && updatingModId === updateInfo.modId;
            const isNew = newlyInstalledMods?.has(modKey);
            const hasConfig = configSet?.has(mod.filename);
            const displayName = mod.customName || cleanModName(mod.title || mod.filename);
            return (
              <div
                key={modKey}
                className="flex flex-col relative animate-slide-up"
                style={{ animationFillMode: 'both', animationDelay: `${Math.min(index, 20) * 25}ms`, animationDuration: '350ms' }}
              >
                <GlassCard
                  onClick={(e) => handleRowClick(mod, modKey, index, e)}
                  className={`group flex flex-row items-center px-3 py-1.5 md:px-4 md:py-2 gap-3 relative z-10 ${isSelected || isNew ? 'ring-2' : ''}`}
                  style={{
                    ...(isSelected ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.5)', backgroundColor: 'rgba(var(--accent-rgb), 0.04)' } : {}),
                    ...(isNew ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.6)', animation: 'newModPulse 0.8s ease-out 2' } : {}),
                  }}
                >
                  {/* The type icon doubles as the selection checkbox: hovering the
                      row (or any active selection) cross-fades it into a checkbox
                      in place, so nothing in the row shifts sideways. */}
                  <div className="relative w-8 h-8 md:w-9 md:h-9 shrink-0">
                    <div className={`absolute inset-0 transition-[opacity,scale] duration-200 ${hasSelection ? 'opacity-0 scale-75' : 'group-hover:opacity-0 group-hover:scale-75'}`}>
                      <div className={`w-full h-full flex items-center justify-center rounded-full bg-gradient-to-br ${iconInfo.color} border border-white dark:border-white/10 shadow-sm ${!mod.enabled ? 'opacity-50 grayscale' : ''}`}>
                        <iconInfo.icon className={`w-4 h-4 ${iconInfo.iconColor}`} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleCheckboxClick(mod, index, e)}
                      className={`absolute inset-0 flex items-center justify-center rounded-full hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-[opacity,scale,background-color] duration-200 ${hasSelection ? 'opacity-100' : 'opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100'}`}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5" style={{ color: 'var(--accent-500)' }} />
                      ) : (
                        <Square className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                      )}
                    </button>
                  </div>

                  <div className={`flex flex-col flex-1 min-w-0 transition-opacity duration-300 ${!mod.enabled ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <InlineModName mod={mod} onRename={onRenameMod} t={t} />
                      {/* The group header already says PAK / Lua / C++, so the chip
                          only appears when it adds something: a version or hybrid. */}
                      {(mod.hybrid || mod.version) && (
                        <span className={`shrink-0 text-[11px] font-mono px-2 py-0.5 rounded-full border leading-none transition-colors duration-700 ${mod.hybrid ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50' : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>{mod.hybrid ? (t.hybrid || 'Hybrid') : mod.version}</span>
                      )}
                      {conflictModSet && conflictModSet.has(mod.filename) && (
                        <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50" title={t.conflictResource || t.conflict || 'Conflict'}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {t.conflict || 'Conflict'}
                        </span>
                      )}
                      {updateInfo && (
                        <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/50" title={t.updateAvailable || 'Update available'}>
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          {updateInfo.currentVersion && updateInfo.latestVersion && updateInfo.currentVersion !== updateInfo.latestVersion ? `${updateInfo.currentVersion} → ${updateInfo.latestVersion}` : (t.updateAvailable || 'Update')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-medium transition-colors duration-700">{mod.customName ? mod.filename : (mod.description || mod.filename)}</p>
                  </div>

                  <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
                    {updateInfo && (
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!updateBusy) onUpdateMod(updateInfo); }}
                        disabled={updateBusy}
                        className={`relative overflow-hidden flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full border transition-all duration-300 active:scale-95 bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-400/40 dark:border-sky-500/30 ${updateBusy ? 'pointer-events-none' : 'hover:bg-sky-500/20 hover:border-sky-500/60 hover:-translate-y-0.5'}`}
                        title={nexusApiKey ? (t.updateMod || 'Update') : (t.viewOnNexus || 'View on Nexus')}
                      >
                        {/* Download progress fill — sweeps left→right behind the label.
                            At 100% the download is done but install/extract is still
                            running, so the full bar + spinner reads as "finishing". */}
                        {updateBusy && updateProgress != null && (
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 bg-sky-500/25 dark:bg-sky-400/25 transition-[width] duration-300 ease-out pointer-events-none"
                            style={{ width: `${updateProgress}%` }}
                          />
                        )}
                        <ArrowUpCircle className={`relative w-3 h-3 ${updateBusy ? 'animate-spin' : ''}`} />
                        <span className="relative hidden sm:inline tabular-nums">
                          {updateBusy
                            ? (updateProgress != null && updateProgress < 100 ? `${updateProgress}%` : (t.updating || 'Updating'))
                            : (nexusApiKey ? (t.updateMod || 'Update') : (t.viewOnNexus || 'Nexus'))}
                        </span>
                      </button>
                    )}
                    {hasConfig && onOpenConfig && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenConfig(mod); }}
                        className="p-1.5 rounded-full text-slate-400 hover:text-[var(--accent-500)] hover:bg-[rgba(var(--accent-rgb),0.12)] transition-all duration-300 hover:scale-110 active:scale-95"
                        title={t.configEditBtn}
                        aria-label={t.configEditBtn}
                      >
                        <Sliders className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {(() => {
                      // linked/rollback lookups key on the enabled-form name
                      const bareName = mod.filename.replace(/\.disabled$/i, '');
                      const rollbackInfo = rollbackMap?.get(bareName);
                      const unlinked = nexusLinkedSet && !nexusLinkedSet.has(bareName);
                      return (
                        <>
                          {rollbackInfo && onRollbackMod && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onRollbackMod(mod); }}
                              className="p-1.5 rounded-full text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                              title={`${t.rollback || 'Roll back'}${rollbackInfo.version ? ` → v${rollbackInfo.version}` : ''}`}
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {unlinked && onLinkMod && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onLinkMod(mod); }}
                              className="p-1.5 rounded-full text-slate-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                              title={t.linkNexus || 'Link to Nexus'}
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      );
                    })()}
                    <button
                      onClick={(e) => { e.stopPropagation(); onUninstallLocal(mod.filename); }}
                      className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                      title={t.uninstall}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <Toggle size="sm" checked={!!mod.enabled} onChange={() => onToggle(mod.filename)} label={displayName} className="ml-1.5" />
                  </div>
                </GlassCard>
              </div>
            );
          })}
        </div>
      </div>

      <ModDetailModal
        isOpen={!!activeModuleId && filteredModules.some(m => (m.type === 'PAK' ? m.id : `ue4ss:${m.filename}`) === activeModuleId)}
        mod={filteredModules.find(m => (m.type === 'PAK' ? m.id : `ue4ss:${m.filename}`) === activeModuleId)}
        onClose={() => onModuleClick(null)}
        onOpenConfig={onOpenConfig}
        t={t}
        lang={lang}
      />
    </div>
  );
};

export default ModuleList;
