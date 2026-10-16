import { useState, useCallback, useEffect, useRef } from 'react';

export function useAppInit({ addToast, t, refreshMods }) {
  // --- Game ---
  const [gamePath, setGamePath] = useState(null);
  const [gameVersion, setGameVersion] = useState(null);
  const [isGameRunning, setIsGameRunning] = useState(false);
  // launchState: 'idle' | 'launching' | 'confirmed'
  const [launchState, setLaunchState] = useState('idle');
  // 30s fallback timer that returns launchState to 'idle' if the game is never
  // detected (e.g. the user cancels Steam's launch dialog). Held in a ref so the
  // confirm effect and unmount cleanup can clear it — see handleLaunch.
  const launchTimeoutRef = useRef(null);
  const [detecting, setDetecting] = useState(false);

  // --- UE4SS ---
  const [ue4ssStatus, setUe4ssStatus] = useState('uninstalled');
  const [ue4ssProgress, setUe4ssProgress] = useState(0);
  const [ue4ssVersion, setUe4ssVersion] = useState(null);

  // --- Conflict & Log Modals ---
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflicts, setConflicts] = useState(null);
  const conflictsRef = useRef(null);
  const [conflictScanning, setConflictScanning] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logLines, setLogLines] = useState(null);
  const [logLoading, setLogLoading] = useState(false);

  // --- Cache Rescan ---
  const [rescanning, setRescanning] = useState(false);

  // --- Computed ---
  const isProcessing = ue4ssStatus === 'installing' || ue4ssStatus === 'updating';

  // --- Game running detection ---
  // The MAIN process polls the game process and pushes state changes here (and
  // re-asserts on window show). Polling in main avoids the renderer background
  // throttling that makes hidden-window polling unreliable on Windows — which
  // is what left a stale "running" state when the game was closed while HZMM
  // sat in the tray. One initial query keeps first paint correct before the
  // first push arrives.
  useEffect(() => {
    if (!window.api) return;
    let cancelled = false;
    window.api.game.isRunning().then(r => { if (!cancelled) setIsGameRunning(r); }).catch(() => { /* transient */ });
    const unsub = window.api.game.onRunning?.((running) => setIsGameRunning(running));
    return () => { cancelled = true; if (unsub) unsub(); };
  }, []);

  // --- UE4SS progress listener ---
  useEffect(() => {
    if (!window.api) return;
    // downloadFile emits -1 as the "no content-length" indeterminate signal;
    // rendering it verbatim showed "-1%" and a negative-width bar.
    const unsub = window.api.ue4ss.onProgress((progress) => {
      setUe4ssProgress(typeof progress === 'number' && progress >= 0 ? progress : 0);
    });
    return unsub;
  }, []);

  // --- Handlers ---
  const handleDetectPath = useCallback(async () => {
    if (!window.api || detecting) return;
    setDetecting(true);
    try {
      const [path] = await Promise.all([
        window.api.game.detectPath(),
        new Promise(r => setTimeout(r, 800)),
      ]);
      setGamePath(path);
      if (path) await refreshMods();
    } finally {
      setDetecting(false);
    }
  }, [detecting, refreshMods]);

  const handleBrowsePath = useCallback(async () => {
    if (!window.api) return;
    const folder = await window.api.system.selectFolder();
    if (!folder) return;

    const result = await window.api.game.setPath(folder);
    if (!result || result.valid) {
      // Old API (no return) or valid
      setGamePath(folder);
      await refreshMods();
    } else if (result.reason === 'select-subfolder' && result.suggestion) {
      // Auto-correct: they selected parent folder
      const fixed = await window.api.game.setPath(result.suggestion);
      if (!fixed || fixed.valid) {
        setGamePath(result.suggestion);
        await refreshMods();
        addToast(t.pathAutoCorrected || `Path corrected to: ${result.suggestion}`, 'info');
      }
    } else {
      addToast(t.pathInvalid || 'Selected folder is not a valid HumanitZ game directory', 'error');
    }
  }, [refreshMods, addToast, t]);

  // Keep conflicts ref in sync
  useEffect(() => { conflictsRef.current = conflicts; }, [conflicts]);

  // Launch state machine: idle → launching → confirmed → idle (isGameRunning takes over).
  // Promote launching → confirmed once the game process is detected.
  useEffect(() => {
    if (isGameRunning && launchState === 'launching') {
      // Launch confirmed — cancel the 30s fallback so it can't later force idle.
      if (launchTimeoutRef.current) { clearTimeout(launchTimeoutRef.current); launchTimeoutRef.current = null; }
      setLaunchState('confirmed');
    }
  }, [isGameRunning, launchState]);

  // Clear the launch fallback on unmount so it can't fire against a dead component.
  useEffect(() => () => {
    if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
  }, []);

  // Auto-reset the brief "confirmed" checkmark back to idle. This MUST live in
  // its own effect keyed only on launchState. If the timer were set in the same
  // effect that calls setLaunchState('confirmed'), that state change re-runs the
  // effect and fires its cleanup — clearing the timer before it can fire — so
  // launchState would stay stuck on 'confirmed' forever (UI shows "game running"
  // even after exit, and the launch button stays disabled). Keying on launchState
  // alone means the timer only clears when we leave 'confirmed', not on entry.
  useEffect(() => {
    if (launchState !== 'confirmed') return;
    const timer = setTimeout(() => setLaunchState('idle'), 1200);
    return () => clearTimeout(timer);
  }, [launchState]);

  const handleLaunch = useCallback(async () => {
    if (!window.api || isGameRunning || launchState !== 'idle') return;
    // Block launch if there are active conflicts
    const currentConflicts = conflictsRef.current;
    if (currentConflicts && currentConflicts.length > 0) {
      addToast(t.launchConflictBlocked || 'Cannot launch: mod conflicts detected. Please resolve conflicts first.', 'error');
      return;
    }
    setLaunchState('launching');
    // Timeout fallback in case game detection fails. NOTE: launch() resolves as
    // soon as the main process hands off to Steam — long before the game is
    // detected — so we must NOT clear this on resolve, or a cancelled/failed
    // launch would leave launchState stuck on 'launching' forever (and the
    // Launch button permanently disabled). It's cleared when the launch is
    // confirmed (game detected) or on unmount; only the reject path below clears
    // it, because there we reset to idle immediately.
    if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
    launchTimeoutRef.current = setTimeout(() => {
      launchTimeoutRef.current = null;
      setLaunchState('idle');
    }, 30000);
    try {
      await window.api.game.launch();
    } catch (err) {
      console.error('Launch failed:', err);
      setLaunchState('idle');
      if (launchTimeoutRef.current) { clearTimeout(launchTimeoutRef.current); launchTimeoutRef.current = null; }
    }
  }, [isGameRunning, launchState, addToast, t]);

  // Toast + list refresh when the main process auto-restores a vanilla set.
  // The vanilla-launch BUTTON was removed, but the restore listener stays: a
  // pending set from an older build's vanilla launch (crash recovery) still
  // gets handed back on startup and the user should see why mods reappeared.
  useEffect(() => {
    if (!window.api?.game?.onVanillaRestored) return;
    const off = window.api.game.onVanillaRestored(async () => {
      addToast(t.vanillaRestored || 'Mods restored', 'success');
      try { await refreshMods(); } catch { /* list refresh is best-effort */ }
    });
    return off;
  }, [addToast, t, refreshMods]);

  const handleUe4ssAction = useCallback(async () => {
    if (!window.api) return;
    if (!gamePath) {
      addToast(t.toastEngineFailedNoPath, 'error');
      return;
    }
    const action = ue4ssStatus === 'uninstalled' ? 'install' : 'update';
    setUe4ssStatus(action === 'install' ? 'installing' : 'updating');
    setUe4ssProgress(0);
    try {
      const result = await window.api.ue4ss[action]();
      setUe4ssStatus('installed');
      if (result?.version) setUe4ssVersion(result.version);
      addToast(t.toastEngineDone, 'success');
    } catch (err) {
      console.error('UE4SS action failed:', err);
      // An update that fails at the fetch/download stage leaves the existing
      // install intact — don't flip the dashboard to "Not Installed". Re-query
      // the real status; fall back to the pre-action assumption on error
      // (install→uninstalled, update→still installed).
      window.api.ue4ss.getStatus()
        .then(s => {
          setUe4ssStatus(s?.status || (action === 'install' ? 'uninstalled' : 'installed'));
          if (s?.version) setUe4ssVersion(s.version);
        })
        .catch(() => setUe4ssStatus(action === 'install' ? 'uninstalled' : 'installed'));
      // Network-shaped failures (stall, blocked CDN, proxy issues) get a hint
      // pointing at the local-zip fallback instead of a bare error string.
      const raw = err?.message || String(err);
      const isNetworkErr = /stalled|Download failed|Download blocked|timed out|rate limit|net::|ENOTFOUND|ECONN/i.test(raw);
      const msg = raw.includes('GAME_PATH_NOT_FOUND')
        ? t.toastEngineFailedNoPath
        : `${t.toastEngineFailed}: ${raw}`;
      addToast(msg, 'error');
      if (isNetworkErr && t.toastEngineNetworkHint) addToast(t.toastEngineNetworkHint, 'error');
    }
  }, [ue4ssStatus, gamePath, t, addToast]);

  // Local-zip fallback: user picks a UE4SS release zip they downloaded
  // themselves (for networks where the app can't reach GitHub's CDN).
  const handleUe4ssManualInstall = useCallback(async () => {
    if (!window.api?.ue4ss?.installFromFile) return;
    if (!gamePath) {
      addToast(t.toastEngineFailedNoPath, 'error');
      return;
    }
    const prevStatus = ue4ssStatus;
    setUe4ssStatus('installing');
    setUe4ssProgress(100); // no download phase — extract only
    try {
      const result = await window.api.ue4ss.installFromFile();
      if (result?.canceled) {
        setUe4ssStatus(prevStatus);
        return;
      }
      setUe4ssStatus('installed');
      setUe4ssVersion(result?.version || 'manual');
      addToast(t.toastEngineDone, 'success');
    } catch (err) {
      console.error('UE4SS manual install failed:', err);
      // Same recovery as handleUe4ssAction: re-query the real status instead
      // of guessing, falling back to the pre-action state.
      window.api.ue4ss.getStatus()
        .then(s => {
          setUe4ssStatus(s?.status || prevStatus);
          if (s?.version) setUe4ssVersion(s.version);
        })
        .catch(() => setUe4ssStatus(prevStatus));
      const raw = err?.message || String(err);
      const msg = raw.includes('GAME_PATH_NOT_FOUND')
        ? t.toastEngineFailedNoPath
        : raw.includes('INVALID_UE4SS_ZIP')
          ? (t.toastEngineInvalidZip || 'Not a UE4SS zip')
          : `${t.toastEngineFailed}: ${raw}`;
      addToast(msg, 'error');
    }
  }, [ue4ssStatus, gamePath, t, addToast]);

  const handleConflictScan = useCallback(async () => {
    setConflictModalOpen(true);
    setConflictScanning(true);
    try { const result = await window.api.conflicts.scan(); setConflicts(result || []); }
    catch { setConflicts([]); }
    setConflictScanning(false);
  }, []);

  // Silent conflict refresh (no modal) — the load-order panel uses it to badge
  // winners without opening the conflict dialog.
  const refreshConflicts = useCallback(async () => {
    try { const result = await window.api.conflicts.scan(); setConflicts(result || []); }
    catch { /* keep whatever we had */ }
  }, []);

  // Apply a full drag-and-drop pak sequence (renumber renames in the main
  // process). Returns true on success so the panel can close itself.
  const [applyingPakOrder, setApplyingPakOrder] = useState(false);
  const handleApplyPakOrder = useCallback(async (orderedFilenames) => {
    if (!window.api?.mods?.applyPakOrder || applyingPakOrder) return false;
    setApplyingPakOrder(true);
    try {
      await window.api.mods.applyPakOrder(orderedFilenames);
      addToast(t.loadOrderApplied || 'Load order applied', 'success');
      try { await refreshMods(); } catch { /* list refresh is best-effort */ }
      refreshConflicts();
      return true;
    } catch (e) {
      addToast(`${t.loadOrderApplyFailed || 'Load order apply failed'}: ${e?.message || ''}`, 'error');
      return false;
    } finally {
      setApplyingPakOrder(false);
    }
  }, [applyingPakOrder, addToast, t, refreshMods, refreshConflicts]);

  // Make a pak win its conflict group (load-order rename in the main process),
  // then re-scan so the modal reflects the new winner. `makingWin` holds the
  // filename being renamed so the modal can disable just that row.
  const [makingWin, setMakingWin] = useState(null);
  const handleMakeWin = useCallback(async (filename, competitors) => {
    if (!window.api?.mods?.makePakWin || makingWin) return;
    setMakingWin(filename);
    try {
      await window.api.mods.makePakWin(filename, competitors);
      addToast(t.conflictMakeWinDone || 'Load order updated', 'success');
      try { await refreshMods(); } catch { /* list refresh is best-effort */ }
      try { const result = await window.api.conflicts.scan(); setConflicts(result || []); } catch { /* keep stale list */ }
    } catch (e) {
      addToast(`${t.conflictMakeWinFailed || 'Load order change failed'}: ${e?.message || ''}`, 'error');
    } finally {
      setMakingWin(null);
    }
  }, [makingWin, addToast, t, refreshMods]);

  const handleOpenLogs = useCallback(async () => {
    setLogModalOpen(true);
    setLogLoading(true);
    try { const lines = await window.api.logger.readRecent(); setLogLines(lines || []); }
    catch { setLogLines([]); }
    setLogLoading(false);
  }, []);

  const handleOpenLogFile = useCallback(async () => {
    if (!window.api) return;
    const p = await window.api.logger.getPath();
    if (p) window.api.system.openPath(p);
  }, []);

  const handleRescan = useCallback(async () => {
    if (!window.api || rescanning) return;
    setRescanning(true);
    try {
      await Promise.all([
        (async () => { await window.api.mods.invalidateCache(); await refreshMods(); })(),
        new Promise(r => setTimeout(r, 800)),
      ]);
    } finally { setRescanning(false); }
  }, [rescanning, refreshMods]);

  // --- Init game path + UE4SS ---
  const initGame = useCallback(async () => {
    const path = await window.api.game.detectPath();
    setGamePath(path);

    // Use cached version immediately (no network), refresh in background
    const cached = await window.api.game.getVersionCached();
    if (cached) setGameVersion(cached);

    // Run mod scan + UE4SS check in parallel (both local/fast)
    await Promise.all([
      path ? refreshMods() : Promise.resolve(),
      window.api.ue4ss.getStatus().then(status => { setUe4ssStatus(status.status); setUe4ssVersion(status.version || null); }).catch(() => {}),
    ]);

    // Background: fetch fresh version from Steam API (slow, don't block UI)
    window.api.game.getVersion().then(ver => { if (ver) setGameVersion(ver); }).catch(() => {});
  }, [refreshMods]);

  return {
    // State
    gamePath, setGamePath,
    gameVersion,
    isGameRunning, launchState,
    detecting,
    ue4ssStatus, ue4ssProgress, ue4ssVersion,
    isProcessing,
    conflictModalOpen, setConflictModalOpen,
    conflicts, setConflicts, conflictScanning,
    logModalOpen, setLogModalOpen,
    logLines, logLoading,
    rescanning,
    // Handlers
    handleDetectPath, handleBrowsePath, handleLaunch,
    handleUe4ssAction, handleUe4ssManualInstall,
    handleConflictScan, handleMakeWin, makingWin,
    refreshConflicts, handleApplyPakOrder, applyingPakOrder,
    handleOpenLogs, handleOpenLogFile,
    handleRescan,
    initGame,
  };
}
