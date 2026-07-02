import { useState, useRef, useCallback } from 'react';
import { Trash2, CheckCircle, Power, ChevronDown, CheckSquare, Square, AlertTriangle, Pencil, ArrowUpCircle } from 'lucide-react';
import { getModIcon, cleanModName } from '../../constants/modIcons';
import ModDetailModal from '../modals/ModDetailModal';
import GlassCard from './GlassCard';

// Inline editable mod name component
function InlineModName({ mod, onRename }) {
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
    <div className="flex items-center gap-1.5 min-w-0 group/name cursor-text" onClick={startEdit}>
      <h4
        className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-all duration-300 group-hover/name:text-[var(--accent-600)] dark:group-hover/name:text-[var(--accent-400)]"
      >
        {displayName}
      </h4>
      <Pencil className="w-3 h-3 shrink-0 text-slate-400 dark:text-slate-500 opacity-0 group-hover/name:opacity-70 transition-opacity duration-200" />
    </div>
  );
}

const ModuleList = ({ modules, type, subtype, title, icon: Icon, colorClass, activeModuleId, onModuleClick, onToggle, onUninstallLocal, onOpenConfig, onRenameMod, t, lang, newlyInstalledMods, selectedMods, onToggleSelect, onRangeSelect, conflictModSet, modUpdateMap, updatingModId, onUpdateMod, nexusApiKey }) => {
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
        <div className="overflow-hidden flex flex-col gap-2.5 px-2 py-1">
          {filteredModules.map((mod, index) => {
            const iconInfo = getModIcon(mod);
            const modKey = mod.id || mod.filename;
            const isSelected = selectedMods?.has(mod.filename);
            const updateInfo = modUpdateMap?.get(mod.filename);
            const updateBusy = updateInfo && updatingModId === updateInfo.modId;
            // Badge shows the mod's concrete kind: UE4SS splits by subtype so a
            // Lua mod reads "Lua" and a cppmod reads "C++" instead of a generic
            // "UE4SS"; PAK keeps its own label.
            const typeLabel = mod.type === 'UE4SS' ? (mod.subtype === 'cpp' ? 'C++' : 'Lua') : mod.type;
            return (
              <div
                key={modKey}
                className="flex flex-col relative animate-slide-up"
                style={{ animationFillMode: 'both', animationDelay: `${index * 60}ms`, animationDuration: '600ms' }}
              >
                <GlassCard onClick={(e) => handleRowClick(mod, modKey, index, e)} className={`group flex flex-row items-center px-3 py-2 md:px-4 md:py-2.5 gap-3 md:gap-4 relative z-10 ${activeModuleId === modKey ? 'bg-white/80 dark:bg-slate-800/80' : ''} ${isSelected ? 'ring-2' : ''} ${newlyInstalledMods?.has(modKey) ? 'ring-2' : ''}`} style={{ ...(activeModuleId === modKey ? { boxShadow: `0 0 0 2px rgba(var(--accent-rgb), 0.5)` } : {}), ...(isSelected ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.5)', backgroundColor: 'rgba(var(--accent-rgb), 0.03)' } : {}), ...(newlyInstalledMods?.has(modKey) ? { '--tw-ring-color': 'rgba(var(--accent-rgb), 0.6)', animation: 'newModPulse 0.8s ease-out 2' } : {}) }}>
                  {/* Checkbox — slides in when items are selected, shows on hover otherwise */}
                  <div className={`shrink-0 overflow-hidden transition-all duration-300 ease-out ${hasSelection ? 'w-5 md:w-6 opacity-100' : 'w-0 opacity-0 group-hover:w-5 group-hover:md:w-6 group-hover:opacity-60'}`}>
                    <button
                      onClick={(e) => handleCheckboxClick(mod, index, e)}
                      className="p-0.5"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 md:w-5 md:h-5 transition-transform duration-200 scale-110" style={{ color: 'var(--accent-500)' }} />
                      ) : (
                        <Square className="w-4 h-4 md:w-5 md:h-5 text-slate-300 dark:text-slate-600 hover:text-slate-400 dark:hover:text-slate-500 transition-colors duration-200" />
                      )}
                    </button>
                  </div>

                  <div className={`w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-gradient-to-br ${iconInfo.color} border border-white dark:border-white/10 shrink-0 transition-all duration-300 shadow-sm group-hover:scale-105 group-hover:shadow-md ${!mod.enabled ? 'opacity-50 grayscale' : ''}`}>
                    <iconInfo.icon className={`w-4 h-4 md:w-5 md:h-5 ${iconInfo.iconColor}`} />
                  </div>

                  <div className={`flex flex-col flex-1 min-w-0 transition-opacity duration-300 ${!mod.enabled ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <InlineModName mod={mod} onRename={onRenameMod} />
                      <span className={`shrink-0 text-[11px] font-mono px-2 py-0.5 rounded-full border leading-none transition-colors duration-700 ${mod.hybrid ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50' : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>{mod.hybrid ? (t.hybrid || 'Hybrid') : (mod.version || typeLabel)}</span>
                      {conflictModSet && conflictModSet.has(mod.filename) && (
                        <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50" title={t.conflictDetected || 'Conflict detected'}>
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

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5 md:gap-2">
                      {updateInfo && (
                        <button
                          onClick={(e) => { e.stopPropagation(); if (!updateBusy) onUpdateMod(updateInfo); }}
                          disabled={updateBusy}
                          className={`flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full border transition-all duration-300 active:scale-95 bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-400/40 dark:border-sky-500/30 ${updateBusy ? 'opacity-70 pointer-events-none' : 'hover:bg-sky-500/20 hover:border-sky-500/60 hover:-translate-y-0.5'}`}
                          title={nexusApiKey ? (t.updateMod || 'Update') : (t.viewOnNexus || 'View on Nexus')}
                        >
                          <ArrowUpCircle className={`w-3 h-3 ${updateBusy ? 'animate-spin' : ''}`} />
                          <span className="hidden sm:inline">{updateBusy ? (t.updating || 'Updating') : (nexusApiKey ? (t.updateMod || 'Update') : (t.viewOnNexus || 'Nexus'))}</span>
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onUninstallLocal(mod.filename); }}
                        className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                        title={t.uninstall}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <span className={`hidden sm:flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors duration-300 ${mod.enabled ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                        {mod.enabled ? <CheckCircle className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                        {mod.enabled ? t.running : t.disabled}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const knob = e.currentTarget.querySelector('.toggle-knob');
                          if (knob) { knob.classList.remove('toggle-bounce'); void knob.offsetWidth; knob.classList.add('toggle-bounce'); }
                          onToggle(mod.filename);
                        }}
                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner border border-black/5 dark:border-white/5 active:scale-90 ${!mod.enabled ? 'bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600' : ''}`}
                        style={mod.enabled ? { backgroundColor: 'var(--accent-500)' } : undefined}
                      >
                        <span className={`toggle-knob inline-block h-3 w-3 transform rounded-full bg-white transition duration-300 ease-in-out shadow-[0_2px_4px_rgba(0,0,0,0.2)] ${mod.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </div>
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
