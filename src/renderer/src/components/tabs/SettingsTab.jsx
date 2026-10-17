import { useState, useEffect } from 'react';
import GlassCard from '../common/GlassCard';
import Toggle from '../common/Toggle';
import { THEME_PRESETS } from '../../constants/themes';
import { Sun, Moon, Palette, ZoomIn, Minimize2, Power, EyeOff, Folder, FolderOpen, RefreshCw, KeyRound, MousePointerClick, Wrench, AlertTriangle, FileText, Info, DownloadCloud, CheckCircle, Zap, Save, RotateCcw, Trash2, Map, Terminal, ClipboardCopy } from 'lucide-react';
import { formatBytes } from '../common/utils';

const PROTON_LAUNCH_OPTION = 'WINEDLLOVERRIDES="dwmapi=n,b" %command%';

// Every settings row shares one anatomy — accent icon chip, title +
// description, controls on the right — so the page reads as one system.
// The row wraps on narrow windows: controls drop below the text instead of
// squeezing it (or pushing the card past the window edge).
function SettingIcon({ icon: Icon }) {
  return (
    <div
      className="p-2.5 rounded-full border shrink-0 shadow-sm transition-transform duration-500 group-hover:scale-110"
      style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.12)', borderColor: 'rgba(var(--accent-rgb), 0.25)', color: 'var(--accent-500)' }}
    >
      <Icon className="w-5 h-5" />
    </div>
  );
}

function SettingRow({ icon, title, desc, badge, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SettingIcon icon={icon} />
      <div className="flex flex-col flex-1 min-w-[12rem]">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="text-sm md:text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight transition-colors duration-700">{title}</h4>
          {badge}
        </div>
        {desc && <p className="mt-0.5 text-[11px] md:text-xs text-slate-500 dark:text-slate-400 font-medium leading-snug transition-colors duration-700">{desc}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0 ml-auto">{children}</div>}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <h3 className="px-4 pt-4 first:pt-0 -mb-1 text-[11px] font-bold tracking-[0.14em] text-slate-400 dark:text-slate-500 transition-colors duration-700">
      {children}
    </h3>
  );
}

const Divider = () => <div className="h-px bg-slate-200/60 dark:bg-slate-700/50" />;

// Neutral pill button that picks up the theme accent on hover.
const SECONDARY_BTN = 'flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full border border-slate-200/80 dark:border-slate-700/70 bg-white/60 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:text-[var(--accent-600)] dark:hover:text-[var(--accent-400)] hover:border-[rgba(var(--accent-rgb),0.45)] hover:bg-[rgba(var(--accent-rgb),0.08)] transition-all duration-300 active:scale-95 shadow-sm';

// Show the end of the path — "C:\…\common\HumanitZ" — since the folder name is
// the part that matters; the full path stays in the tooltip.
function shortenPath(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 3) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  return [parts[0], '…', ...parts.slice(-2)].join(sep);
}

