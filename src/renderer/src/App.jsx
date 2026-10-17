import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getTheme } from './constants/themes';
import appIcon from './assets/icon.png';
import { clampZoom, stepZoom, ZOOM_STEP } from './utils/zoom';

// Constants
import { UI_TEXT } from './constants/i18n';

// Styles
import { APP_STYLES } from './styles/appStyles';

// Common components
import { ToastContainer, ConfirmModal, Spinner } from './components/common';

// Layout components
import Sidebar from './components/layout/Sidebar';
import AppHeader from './components/layout/AppHeader';

// Modal components
import ConfigEditorModal from './components/modals/ConfigEditorModal';
import ConflictModal from './components/modals/ConflictModal';
import NexusLinkModal from './components/modals/NexusLinkModal';
import LogModal from './components/modals/LogModal';
import PreviewModal from './components/modals/PreviewModal';
import WorldSelectModal from './components/modals/WorldSelectModal';

// Tab components
import DashboardTab from './components/tabs/DashboardTab';
const ModulesTab = lazy(() => import('./components/tabs/ModulesTab'));
const ProfilesTab = lazy(() => import('./components/tabs/ProfilesTab'));
const SettingsTab = lazy(() => import('./components/tabs/SettingsTab'));
const NexusTab = lazy(() => import('./components/tabs/NexusTab'));
const SteamWorkshopTab = lazy(() => import('./components/tabs/SteamWorkshopTab'));

// Hooks
import { useToast } from './hooks/useToast';
import { useConfirmModal } from './hooks/useConfirmModal';
import { useTheme } from './hooks/useTheme';
import { useModHandlers } from './hooks/useModHandlers';
import { useBackupHandlers } from './hooks/useBackupHandlers';
import { useProfileHandlers } from './hooks/useProfileHandlers';
import { useUpdateHandlers } from './hooks/useUpdateHandlers';
import { useAppInit } from './hooks/useAppInit';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import { useNxm } from './hooks/useNxm';
import { useNexusSources } from './hooks/useNexusSources';
import { useAmbientMotion } from './hooks/useAmbientMotion';

// ==========================================
// Main App Component
// ==========================================

// Sidebar tab order — used to pick the tab-switch slide direction.
const tabOrder = ['dashboard', 'modules', 'profiles', 'nexus', 'steamWorkshop', 'settings'];

