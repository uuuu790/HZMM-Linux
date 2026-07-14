import { useState, useCallback, useEffect, useRef } from 'react';

export function useAppInit({ addToast, t, refreshMods }) {
  // --- Game ---
  const [gamePath, setGamePath] = useState(null);
  const [gameVersion, setGameVersion] = useState(null);
  const [isGameRunning, setIsGameRunning] = useState(false);
  // launchState: 'idle' | 'launching' | 'confirmed'
  const [launchState, setLaunchState] = useState('idle');
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
  const launchTimerRef = useRef(null);
  useEffect(() => {
    if (isGameRunning && launchState === 'launching') {
      // Game detected — the not-detected fallback timer is now moot.
      if (launchTimerRef.current) { clearTimeout(launchTimerRef.current); launchTimerRef.current = null; }
      setLaunchState('confirmed');
    }
  }, [isGameRunning, launchState]);

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
    // Fallback: reset to idle if the game is never DETECTED. game:launch only
    // dispatches the steam:// URL and resolves immediately — clearing this on
    // resolve (as the code used to) killed the fallback milliseconds in, so a
    // cancelled Steam dialog / crashed boot left the Launch button disabled
    // until app restart. The timer is cleared by the detection effect above.
    if (launchTimerRef.current) clearTimeout(launchTimerRef.current);
    launchTimerRef.current = setTimeout(() => {
      launchTimerRef.current = null;
      setLaunchState((s) => (s === 'launching' ? 'idle' : s));
    }, 30000);
    try {
      await window.api.game.launch();
    } catch (err) {
      console.error('Launch failed:', err);
      if (launchTimerRef.current) { clearTimeout(launchTimerRef.current); launchTimerRef.current = null; }
      setLaunchState('idle');
    }
  }, [isGameRunning, launchState, addToast, t]);

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
      // A failed UPDATE leaves the existing install untouched — reverting to
      // 'uninstalled' made the dashboard offer "Install" over a working setup.
      setUe4ssStatus(action === 'install' ? 'uninstalled' : 'installed');
      const msg = err?.message?.includes('GAME_PATH_NOT_FOUND')
        ? t.toastEngineFailedNoPath
        : `${t.toastEngineFailed}: ${err?.message || err}`;
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
    handleUe4ssAction,
    handleConflictScan, handleOpenLogs, handleOpenLogFile,
    handleRescan,
    initGame,
  };
}
