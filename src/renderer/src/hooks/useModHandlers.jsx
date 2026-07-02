import { useState, useCallback, useRef, useEffect } from 'react';
import { Package, Puzzle } from 'lucide-react';

export function useModHandlers({ addToast, showConfirm, t, isGameRunning, persistSetting, skipInstallPreview, onManualModChange, onConflictsUpdate }) {
  // Called after every user-initiated mod state change (toggle / install /
  // remove / batch). Wired up in App.jsx to clear the active profile
  // indicator — manually deviating from a profile means that profile no
  // longer represents current state.
  const notifyManualChange = useCallback(() => {
    if (typeof onManualModChange === 'function') onManualModChange();
  }, [onManualModChange]);
  const [modules, setModules] = useState([]);
  const [newlyInstalledMods, setNewlyInstalledMods] = useState(new Set());
  const [activeModuleId, setActiveModuleId] = useState(null);

  // --- Search / Filter / Sort ---
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('name');

  // --- Batch Mode ---
  const [batchMode, setBatchMode] = useState(false);
  const [selectedMods, setSelectedMods] = useState(new Set());

  // --- Preview ---
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingInstallPaths, setPendingInstallPaths] = useState([]);

  // --- Nexus ---
  const [nexusApiKey, setNexusApiKey] = useState('');

  // --- Drag & Drop ---
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // --- Refresh ---
  const prevModFilenames = useRef(new Set());
  // Handle for the newly-installed highlight auto-clear timer, tracked so a
  // rapid second install cancels the prior timer and unmount can clear it.
  const highlightTimerRef = useRef(null);
  const refreshMods = useCallback(async (trackNew = false) => {
    if (!window.api) return;
    const mods = await window.api.mods.scan();
    if (trackNew && prevModFilenames.current.size > 0) {
      const newMods = new Set();
      mods.forEach(m => {
        const key = m.id || m.filename;
        if (!prevModFilenames.current.has(key)) newMods.add(key);
      });
      if (newMods.size > 0) {
        setNewlyInstalledMods(newMods);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          highlightTimerRef.current = null;
          setNewlyInstalledMods(new Set());
        }, 2000);
      }
    }
    prevModFilenames.current = new Set(mods.map(m => m.id || m.filename));
    setModules(mods);
    // Auto-refresh conflict data after mod changes
    if (window.api.conflicts?.scan) {
      window.api.conflicts.scan().then(result => {
        if (typeof onConflictsUpdate === 'function') onConflictsUpdate(result || []);
      }).catch(() => {});
    }
  }, [onConflictsUpdate]);

  // Clear the pending newly-installed highlight timer on unmount so it can't
  // fire setState after the hook's host unmounts.
  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  // --- Module Click ---
  const handleModuleClick = useCallback((modId) => {
    setActiveModuleId(prev => prev === modId ? null : modId);
  }, []);

  // --- Toggle Enable ---
  const handleToggleEnable = useCallback(async (filename) => {
    if (!window.api) return;
    const doToggle = async () => {
      try {
        const result = await window.api.mods.toggle(filename);
        await refreshMods();
        notifyManualChange();
        addToast(result.enabled ? t.toastEnabled : t.toastDisabled, 'success');
      } catch (err) {
        console.error('Toggle failed:', err);
        addToast(`${t.toastToggleFailed || 'Toggle failed'}: ${err?.message || err}`, 'error');
      }
    };
    if (isGameRunning) {
      showConfirm(t.gameRunningWarning, t.gameRunningWarningDesc, doToggle, 'warning');
    } else {
      await doToggle();
    }
  }, [isGameRunning, t, refreshMods, addToast, showConfirm, notifyManualChange]);

  // --- Uninstall ---
  const handleUninstallLocalMod = useCallback((filename) => {
    const doRemove = async () => {
      await window.api.mods.remove(filename);
      await refreshMods();
      if (activeModuleId === filename) setActiveModuleId(null);
      notifyManualChange();
      addToast(t.toastUninstalled, 'warning');
    };

    // 找出 hybrid 關聯模組名稱
    const mod = modules.find(m => m.filename === filename);
    const linkedItems = mod?.hybrid
      ? (mod.linkedPaks || (mod.linkedUe4ss ? [mod.linkedUe4ss] : []))
      : [];
    const isPakLink = !!mod?.linkedPaks;

    const desc = linkedItems.length > 0 ? (
      <div>
        <p>{t.confirmUninstallDesc}</p>
        <p className="mt-3 text-xs font-bold text-orange-500">{t.hybridDeleteWarning || 'Linked mods will also be removed'}:</p>
        {linkedItems.map(item => (
          <div key={item} className="flex items-center justify-center gap-2 mt-1.5">
            {isPakLink
              ? <Package className="w-4 h-4 text-indigo-500 shrink-0" />
              : <Puzzle className="w-4 h-4 text-emerald-500 shrink-0" />
            }
            <span className="text-sm font-mono font-semibold text-slate-700 dark:text-slate-200">{item}</span>
          </div>
        ))}
      </div>
    ) : t.confirmUninstallDesc;
    if (isGameRunning) {
      // Don't string-interpolate `desc` — if it's JSX (hybrid mod case),
      // template-literal converts it to "[object Object]".
      const fullDesc = typeof desc === 'string'
        ? `${t.gameRunningWarningDesc}\n\n${desc}`
        : (
          <div>
            <p className="font-bold mb-2 whitespace-pre-line">{t.gameRunningWarningDesc}</p>
            {desc}
          </div>
        );
      showConfirm(t.gameRunningWarning, fullDesc, doRemove, 'danger');
    } else {
      showConfirm(t.confirmUninstallTitle, desc, doRemove);
    }
  }, [isGameRunning, activeModuleId, modules, t, refreshMods, addToast, showConfirm, notifyManualChange]);

  // --- Install with Preview ---
  const doInstallPreview = useCallback(async (paths) => {
    setPendingInstallPaths(paths);
    setPreviewLoading(true);
    setShowPreview(true);
    try {
      const previews = await window.api.mods.preview(paths);
      setPreviewData(previews);
    } catch (err) {
      console.error('Preview failed:', err);
      setPreviewData([]);
      addToast(`${t.toastInstallFailed || 'Install failed'}: ${err.message || err}`, 'error');
    } finally {
      setPreviewLoading(false);
    }
  }, [addToast, t]);

  // Direct install — bypasses the preview dialog. Used when the user has
  // opted into "don't show again" on the preview modal (or toggled it in
  // Settings). Still goes through the game-running guard.
  const doDirectInstall = useCallback(async (paths) => {
    try {
      await window.api.mods.install(paths);
      await refreshMods(true);
      notifyManualChange();
      addToast(t.toastInstalled, 'success');
    } catch (err) {
      console.error('Install failed:', err);
      addToast(`${t.toastInstallFailed || 'Install failed'}: ${err.message || err}`, 'error');
    }
  }, [refreshMods, notifyManualChange, addToast, t]);

  const handleInstallWithPreview = useCallback(async (paths) => {
    if (!window.api || !paths?.length) return;
    const installer = skipInstallPreview ? doDirectInstall : doInstallPreview;
    if (isGameRunning) {
      showConfirm(t.gameRunningWarning, t.gameRunningWarningDesc, async () => {
        await installer(paths);
      }, 'warning');
      return;
    }
    await installer(paths);
  }, [isGameRunning, t, showConfirm, doInstallPreview, doDirectInstall, skipInstallPreview]);

  const handleConfirmInstall = useCallback(async () => {
    if (!window.api || !pendingInstallPaths.length) return;
    setShowPreview(false);
    try {
      await window.api.mods.install(pendingInstallPaths);
      await refreshMods(true);
      notifyManualChange();
      addToast(t.toastInstalled, 'success');
    } catch (err) {
      console.error('Install failed:', err);
      addToast(`${t.toastInstallFailed || 'Install failed'}: ${err.message || err}`, 'error');
    }
    setPendingInstallPaths([]);
    setPreviewData([]);
  }, [pendingInstallPaths, t, refreshMods, addToast, notifyManualChange]);

  // --- Drop ---
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!window.api) return;
    const files = Array.from(e.dataTransfer?.files || []);
    const paths = files
      .map(f => window.api.system.getPathForFile(f))
      .filter(p => {
        if (!p) return false;
        const lower = p.toLowerCase();
        return lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.pak');
      });
    if (paths.length > 0) {
      await handleInstallWithPreview(paths);
    }
  }, [handleInstallWithPreview]);

  // --- Import Files ---
  const handleImportFiles = useCallback(async () => {
    if (!window.api) return;
    const files = await window.api.system.selectFiles();
    if (files && files.length > 0) {
      await handleInstallWithPreview(files);
    }
  }, [handleInstallWithPreview]);

  const handleSetNexusApiKey = useCallback((key) => {
    setNexusApiKey(key);
    persistSetting('nexusApiKey', key);
  }, [persistSetting]);

  // --- Batch Operations ---
  const handleBatchToggle = useCallback(async (enable) => {
    if (!window.api || selectedMods.size === 0) return;
    const run = async () => {
      let failed = 0;
      for (const filename of selectedMods) {
        const mod = modules.find(m => m.filename === filename);
        if (mod && mod.enabled !== enable) {
          // One locked/in-use file (common while the game is running) must not
          // abort the whole batch and leave it silently half-applied.
          try { await window.api.mods.toggle(filename); }
          catch (err) { console.error(`Batch toggle failed: ${filename}`, err); failed++; }
        }
      }
      await refreshMods();
      notifyManualChange();
      setSelectedMods(new Set());
      setBatchMode(false);
      if (failed > 0) addToast(`${t.toastBatchFailed || 'Some mods could not be changed'} (${failed})`, 'error');
      else addToast(enable ? t.toastEnabled : t.toastDisabled, 'success');
    };
    if (isGameRunning) {
      showConfirm(t.gameRunningWarning, t.gameRunningWarningDesc, run, 'warning');
    } else {
      await run();
    }
  }, [selectedMods, modules, t, refreshMods, addToast, notifyManualChange, isGameRunning, showConfirm]);

  const handleBatchRemove = useCallback(() => {
    if (selectedMods.size === 0) return;
    const run = async () => {
      let failed = 0;
      for (const filename of selectedMods) {
        try { await window.api.mods.remove(filename); }
        catch (err) { console.error(`Batch remove failed: ${filename}`, err); failed++; }
      }
      await refreshMods();
      notifyManualChange();
      setSelectedMods(new Set());
      setBatchMode(false);
      if (failed > 0) addToast(`${t.toastBatchFailed || 'Some mods could not be removed'} (${failed})`, 'error');
      else addToast(t.toastUninstalled, 'warning');
    };
    if (isGameRunning) {
      showConfirm(t.gameRunningWarning, t.gameRunningWarningDesc, run, 'danger');
    } else {
      showConfirm(t.confirmBatchDeleteTitle, t.confirmBatchDeleteDesc, run);
    }
  }, [selectedMods, t, showConfirm, refreshMods, addToast, notifyManualChange, isGameRunning]);

  // --- Rename (Custom Display Name) ---
  const handleRenameMod = useCallback(async (modId, customName) => {
    if (!window.api) return;
    await window.api.mods.setCustomName(modId, customName || null);
    await refreshMods();
    addToast(customName ? t.toastRenamed : t.toastNameReset, 'success');
  }, [refreshMods, addToast, t]);

  const handleToggleSelect = useCallback((filename) => {
    setSelectedMods(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  // --- Init ---
  const initMods = useCallback(async () => {
    const mods = await window.api?.mods?.scan();
    if (mods) {
      prevModFilenames.current = new Set(mods.map(m => m.id || m.filename));
      setModules(mods);
    }
    const key = await window.api?.settings?.get('nexusApiKey', '');
    if (key) setNexusApiKey(key);
  }, []);

  return {
    // State
    modules, setModules,
    newlyInstalledMods,
    activeModuleId, setActiveModuleId,
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    sortBy, setSortBy,
    batchMode, setBatchMode,
    selectedMods, setSelectedMods,
    showPreview, setShowPreview,
    previewData, setPreviewData,
    previewLoading,
    pendingInstallPaths, setPendingInstallPaths,
    nexusApiKey,
    isDragging, setIsDragging,
    fileInputRef,
    // Handlers
    refreshMods,
    handleModuleClick,
    handleToggleEnable,
    handleUninstallLocalMod,
    handleInstallWithPreview,
    handleConfirmInstall,
    handleDrop,
    handleImportFiles,
    handleSetNexusApiKey,
    handleBatchToggle,
    handleBatchRemove,
    handleToggleSelect,
    handleRenameMod,
    initMods,
  };
}
