import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import appIcon from './assets/icon.png';

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
import LogModal from './components/modals/LogModal';
import PreviewModal from './components/modals/PreviewModal';
import WorldSelectModal from './components/modals/WorldSelectModal';

// Tab components
import DashboardTab from './components/tabs/DashboardTab';
const ModulesTab = lazy(() => import('./components/tabs/ModulesTab'));
const ProfilesTab = lazy(() => import('./components/tabs/ProfilesTab'));
const SettingsTab = lazy(() => import('./components/tabs/SettingsTab'));
const NexusTab = lazy(() => import('./components/tabs/NexusTab'));

// Hooks
import { useToast } from './hooks/useToast';
import { useConfirmModal } from './hooks/useConfirmModal';
import { useTheme } from './hooks/useTheme';
import { useModHandlers } from './hooks/useModHandlers';
import { useBackupHandlers } from './hooks/useBackupHandlers';
import { useProfileHandlers } from './hooks/useProfileHandlers';
import { useUpdateHandlers } from './hooks/useUpdateHandlers';
import { useAppInit } from './hooks/useAppInit';

// ==========================================
// Main App Component
// ==========================================

export default function App() {
  // --- Language ---
  const [lang, setLang] = useState('zh-TW');
  const [supportedLocales, setSupportedLocales] = useState([]);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);

  // --- Tray & Startup ---
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [autoStart, setAutoStart] = useState(false);

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
  const tabOrder = ['dashboard', 'modules', 'nexus', 'profiles', 'settings'];

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

  // ==========================================
  // Domain Hooks
  // ==========================================

  const {
    appVersion, updateState, updateInfo, updateProgress, isUpdating,
    handleCheckUpdate, handleDownloadUpdate, handleInstallUpdate,
    initVersion,
  } = useUpdateHandlers({ addToast, t });

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
    handleUe4ssAction,
    handleConflictScan, handleOpenLogs, handleOpenLogFile,
    handleRescan,
    initGame,
  } = useAppInit({ addToast, t, refreshMods });

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
    handleExportProfile: _handleExportProfile, handleImportProfile: _handleImportProfile,
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

      await Promise.all([
        window.api.locale.getPreference().then(v => setLang(v)),
        window.api.locale.getSupported().then(v => setSupportedLocales(v)),
        window.api.settings.get('darkMode', true).then(v => { setIsDark(v); window.api?.system?.setTitleBarTheme(v); document.documentElement.classList.toggle('dark', v); }),
        window.api.settings.get('themeId', 'ember').then(v => setThemeId(v)),
        window.api.settings.get('minimizeToTray', true).then(v => setMinimizeToTray(v)),
        window.api.settings.get('skipInstallPreview', false).then(v => setSkipInstallPreview(!!v)),
        window.api.system.getAutoStart().then(v => setAutoStart(v)).catch(() => {}),
        initProfiles(),
        initGame(),
        initVersion(),
        initBackups(),
        initMods(),
        // Minimum splash display time
        new Promise(r => setTimeout(r, 3000)),
      ]);

      // Dismiss HTML splash
      const splash = document.getElementById('splash-screen');
      if (splash) {
        splash.classList.add('exit');
        setTimeout(() => splash.remove(), 600);
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

      {/* Floating orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className={`absolute top-[-12%] left-[-12%] w-[38vw] h-[38vw] md:w-[32vw] md:h-[32vw] 2xl:w-[38vw] 2xl:h-[38vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-1 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-1)' : 'var(--orb-light-1)' }} />
        <div className={`absolute top-[-8%] right-[-8%] w-[32vw] h-[32vw] md:w-[26vw] md:h-[26vw] 2xl:w-[32vw] 2xl:h-[32vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-2 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-2)' : 'var(--orb-light-2)' }} />
        <div className={`absolute bottom-[-12%] left-[-12%] w-[42vw] h-[42vw] md:w-[35vw] md:h-[35vw] 2xl:w-[42vw] 2xl:h-[42vw] rounded-full blur-[110px] md:blur-[180px] 2xl:blur-[250px] transition-all duration-1000 ease-in-out orb-float-3 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-3)' : 'var(--orb-light-3)' }} />
        <div className={`absolute bottom-[-16%] right-[-8%] w-[34vw] h-[34vw] md:w-[28vw] md:h-[28vw] 2xl:w-[35vw] 2xl:h-[35vw] rounded-full blur-[100px] md:blur-[160px] 2xl:blur-[220px] transition-all duration-1000 ease-in-out orb-float-4 ${isDark ? 'mix-blend-screen' : 'mix-blend-normal'}`} style={{ backgroundColor: isDark ? 'var(--orb-dark-4)' : 'var(--orb-light-4)' }} />
      </div>

      {/* Fixed drag bar for Electron title bar */}
      <div className="fixed top-0 left-0 right-0 h-[36px] z-[999] [-webkit-app-region:drag] pointer-events-none" />

      {/* ============ Sidebar ============ */}
      <Sidebar
        activeTab={activeTab} setActiveTab={setActiveTab} setActiveModuleId={setActiveModuleId}
        appIcon={appIcon} t={t}
        isGameRunning={isGameRunning} launchState={launchState} gameVersion={gameVersion}
        handleLaunch={handleLaunch} appVersion={appVersion}
        updateState={updateState} updateInfo={updateInfo}
      />

      {/* ============ Main Content ============ */}
      {/* Split into two zones: a pinned header bar and a scrollable area
          below it. The scroll-thumb now starts at the bottom of the HZMM
          title row instead of at the top of the window. */}
      <div className="flex-1 flex flex-col h-screen relative z-10 md:pl-12 min-w-0">

        <div className="absolute top-0 left-0 w-full h-12 [-webkit-app-region:drag]" />

        {/* Pinned header zone — does not scroll */}
        <div className="shrink-0 w-full flex flex-col items-center pt-16 px-4 md:px-8">
          <AppHeader
            activeTab={activeTab} t={t} isDark={isDark}
            lang={lang} supportedLocales={supportedLocales}
            langDropdownOpen={langDropdownOpen} setLangDropdownOpen={setLangDropdownOpen}
            changeLang={changeLang}
          />
        </div>

        {/* Scrollable content zone — takes remaining height. Scrollbar thumb
            auto-hides when idle (see .scroll-fade-thumb in appStyles.js and
            the handleContentScroll handler above). */}
        <div
          ref={scrollAreaRef}
          onScroll={handleContentScroll}
          className="scroll-fade-thumb flex-1 w-full overflow-y-auto scroll-smooth flex flex-col items-center px-4 md:px-8 pb-12"
        >
        <main
          className={`tab-width-spring w-full flex-1 relative z-10 ${activeTab === 'nexus' ? 'max-w-[1600px]' : 'max-w-6xl'}`}
        >
          <div key={activeTab} className={tabOrder.indexOf(activeTab) >= tabOrder.indexOf(prevTabRef.current) ? 'animate-tab-left' : 'animate-tab-right'}>

          {activeTab === 'dashboard' && (
            <DashboardTab
              t={t} modules={modules} isDark={isDark}
              isDragging={isDragging} setIsDragging={setIsDragging}
              fileInputRef={fileInputRef} handleDrop={handleDrop}
              handleImportFiles={handleImportFiles} addToast={addToast}
              ue4ssStatus={ue4ssStatus} ue4ssProgress={ue4ssProgress}
              ue4ssVersion={ue4ssVersion} isProcessing={isProcessing}
              handleUe4ssAction={handleUe4ssAction}
              handleInstallWithPreview={handleInstallWithPreview}
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
              handleRescan={handleRescan} rescanning={rescanning}
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

          {activeTab === 'profiles' && (
            <Suspense fallback={<Spinner />}>
            <ProfilesTab
              t={t} isDark={isDark} modules={modules}
              profiles={profiles} activeProfileId={activeProfileId}
              newProfileName={newProfileName} setNewProfileName={setNewProfileName}
              handleCreateProfile={handleCreateProfile}
              handleApplyProfile={handleApplyProfile}
              handleDeleteProfile={handleDeleteProfile}
              applyingProfileId={applyingProfileId}
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
              minimizeToTray={minimizeToTray}
              handleSetMinimizeToTray={handleSetMinimizeToTray}
              autoStart={autoStart}
              handleSetAutoStart={handleSetAutoStart}
              skipInstallPreview={skipInstallPreview}
              handleSetSkipInstallPreview={handleSetSkipInstallPreview}
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