function SettingsTab({
  t,
  lang: _lang,
  isDark,
  themeId,
  toggleDark,
  changeTheme,
  gamePath,
  detecting,
  handleDetectPath,
  handleBrowsePath,
  handleConflictScan,
  handleOpenLogs,
  appVersion,
  updateState,
  updateInfo,
  updateProgress,
  handleCheckUpdate,
  handleDownloadUpdate,
  handleInstallUpdate,
  updateError,
  backups,
  backupLoading,
  handleBackup,
  handleListBackups: _handleListBackups,
  handleRestoreBackup,
  handleDeleteBackup,
  nexusApiKey,
  handleSetNexusApiKey,
  nxmEnabled,
  handleSetNxmEnabled,
  minimizeToTray,
  handleSetMinimizeToTray,
  autoStart,
  handleSetAutoStart,
  skipInstallPreview,
  handleSetSkipInstallPreview,
  uiZoom,
  handleSetUiZoom,
}) {

  // Drag the slider locally (draftZoom); only apply the real zoom on release,
  // so the whole UI doesn't re-scale on every step mid-drag (layout thrash).
  const [draftZoom, setDraftZoom] = useState(uiZoom);
  useEffect(() => { setDraftZoom(uiZoom); }, [uiZoom]);
  const commitZoom = () => { if (draftZoom !== uiZoom) handleSetUiZoom(draftZoom); };

  const [protonCopied, setProtonCopied] = useState(false);
  const handleCopyProton = () => {
    navigator.clipboard.writeText(PROTON_LAUNCH_OPTION).then(() => {
      setProtonCopied(true);
      setTimeout(() => setProtonCopied(false), 1500);
    }).catch(() => { /* clipboard unavailable — the string stays visible to copy by hand */ });
  };

  // One stagger for the whole page (cards cascade top to bottom).
  let cardIndex = 0;
  const anim = () => ({ animationFillMode: 'both', animationDelay: `${Math.min(cardIndex++, 12) * 30}ms`, animationDuration: '500ms' });
  const cardClass = 'group flex flex-col gap-3 px-4 py-3 md:px-5 md:py-3.5';

  const visibleBackups = backups.filter(b => !b.legacy);

  return (
    <div className="flex flex-col gap-3 w-full px-2">

      {/* ============ Interface ============ */}
      <SectionLabel>{t.settingsGroupInterface}</SectionLabel>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} onClick={toggleDark} className={cardClass}>
          <SettingRow
            icon={isDark ? Moon : Sun}
            title={t.appearance}
            desc={t.appearanceDesc}
            badge={
              <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 leading-none transition-colors duration-700 shadow-inner">
                {isDark ? t.darkMode : t.lightMode}
              </span>
            }
          >
            <button
              onClick={(e) => { e.stopPropagation(); toggleDark(); }}
              aria-label={isDark ? t.lightMode : t.darkMode}
              className="relative flex items-center w-16 h-8 md:w-20 md:h-9 bg-slate-200/80 dark:bg-slate-800 rounded-full p-1 shadow-inner transition-colors duration-500 hover:scale-105 active:scale-95"
            >
              <div
                className={`absolute top-1 bottom-1 w-[28px] md:w-[36px] bg-white dark:bg-slate-600 rounded-full shadow-md transition-transform duration-500 ${isDark ? 'translate-x-[28px] md:translate-x-[36px]' : 'translate-x-0'}`}
                style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}
              />
              <div className={`relative flex-1 flex justify-center items-center z-10 transition-colors duration-500 ${!isDark ? '' : 'text-slate-400 dark:text-slate-500'}`}
                style={!isDark ? { color: 'var(--accent-500)' } : undefined}><Sun className="w-3.5 h-3.5 md:w-4 md:h-4" /></div>
              <div className={`relative flex-1 flex justify-center items-center z-10 transition-colors duration-500 ${isDark ? '' : 'text-slate-400 dark:text-slate-600'}`}
                style={isDark ? { color: 'var(--accent-300)' } : undefined}><Moon className="w-3.5 h-3.5 md:w-4 md:h-4" /></div>
            </button>
          </SettingRow>
        </GlassCard>
      </div>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow icon={Palette} title={t.theme} desc={t.themeDesc} />
          <div className="flex items-center justify-around gap-2 px-1 pb-1">
            {THEME_PRESETS.map(preset => {
              const isActive = themeId === preset.id;
              const label = t[`theme${preset.id.charAt(0).toUpperCase() + preset.id.slice(1)}`] || preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={(e) => changeTheme(preset.id, e)}
                  aria-pressed={isActive}
                  className={`flex flex-col items-center gap-2 px-3 py-2 rounded-2xl transition-all duration-300 active:scale-90 ${isActive ? 'bg-white/80 dark:bg-slate-800/80 shadow-md scale-105' : 'hover:bg-white/40 dark:hover:bg-slate-800/40 hover:scale-105'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg transition-all duration-300 shadow-sm ${isActive ? 'scale-110' : 'hover:scale-110'}`}
                    style={{
                      background: `linear-gradient(135deg, ${preset.accent[400]}, ${preset.gradient.to})`,
                      boxShadow: isActive ? `0 0 0 2.5px ${isDark ? '#0f172a' : '#fff'}, 0 0 0 4.5px ${preset.accent[500]}` : undefined
                    }}
                  />
                  <span className={`text-xs font-bold tracking-wide transition-colors duration-300 ${isActive ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{label}</span>
                </button>
              );
            })}
          </div>
        </GlassCard>
      </div>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow icon={ZoomIn} title={t.uiZoom} desc={t.uiZoomDesc}>
            <input
              type="range" min="0.5" max="2" step="0.1" value={draftZoom}
              onChange={(e) => setDraftZoom(parseFloat(e.target.value))}
              onMouseUp={commitZoom}
              onTouchEnd={commitZoom}
              onKeyUp={commitZoom}
              aria-label={t.uiZoom}
              className="w-28 sm:w-40 accent-[var(--accent-500)] cursor-pointer"
            />
            <span className="w-11 text-right text-sm font-bold font-mono text-slate-700 dark:text-slate-200 tabular-nums">{Math.round(draftZoom * 100)}%</span>
            <button
              onClick={() => handleSetUiZoom(1)}
              disabled={uiZoom === 1 && draftZoom === 1}
              className="px-3 py-1.5 text-xs font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {t.uiZoomReset}
            </button>
          </SettingRow>
        </GlassCard>
      </div>

      {/* ============ General ============ */}
      <SectionLabel>{t.settingsGroupGeneral}</SectionLabel>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow icon={Minimize2} title={t.minimizeToTray} desc={t.minimizeToTrayDesc}>
            <Toggle checked={minimizeToTray} onChange={handleSetMinimizeToTray} label={t.minimizeToTray} />
          </SettingRow>
          <Divider />
          <SettingRow icon={Power} title={t.autoStart} desc={t.autoStartDesc}>
            <Toggle checked={autoStart} onChange={handleSetAutoStart} label={t.autoStart} />
          </SettingRow>
          <Divider />
          {/* Pairs with the "don't show again" checkbox inside PreviewModal. */}
          <SettingRow icon={EyeOff} title={t.skipInstallPreview} desc={t.skipInstallPreviewDesc}>
            <Toggle checked={skipInstallPreview} onChange={handleSetSkipInstallPreview} label={t.skipInstallPreview} />
          </SettingRow>
        </GlassCard>
      </div>

      {/* ============ Game & Nexus ============ */}
      <SectionLabel>{t.settingsGroupGame}</SectionLabel>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow icon={Folder} title={t.gamePath} desc={t.gamePathDesc}>
            {gamePath ? (
              <button
                onClick={() => window.api?.system?.openPath?.(gamePath)}
                title={gamePath}
                className="group/path flex items-center gap-1.5 max-w-[14rem] px-3 py-1.5 text-[11px] md:text-xs font-mono rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 shadow-inner hover:border-[rgba(var(--accent-rgb),0.45)] transition-colors duration-300"
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover/path:text-[var(--accent-500)] transition-colors duration-300" />
                <span className="truncate">{shortenPath(gamePath)}</span>
              </button>
            ) : (
              <span className="px-3 py-1.5 text-[11px] md:text-xs rounded-full border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500">
                {t.gamePathPlaceholder || '...'}
              </span>
            )}
            <button
              onClick={handleDetectPath}
              disabled={detecting}
              className={`${SECONDARY_BTN} ${detecting ? 'opacity-70 pointer-events-none' : ''}`}
              title={t.gamePathDetect}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${detecting ? 'animate-spin' : ''}`} />
              <span className="hidden lg:inline">{t.gamePathDetect}</span>
            </button>
            <button onClick={handleBrowsePath} className={SECONDARY_BTN}>
              {t.gamePathBrowse}
            </button>
          </SettingRow>
          <Divider />
          {/* Proton launch option — Linux-specific: the WINEDLLOVERRIDES string
              the user must paste into Steam launch options for UE4SS to inject
              under Wine. Copy button writes via navigator.clipboard. */}
          <SettingRow icon={Terminal} title={t.protonLaunchTitle} desc={t.protonLaunchDesc}>
            <code
              title={PROTON_LAUNCH_OPTION}
              className="hidden md:block max-w-[20rem] truncate px-3 py-1.5 text-[11px] md:text-xs font-mono rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 shadow-inner select-all"
            >
              {PROTON_LAUNCH_OPTION}
            </code>
            <button
              onClick={handleCopyProton}
              className={protonCopied
                ? 'flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full border border-emerald-400/60 bg-emerald-500 text-white transition-all duration-300 active:scale-95 shadow-sm'
                : SECONDARY_BTN}
            >
              {protonCopied ? <CheckCircle className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
              <span>{protonCopied ? t.protonLaunchCopied : t.protonLaunchCopy}</span>
            </button>
          </SettingRow>
        </GlassCard>
      </div>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow
            icon={KeyRound}
            title={t.nexusApiKey || 'Nexus Mods API Key'}
            desc={t.nexusApiKeyDesc || 'Required for downloading mods from Nexus Mods URLs'}
            badge={nexusApiKey ? (
              <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 shadow-inner">
                <CheckCircle className="w-3 h-3" /> {t.apiKeySet || 'Set'}
              </span>
            ) : null}
          >
            <input
              type="password"
              value={nexusApiKey}
              onChange={(e) => handleSetNexusApiKey(e.target.value)}
              placeholder={t.nexusApiKeyPlaceholder}
              aria-label={t.nexusApiKey || 'Nexus Mods API Key'}
              // Block Chromium / password-manager autofill — was observed
              // wiping the saved key on app launch (mount-time autofill
              // dispatched onChange('') and persisted blank back to disk).
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore
              data-form-type="other"
              className="w-32 md:w-48 px-3 py-1.5 text-[11px] md:text-xs rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[rgba(var(--accent-rgb),0.4)] transition-all shadow-inner font-mono truncate"
            />
            <button
              onClick={() => window.api?.system?.openExternal('https://next.nexusmods.com/settings/api-keys')}
              className={SECONDARY_BTN}
            >
              {t.nexusGetKey || 'Get Key'}
            </button>
          </SettingRow>
          <Divider />
          {/* nxm:// handler — one-click installs from the Nexus website */}
          <SettingRow
            icon={MousePointerClick}
            title={t.nxmHandler || 'One-click install from Nexus'}
            desc={t.nxmHandlerDesc || 'Clicking Mod Manager Download on the Nexus site installs the mod automatically (handles nxm:// links, taking over from Vortex/MO2)'}
          >
            <Toggle checked={nxmEnabled} onChange={handleSetNxmEnabled} label={t.nxmHandler || 'One-click install from Nexus'} />
          </SettingRow>
        </GlassCard>
      </div>

      {/* ============ Maintenance ============ */}
      <SectionLabel>{t.settingsGroupMaintenance}</SectionLabel>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow icon={Wrench} title={t.toolsTitle} desc={t.toolsDesc}>
            <button onClick={handleConflictScan} className={SECONDARY_BTN}>
              <AlertTriangle className="w-3.5 h-3.5" /> {t.conflictScan}
            </button>
            <button onClick={handleOpenLogs} className={SECONDARY_BTN}>
              <FileText className="w-3.5 h-3.5" /> {t.viewLogs}
            </button>
          </SettingRow>
        </GlassCard>
      </div>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow icon={Save} title={t.backup} desc={t.backupDesc}>
            <button
              onClick={handleBackup}
              disabled={backupLoading}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent-500)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-600)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = ''; }}
            >
              {backupLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {t.backupCreate}
            </button>
          </SettingRow>

          {visibleBackups.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {visibleBackups.map((backup, i) => {
                const worldNames = backup.worlds?.map(w => w.name) || [];
                const totalSize = backup.totalSize || 0;
                const dateStr = backup.date ? new Date(backup.date).toLocaleString() : backup.timestamp?.replace(/T/g, ' ').replace(/-/g, '/').slice(0, 19);
                return (
                  <div key={backup.name || i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 transition-all duration-300 hover:bg-white/80 dark:hover:bg-slate-800/50 animate-slide-up" style={{ animationFillMode: 'both', animationDelay: `${Math.min(i, 10) * 40}ms`, animationDuration: '400ms' }}>
                    <div className="p-2 rounded-full shrink-0" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent-500)' }}>
                      <Save className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {worldNames.length > 0 ? worldNames.map((name, j) => (
                          <span key={j} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full" style={{ color: 'var(--accent-600)', backgroundColor: 'rgba(var(--accent-rgb), 0.1)' }}>
                            <Map className="w-3 h-3" />{name}
                          </span>
                        )) : (
                          <span className="text-sm font-bold text-slate-400 dark:text-slate-500 italic">{t.backupEmpty || 'Empty'}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{dateStr}</span>
                        {totalSize > 0 && (
                          <>
                            <span className="text-[10px] text-slate-300 dark:text-slate-600">·</span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">{formatBytes(totalSize)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRestoreBackup(backup.path)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full transition-all duration-300 active:scale-95 hover:shadow-sm"
                        style={{ color: 'var(--accent-500)', backgroundColor: 'rgba(var(--accent-rgb), 0.08)', border: '1px solid rgba(var(--accent-rgb), 0.2)' }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.15)'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(var(--accent-rgb), 0.08)'; }}
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t.backupRestore}
                      </button>
                      <button
                        onClick={() => handleDeleteBackup(backup.path)}
                        title={t.confirmDeleteBackupTitle}
                        className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-all duration-300 hover:scale-110 active:scale-95"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>

      <div className="animate-slide-up" style={anim()}>
        <GlassCard isPill={false} className={cardClass}>
          <SettingRow
            icon={Info}
            title={t.about}
            desc="HZMM — HumanitZ Mod Manager"
            badge={<span className="shrink-0 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shadow-inner">v{appVersion || '1.0.0'}</span>}
          >
            {updateState === 'idle' && (
              <button onClick={handleCheckUpdate} className={SECONDARY_BTN}>
                {t.checkUpdate}
              </button>
            )}
            {updateState === 'checking' && (
              <span className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t.checking}
              </span>
            )}
            {updateState === 'latest' && (
              <span className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded-full border border-emerald-200 dark:border-emerald-800">
                <CheckCircle className="w-3.5 h-3.5" /> {t.latestVersion}
              </span>
            )}
            {updateState === 'available' && (
              <button onClick={handleDownloadUpdate} className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full text-white transition-all duration-300 active:scale-95 shadow-sm" style={{ backgroundColor: 'var(--accent-500)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-600)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(var(--accent-rgb), 0.3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-500)'; e.currentTarget.style.boxShadow = ''; }}>
                <DownloadCloud className="w-3.5 h-3.5" /> {t.downloadUpdate}
              </button>
            )}
            {updateState === 'downloading' && (
              <div className="flex items-center gap-3">
                <div className="w-24 h-2 bg-slate-200/80 dark:bg-slate-800/80 rounded-full overflow-hidden shadow-inner">
                  <div className="h-full transition-all duration-500 ease-out rounded-full shimmer-sweep" style={{ background: 'linear-gradient(to right, var(--accent-400), var(--accent-500))', width: `${updateProgress}%` }} />
                </div>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--accent-500)' }}>{Math.round(updateProgress)}%</span>
              </div>
            )}
            {updateState === 'ready' && (
              <div className="flex flex-col items-end gap-1.5">
                <button onClick={handleInstallUpdate} className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-full bg-emerald-500 hover:bg-emerald-600 text-white transition-all duration-300 active:scale-95 shadow-sm hover:shadow-md">
                  {/* AppImage swaps in place; deb / dev runs open the releases page. */}
                  {updateInfo?.autoInstall
                    ? <><Zap className="w-3.5 h-3.5" /> {t.installUpdate}</>
                    : <><DownloadCloud className="w-3.5 h-3.5" /> {t.updateDownloadManual}</>}
                </button>
                {updateError && (
                  <span className="text-[11px] font-medium text-right max-w-[220px] leading-snug text-red-500 dark:text-red-400">{updateError}</span>
                )}
              </div>
            )}
          </SettingRow>
          {updateState === 'available' && updateInfo?.changelog && (
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200/60 dark:border-slate-700/50 overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed max-h-28 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 dark:hover:[&::-webkit-scrollbar-thumb]:bg-slate-600/80">
                <p className="font-bold text-slate-600 dark:text-slate-300 mb-1.5">{t.newVersion}: {updateInfo.latestVersion.startsWith('v') ? updateInfo.latestVersion : `v${updateInfo.latestVersion}`}</p>
                {updateInfo.changelog.split('\n').map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  if (trimmed.startsWith('## ')) return <p key={i} className="font-bold text-slate-600 dark:text-slate-300 mt-1.5 mb-0.5">{trimmed.replace('## ', '')}</p>;
                  if (trimmed.startsWith('- ')) return <p key={i} className="pl-2">• {trimmed.replace('- ', '')}</p>;
                  return <p key={i}>{trimmed}</p>;
                })}
              </div>
            </div>
          )}
        </GlassCard>
      </div>

    </div>
  );
}

export default SettingsTab;
