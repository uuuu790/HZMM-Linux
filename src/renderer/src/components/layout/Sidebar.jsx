import { CheckCircle, Settings, Play, LayoutDashboard, Layers, Save, Compass, ArrowUpCircle, Hammer } from 'lucide-react';

const YTSpinner = ({ className = '' }) => (
  <svg className={`yt-spinner ${className}`} viewBox="0 0 24 24" fill="none">
    <circle className="yt-spinner-track" cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
    <circle className="yt-spinner-arc" cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export default function Sidebar({
  activeTab, setActiveTab, setActiveModuleId, appIcon, t,
  isGameRunning, launchState, gameVersion, handleLaunch, appVersion,
  updateState, updateInfo, modUpdateCount,
}) {
  const hasUpdate = updateState === 'available' || updateState === 'downloading' || updateState === 'ready';
  // Steam Workshop is a work-in-progress tab — HumanitZ has no official
  // Workshop yet, so it only appears in dev builds for testing and is hidden
  // in packaged builds. The glider divisor (--total-radio) tracks the live
  // tab count so the indicator stays aligned whether the tab shows or not.
  const showSteamWorkshop = import.meta.env.DEV;
  const navTabCount = showSteamWorkshop ? 6 : 5;
  return (
    <aside className="w-20 lg:w-64 border-r border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl flex flex-col z-20 transition-colors duration-700 shadow-[4px_0_24px_rgba(0,0,0,0.02)] dark:shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
      <div className="h-24 flex items-center justify-center lg:justify-start lg:px-8 border-b border-slate-200/50 dark:border-white/5 transition-colors duration-700 [-webkit-app-region:drag]">
        <div className="w-10 h-10 shrink-0 rounded-full logo-breath transition-[filter] duration-700" style={{ backgroundImage: `url(${appIcon})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', filter: 'hue-rotate(var(--icon-hue-rotate))' }} />
        <h1 className="hidden lg:block ml-4 text-2xl font-black tracking-widest text-transparent bg-clip-text transition-all duration-700" style={{ backgroundImage: `linear-gradient(to right, var(--gradient-from), var(--gradient-to))` }}>
          HZMM
        </h1>
      </div>

      <nav className="flex-1 py-8 px-4 [-webkit-app-region:no-drag]">
        <div className="sidebar-nav" style={{ '--total-radio': navTabCount }}>
          <input type="radio" name="sidebar-tab" id="tab-dashboard" checked={activeTab === 'dashboard'} onChange={() => { setActiveTab('dashboard'); setActiveModuleId(null); }} />
          <label htmlFor="tab-dashboard">
            <LayoutDashboard className="w-5 h-5 shrink-0 transition-transform duration-300" />
            <span className="hidden lg:block font-medium tracking-wide">{t.dashboard}</span>
          </label>
          <input type="radio" name="sidebar-tab" id="tab-modules" checked={activeTab === 'modules'} onChange={() => { setActiveTab('modules'); setActiveModuleId(null); }} />
          <label htmlFor="tab-modules">
            <Layers className="w-5 h-5 shrink-0 transition-transform duration-300" />
            <span className="hidden lg:block font-medium tracking-wide">{t.modules}</span>
            {modUpdateCount > 0 && (
              <>
                <span className="ml-auto hidden lg:flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full bg-sky-500 text-white shadow-sm" title={t.updatesAvailable || 'Updates available'}>
                  {modUpdateCount}
                </span>
                <span className="lg:hidden absolute top-2.5 right-4 w-2 h-2 rounded-full bg-sky-500 ring-2 ring-white dark:ring-slate-900" />
              </>
            )}
          </label>
          <input type="radio" name="sidebar-tab" id="tab-profiles" checked={activeTab === 'profiles'} onChange={() => { setActiveTab('profiles'); setActiveModuleId(null); }} />
          <label htmlFor="tab-profiles">
            <Save className="w-5 h-5 shrink-0 transition-transform duration-300" />
            <span className="hidden lg:block font-medium tracking-wide">{t.profiles}</span>
          </label>
          <input type="radio" name="sidebar-tab" id="tab-nexus" checked={activeTab === 'nexus'} onChange={() => { setActiveTab('nexus'); setActiveModuleId(null); }} />
          <label htmlFor="tab-nexus">
            <Compass className="w-5 h-5 shrink-0 transition-transform duration-300" />
            <span className="hidden lg:block font-medium tracking-wide">{t.nexus}</span>
          </label>
          {showSteamWorkshop && (
            <>
              <input type="radio" name="sidebar-tab" id="tab-steam-workshop" checked={activeTab === 'steamWorkshop'} onChange={() => { setActiveTab('steamWorkshop'); setActiveModuleId(null); }} />
              <label htmlFor="tab-steam-workshop">
                <Hammer className="w-5 h-5 shrink-0 transition-transform duration-300" />
                <span className="hidden lg:block font-medium tracking-wide">{t.steamWorkshop}</span>
              </label>
            </>
          )}
          <input type="radio" name="sidebar-tab" id="tab-settings" checked={activeTab === 'settings'} onChange={() => { setActiveTab('settings'); setActiveModuleId(null); }} />
          <label htmlFor="tab-settings">
            <Settings className="w-5 h-5 shrink-0 transition-transform duration-300" />
            <span className="hidden lg:block font-medium tracking-wide">{t.settings}</span>
          </label>
          <div className="glider-container">
            <div className="glider" />
          </div>
        </div>
      </nav>

      {/* Update pill — surfaces above the launch button so the most
          important app-level state ("you should update") is visible
          without the user having to dig into Settings. Tapping it jumps
          straight to the Settings tab where the actual download / install
          buttons live. */}
      {hasUpdate && (
        <div className="px-4 pb-3 [-webkit-app-region:no-drag]">
          <button
            onClick={() => { setActiveTab('settings'); setActiveModuleId(null); }}
            title={t.newVersion}
            className="w-full flex items-center justify-center lg:justify-start gap-2 lg:gap-3 px-2 lg:px-4 py-2 lg:py-2.5 rounded-xl lg:rounded-full bg-gradient-to-r from-amber-400/20 to-orange-400/20 dark:from-amber-500/15 dark:to-orange-500/15 border border-amber-400/40 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 hover:border-amber-500/60 dark:hover:border-amber-400/50 hover:bg-amber-400/25 dark:hover:bg-amber-500/20 hover:-translate-y-0.5 active:scale-95 animate-slide-up"
            style={{ transition: 'translate 200ms, scale 100ms, background-color 200ms, border-color 200ms', animationDuration: '400ms' }}
          >
            <ArrowUpCircle className="w-4 h-4 lg:w-4 lg:h-4 shrink-0 animate-pulse" />
            <div className="hidden lg:flex flex-col items-start min-w-0 flex-1">
              <span className="text-[11px] font-black tracking-wider truncate">{t.newVersion}</span>
              {updateInfo?.version && (
                <span className="text-[10px] font-mono opacity-70 truncate">
                  {updateState === 'ready' ? t.updateReady : `v${updateInfo.version}`}
                </span>
              )}
            </div>
          </button>
        </div>
      )}

      {/* Launch Game button */}
      <div className="px-4 pb-6 [-webkit-app-region:no-drag]">
        <div className="relative w-full group">
          <div className={`absolute -inset-1.5 blur-lg opacity-40 animate-pulse transition-all duration-500 rounded-2xl lg:rounded-full pointer-events-none ${isGameRunning ? 'bg-gradient-to-r from-emerald-500 to-green-500' : ''}`} style={!isGameRunning ? { background: `linear-gradient(to right, var(--gradient-from), var(--gradient-to))` } : undefined} />
          <button onClick={handleLaunch} disabled={isGameRunning || launchState !== 'idle'}
            onMouseEnter={(e) => { if (isGameRunning || launchState !== 'idle') return; const btn = e.currentTarget; const icon = btn.querySelector('.icon-mover'); const text = btn.querySelector('.launch-text'); if (!icon) return; const btnRect = btn.getBoundingClientRect(); const btnCenter = btnRect.width / 2; const iconRect = icon.getBoundingClientRect(); const textRect = text ? text.getBoundingClientRect() : null; const groupLeft = iconRect.left - btnRect.left; const groupRight = textRect ? textRect.right - btnRect.left : iconRect.right - btnRect.left; const groupCenter = (groupLeft + groupRight) / 2; const offset = btnCenter - groupCenter; btn.style.setProperty('--icon-center', `translateX(${offset}px)`); btn.style.setProperty('--content-center', `translateX(${offset}px)`); }}
            className={`launch-hover relative w-full flex items-center justify-center lg:justify-start gap-3 text-white p-3 lg:px-5 lg:py-3.5 rounded-2xl lg:rounded-full transition-all duration-500 overflow-hidden z-10 ${isGameRunning
            ? 'bg-gradient-to-r from-emerald-500 to-green-600 shadow-[0_8px_20px_rgba(16,185,129,0.3)] cursor-default'
            : launchState !== 'idle'
            ? 'cursor-default launch-active'
            : 'hover:-translate-y-0.5 active:scale-95'}`}
            style={!isGameRunning ? { background: 'linear-gradient(to right, var(--gradient-from), var(--gradient-to))', boxShadow: '0 8px 20px rgba(var(--accent-rgb), 0.3)' } : undefined}>
            <div className="icon-mover shrink-0 relative z-10">
              <div className="svg-wrapper">
                {isGameRunning && launchState === 'idle'
                  ? <CheckCircle className="w-5 h-5" />
                  : launchState === 'confirmed'
                  ? <CheckCircle className="w-5 h-5" />
                  : launchState === 'launching'
                  ? <YTSpinner className="w-5 h-5" />
                  : <Play className="w-5 h-5 fill-white" />
                }
              </div>
            </div>
            <div className="launch-content hidden lg:flex items-center gap-3 relative z-10 min-w-0 flex-1">
              <span className="launch-text font-black tracking-widest text-sm truncate whitespace-nowrap">{isGameRunning ? t.gameRunning : launchState === 'launching' ? (t.launching || 'Launching...') : launchState === 'confirmed' ? t.gameRunning : t.launch}</span>
              <span className="launch-badge font-mono text-[10px] font-bold bg-white/20 text-white/90 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 shadow-inner">
                {gameVersion?.versionName ? `v${gameVersion.versionName}` : gameVersion?.buildId ? `#${gameVersion.buildId}` : gameVersion?.fileVersion ? `v${gameVersion.fileVersion}` : 'v1.0'}
              </span>
            </div>
          </button>
        </div>
      </div>

      <div className="hidden lg:flex p-4 border-t border-slate-200/50 dark:border-white/5 items-center gap-2 text-slate-400 dark:text-slate-500 transition-colors duration-700">
        <Settings className="w-4 h-4 rounded-full shrink-0" />
        <span className="text-[10px] font-mono font-bold tracking-wider truncate">HZMM Manager v{appVersion || '1.0.0'}</span>
      </div>
    </aside>
  );
}
