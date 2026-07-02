import { useState, useEffect, useCallback, useMemo } from 'react';

// Checks installed Nexus mods for newer versions via the keyless V2 API. The
// main process throttles the actual network hit (6h cache), so the startup
// call is cheap on a warm cache. We map the verdict list to a
// filename -> updateInfo lookup the mod cards consume, mirroring conflictModSet.
export function useUpdateChecker({ nexusApiKey, addToast, t, refreshMods }) {
  const [results, setResults] = useState([]);
  const [checking, setChecking] = useState(false);
  const [updatingModId, setUpdatingModId] = useState(null);

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

  const runCheck = useCallback(async (force = false) => {
    if (!window.api?.nexus) return;
    setChecking(true);
    try {
      const payload = force
        ? await window.api.nexus.checkUpdatesForce()
        : await window.api.nexus.checkUpdates();
      setResults(Array.isArray(payload?.results) ? payload.results : []);
    } catch {
      /* offline / API down — keep the last results and stay quiet */
    } finally {
      setChecking(false);
    }
  }, []);

  // Startup check (throttled in main, so a no-op past the 6h window).
  useEffect(() => { runCheck(false); }, [runCheck]);

  const handleUpdateMod = useCallback(async (info) => {
    if (!info) return;
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
      await window.api.nexus.installFile(info.modId, info.latestFileId, info.latestVersion || undefined);
      addToast(t.updateModSuccess || 'Mod updated', 'success');
      await refreshMods();
      await runCheck(true); // re-check so the badge clears
    } catch (e) {
      addToast(`${t.updateModFailed || 'Update failed'}: ${e?.message || ''}`, 'error');
    } finally {
      setUpdatingModId(null);
    }
  }, [nexusApiKey, addToast, t, refreshMods, runCheck]);

  return { updateMap, updateCount, checking, updatingModId, runCheck, handleUpdateMod };
}
