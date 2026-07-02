import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ThumbsUp, User, ExternalLink, RefreshCw, Play, Calendar, Star, DownloadCloud, Check } from 'lucide-react';
import { bbcodeToHtml } from '../../utils/bbcode';
import { isSelfMod } from '../../utils/nexus-self';
import { adaptV2Mod } from '../../utils/nexus-mod-adapt';

// Group files by Nexus category_id. 1=Main 2=Update 3=Optional 4=Old 5=Misc
// 6=Deleted 7=Archived — we hide 6/7.
const CATEGORY_ORDER = [
  { id: 1, labelKey: 'nexusFilesMain', accent: true },
  { id: 3, labelKey: 'nexusFilesOptional' },
  { id: 2, labelKey: 'nexusFilesUpdate' },
  { id: 5, labelKey: 'nexusFilesMisc' },
  { id: 4, labelKey: 'nexusFilesOld' },
];

function formatCount(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function formatBytes(n) {
  if (!n) return '—';
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
function formatDate(ts) {
  if (!ts) return '—';
  // V2 returns ISO 8601 strings ("2026-04-17T15:31:48Z"); V1 / file endpoints
  // return unix epoch seconds (number). Detect which and branch.
  try {
    if (typeof ts === 'string') return new Date(ts).toLocaleDateString();
    return new Date(ts * 1000).toLocaleDateString();
  } catch { return '—'; }
}

export default function NexusModDetailModal({ mod, t, lang: _lang, onClose, addToast, isPremium, installedSet, installedList, onInstallComplete }) {
  // Coerce to a number — V2 GraphQL serializes ID as string in some responses
  // and number in others; the backend's IPC guards (Number.isInteger) and the
  // installedList filter below (strict ===) both require a real number to
  // match. The old `const modIdNum = mod.modId || modIdNum;` was a
  // self-reference (TDZ on the right-hand side) and only worked by accident
  // whenever mod.modId happened to be truthy.
  const modIdNum = Number(mod.modId);

  const [detail, setDetail] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [installingFileId, setInstallingFileId] = useState(null);
  const [activeTab, setActiveTab] = useState('description'); // 'description' | 'files'

  useEffect(() => {
    let cancelled = false;
    setActiveTab('description');
    setLoading(true);
    setError(null);

    Promise.all([
      window.api.nexus.getModDetail(modIdNum),
      window.api.nexus.getModFiles(modIdNum),
    ]).then(([d, f]) => {
      if (cancelled) return;
      if (!d.ok) { setError(d.reason || 'unknown'); setLoading(false); return; }
      setDetail(adaptV2Mod(d.mod));
      setFiles(f.ok ? (f.files || []) : []);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err?.message || 'unknown');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [modIdNum]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleInstallFile = async (file) => {
    if (installingFileId) return;
    if (!isPremium) {
      addToast(t.nexusPremiumRequired, 'error');
      return;
    }
    setInstallingFileId(file.file_id);
    try {
      await window.api.nexus.installFile(modIdNum, file.file_id);
      addToast(`${t.nexusInstalledToast}: ${file.name}`, 'success');
      onInstallComplete?.();
    } catch (err) {
      addToast(`${t.nexusInstallFailedToast}: ${err?.message || err}`, 'error');
    } finally {
      setInstallingFileId(null);
    }
  };

  const openOnNexus = () => {
    window.api?.system?.openExternal?.(`https://www.nexusmods.com/humanitz/mods/${modIdNum}`);
  };

  // Nexus v1 API returns descriptions in BBCode (not Markdown). Convert
  // through our bbcode utility, which escapes HTML entities first and only
  // emits a safe subset of tags. YouTube embeds degrade to external links
  // because CSP blocks iframes.
  const descriptionHtml = detail?.description ? bbcodeToHtml(detail.description) : null;

  // Suppress install affordances if this is HZMM itself (see utils/nexus-self).
  // Detail arrives from V2 as snake_case via adaptV2Mod; fall back to the
  // trimmed-down mod prop passed into the modal so the flag is correct even
  // before the detail fetch resolves.
  const isSelf = isSelfMod(detail || mod);

  const handleReadmeClick = (e) => {
    // Same pattern as ModDetailModal — route any anchor click through
    // shell.openExternal to bypass will-navigate.
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) window.api?.system?.openExternal?.(href);
  };

  // Group files by category, newest-first. Memoized on [files] so the per-file
  // install spinner toggling (installingFileId) doesn't re-group/re-sort.
  const groupedFiles = useMemo(() => {
    const groups = {};
    for (const f of files) {
      const cat = f.category_id;
      if (cat === 6 || cat === 7) continue;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(f);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => (b.uploaded_timestamp || 0) - (a.uploaded_timestamp || 0));
    }
    return groups;
  }, [files]);

  // Tab badge counts only the files actually shown — groupedFiles drops the
  // Deleted/Archived categories — so it matches the list instead of files.length.
  const visibleFileCount = useMemo(
    () => Object.values(groupedFiles).reduce((n, arr) => n + arr.length, 0),
    [groupedFiles]
  );

  const displayMod = detail || mod;
  // Narrow set of fileIds the user has installed for THIS mod. Used by the
  // per-file install buttons so they don't all light up when the user only
  // installed one of them. (The header badge uses installedSet at the
  // mod-level — any file of this mod counts there.)
  const installedFileIds = useMemo(
    () => (installedList || []).filter(e => e && e.modId === modIdNum && e.fileId != null).map(e => e.fileId),
    [installedList, modIdNum]
  );
  const thumb = displayMod.picture_url;
  const author = displayMod.author || displayMod.uploaded_by || '—';
  const downloads = displayMod.mod_downloads ?? displayMod.mod_unique_downloads ?? 0;
  const endorsements = displayMod.endorsement_count ?? 0;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-2 sm:p-4 md:p-6 [-webkit-app-region:no-drag]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-zoom-in duration-300" />
      <div
        onClick={(e) => e.stopPropagation()}
        // Fluid sizing: width tracks the viewport (85vw) so enlarging the
        // window actually enlarges the modal, but with a hard cap at
        // 1400px for ultrawide/4K displays so it never degenerates into a
        // full-page takeover. Height the same story — tracks viewport on
        // small screens, obeys a 900px ceiling on tall monitors.
        className="relative w-full max-w-[min(85vw,1400px)] max-h-[92vh] sm:max-h-[88vh] lg:max-h-[min(85vh,900px)] bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-white/60 dark:border-slate-700/50 rounded-2xl sm:rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] animate-modal-spring flex flex-col overflow-hidden"
      >
        {/* Banner — full-res picture fills the top; title sits over a
            bottom gradient. No image -> theme-tinted gradient fallback. */}
        <div className="relative shrink-0 h-36 sm:h-44 lg:h-52">
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.35), rgba(15,23,42,0.6))' }} />
          {thumb && (
            <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-white/95 dark:from-slate-900/95 via-white/55 dark:via-slate-900/55 to-transparent" />
          <button onClick={onClose} title="Close"
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 shadow-md active:scale-90 transition-all">
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="absolute left-4 sm:left-6 lg:left-8 right-4 bottom-3 sm:bottom-4">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h2 className="text-lg sm:text-2xl lg:text-3xl font-black text-slate-900 dark:text-slate-50 leading-tight drop-shadow-sm">{displayMod.name}</h2>
              {installedSet?.has(modIdNum) && (
                <span className="shrink-0 flex items-center gap-1 text-[10px] font-black tracking-widest uppercase px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {t.nexusInstalledLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stat row */}
        <div className="shrink-0 flex items-center gap-x-3.5 sm:gap-x-5 gap-y-1.5 flex-wrap px-4 sm:px-6 lg:px-8 py-3 border-b border-slate-200/60 dark:border-slate-700/50 text-[13px] sm:text-sm text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" />{author}</span>
          {displayMod.version && <span className="font-mono">v{displayMod.version}</span>}
          <span className="flex items-center gap-1" title={t.nexusDownloads}><Download className="w-3.5 h-3.5" />{formatCount(downloads)}</span>
          <span className="flex items-center gap-1" title={t.nexusEndorsements}><ThumbsUp className="w-3.5 h-3.5" />{formatCount(endorsements)}</span>
          {displayMod.updated_timestamp && <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />{formatDate(displayMod.updated_timestamp)}</span>}
          <button onClick={openOnNexus} className="ml-auto flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
            <ExternalLink className="w-3.5 h-3.5" />{t.nexusVisitPage}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 lg:px-8 pb-4 sm:pb-5 lg:pb-8 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
          {!loading && !error && (
            <div className="flex gap-1 mb-4 border-b border-slate-200/60 dark:border-slate-700/50">
              {[['description', t.readmeTitle || '描述'], ['files', `${t.nexusFiles}${visibleFileCount ? ` (${visibleFileCount})` : ''}`]].map(([key, label]) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`px-4 py-2.5 text-[13px] font-bold transition-colors ${activeTab === key ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                  style={activeTab === key ? { borderBottom: '2px solid var(--accent-500)', marginBottom: '-1px' } : undefined}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t.nexusNetworkError}</p>
              <p className="text-xs text-slate-400 font-mono mt-1">{error}</p>
            </div>
          ) : (
            <>
              {activeTab === 'description' && (
                <div className="flex flex-col gap-5">
                  {displayMod.summary && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 italic leading-relaxed border-l-[3px] border-slate-300 dark:border-slate-700 pl-4">
                      {displayMod.summary}
                    </p>
                  )}
                  {descriptionHtml
                    ? <div className="nexus-description" onClick={handleReadmeClick} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
                    : <p className="text-xs text-slate-400 dark:text-slate-500 italic">{displayMod.summary ? '' : 'No description.'}</p>}
                </div>
              )}

              {activeTab === 'files' && (
                <div className="flex flex-col gap-4">
                  {CATEGORY_ORDER.map(cat => {
                    const list = groupedFiles[cat.id];
                    if (!list || list.length === 0) return null;
                    return (
                      <div key={cat.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[11px] sm:text-xs font-black tracking-widest uppercase ${cat.accent ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}>{t[cat.labelKey]}</span>
                          {cat.accent && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
                          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700/50" />
                        </div>
                        <div className="flex flex-col gap-2">
                          {list.map((file, idx) => {
                            const isThisFileInstalled = installedFileIds.includes(file.file_id);
                            return (
                            <div
                              key={file.file_id}
                              className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 animate-slide-up"
                              style={{ animationFillMode: 'both', animationDelay: `${idx * 40}ms`, animationDuration: '380ms' }}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                  <span className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 truncate">{file.name}</span>
                                  {file.version && <span className="text-[11px] sm:text-xs font-mono bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 sm:px-2 py-0.5 rounded">{file.version}</span>}
                                </div>
                                <div className="flex items-center gap-x-2.5 sm:gap-x-3 gap-y-0.5 flex-wrap text-xs sm:text-[13px] text-slate-400 dark:text-slate-500 mt-1.5 font-mono">
                                  <span>{formatBytes(file.size_in_bytes || file.size * 1024)}</span>
                                  <span>{formatDate(file.uploaded_timestamp)}</span>
                                  {file.total_downloads != null && (
                                    <span className="flex items-center gap-1" title={t.nexusDownloads}>
                                      <DownloadCloud className="w-3.5 h-3.5" />
                                      {formatCount(file.total_downloads)}
                                    </span>
                                  )}
                                </div>
                                {file.description && (
                                  <p className="text-[13px] sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-1 sm:line-clamp-2">{file.description}</p>
                                )}
                              </div>
                              {isSelf ? (
                                // HZMM itself — hide the install button. Kept
                                // a muted pill so the row still aligns cleanly.
                                <span className="shrink-0 flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-[11px] font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200/60 dark:border-slate-700/60">
                                  {t.nexusSelfModBadge || 'This app'}
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleInstallFile(file)}
                                  disabled={!!installingFileId}
                                  className={`shrink-0 flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2 text-[11px] sm:text-xs font-bold rounded-full transition-all duration-300 active:scale-95 ${
                                    installingFileId === file.file_id
                                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                                      : isThisFileInstalled && !installingFileId
                                      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40'
                                      : installingFileId
                                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                      : 'text-white'
                                  }`}
                                  style={installingFileId === file.file_id || (isThisFileInstalled && !installingFileId)
                                    ? undefined
                                    : !installingFileId
                                    ? { backgroundColor: 'var(--accent-500)', boxShadow: '0 4px 10px -2px rgba(var(--accent-rgb), 0.4)' }
                                    : undefined}
                                >
                                  {installingFileId === file.file_id
                                    ? <><RefreshCw className="w-3 h-3 animate-spin" /><span className="hidden sm:inline"> {t.nexusInstalling}</span></>
                                    : isThisFileInstalled
                                    ? <><Check className="w-3 h-3" /><span className="hidden sm:inline"> {t.nexusInstalledLabel}</span></>
                                    : <><Play className="w-3 h-3 fill-current" /><span className="hidden sm:inline"> {t.nexusInstall}</span></>}
                                </button>
                              )}
                            </div>
                          );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {Object.keys(groupedFiles).length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">No downloadable files.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
