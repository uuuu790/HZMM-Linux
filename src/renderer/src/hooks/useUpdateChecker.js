import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// Checks installed Nexus mods for newer versions via the keyless V2 API. The
// main process throttles the actual network hit (6h cache), so the startup
// call is cheap on a warm cache. We map the verdict list to a
// filename -> updateInfo lookup the mod cards consume, mirroring conflictModSet.
export function useUpdateChecker({ nexusApiKey, addToast, t, refreshMods }) {
  const [results, setResults] = useState([]);
  const [checking, setChecking] = useState(false);
  const [updatingModId, setUpdatingModId] = useState(null);
  const [updateAllBusy, setUpdateAllBusy] = useState(false);

  // filename -> { modId, latestFileId, latestVersion, currentVersion, ... }
  const updateMap = useMemo(() => {
    const m = new Map();
    for (const r of results) {
      if (!r.outdated) continue;
      for (const fn of r.affectedFilenames || []) m.set(fn, r);
    }
    return m;
  }, [results]);

  // Distinct outdated mods — drives the Sidebar count badge.
  const updateCount = useMemo(() => results.filter(r => r.outdated).length, [results]);

  // One system notification per session, and only when a FRESH network check
  // (not the 6h cache replay) found updates — otherwise every app start would
  // re-announce the same stale verdict.
  const notifiedRef = useRef(false);

  const runCheck = useCallback(async (force = false) => {
    if (!window.api?.nexus) return;
    setChecking(true);
    try {
      const payload = force
        ? await window.api.nexus.checkUpdatesForce()
        : await window.api.nexus.checkUpdates();
      const list = Array.isArray(payload?.results) ? payload.results : [];
      setResults(list);
      const outdated = list.filter(r => r.outdated).length;
      const fresh = payload?.checkedAt && Date.now() - payload.checkedAt < 120000;
      if (!force && fresh && outdated > 0 && !notifiedRef.current) {
        notifiedRef.current = true;
        try {
          new Notification(t.updatesAvailable || 'Updates available', {
            body: (t.updateNotifyBody || '{n} mod update(s) available').replace('{n}', String(outdated)),
            silent: true,
          });
        } catch { /* notifications unavailable on this system — skip */ }
      }
    } catch {
      /* offline / API down — keep the last results and stay quiet */
    } finally {
      setChecking(false);
    }
  }, [t]);

  // Startup check (throttled in main, so a no-op past the 6h window).
  useEffect(() => { runCheck(false); }, [runCheck]);

  const handleUpdateMod = useCallback(async (info) => {
    if (!info || updateAllBusy) return;
    // No API key → can't resolve the Premium download_link; send the user to
    // the Nexus page to grab it manually. window.open is intercepted by the
    // main setWindowOpenHandler and opened in the external browser.
    if (!nexusApiKey) {
      window.open(`https://www.nexusmods.com/humanitz/mods/${info.modId}`);
      return;
    }
    if (!window.api?.nexus) return;
    setUpdatingModId(info.modId);
    try {
      // update-file (not install-file): the main process snapshots the mod's
      // enabled-state + edited configs and re-applies them after the reinstall.
      await window.api.nexus.updateFile(info.modId, info.latestFileId, info.latestVersion || undefined);
      addToast(t.updateModSuccess || 'Mod updated', 'success');
      await refreshMods();
      await runCheck(true); // re-check so the badge clears
    } catch (e) {
      addToast(`${t.updateModFailed || 'Update failed'}: ${e?.message || ''}`, 'error');
    } finally {
      setUpdatingModId(null);
    }
  }, [nexusApiKey, updateAllBusy, addToast, t, refreshMods, runCheck]);

  // Serial "update all": one at a time so download progress events stay
  // readable and the Nexus API isn't hammered. Per-mod failures are counted,
  // not fatal — the summary toast reports both.
  const handleUpdateAll = useCallback(async () => {
    if (updateAllBusy || !nexusApiKey || !window.api?.nexus) return;
    const targets = results.filter(r => r.outdated && r.latestFileId);
    if (targets.length === 0) return;
    setUpdateAllBusy(true);
    let ok = 0, failed = 0;
    try {
      for (const info of targets) {
        setUpdatingModId(info.modId);
        try {
          await window.api.nexus.updateFile(info.modId, info.latestFileId, info.latestVersion || undefined);
          ok++;
        } catch {
          failed++;
        }
      }
    } finally {
      setUpdatingModId(null);
      setUpdateAllBusy(false);
    }
    addToast(
      `${t.updateAllDone || 'Updates finished'}: ${ok} ✓${failed > 0 ? ` / ${failed} ✕` : ''}`,
      failed > 0 ? 'warning' : 'success'
    );
    try { await refreshMods(); } catch { /* list refresh is best-effort */ }
    await runCheck(true); // re-check so the badges clear
  }, [updateAllBusy, nexusApiKey, results, addToast, t, refreshMods, runCheck]);

  return { updateMap, updateCount, checking, updatingModId, updateAllBusy, runCheck, handleUpdateMod, handleUpdateAll };
}