export default function App() {
  // --- Language ---
  const [lang, setLang] = useState('zh-TW');
  const [supportedLocales, setSupportedLocales] = useState([]);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  // --- Tray & Startup ---
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [autoStart, setAutoStart] = useState(false);

  // --- UI Zoom ---
  const [uiZoom, setUiZoom] = useState(1);

  // --- Install preview toggle ---
  // Power users / mod authors who install the same archive repeatedly find
  // the preview dialog redundant. When true, handleInstallWithPreview skips
  // the modal and installs directly. Settable from the modal's own
  // "don't show again" checkbox and from the Settings tab.
  const [skipInstallPreview, setSkipInstallPreview] = useState(false);

  // --- i18n ---
  const t = UI_TEXT[lang];

  // --- Tab ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const prevTabRef = useRef('dashboard');

  // --- Config Editor ---
  const [configEditorMod, setConfigEditorMod] = useState(null);

  // --- Scroll fade-out ---
  // Auto-hide the scrollbar thumb when the user stops scrolling. Uses direct
  // DOM class mutation instead of React state so we don't trigger a re-render
  // of the whole app on every scroll tick (which happens at ~60Hz).
  const scrollAreaRef = useRef(null);
  const scrollIdleTimerRef = useRef(null);
  const handleContentScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.classList.add('is-scrolling');
    // Fade the top clip edge only while actually scrolled — see
    // .scroll-top-fade in appStyles.js for why it can't be resident.
    el.classList.toggle('scroll-top-fade', el.scrollTop > 2);
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = setTimeout(() => {
      el.classList.remove('is-scrolling');
    }, 700);
  }, []);
  useEffect(() => () => {
    if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
  }, []);

  // ==========================================
  // Extracted Hooks
  // ==========================================

  const { toasts, addToast, dismissToast } = useToast();
  const { confirmModal, showConfirm, closeConfirm } = useConfirmModal();

  const persistSetting = useCallback((key, value) => {
    if (window.api) window.api.settings.set(key, value);
  }, []);

  const { isDark, setIsDark, themeId, setThemeId, toggleDark, changeTheme } = useTheme({ persistSetting });

  // Remember theme colours and language for the next launch's splash: the
  // preload reads this before index.html paints (the mode comes from main).
  useEffect(() => {
    const theme = getTheme(themeId);
    try {
      localStorage.setItem('hzmm.splash', JSON.stringify({
        accent: theme.accent.rgb,
        from: theme.gradient.from,
        to: theme.gradient.to,
        hue: theme.iconHueRotate || '0deg',
        lang,
      }));
    } catch { /* storage unavailable: the next splash keeps its defaults */ }
  }, [themeId, lang]);

  useAmbientMotion();

  const handleSetMinimizeToTray = useCallback((enabled) => {
    setMinimizeToTray(enabled);
    if (window.api) window.api.settings.set('minimizeToTray', enabled);
  }, []);

  const handleSetAutoStart = useCallback((enabled) => {
    setAutoStart(enabled);
    if (window.api) window.api.system.setAutoStart(enabled);
  }, []);

  const handleSetSkipInstallPreview = useCallback((enabled) => {
    setSkipInstallPreview(enabled);
    persistSetting('skipInstallPreview', enabled);
  }, [persistSetting]);

  const handleSetUiZoom = useCallback((factor) => {
    const z = clampZoom(factor);
    setUiZoom(z);
    window.api?.ui?.setZoom?.(z);
    persistSetting('uiZoom', z);
    // After zoom + reflow, if the content area overflows horizontally, ask main
    // to grow the window just enough to fit it (main clamps to the screen,
    // grows only). The horizontal scroll stays as a fallback past screen width.
    requestAnimationFrame(() => {
      const area = scrollAreaRef.current;
      if (area && area.scrollWidth > area.clientWidth + 1) {
        const neededInner = window.innerWidth + (area.scrollWidth - area.clientWidth);
        window.api?.ui?.fitWindow?.(Math.ceil(neededInner * z));
      }
    });
  }, [persistSetting]);

  // ==========================================
  // Domain Hooks
  // ==========================================

  const {
    appVersion, updateState, updateInfo, updateProgress, isUpdating, updateError,
    handleCheckUpdate, handleDownloadUpdate, handleInstallUpdate,
    initVersion,
  } = useUpdateHandlers();

  const [isGameRunningProxy, setIsGameRunningProxy] = useState(false);

  const clearActiveProfileRef = useRef(() => {});
  const updateConflictsRef = useRef(() => {});

  const modHandlers = useModHandlers({
    addToast, showConfirm, t,
    isGameRunning: isGameRunningProxy,
    persistSetting,
    skipInstallPreview,
    onManualModChange: () => clearActiveProfileRef.current(),
    onConflictsUpdate: (data) => updateConflictsRef.current(data),
  });

  const {
    modules, newlyInstalledMods,
    activeModuleId, setActiveModuleId,
    searchQuery, setSearchQuery,
    filterType, setFilterType,
    sortBy, setSortBy,
    batchMode, setBatchMode,
    selectedMods, setSelectedMods,
    showPreview, setShowPreview,
    previewData, setPreviewData,
    previewLoading,
    pendingInstallPaths: _pendingInstallPaths, setPendingInstallPaths,
    nexusApiKey,
    isDragging, setIsDragging,
    fileInputRef,
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
  } = modHandlers;

  const {
    gamePath, gameVersion,
    isGameRunning, launchState, detecting,
    ue4ssStatus, ue4ssProgress, ue4ssVersion,
    isProcessing,
    conflictModalOpen, setConflictModalOpen,
    conflicts, setConflicts, conflictScanning,
    logModalOpen, setLogModalOpen,
    logLines, logLoading,
    rescanning,
    handleDetectPath, handleBrowsePath, handleLaunch,
    handleUe4ssAction, handleUe4ssManualInstall,
    handleConflictScan, handleMakeWin, makingWin,
    handleOpenLogs, handleOpenLogFile,
    handleRescan,
    initGame,
  } = useAppInit({ addToast, t, refreshMods });

  const {
    updateMap: modUpdateMap, updateCount: modUpdateCount, updatingModId, updateAllBusy, updateProgress: modUpdateProgress, updateAllProgress, handleUpdateMod, handleUpdateAll, runCheck: recheckUpdates,
  } = useUpdateChecker({ nexusApiKey, addToast, t, refreshMods });

  const { nxmEnabled, handleSetNxmEnabled } = useNxm({ addToast, t, refreshMods, recheckUpdates });

  // filename → Nexus source lookups (claim + rollback features)
  const { linkedSet: nexusLinkedSet, rollbackMap, refreshNexusSources } = useNexusSources({ modules });
  const [linkTarget, setLinkTarget] = useState(null);
  const handleLinkMod = useCallback((mod) => setLinkTarget(mod), []);
  const handleLinkedDone = useCallback(() => {
    refreshNexusSources();
    recheckUpdates(true); // the freshly-linked mod should get its verdict now
  }, [refreshNexusSources, recheckUpdates]);

  const handleRollbackMod = useCallback((mod) => {
    const info = rollbackMap.get((mod.filename || '').replace(/\.disabled$/i, ''));
    if (!info) return;
    showConfirm(
      t.rollback || 'Roll back',
      (t.rollbackConfirm || 'Replace the current files with the previous version{v}?').replace('{v}', info.version ? ` (v${info.version})` : ''),
      async () => {
        try {
          await window.api.nexus.rollbackMod(info.modId, info.dir);
          addToast(t.rollbackDone || 'Rolled back', 'success');
          try { await refreshMods(); } catch { /* list refresh is best-effort */ }
          refreshNexusSources();
          recheckUpdates(true); // the newer version is available again — show the badge
        } catch (e) {
          addToast(`${t.rollbackFailed || 'Rollback failed'}: ${e?.message || ''}`, 'error');
        }
      },
      'warning'
    );
  }, [rollbackMap, showConfirm, t, addToast, refreshMods, refreshNexusSources, recheckUpdates]);

  // "Rescan mods" also force-rechecks Nexus updates past the 6h throttle, giving
  // the user a manual way to refresh the update badges after the verdict changes.
  const handleRescanAndRecheck = useCallback(async () => {
    await handleRescan();
    recheckUpdates(true);
  }, [handleRescan, recheckUpdates]);

  useEffect(() => {
    setIsGameRunningProxy(isGameRunning);
  }, [isGameRunning]);

  const {
    backups, backupLoading,
    worldSelectOpen, setWorldSelectOpen,
    worldSelectLoading, availableWorlds,
    handleBackup, handleConfirmBackup, handleListBackups,
    handleRestoreBackup, handleDeleteBackup,
    initBackups,
  } = useBackupHandlers({ addToast, showConfirm, t });

  const {
    profiles, activeProfileId, setActiveProfileId,
    newProfileName, setNewProfileName,
    applyingProfileId,
    handleCreateProfile, handleApplyProfile, handleDeleteProfile,
    handleExportProfile, handleImportProfile,
    importModal, importDownloading, importProgress,
    importDownloadAndApply, importApplyAnyway, closeImportModal,
    initProfiles,
  } = useProfileHandlers({ addToast, showConfirm, closeConfirm, t, modules, persistSetting, refreshMods });

  clearActiveProfileRef.current = () => {
    if (activeProfileId !== null) {
      setActiveProfileId(null);
      persistSetting('activeProfileId', null);
    }
  };
  updateConflictsRef.current = setConflicts;

  // ==========================================
  // Tab Animation
  // ==========================================

  // Direction must be locked in AT the tab switch. Computing it inline in JSX
  // re-evaluates on every render — and the effect below has already synced
  // prevTabRef by the time the next unrelated re-render happens (e.g. pressing
  // rescan flips `rescanning`), so the class would flip left↔right and restart
  // the entrance animation: the whole tab content visibly re-fades ("flash").
  // useMemo pins the class until activeTab actually changes; reading the ref
  // here is safe because the memo runs before the effect updates it.
  const tabAnimClass = useMemo(
    () => (tabOrder.indexOf(activeTab) >= tabOrder.indexOf(prevTabRef.current) ? 'animate-tab-left' : 'animate-tab-right'),
    [activeTab]
  );

  useEffect(() => {
    prevTabRef.current = activeTab;
  }, [activeTab]);

  // ==========================================
  // Initialization
  // ==========================================

  useEffect(() => {
    async function init() {
      if (!window.api) {
        // Browser dev mode (no Electron preload) — dismiss the splash
        // so the renderer is inspectable in a normal browser tab. The
        // rest of init depends on IPC; handlers themselves guard for
        // `!window.api` and become no-ops in this mode.
        const splash = document.getElementById('splash-screen');
        if (splash) {
          splash.classList.add('exit');
          setTimeout(() => splash.remove(), 600);
        }
        return;
      }
      // The interface is rendered: the splash (public/splash.js) lets it
      // paint underneath, then starts its droplets.
      window.hzmmSplash?.uiMounted?.();

      try {
        // allSettled, NOT all: these init steps are independent, and any one of
        // them rejecting (e.g. an unreadable mods/backups dir making an IPC
        // handler throw) must neither skip the others' state updates nor — via
        // the finally below — prevent splash dismissal. A rejecting Promise.all
        // here used to leave the opaque splash up forever with the app unusable.
        await Promise.allSettled([
          window.api.locale.getPreference().then(v => setLang(v)),
          window.api.locale.getSupported().then(v => setSupportedLocales(v)),
          window.api.settings.get('darkMode', true).then(v => { setIsDark(v); window.api?.system?.setTitleBarTheme(v); document.documentElement.classList.toggle('dark', v); }),
          window.api.settings.get('themeId', 'ember').then(v => setThemeId(v)),
          window.api.settings.get('minimizeToTray', true).then(v => setMinimizeToTray(v)),
          window.api.settings.get('skipInstallPreview', false).then(v => setSkipInstallPreview(!!v)),
          window.api.settings.get('uiZoom', 1).then(v => setUiZoom(clampZoom(v))),
          window.api.system.getAutoStart().then(v => setAutoStart(v)).catch(() => {}),
          initProfiles(),
          initGame(),
          initVersion(),
          initBackups(),
          initMods(),
        ]);
      } finally {
        // Dismiss HTML splash — ALWAYS, even if an init step above rejected.
        const splash = document.getElementById('splash-screen');
        if (splash) {
          // Loaded: the circling droplets now swirl into a pool; this
          // resolves when it lands, with a promise for when the logo has
          // formed on it. Never wait on either for more than a few seconds.
          const formResult = await Promise.race([
            Promise.resolve(window.hzmmSplash?.form?.()).catch(() => null),
            new Promise(r => setTimeout(() => r(null), 4000)),
          ]);
          const logoFormed = Promise.race([
            formResult?.formed ?? Promise.resolve(),
            new Promise(r => setTimeout(r, 1500)),
          ]);
          // Hand the splash over to the interface (see index.html): as the
          // pool lands, "handoff" sends a liquid wave out from it to the
          // window's far corner, opening the backdrop onto the UI while the
          // logo spins in; once formed, "fly" moves the logo onto the sidebar
          // slot, measured then so the layout has settled. The real logo
          // stays hidden until it lands. Falls back to a plain fade if there
          // is nowhere to land or motion is reduced.
          const target = document.querySelector('[data-app-logo]');
          const logo = document.getElementById('splash-logo');
          const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          if (target?.getBoundingClientRect().width && logo && !reduceMotion) {
            const c = logo.getBoundingClientRect();
            const cx = c.left + c.width / 2;
            const cy = c.top + c.height / 2;
            const far = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy));
            splash.style.setProperty('--hole-x', `${cx}px`);
            splash.style.setProperty('--hole-y', `${cy}px`);
            splash.style.setProperty('--hole-end', `${Math.ceil(far + 140)}px`);
            document.documentElement.classList.add('splash-handoff');
            splash.classList.add('handoff');
            logoFormed.then(() => {
              const from = logo.getBoundingClientRect();
              const to = target.getBoundingClientRect();
              splash.style.setProperty('--fly-x', `${to.left + to.width / 2 - (from.left + from.width / 2)}px`);
              splash.style.setProperty('--fly-y', `${to.top + to.height / 2 - (from.top + from.height / 2)}px`);
              splash.style.setProperty('--fly-s', String(to.width / from.width));
              splash.classList.add('fly');
              setTimeout(() => {
                document.documentElement.classList.remove('splash-handoff');
                splash.remove();
              }, 720);
            });
          } else {
            splash.classList.add('exit');
            setTimeout(() => splash.remove(), 650);
          }
        }
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.mods.onUpdated(async () => { await refreshMods(true); });
    return unsub;
  }, [refreshMods]);

  // Auto-check for updates on startup, but wait a few seconds so it doesn't
  // race with splash dismissal, initial scans, or Nexus bootup — user sees a
  // clean UI first, then the "new version" pill fades in if there's an update.
  useEffect(() => {
    if (!window.api) return;
    const tid = setTimeout(() => { handleCheckUpdate(); }, 6000);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const preventDrag = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    window.addEventListener('dragover', preventDrag);
    window.addEventListener('drop', preventDrag);
    return () => {
      window.removeEventListener('dragover', preventDrag);
      window.removeEventListener('drop', preventDrag);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); handleSetUiZoom(stepZoom(uiZoom, ZOOM_STEP)); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); handleSetUiZoom(stepZoom(uiZoom, -ZOOM_STEP)); }
      else if (e.key === '0') { e.preventDefault(); handleSetUiZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uiZoom, handleSetUiZoom]);

  const changeLang = useCallback((code) => {
    setLang(code);
    setLangDropdownOpen(false);
    if (window.api) window.api.locale.setPreference(code);
  }, []);

  // ==========================================
  // Render
  // ==========================================

  return (
    <div className={`min-h-screen font-sans overflow-hidden flex relative transition-colors duration-700 ease-in-out ${isDark ? 'dark text-slate-200' : 'text-slate-800'}`}>

      <style>{APP_STYLES}</style>

      {/* SVG Filters */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id="goo-filter">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>

      {/* Background */}
      <div className={`fixed inset-0 pointer-events-none transition-colors duration-1000 -z-20 ${isDark ? 'bg-slate-950' : 'bg-slate-50'}`} />

      {/* Ambient light — one soft light from above, see .ambient-light in appStyles */}
      <div className="ambient-light fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="ambient-key" />
      </div>
      {/* Outside the light's stacking context so its soft-light blend sees the base colour too */}
      <div className="ambient-grain fixed inset-0 pointer-events-none -z-[5]" aria-hidden="true" />

      {/* Fixed drag bar for Electron title bar */}
      <div className="fixed top-0 left-0 right-0 h-[36px] z-[999] [-webkit-app-region:drag] pointer-events-none" />

      {/* ============ Sidebar ============ */}
      <Sidebar
        activeTab={activeTab} setActiveTab={setActiveTab} setActiveModuleId={setActiveModuleId}
        appIcon={appIcon} t={t}
        isGameRunning={isGameRunning} launchState={launchState} gameVersion={gameVersion}
        handleLaunch={handleLaunch} appVersion={appVersion}
        updateState={updateState} updateInfo={updateInfo}
        modUpdateCount={modUpdateCount}
      />

      {/* ============ Main Content ============ */}
      {/* Split into two zones: a pinned header bar and a scrollable area
          below it. The scroll-thumb now starts at the bottom of the HZMM
          title row instead of at the top of the window. */}
      {/* min-w-0 lets this column shrink to the window. A flex item's automatic
          minimum width is its min-content width, which counts the full length
          of every `truncate` line, so long translations would otherwise push
          it past the edge, where the root's overflow-hidden clips it. */}
      <div className="flex-1 min-w-0 flex flex-col h-screen relative z-10 md:pl-12">

        <div className="absolute top-0 left-0 w-full h-12 [-webkit-app-region:drag]" />

        {/* Pinned header zone — does not scroll */}
        <div className="shrink-0 w-full flex flex-col items-center pt-12 px-4 md:px-8">
          <AppHeader
            activeTab={activeTab} t={t} isDark={isDark}
            lang={lang} supportedLocales={supportedLocales}
            langDropdownOpen={langDropdownOpen} setLangDropdownOpen={setLangDropdownOpen}
            changeLang={changeLang}
          />
        </div>

        {/* Scrollable content zone — takes remaining height. Scrollbar thumb
            auto-hides when idle (see .scroll-fade-thumb in appStyles.js and
            the handleContentScroll handler above). pt-1.5 is load-bearing:
            first-row focus rings (ring-2) paint OUTSIDE the border box, and
            overflow clips at the padding edge — without top padding the ring's
            upper arc gets sliced flat while "scrolled to the very top". */}
        <div
          ref={scrollAreaRef}
          onScroll={handleContentScroll}
          className="scroll-fade-thumb flex-1 w-full overflow-auto scroll-smooth flex flex-col px-4 md:px-8 pt-1.5 pb-12"
        >
        <main
          className={`tab-width-spring w-full flex-1 mx-auto relative z-10 ${activeTab === 'nexus' ? 'max-w-[1600px]' : 'max-w-6xl'}`}
        >
          <div key={activeTab} className={tabAnimClass}>

          {activeTab === 'dashboard' && (
            <DashboardTab
              t={t} modules={modules} isDark={isDark}
              isDragging={isDragging} setIsDragging={setIsDragging}
              fileInputRef={fileInputRef} handleDrop={handleDrop}
              handleImportFiles={handleImportFiles} addToast={addToast}
              ue4ssStatus={ue4ssStatus} ue4ssProgress={ue4ssProgress}
              ue4ssVersion={ue4ssVersion} isProcessing={isProcessing}
              handleUe4ssAction={handleUe4ssAction}
              handleUe4ssManualInstall={handleUe4ssManualInstall}
              handleInstallWithPreview={handleInstallWithPreview}
              modUpdateCount={modUpdateCount}
              conflicts={conflicts}
              handleConflictScan={handleConflictScan}
              backups={backups}
              backupLoading={backupLoading}
              handleBackup={handleBackup}
              onOpenModules={(type) => { setFilterType(type || 'all'); setActiveModuleId(null); setActiveTab('modules'); }}
            />
          )}

          {activeTab === 'modules' && (
            <Suspense fallback={<Spinner />}>
            <ModulesTab
              t={t} lang={lang} modules={modules}
              activeModuleId={activeModuleId}
              handleModuleClick={handleModuleClick}
              handleToggleEnable={handleToggleEnable}
              handleUninstallLocalMod={handleUninstallLocalMod}
              setConfigEditorMod={setConfigEditorMod}
              newlyInstalledMods={newlyInstalledMods}
              searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              filterType={filterType} setFilterType={setFilterType}
              sortBy={sortBy} setSortBy={setSortBy}
              batchMode={batchMode} setBatchMode={setBatchMode}
              selectedMods={selectedMods} setSelectedMods={setSelectedMods}
              handleBatchToggle={handleBatchToggle}
              handleBatchRemove={handleBatchRemove}
              handleToggleSelect={handleToggleSelect}
              handleRenameMod={handleRenameMod}
              isGameRunning={isGameRunning}
              conflicts={conflicts}
              isDark={isDark}
              handleRescan={handleRescanAndRecheck} rescanning={rescanning}
              modUpdateMap={modUpdateMap}
              updatingModId={updatingModId}
              updateProgress={modUpdateProgress}
              onUpdateMod={handleUpdateMod}
              updateCount={modUpdateCount}
              onUpdateAll={handleUpdateAll}
              updateAllBusy={updateAllBusy}
              updateAllProgress={updateAllProgress}
              nexusApiKey={nexusApiKey}
              nexusLinkedSet={nexusLinkedSet}
              onLinkMod={handleLinkMod}
              rollbackMap={rollbackMap}
              onRollbackMod={handleRollbackMod}
            />
            </Suspense>
          )}

          {activeTab === 'nexus' && (
            <Suspense fallback={<Spinner />}>
            <NexusTab
              t={t} lang={lang} isDark={isDark}
              addToast={addToast}
              setActiveTab={setActiveTab}
            />
            </Suspense>
          )}

          {/* window.api guard: the dev-only tab is reachable in plain-browser
              dev sessions, where SteamWorkshopTab's unguarded steam.browse
              call would crash — keep the tab file identical to upstream and
              gate here instead. */}
          {import.meta.env.DEV && window.api && activeTab === 'steamWorkshop' && (
            <Suspense fallback={<Spinner />}>
            <SteamWorkshopTab t={t} />
            </Suspense>
          )}

          {activeTab === 'profiles' && (
            <Suspense fallback={<Spinner />}>
            <ProfilesTab
              t={t} isDark={isDark} modules={modules}
              profiles={profiles} activeProfileId={activeProfileId}
              newProfileName={newProfileName} setNewProfileName={setNewProfileName}
              handleCreateProfile={handleCreateProfile}
              handleApplyProfile={handleApplyProfile}
              handleDeleteProfile={handleDeleteProfile}
              handleExportProfile={handleExportProfile}
              handleImportProfile={handleImportProfile}
              applyingProfileId={applyingProfileId}
              importModal={importModal}
              importDownloading={importDownloading}
              importProgress={importProgress}
              importDownloadAndApply={importDownloadAndApply}
              importApplyAnyway={importApplyAnyway}
              closeImportModal={closeImportModal}
            />
            </Suspense>
          )}

          {activeTab === 'settings' && (
            <Suspense fallback={<Spinner />}>
            <SettingsTab
              t={t} lang={lang} isDark={isDark} themeId={themeId}
              toggleDark={toggleDark} changeTheme={changeTheme}
              gamePath={gamePath} detecting={detecting}
              handleDetectPath={handleDetectPath} handleBrowsePath={handleBrowsePath}
              handleConflictScan={handleConflictScan} handleOpenLogs={handleOpenLogs}
              appVersion={appVersion} updateState={updateState}
              updateInfo={updateInfo} updateProgress={updateProgress}
              updateError={updateError}
              handleCheckUpdate={handleCheckUpdate}
              handleDownloadUpdate={handleDownloadUpdate}
              handleInstallUpdate={handleInstallUpdate}
              backups={backups} backupLoading={backupLoading}
              handleBackup={handleBackup}
              handleListBackups={handleListBackups}
              handleRestoreBackup={handleRestoreBackup}
              handleDeleteBackup={handleDeleteBackup}
              nexusApiKey={nexusApiKey}
              handleSetNexusApiKey={handleSetNexusApiKey}
              nxmEnabled={nxmEnabled}
              handleSetNxmEnabled={handleSetNxmEnabled}
              minimizeToTray={minimizeToTray}
              handleSetMinimizeToTray={handleSetMinimizeToTray}
              autoStart={autoStart}
              handleSetAutoStart={handleSetAutoStart}
              skipInstallPreview={skipInstallPreview}
              handleSetSkipInstallPreview={handleSetSkipInstallPreview}
              uiZoom={uiZoom}
              handleSetUiZoom={handleSetUiZoom}
            />
            </Suspense>
          )}

          </div>
        </main>
        </div>
      </div>

      {/* Global Overlays */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        description={confirmModal.description}
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirm}
        t={t}
        confirmVariant={confirmModal.variant}
      />

      <ConfigEditorModal
        isOpen={!!configEditorMod}
        mod={configEditorMod}
        onClose={() => setConfigEditorMod(null)}
        t={t}
        lang={lang}
        addToast={addToast}
      />

      <ConflictModal
        isOpen={conflictModalOpen}
        onClose={() => setConflictModalOpen(false)}
        scanning={conflictScanning}
        conflicts={conflicts}
        onMakeWin={handleMakeWin}
        makingWin={makingWin}
        t={t}
      />

      <NexusLinkModal
        isOpen={!!linkTarget}
        mod={linkTarget}
        onClose={() => setLinkTarget(null)}
        onLinked={handleLinkedDone}
        addToast={addToast}
        t={t}
      />

      <LogModal
        isOpen={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        loading={logLoading}
        logLines={logLines}
        onOpenLogFile={handleOpenLogFile}
        t={t}
      />

      <PreviewModal
        isOpen={showPreview}
        onClose={() => { setShowPreview(false); setPreviewData([]); setPendingInstallPaths([]); }}
        previews={previewData}
        loading={previewLoading}
        onConfirm={handleConfirmInstall}
        onDontShowAgain={() => handleSetSkipInstallPreview(true)}
        t={t}
      />

      <WorldSelectModal
        isOpen={worldSelectOpen}
        onClose={() => setWorldSelectOpen(false)}
        worlds={availableWorlds}
        loading={worldSelectLoading}
        onConfirm={handleConfirmBackup}
        t={t}
      />

      {/* Updating overlay */}
      {isUpdating && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-xs bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-[2rem] shadow-2xl p-8 flex flex-col items-center text-center gap-5 animate-modal-spring">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent animate-spin" style={{ borderTopColor: 'var(--accent-500)' }} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t.updatingTitle || 'Updating...'}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.updatingDesc || 'Please wait, the app will restart shortly.'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
