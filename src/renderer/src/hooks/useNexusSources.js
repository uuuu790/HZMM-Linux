import { useState, useEffect, useCallback } from 'react';

// filename → Nexus source lookups shared by the link ("claim") and rollback
// features: which local mods already have a Nexus receipt, and which have an
// archived previous version to roll back to.
export function useNexusSources({ modules }) {
  const [linkedSet, setLinkedSet] = useState(() => new Set());
  const [rollbackMap, setRollbackMap] = useState(() => new Map());

  const refreshNexusSources = useCallback(async () => {
    if (!window.api?.nexus?.resolveProfileSources) return;
    try {
      const filenames = (modules || []).map(m => m.filename).filter(Boolean);
      const [sources, versions] = await Promise.all([
        filenames.length ? window.api.nexus.resolveProfileSources(filenames) : Promise.resolve([]),
        window.api.nexus.listModVersions ? window.api.nexus.listModVersions() : Promise.resolve({}),
      ]);
      // matchSourcesToMods returns filenames with `.disabled` stripped — card
      // lookups must strip the same way.
      const linked = new Set((sources || []).map(s => s.filename));
      const byMod = versions || {};
      const rb = new Map();
      for (const s of (sources || [])) {
        const list = byMod[String(s.modId)];
        if (Array.isArray(list) && list.length > 0) {
          rb.set(s.filename, { modId: s.modId, ...list[0] });
        }
      }
      setLinkedSet(linked);
      setRollbackMap(rb);
    } catch { /* keep the last known lookups */ }
  }, [modules]);

  useEffect(() => { refreshNexusSources(); }, [refreshNexusSources]);

  return { linkedSet, rollbackMap, refreshNexusSources };
}
