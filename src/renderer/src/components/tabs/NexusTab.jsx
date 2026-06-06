import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search, RefreshCw, ExternalLink, DownloadCloud, Crown, Flame, Clock, Sparkles, TrendingUp, X } from 'lucide-react';
import NexusModCard from '../common/NexusModCard';
import NexusModCardSkeleton from '../common/NexusModCardSkeleton';
import NexusModDetailModal from '../modals/NexusModDetailModal';
import NexusFileSelectModal from '../modals/NexusFileSelectModal';
import { isSelfMod } from '../../utils/nexus-self';

// ============================================================
// Sort segments — map to V2 nexus:list-mods sort enum values.
// ============================================================
const SEGMENTS = [
  { id: 'latest_added', labelKey: 'nexusLatestAdded', icon: Sparkles },
  { id: 'latest_updated', labelKey: 'nexusLatestUpdated', icon: Clock },
  { id: 'most_downloaded', labelKey: 'nexusMostDownloaded', icon: TrendingUp },
  { id: 'trending', labelKey: 'nexusTrending', icon: Flame },
];

// ============================================================
// Gate states (API key / network / invalid — NOT Premium; Premium is now
// only a gate on the install button, browsing is always available).
// ============================================================
function GateCard({ icon: Icon, title, description, cta, onCta, iconColor }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-8 max-w-xl mx-auto">
      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-6 ${iconColor || 'bg-slate-100 dark:bg-slate-800'} shadow-[0_8px_24px_rgba(0,0,0,0.05)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.3)]`}>
        <Icon className="w-10 h-10 text-white" />
      </div>
      <h2 className="text-xl font-black tracking-wide text-slate-800 dark:text-slate-100 mb-2">{title}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">{description}</p>
      {cta && (
        <button onClick={onCta} className="flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-bold transition-all duration-300 active:scale-95 hover:-translate-y-0.5" style={{ backgroundColor: 'var(--accent-500)', boxShadow: '0 8px 20px rgba(var(--accent-rgb), 0.3)' }}>
          {cta}
        </button>
      )}
    </div>
  );
}

// ============================================================
// Main browse UI
// ============================================================
function BrowseUI({ t, lang, addToast, premiumName, isPremium, noKey, goToSettings }) {
  const [category, setCategory] = useState('latest_added');
  const [mods, setMods] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchTimerRef = useRef(null);

  const [selectedMod, setSelectedMod] = useState(null);
  const [installingModId, setInstallingModId] = useState(null);
  // When the card's quick-install button triggers a mod that has multiple
  // Main files, we pop this picker instead of silently grabbing the latest.
  // `{ mod, files }` when open, null when closed.
  const [filePicker, setFilePicker] = useState(null);
  const [installingFileId, setInstallingFileId] = useState(null);

  // "Bootup" gate — keep showing lightweight skeletons during the parent
  // container's 500ms max-width spring transition, even if the API response
  // has already arrived from cache. Swapping in 69 real cards mid-animation
  // forces the grid to re-layout every frame as the container bounces, which
  // shows up as jank. Skeletons (simple pulsed boxes with content-visibility)
  // have near-constant layout cost, so the spring lands first, *then* we
  // swap in the real cards on a stable grid.
  const [bootupDone, setBootupDone] = useState(false);
  useEffect(() => {
    const tid = setTimeout(() => setBootupDone(true), 550);
    return () => clearTimeout(tid);
  }, []);

  // Settings-tab-style cascade entrance: when the gate opens, the skeleton
  // layer quickly fades out (150ms) while the real cards immediately start
  // streaming in with a tight 25ms stagger. The skeleton's fade-out overlaps
  // the first ~150ms of the real cascade so there's no empty frame during
  // the swap — the user sees "skeleton dissolves, cards pop in one by one"
  // as a single continuous motion.
  const SKEL_COUNT = 12;
  const SKEL_FADE_MS = 150;
  const gateOpen = !loading && bootupDone;
  const [realMounted, setRealMounted] = useState(false);
  const [skelExiting, setSkelExiting] = useState(false);
  const realMountedRef = useRef(false);

  useEffect(() => {
    if (gateOpen && !realMountedRef.current) {
      realMountedRef.current = true;
      setRealMounted(true);
      setSkelExiting(true);
      const tid = setTimeout(() => setSkelExiting(false), SKEL_FADE_MS + 20);
      return () => clearTimeout(tid);
    }
    if (!gateOpen && realMountedRef.current) {
      realMountedRef.current = false;
      setRealMounted(false);
      setSkelExiting(false);
    }
  }, [gateOpen]);

  // Persistent "installed via Nexus" list. We keep the raw receipts so the
  // detail modal can match per-file install status (modId + fileId), not
  // just mod-level (which would paint every file in the mod as installed
  // even when only one was actually installed).
  const [installedList, setInstalledList] = useState([]);
  const refreshInstalledSet = () => {
    window.api?.nexus?.getInstalledMods?.().then(list => {
      setInstalledList(Array.isArray(list) ? list : []);
    }).catch(() => {});
  };
  // Refresh on mount *and* whenever the local mod inventory changes. This
  // closes the loop with the backend's cross-check in nexus:get-installed-mods:
  // if the user removes a Nexus-installed mod from the Modules tab, the
  // 'mods:updated' event fires, we re-fetch, and the badge auto-clears.
  useEffect(() => {
    refreshInstalledSet();
    const unsubscribe = window.api?.mods?.onUpdated?.(() => refreshInstalledSet());
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);
  // Mod-level set: any file of this mod counts. Used by the card + modal title.
  const installedSet = useMemo(
    () => new Set(installedList.map(e => e.modId)),
    [installedList]
  );

  // Debounce the search input so typing doesn't spam the V2 endpoint.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Load mods — either by sort (browse mode) or by keyword (search mode).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loader = debouncedQuery
      ? window.api.nexus.searchMods(debouncedQuery)
      : window.api.nexus.listMods(category);

    loader.then(res => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.reason || 'unknown');
        setMods([]);
        setTotalCount(0);
      } else {
        setMods(res.mods || []);
        setTotalCount(res.totalCount || 0);
      }
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err?.message || 'unknown');
      setMods([]);
      setTotalCount(0);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [category, debouncedQuery]);

  const handleQuickInstall = async (mod) => {
    if (installingModId) return;
    // Distinguish "no key at all" from "key present but not premium" so
    // the toast can point the user to the right fix.
    if (noKey) {
      addToast(t.nexusNoKeyInstall, 'error');
      return;
    }
    if (!isPremium) {
      addToast(t.nexusPremiumRequired, 'error');
      return;
    }
    // Coerce to number for the IPC — backend guards with Number.isInteger
    // and V2 GraphQL isn't consistent about whether ID comes back as string
    // or number. (Previously only worked because Nexus happened to send ints.)
    const modIdNum = Number(mod.modId);
    setInstallingModId(modIdNum);
    // Probe the file list first. One Main file → backend picks it (same
    // as the old "install latest" behavior). Multiple → surface a picker
    // so the user can pick between Vanilla/Modded/compat variants etc.
    try {
      // IPC returns { ok, files } (not a bare array) — unwrap carefully.
      const filesRes = await window.api.nexus.getModFiles(modIdNum);
      if (!filesRes || filesRes.ok === false) {
        throw new Error(filesRes?.error || filesRes?.reason || 'fetch-files-failed');
      }
      const allFiles = Array.isArray(filesRes.files) ? filesRes.files : [];
      const mainFiles = allFiles.filter(f => f.category_id === 1);

      if (mainFiles.length > 1) {
        // Sort newest-first so the likely "latest" candidate is on top.
        mainFiles.sort((a, b) => {
          const ta = typeof a.uploaded_timestamp === 'string'
            ? Date.parse(a.uploaded_timestamp)
            : (a.uploaded_timestamp || 0) * 1000;
          const tb = typeof b.uploaded_timestamp === 'string'
            ? Date.parse(b.uploaded_timestamp)
            : (b.uploaded_timestamp || 0) * 1000;
          return tb - ta;
        });
        setInstallingModId(null);
        setFilePicker({ mod, files: mainFiles });
        return;
      }

      // 0 or 1 Main file → let the backend's resolver do its thing
      // (which also handles the "fall back to any file if no Main" case).
      await window.api.nexus.installMod(modIdNum);
      addToast(`${t.nexusInstalledToast}: ${mod.name}`, 'success');
      refreshInstalledSet();
    } catch (err) {
      addToast(`${t.nexusInstallFailedToast}: ${err?.message || err}`, 'error');
    } finally {
      setInstallingModId(null);
    }
  };

  // Called by NexusFileSelectModal when the user picks a specific Main file.
  const handlePickedFileInstall = async (file) => {
    if (!filePicker || installingFileId) return;
    if (noKey) {
      addToast(t.nexusNoKeyInstall, 'error');
      return;
    }
    if (!isPremium) {
      addToast(t.nexusPremiumRequired, 'error');
      return;
    }
    const { mod } = filePicker;
    setInstallingFileId(file.file_id);
    try {
      await window.api.nexus.installFile(Number(mod.modId), file.file_id);
      addToast(`${t.nexusInstalledToast}: ${mod.name}`, 'success');
      refreshInstalledSet();
      setFilePicker(null);
    } catch (err) {
      addToast(`${t.nexusInstallFailedToast}: ${err?.message || err}`, 'error');
    } finally {
      setInstallingFileId(null);
    }
  };

  const openNexusSearch = () => {
    const url = searchQuery.trim()
      ? `https://www.nexusmods.com/humanitz/mods/?BH=0&keyword=${encodeURIComponent(searchQuery)}`
      : 'https://www.nexusmods.com/humanitz';
    window.api?.system?.openExternal?.(url);
  };

  const inSearchMode = !!debouncedQuery;

  // Sliding pill indicator — measure each segment button's offset/width via
  // refs so the active highlight can animate between them instead of
  // instantly repainting on the new button.
  const segmentRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });
  // useLayoutEffect so the measurement runs before paint — avoids a visible
  // flash where the indicator briefly sits at the stale position after the
  // active class toggles.
  useLayoutEffect(() => {
    const el = segmentRefs.current[category];
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
    }
  }, [category]);
  // Recalibrate when the window resizes (button widths shift at md: breakpoint
  // when the label text toggles visibility).
  useEffect(() => {
    const onResize = () => {
      const el = segmentRefs.current[category];
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [category]);

  // Normalize mod shape — V2 uses camelCase, but NexusModCard was written
  // against V1's snake_case. Adapt the mod object on its way in.
  const adaptedMods = useMemo(() => mods.map(m => ({
    ...m,
    mod_id: m.modId,
    picture_url: m.pictureUrl || m.thumbnailUrl,
    mod_downloads: m.downloads,
    endorsement_count: m.endorsements,
    contains_adult_content: m.adultContent,
  })), [mods]);

  return (
    <div className="flex flex-col gap-4 animate-zoom-in duration-500">
      {/* Top bar: sort pills + search + external-search button */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`relative flex items-center gap-1 p-1 rounded-full bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 transition-opacity duration-200 ${inSearchMode ? 'opacity-40 pointer-events-none' : ''}`}>
          {/* Sliding pill — tracks the active segment with a CSS transition.
              Rendered as a single absolutely-positioned layer behind the
              buttons so switching segments animates position/width instead
              of instantly repainting the background on a different child. */}
          {indicator.ready && (
            <div
              aria-hidden
              className="absolute top-1 bottom-1 rounded-full shadow-sm pointer-events-none transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              style={{
                left: `${indicator.left}px`,
                width: `${indicator.width}px`,
                backgroundColor: 'var(--accent-500)',
              }}
            />
          )}
          {SEGMENTS.map(seg => {
            const SegIcon = seg.icon;
            const active = category === seg.id;
            return (
              <button
                key={seg.id}
                ref={el => { segmentRefs.current[seg.id] = el; }}
                onClick={() => setCategory(seg.id)}
                className={`relative z-10 flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full transition-colors duration-300 active:scale-95 ${active ? 'text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                <SegIcon className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{t[seg.labelKey]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t.nexusSearchPlaceholderV2}
            className="w-full pl-10 pr-10 py-2 text-sm rounded-full bg-white/80 dark:bg-slate-900/80 border border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all"
            style={{ '--tw-ring-color': 'rgba(var(--accent-rgb), 0.3)' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center transition-colors"
              title="Clear"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          onClick={openNexusSearch}
          title={t.nexusSearchOnWeb}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/50 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 active:scale-95 transition-all"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span className="hidden md:block">{t.nexusSearchOnWeb}</span>
        </button>
      </div>

      {/* Status strip — three mutually exclusive badges:
          - no-key: amber, clickable, jumps to Settings
          - non-premium (has key): amber, "install gated by Premium"
          - premium: amber crown + username */}
      <div className="flex items-center gap-4 text-[10px] font-bold tracking-widest uppercase text-slate-400 dark:text-slate-500">
        {noKey ? (
          <button
            onClick={goToSettings}
            className="flex items-center gap-1 text-amber-500 hover:text-amber-600 dark:hover:text-amber-400 active:scale-95 [transition:color_200ms,scale_100ms] cursor-pointer"
          >
            <Crown className="w-3 h-3" />
            {t.nexusBrowseOnlyNoKey}
          </button>
        ) : isPremium && premiumName ? (
          <span className="flex items-center gap-1"><Crown className="w-3 h-3 text-amber-500" />Premium · {premiumName}</span>
        ) : (
          <span className="flex items-center gap-1 text-amber-500"><Crown className="w-3 h-3" />{t.nexusPremiumInstallOnly}</span>
        )}
        {!loading && !error && (
          <span>
            {inSearchMode
              ? t.nexusSearchResults?.replace('{n}', totalCount) || `${totalCount} results`
              : t.nexusCountTotal?.replace('{n}', totalCount) || `${totalCount} mods`}
          </span>
        )}
      </div>

      {/* Grid — crossfade between skeleton and real card layers.
          Layout: CSS grid-stack (both layers share a single grid cell) so
          the skeleton can fade out while the real cards fade in at the same
          visual position, with the container's height always matching the
          real grid. No absolute positioning, no layout-thrash. */}
      {error ? (
        <div className="flex flex-col items-center justify-center py-24 text-center px-8 animate-slide-up" style={{ animationDuration: '400ms' }}>
          <DownloadCloud className="w-10 h-10 text-slate-400 mb-3" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t.nexusNetworkError}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-mono">{error}</p>
        </div>
      ) : (gateOpen && adaptedMods.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 dark:text-slate-500 animate-slide-up" style={{ animationDuration: '400ms' }}>
          <Search className="w-10 h-10 mb-3" style={{ animation: 'emptyBreath 3s ease-in-out infinite' }} />
          <p className="text-sm">{t.nexusNoResults}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateAreas: '"stack"' }}>
          {/* Real grid — rendered underneath the skeleton. Each card does its
              own staggered slide-up, kicking off the moment the gate opens.
              By the time the skeleton's 150ms fade-out completes, the first
              few real cards are already sliding in, so there's never an
              empty frame during the swap. */}
          {realMounted && adaptedMods.length > 0 && (
            <div
              key={`grid:${category}:${debouncedQuery}`}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4"
              style={{ gridArea: 'stack', contain: 'layout style' }}
            >
              {adaptedMods.map((mod, i) => (
                <NexusModCard
                  key={mod.modId}
                  index={i}
                  mod={mod}
                  t={t}
                  onClick={() => setSelectedMod(mod)}
                  onQuickInstall={() => handleQuickInstall(mod)}
                  installing={installingModId === mod.modId}
                  installingAny={!!installingModId}
                  installed={installedSet.has(mod.modId)}
                  entrance="slide"
                  selfMod={isSelfMod(mod)}
                />
              ))}
            </div>
          )}
          {/* Skeleton on top — fades out quickly (150ms) while the real
              cards are already cascading in below. */}
          {(loading || !bootupDone || skelExiting) && (
            <div
              key={`skel:${category}:${debouncedQuery}`}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4"
              style={{
                gridArea: 'stack',
                contain: 'layout style',
                opacity: skelExiting ? 0 : 1,
                transition: `opacity ${SKEL_FADE_MS}ms ease-out`,
                willChange: 'opacity',
                pointerEvents: skelExiting ? 'none' : 'auto',
              }}
            >
              {Array.from({ length: SKEL_COUNT }).map((_, i) => (
                <NexusModCardSkeleton key={i} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {selectedMod && (
        <NexusModDetailModal
          mod={selectedMod}
          t={t}
          lang={lang}
          onClose={() => setSelectedMod(null)}
          addToast={addToast}
          isPremium={isPremium}
          installedSet={installedSet}
          installedList={installedList}
          onInstallComplete={refreshInstalledSet}
        />
      )}

      {filePicker && (
        <NexusFileSelectModal
          modName={filePicker.mod.name}
          files={filePicker.files}
          t={t}
          onSelect={handlePickedFileInstall}
          onClose={() => { if (!installingFileId) setFilePicker(null); }}
          installingFileId={installingFileId}
        />
      )}
    </div>
  );
}

// ============================================================
// Root — runs V1 validate to detect Premium status, then hands off
// to BrowseUI. Hard-gates only on key-INVALID / network errors.
// No-key + non-premium both enter browse mode (V2 GraphQL doesn't need
// auth); the install button is what actually gates on Premium.
// ============================================================
export default function NexusTab({ t, lang, addToast, setActiveTab }) {
  const [state, setState] = useState({ loading: true });

  const runValidate = () => {
    setState({ loading: true });
    window.api.nexus.validate().then(res => {
      // V1 validate returns: ok (premium), or { ok:false, reason } for no-key/invalid/network.
      if (res.ok) {
        setState({ loading: false, ready: true, premium: true, name: res.name });
      } else if (res.reason === 'not-premium') {
        setState({ loading: false, ready: true, premium: false, name: res.name });
      } else if (res.reason === 'no-key') {
        // Still let them browse — V2 is unauthenticated. Install button
        // will surface the "need API key" toast when they try.
        setState({ loading: false, ready: true, premium: false, noKey: true });
      } else {
        setState({ loading: false, ready: false, reason: res.reason, error: res.error });
      }
    }).catch(err => {
      setState({ loading: false, ready: false, reason: 'network', error: err?.message });
    });
  };

  useEffect(() => { runValidate(); }, []);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    );
  }

  // Hard gates — only for genuine error states (invalid key / network).
  // No-key is no longer a hard gate; it enters browse mode as non-premium.
  if (!state.ready) {
    if (state.reason === 'invalid') {
      return (
        <GateCard
          icon={DownloadCloud}
          iconColor="bg-gradient-to-br from-red-500 to-rose-600"
          title={t.nexusApiKeyInvalid}
          description={t.nexusApiKeyInvalidDesc}
          cta={t.nexusGoToSettings}
          onCta={() => setActiveTab('settings')}
        />
      );
    }
    return (
      <GateCard
        icon={DownloadCloud}
        iconColor="bg-gradient-to-br from-slate-500 to-slate-700"
        title={t.nexusNetworkError}
        description={state.error || ''}
        cta={<><RefreshCw className="w-4 h-4" /> Retry</>}
        onCta={runValidate}
      />
    );
  }

  return <BrowseUI t={t} lang={lang} addToast={addToast} premiumName={state.name} isPremium={state.premium} noKey={!!state.noKey} goToSettings={() => setActiveTab('settings')} />;
}
