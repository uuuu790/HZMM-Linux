import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ThumbsUp, User, ExternalLink, RefreshCw, Play, FileArchive, Calendar, Crown, DownloadCloud, Check } from 'lucide-react';
import { bbcodeToHtml } from '../../utils/bbcode';
import { isSelfMod } from '../../utils/nexus-self';

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

// V2 returns camelCase, but the render code below was written against V1's
// snake_case. Adapt the detail payload once so the JSX stays flat.
function adaptV2Mod(v2) {
  if (!v2) return null;
  return {
    ...v2,
    mod_id: v2.modId,
    picture_url: v2.thumbnailLargeUrl || v2.pictureUrl || v2.thumbnailUrl,
    mod_downloads: v2.downloads,
    mod_unique_downloads: v2.downloads,
    endorsement_count: v2.endorsements,
    updated_timestamp: v2.updatedAt,
    uploaded_by: v2.uploader?.name || v2.author,
    author: v2.author || v2.uploader?.name,
    contains_adult_content: v2.adultContent,
  };
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

  useEffect(() => {
    let cancelled = false;
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

  // Group files by category
  const groupedFiles = {};
  for (const f of files) {
    const cat = f.category_id;
    if (cat === 6 || cat === 7) continue;
    if (!groupedFiles[cat]) groupedFiles[cat] = [];
    groupedFiles[cat].push(f);
  }
  // Sort each group newest-first
  for (const k of Object.keys(groupedFiles)) {
    groupedFiles[k].sort((a, b) => (b.uploaded_timestamp || 0) - (a.uploaded_timestamp || 0));
  }

  const displayMod = detail || mod;
  // Narrow set of fileIds the user has installed for THIS mod. Used by the
  // per-file install buttons so they don't all light up when the user only
  // installed one of them. (The header badge uses installedSet at the
  // mod-level — any file of this mod counts there.)
  const installedFileIds = (installedList || [])
    .filter(e => e && e.modId === modIdNum && e.fileId != null)
    .map(e => e.fileId);
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
        {/* Header — every knob scales by breakpoint (sm = 640px, lg = 1024px)
            so the whole band shrinks proportionally on a narrow window
            instead of keeping any one element at desktop size. */}
        <div className="relative shrink-0">
          {thumb && (
            <div className="relative h-20 sm:h-32 lg:h-48 overflow-hidden">
              <img src={thumb} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <div className="absolute inset-0 bg-gradient-to-t from-white/95 dark:from-slate-900/95 via-white/40 dark:via-slate-900/40 to-transparent" />
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 sm:top-3 sm:right-3 lg:top-4 lg:right-4 w-8 h-8 sm:w-9 sm:h-9 lg:w-10 lg:h-10 rounded-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 shadow-md active:scale-90 transition-all"
            title="Close"
          >
            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 lg:w-5 lg:h-5" />
          </button>

          <div className={`px-3 sm:px-5 lg:px-8 ${thumb ? 'pb-3 sm:pb-4 lg:pb-5 -mt-6 sm:-mt-8 lg:-mt-12 relative' : 'py-4 sm:py-5 lg:py-6'}`}>
            <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2 flex-wrap">
              <h2 className="text-base sm:text-xl lg:text-2xl font-black text-slate-900 dark:text-slate-50 leading-tight">{displayMod.name}</h2>
              {installedSet?.has(modIdNum) && (
                <span className="shrink-0 flex items-center gap-1 text-[9px] sm:text-[10px] font-black tracking-widest uppercase px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-emerald-500" />
                  {t.nexusInstalledLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-x-2 sm:gap-x-3 lg:gap-x-4 gap-y-1 flex-wrap text-[10px] sm:text-[11px] lg:text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1"><User className="w-3 h-3 sm:w-3.5 sm:h-3.5" />{author}</span>
              {displayMod.version && <span className="font-mono">v{displayMod.version}</span>}
              <span className="flex items-center gap-1"><Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />{formatCount(downloads)}<span className="hidden sm:inline"> {t.nexusDownloads}</span></span>
              <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />{formatCount(endorsements)}<span className="hidden sm:inline"> {t.nexusEndorsements}</span></span>
              {displayMod.updated_timestamp && (
                <span className="hidden sm:flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(displayMod.updated_timestamp)}</span>
              )}
              <button onClick={openOnNexus} className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
                <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" /><span className="hidden sm:inline">{t.nexusVisitPage}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 lg:px-8 pb-4 sm:pb-5 lg:pb-8 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/50 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
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
            <div className="flex flex-col gap-6">
              {/* Summary + description */}
              {displayMod.summary && (
                <p className="text-sm text-slate-600 dark:text-slate-300 italic leading-relaxed border-l-3 border-slate-300 dark:border-slate-700 pl-4" style={{ borderLeftWidth: '3px' }}>
                  {displayMod.summary}
                </p>
              )}

              {descriptionHtml && (
                <div
                  className="nexus-description"
                  onClick={handleReadmeClick}
                  dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                />
              )}

              {/* Files */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: 'var(--accent-500)' }}>
                  <FileArchive className="w-3.5 h-3.5" />
                  {t.nexusFiles}
                </h3>

                <div className="flex flex-col gap-4">
                  {CATEGORY_ORDER.map(cat => {
                    const list = groupedFiles[cat.id];
                    if (!list || list.length === 0) return null;
                    return (
                      <div key={cat.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] font-black tracking-widest uppercase ${cat.accent ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}>{t[cat.labelKey]}</span>
                          {cat.accent && <Crown className="w-3 h-3 text-amber-500" />}
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
                                  <span className="text-[13px] sm:text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{file.name}</span>
                                  {file.version && <span className="text-[9px] sm:text-[10px] font-mono bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1 sm:px-1.5 py-0.5 rounded">{file.version}</span>}
                                </div>
                                <div className="flex items-center gap-x-2 sm:gap-x-3 gap-y-0.5 flex-wrap text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono">
                                  <span>{formatBytes(file.size_in_bytes || file.size * 1024)}</span>
                                  <span>{formatDate(file.uploaded_timestamp)}</span>
                                  {file.total_downloads != null && (
                                    <span className="flex items-center gap-1" title={t.nexusDownloads}>
                                      <DownloadCloud className="w-3 h-3" />
                                      {formatCount(file.total_downloads)}
                                    </span>
                                  )}
                                  {/* filename is noise at narrow widths; hide until there's room */}
                                  <span className="hidden sm:inline truncate max-w-[35%]">{file.file_name}</span>
                                </div>
                                {file.description && (
                                  <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1 sm:line-clamp-2">{file.description}</p>
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

