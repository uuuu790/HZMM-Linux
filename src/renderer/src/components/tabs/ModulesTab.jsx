import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Package, Puzzle, Search, X, Power, Trash2, ChevronDown, RefreshCw, Binary } from 'lucide-react';
import ModuleList from '../common/ModuleList';

function ModulesTab({
  t,
  lang,
  modules,
  activeModuleId,
  handleModuleClick,
  handleToggleEnable,
  handleUninstallLocalMod,
  setConfigEditorMod,
  newlyInstalledMods,
  searchQuery,
  setSearchQuery,
  filterType,
  setFilterType,
  sortBy,
  setSortBy,
  batchMode: _batchMode,
  setBatchMode: _setBatchMode,
  selectedMods,
  setSelectedMods,
  handleBatchToggle,
  handleBatchRemove,
  handleToggleSelect,
  handleRenameMod,
  isGameRunning: _isGameRunning,
  conflicts,
  isDark,
  handleRescan,
  rescanning,
  modUpdateMap,
  updatingModId,
  onUpdateMod,
  nexusApiKey,
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortDropdownRef = useRef(null);
  const sortMenuRef = useRef(null);
  const filterBarRef = useRef(null);
  const filterRefs = useRef({});
  const [filterIndicator, setFilterIndicator] = useState({ left: 0, width: 0 });

  // Update filter pill sliding indicator
  useEffect(() => {
    const btn = filterRefs.current[filterType];
    const bar = filterBarRef.current;
    if (btn && bar) {
      const barRect = bar.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setFilterIndicator({
        left: btnRect.left - barRect.left,
        width: btnRect.width,
      });
    }
  }, [filterType, t]);

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target) && sortMenuRef.current && !sortMenuRef.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen]);

  const sortOptions = useMemo(() => [
    { value: 'name', label: t.sortName },
    { value: 'nameDesc', label: t.sortNameDesc },
    { value: 'type', label: t.sortType },
    { value: 'status', label: t.sortStatus },
    { value: 'newest', label: t.sortNewest },
  ], [t]);

  // Build a set of mod filenames that have conflicts
  const conflictModSet = useMemo(() => {
    const set = new Set()
    if (conflicts) {
      for (const c of conflicts) {
        for (const m of c.mods) set.add(m)
      }
    }
    return set
  }, [conflicts])

  const processedModules = useMemo(() => {
    let result = [...modules]
    // `C++` is a UE4SS subtype filter, not a real mod type. Pre-filtering to cpp
    // here works together with the render-time block visibility guards below:
    // when filterType is 'C++', only the UE4SS·C++ block renders (the PAK and
    // Lua guards exclude it), so this cpp-only list never reaches a block that
    // would mis-render it. Keep the pre-filter and the guards in sync.
    if (filterType === 'C++') result = result.filter(m => m.type === 'UE4SS' && m.subtype === 'cpp')
    else if (filterType !== 'all') result = result.filter(m => m.type === filterType)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(m => (m.customName || m.title || m.filename).toLowerCase().includes(q))
    }
    const displayName = m => m.customName || m.title || m.filename
    switch (sortBy) {
      case 'name': result.sort((a, b) => displayName(a).localeCompare(displayName(b))); break
      case 'nameDesc': result.sort((a, b) => displayName(b).localeCompare(displayName(a))); break
      case 'type': result.sort((a, b) => a.type.localeCompare(b.type)); break
      case 'status': result.sort((a, b) => Number(b.enabled) - Number(a.enabled)); break
      case 'newest': result.sort((a, b) => new Date(b.modified) - new Date(a.modified)); break
    }
    return result
  }, [modules, filterType, searchQuery, sortBy])

  // Range select handler for Shift+Click
  const handleRangeSelect = useCallback((filenames) => {
    setSelectedMods(prev => {
      const next = new Set(prev)
      filenames.forEach(f => next.add(f))
      return next
    })
  }, [setSelectedMods])

  const hasSelection = selectedMods.size > 0

  return (
    <div className="flex flex-col gap-2 w-full animate-slide-up">
      {modules.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 dark:text-slate-500 gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', animation: 'emptyBreath 3s ease-in-out infinite' }} />
            <Package className="relative w-14 h-14 opacity-40" style={{ animation: 'emptyBreath 3s ease-in-out infinite' }} />
          </div>
          <h3 className="text-lg font-bold animate-slide-up" style={{ animationDelay: '100ms' }}>{t.noMods}</h3>
          <p className="text-sm animate-slide-up" style={{ animationDelay: '200ms' }}>{t.noModsDesc}</p>
        </div>
      ) : (
        <>
          {/* Search / Filter / Sort toolbar */}
          {modules.length > 0 && (
            <div className="flex flex-col gap-2 mb-2 px-2 animate-slide-up" style={{ animationFillMode: 'both', animationDelay: '0ms', animationDuration: '500ms' }}>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search input */}
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.search}
                    className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 transition-all shadow-inner"
                    style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.3)' }}
                  />
                </div>

                {/* Type filter pills */}
                <div className="relative flex items-center bg-white/40 dark:bg-slate-900/40 rounded-full border border-slate-200/60 dark:border-slate-700/60 p-0.5" ref={filterBarRef}>
                  {/* Sliding indicator */}
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-full shadow-sm transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] pointer-events-none"
                    style={{
                      backgroundColor: 'var(--accent-500)',
                      left: filterIndicator.left,
                      width: filterIndicator.width,
                    }}
                  />
                  {['all', 'PAK', 'UE4SS', 'C++'].map(type => (
                    <button
                      key={type}
                      ref={el => { filterRefs.current[type] = el; }}
                      onClick={() => setFilterType(type)}
                      className={`relative z-10 px-3 py-1.5 text-[11px] font-bold rounded-full transition-colors duration-300 ${filterType === type ? 'text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                      {type === 'all' ? t.filterAll : type}
                    </button>
                  ))}
                </div>

                {/* Sort dropdown */}
                <div className="relative" ref={sortDropdownRef}>
                  <button
                    onClick={() => setSortOpen(prev => !prev)}
                    className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-200 shadow-inner cursor-pointer"
                  >
                    {sortOptions.find(o => o.value === sortBy)?.label}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${sortOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {sortOpen && (() => {
                    const rect = sortDropdownRef.current?.getBoundingClientRect();
                    return createPortal(
                      <div
                        ref={sortMenuRef}
                        className="fixed min-w-[120px] py-1.5 rounded-2xl z-[9999] animate-zoom-in overflow-hidden"
                        style={{
                          top: rect ? rect.top + rect.height + 8 : 0,
                          right: rect ? window.innerWidth - rect.right : 0,
                          backgroundColor: isDark ? '#1e293b' : '#ffffff',
                          border: `1px solid ${isDark ? 'rgba(51,65,85,0.8)' : 'rgba(226,232,240,0.8)'}`,
                          boxShadow: isDark
                            ? '0 12px 48px -4px rgba(0,0,0,0.6), 0 4px 16px -2px rgba(0,0,0,0.3)'
                            : '0 12px 48px -4px rgba(0,0,0,0.12), 0 4px 16px -2px rgba(0,0,0,0.06)',
                        }}
                      >
                        {sortOptions.map((opt, i) => (
                          <button
                            key={opt.value}
                            onClick={() => { setSortBy(opt.value); setSortOpen(false); }}
                            className="w-full text-left px-4 py-2 text-[11px] cursor-pointer flex items-center gap-2.5 opacity-0 animate-[langItemIn_0.3s_ease_forwards] transition-colors duration-150"
                            style={{
                              animationDelay: `${i * 40}ms`,
                              color: sortBy === opt.value ? 'var(--accent-600)' : (isDark ? '#cbd5e1' : '#475569'),
                              fontWeight: sortBy === opt.value ? 700 : 400,
                            }}
                            onMouseEnter={(e) => { if (sortBy !== opt.value) e.currentTarget.style.backgroundColor = isDark ? 'rgba(51,65,85,0.4)' : 'rgba(248,250,252,1)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                          >
                            {sortBy === opt.value && (
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent-500)' }} />
                            )}
                            <span style={{ marginLeft: sortBy === opt.value ? 0 : 14 }}>{opt.label}</span>
                          </button>
                        ))}
                      </div>,
                      document.body
                    );
                  })()}
                </div>

                {/* Rescan modules — moved here from Settings so it's next to the list */}
                {handleRescan && (
                  <button
                    onClick={handleRescan}
                    disabled={rescanning}
                    className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:border-violet-300 dark:hover:border-violet-700 hover:text-violet-600 dark:hover:text-violet-400 transition-all duration-200 shadow-inner cursor-pointer ${rescanning ? 'opacity-70 pointer-events-none' : ''}`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${rescanning ? 'animate-spin' : ''}`} />
                    {rescanning ? t.rescanning : t.rescanMods}
                  </button>
                )}
              </div>

              {/* Hint / Batch action bar */}
              {!hasSelection && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium px-2">
                  Ctrl+Click {t.selectAll?.toLowerCase() === '全選' ? '多選' : 'to select'} · Shift+Click {t.selectAll?.toLowerCase() === '全選' ? '範圍選取' : 'for range'}
                </p>
              )}
              {hasSelection && (
                <div className="flex items-center gap-1.5 flex-wrap animate-slide-up" style={{ animationDuration: '300ms' }}>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shadow-inner" style={{ backgroundColor: 'var(--accent-100)', color: 'var(--accent-600)' }}>
                    {selectedMods.size} {t.selectedCount}
                  </span>
                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                  <button onClick={() => { const all = new Set(processedModules.map(m => m.filename)); setSelectedMods(all) }} className="px-2 py-1 text-[10px] font-bold rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-95">{t.selectAll}</button>
                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                  <button onClick={() => handleBatchToggle(true)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-all duration-200 active:scale-95"><Power className="w-2.5 h-2.5" />{t.batchEnable}</button>
                  <button onClick={() => handleBatchToggle(false)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-95"><Power className="w-2.5 h-2.5" />{t.batchDisable}</button>
                  <button onClick={handleBatchRemove} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all duration-200 active:scale-95"><Trash2 className="w-2.5 h-2.5" />{t.batchDelete}</button>
                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                  <button onClick={() => setSelectedMods(new Set())} className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 active:scale-95"><X className="w-3 h-3" /></button>
                </div>
              )}
            </div>
          )}

          {/* Empty search results */}
          {modules.length > 0 && processedModules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500 animate-slide-up" style={{ animationDuration: '500ms' }}>
              <Search className="w-10 h-10 mb-3 opacity-40" style={{ animation: 'emptyBreath 3s ease-in-out infinite' }} />
              <p className="text-sm font-bold">{t.noMods}</p>
            </div>
          )}

          {/* Module lists — PAK / UE4SS·Lua / UE4SS·C++ as parallel blocks.
              commonListProps dedupes the long prop list across all three. Each
              ModuleList returns null when its (type, subtype) slice is empty,
              so empty subgroups simply don't render. */}
          {(() => {
            const commonListProps = {
              activeModuleId,
              onModuleClick: handleModuleClick,
              onToggle: handleToggleEnable,
              onUninstallLocal: handleUninstallLocalMod,
              onOpenConfig: setConfigEditorMod,
              onRenameMod: handleRenameMod,
              t, lang,
              newlyInstalledMods,
              selectedMods,
              onToggleSelect: handleToggleSelect,
              onRangeSelect: handleRangeSelect,
              conflictModSet,
              modUpdateMap,
              updatingModId,
              onUpdateMod,
              nexusApiKey,
            };
            return (
              <>
                {(filterType === 'all' || filterType === 'PAK') && (
                  <ModuleList
                    modules={processedModules}
                    type="PAK"
                    title={t.pakTitle}
                    icon={Package}
                    colorClass="text-indigo-600 dark:text-indigo-400"
                    {...commonListProps}
                  />
                )}
                {(filterType === 'all' || filterType === 'UE4SS') && (
                  <ModuleList
                    modules={processedModules}
                    type="UE4SS"
                    subtype="lua"
                    title={t.ue4ssLuaTitle || 'UE4SS · Lua'}
                    icon={Puzzle}
                    colorClass="text-emerald-600 dark:text-emerald-400"
                    {...commonListProps}
                  />
                )}
                {(filterType === 'all' || filterType === 'UE4SS' || filterType === 'C++') && (
                  <ModuleList
                    modules={processedModules}
                    type="UE4SS"
                    subtype="cpp"
                    title={t.ue4ssCppTitle || 'UE4SS · C++'}
                    icon={Binary}
                    colorClass="text-amber-600 dark:text-amber-400"
                    {...commonListProps}
                  />
                )}
              </>
            );
          })()}

        </>
      )}
    </div>
  );
}

export default ModulesTab;
