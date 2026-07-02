import { useState, useCallback } from 'react';
import { normalizeFilename, normalizeProfileFilenames, modIsInProfile } from './profile-utils.js';
import { classifyProfileMods } from './profile-nexus-utils.js';

export function useProfileHandlers({ addToast, showConfirm, closeConfirm, t, modules, persistSetting, refreshMods }) {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [applyingProfileId, setApplyingProfileId] = useState(null);
  const [importModal, setImportModal] = useState(null); // { profileId, missing, auto, manual, premium } | null
  const [importDownloading, setImportDownloading] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { current, total, name }

  const handleCreateProfile = useCallback(async () => {
    if (!newProfileName.trim()) return;
    // Store normalized base filenames so PAK state toggles don't break apply.
    const enabledFilenames = modules.filter(m => m.enabled).map(m => normalizeFilename(m.filename));
    let configSnapshot = null;
    try {
      if (window.api?.mods?.snapshotConfigs) {
        configSnapshot = await window.api.mods.snapshotConfigs();
      }
    } catch { /* ignore */ }
    // Capture each enabled mod's Nexus source now, while the mods are still on
    // disk to reverse-look-up. Lets applying this profile later — even on this
    // same machine after a mod was removed — auto-download what's missing,
    // without needing an export/import round-trip. Best-effort: no key needed
    // (pure local receipt + scan match), empty on failure.
    let nexusSources = [];
    try {
      nexusSources = await window.api?.nexus?.resolveProfileSources?.(enabledFilenames) || [];
    } catch { /* create without sources */ }
    const newProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      enabledModFilenames: enabledFilenames,
      nexusSources,
      configSnapshot,
      createdAt: new Date().toISOString().split('T')[0],
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    setNewProfileName('');
    persistSetting('profiles', updated);
    addToast(t.toastProfileCreated, 'success');
  }, [newProfileName, modules, profiles, t, addToast, persistSetting]);

  const applyProfileNow = useCallback(async (profile) => {
    const profileSet = normalizeProfileFilenames(profile.enabledModFilenames);
    for (const mod of modules) {
      const shouldBeEnabled = modIsInProfile(profileSet, mod);
      if (mod.enabled !== shouldBeEnabled) {
        await window.api.mods.toggle(mod.filename);
      }
    }
    try {
      if (profile.configSnapshot && window.api?.mods?.restoreConfigs) {
        await window.api.mods.restoreConfigs(profile.configSnapshot);
      }
    } catch { /* ignore */ }
    await refreshMods();
    setActiveProfileId(profile.id);
    persistSetting('activeProfileId', profile.id);
    addToast(t.toastProfileApplied, 'success');
  }, [modules, refreshMods, persistSetting, t, addToast]);

  const handleApplyProfile = useCallback(async (profileId) => {
    if (!window.api || applyingProfileId) return;
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    // Detect mods the profile wants that aren't installed here.
    let premium = false;
    try { premium = (await window.api?.nexus?.validate?.())?.ok === true; } catch { /* offline */ }
    const { missing, auto, manual } = classifyProfileMods(profile, modules, premium);

    if (missing.length > 0) {
      // allMissing: none of the profile's mods are present locally, so applying
      // "anyway" would enable zero of them — the modal hides that option then.
      const wantedCount = (profile.enabledModFilenames || []).map(normalizeFilename).filter(Boolean).length;
      const allMissing = missing.length >= wantedCount;
      // Surface the modal; actual apply happens after the user chooses.
      setImportModal({ profileId, missing, auto, manual, premium, allMissing });
      return;
    }
    setApplyingProfileId(profileId);
    try { await applyProfileNow(profile); } finally { setApplyingProfileId(null); }
  }, [applyingProfileId, profiles, modules, applyProfileNow]);

  // Modal actions:
  const importDownloadAndApply = useCallback(async () => {
    const m = importModal;
    if (!m) return;
    const profile = profiles.find(p => p.id === m.profileId);
    if (!profile) { setImportModal(null); return; }
    setImportDownloading(true);
    // Collect mods whose pinned file was gone so we fell back to the latest main
    // file — applied below, then surfaced as a warning so the user knows those
    // versions may differ from what the profile originally captured.
    const drifted = [];
    try {
      let i = 0;
      for (const s of m.auto) {
        i += 1;
        setImportProgress({ current: i, total: m.auto.length, name: s.displayName });
        try {
          const res = await window.api.nexus.installFile(s.modId, s.fileId, s.version || undefined, true);
          if (res?.fellBackToLatest) drifted.push(s.displayName);
        } catch { /* leave it for manual; continue the rest */ }
      }
      await refreshMods();
      await applyProfileNow(profile);
    } finally {
      setImportDownloading(false);
      setImportProgress(null);
      setImportModal(null);
    }
    if (drifted.length > 0) {
      addToast(`${t.toastProfileVersionDrift}${drifted.join(', ')}`, 'warning');
    }
  }, [importModal, profiles, refreshMods, applyProfileNow, addToast, t]);

  const importApplyAnyway = useCallback(async () => {
    const m = importModal;
    setImportModal(null);
    if (!m) return;
    const profile = profiles.find(p => p.id === m.profileId);
    if (profile) await applyProfileNow(profile);
  }, [importModal, profiles, applyProfileNow]);

  // Cancel: close the modal without applying anything (X / backdrop / Escape).
  const closeImportModal = useCallback(() => {
    if (!importDownloading) setImportModal(null);
  }, [importDownloading]);


  const handleDeleteProfile = useCallback((profileId) => {
    showConfirm(t.confirmDeleteProfileTitle, t.confirmDeleteProfileDesc, () => {
      const updated = profiles.filter(p => p.id !== profileId);
      setProfiles(updated);
      persistSetting('profiles', updated);
      if (activeProfileId === profileId) {
        setActiveProfileId(null);
        persistSetting('activeProfileId', null);
      }
      addToast(t.toastProfileDeleted, 'warning');
      closeConfirm();
    }, 'danger');
  }, [profiles, activeProfileId, t, showConfirm, closeConfirm, addToast, persistSetting]);

  const handleExportProfile = useCallback(async (profileId) => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    // Attach where each enabled mod came from on Nexus, so importers can
    // auto-download the missing ones. Best-effort: on failure, export without.
    // Prefer the sources captured at creation time (taken while every mod was
    // present); fall back to a live reverse-lookup for older profiles that
    // predate creation-time capture.
    let nexusSources = Array.isArray(profile.nexusSources) && profile.nexusSources.length
      ? profile.nexusSources
      : [];
    if (!nexusSources.length) {
      try {
        nexusSources = await window.api?.nexus?.resolveProfileSources?.(profile.enabledModFilenames) || [];
      } catch { /* export without sources */ }
    }
    const exported = { ...profile, nexusSources };
    const data = JSON.stringify(exported, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(t.toastProfileExported, 'success');
  }, [profiles, t, addToast]);

  const handleImportProfile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (!imported.name || !imported.enabledModFilenames) {
          addToast(t.toastProfileImportError, 'error');
          return;
        }
        imported.id = Date.now().toString();
        imported.createdAt = new Date().toLocaleDateString();
        const updated = [...profiles, imported];
        setProfiles(updated);
        persistSetting('profiles', updated);
        addToast(t.toastProfileImported, 'success');
      } catch {
        addToast(t.toastProfileImportError, 'error');
      }
    };
    input.click();
  }, [profiles, t, addToast, persistSetting]);

  const initProfiles = useCallback(async () => {
    const saved = await window.api?.settings?.get('profiles', []);
    if (saved) setProfiles(Array.isArray(saved) ? saved : []);
    const activeId = await window.api?.settings?.get('activeProfileId', null);
    if (activeId) setActiveProfileId(activeId);
  }, []);

  return {
    profiles, setProfiles, activeProfileId, setActiveProfileId,
    newProfileName, setNewProfileName, applyingProfileId,
    handleCreateProfile, handleApplyProfile, handleDeleteProfile,
    handleExportProfile, handleImportProfile,
    importModal, importDownloading, importProgress,
    importDownloadAndApply, importApplyAnyway, closeImportModal,
    initProfiles,
  };
}
