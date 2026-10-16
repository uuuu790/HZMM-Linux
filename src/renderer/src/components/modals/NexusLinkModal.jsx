import { useState, useEffect, useCallback } from 'react';
import { Link2, Search, X, RefreshCw, ChevronLeft, Check } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// Claim a hand-installed mod: search Nexus, pick the page, optionally pick
// which file you have (accurate update detection), or skip (future-uploads
// notification only). The link itself is one IPC call — nexus:link-mod.
const NexusLinkModal = ({ isOpen, onClose, mod, onLinked, addToast, t }) => {
  useEscapeKey(onClose, isOpen);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [linking, setLinking] = useState(false);

  const runSearch = useCallback(async (q) => {
    if (!window.api?.nexus || !q?.trim()) return;
    setSearching(true);
    try {
      const res = await window.api.nexus.searchMods(q.trim());
      setResults(res?.ok && Array.isArray(res.mods) ? res.mods : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Fresh state + auto-search on open, seeded with the mod's display name.
  useEffect(() => {
    if (!isOpen || !mod) return;
    const seed = mod.customName || mod.title || '';
    setQuery(seed);
    setResults([]);
    setSelected(null);
    setFiles([]);
    setLinking(false);
    if (seed) runSearch(seed);
  }, [isOpen, mod, runSearch]);

  const pickMod = useCallback(async (candidate) => {
    setSelected(candidate);
    setFiles([]);
    setLoadingFiles(true);
    try {
      const res = await window.api.nexus.getModFiles(Number(candidate.modId));
      setFiles(res?.ok && Array.isArray(res.files) ? res.files : []);
    } catch {
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const doLink = useCallback(async (fileId, version) => {
    if (!mod || !selected || linking) return;
    setLinking(true);
    try {
      await window.api.nexus.linkMod(Number(selected.modId), mod.filename, fileId ?? null, version ?? null);
      addToast(t.linkDone || 'Linked to Nexus', 'success');
      onLinked?.();
      onClose();
    } catch (e) {
      addToast(`${t.linkFailed || 'Link failed'}: ${e?.message || ''}`, 'error');
    } finally {
      setLinking(false);
    }
  }, [mod, selected, linking, addToast, t, onLinked, onClose]);

  if (!isOpen || !mod) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-zoom-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nexus-link-modal-title"
        className="relative w-full max-w-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border border-white/60 dark:border-slate-700/50 overflow-hidden animate-modal-spring"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <h3 id="nexus-link-modal-title" className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 min-w-0">
            <Link2 className="w-5 h-5 text-orange-500 shrink-0" />
            <span className="truncate">{t.linkNexus || 'Link to Nexus'} — {mod.customName || mod.title || mod.filename}</span>
          </h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto flex flex-col gap-3">
          {!selected ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(query); }}
                  placeholder={t.linkSearchPlaceholder || 'Search Nexus Mods...'}
                  className="flex-1 min-w-0 px-3 py-2 text-xs rounded-full bg-white/50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all shadow-inner"
                />
                <button
                  onClick={() => runSearch(query)}
                  disabled={searching}
                  className="shrink-0 flex items-center gap-1 px-3 py-2 text-[11px] font-bold rounded-full bg-orange-500/10 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-400/40 dark:border-orange-500/30 hover:bg-orange-500/20 transition-all duration-200 active:scale-95"
                >
                  {searching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                </button>
              </div>
              {searching ? null : results.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6 font-medium">{t.linkNoResults || 'No results — try another keyword'}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {results.map((r) => (
                    <button
                      key={r.modId}
                      onClick={() => pickMod(r)}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/60 dark:bg-slate-800/60 hover:border-orange-400/60 hover:bg-orange-50/50 dark:hover:bg-orange-900/15 transition-colors duration-150 text-left"
                    >
                      {r.thumbnailUrl && <img src={r.thumbnailUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />}
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200 truncate">{r.name}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">#{r.modId}{r.version ? ` · v${r.version}` : ''}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => setSelected(null)}
                className="self-start flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
              >
                <ChevronLeft className="w-3 h-3" /> {selected.name}
              </button>
              <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{t.linkPickFile || 'Which file do you have installed?'}</p>
              {loadingFiles ? (
                <div className="flex justify-center py-4"><RefreshCw className="w-5 h-5 animate-spin text-orange-500" /></div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {files.map((f) => (
                    <button
                      key={f.file_id}
                      onClick={() => doLink(f.file_id, f.version || null)}
                      disabled={linking}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/60 dark:bg-slate-800/60 hover:border-orange-400/60 hover:bg-orange-50/50 dark:hover:bg-orange-900/15 transition-colors duration-150 text-left"
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200 truncate">{f.name}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{f.version ? `v${f.version}` : ''}{f.uploaded_timestamp ? ` · ${new Date(f.uploaded_timestamp * 1000).toLocaleDateString()}` : ''}</span>
                      </div>
                      <Check className="w-3.5 h-3.5 text-orange-500 shrink-0 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  <button
                    onClick={() => doLink(null, selected.version || null)}
                    disabled={linking}
                    className="mt-1 px-3 py-2 text-[11px] font-bold rounded-full text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
                  >
                    {t.linkSkipFile || 'Not sure — just watch for future updates'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NexusLinkModal;
