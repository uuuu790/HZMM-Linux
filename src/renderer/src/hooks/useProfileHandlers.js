import { useState, useCallback } from 'react';
import { normalizeFilename, normalizeProfileFilenames, modIsInProfile } from './profile-utils.js';

export function useProfileHandlers({ addToast, showConfirm, closeConfirm, t, modules, persistSetting, refreshMods }) {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [applyingProfileId, setApplyingProfileId] = useState(null);

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
    const newProfile = {
      id: `profile-${Date.now()}`,
      name: newProfileName.trim(),
      enabledModFilenames: enabledFilenames,
      configSnapshot,
      createdAt: new Date().toISOString().split('T')[0],
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    setNewProfileName('');
    persistSetting('profiles', updated);
    addToast(t.toastProfileCreated, 'success');
  }, [newProfileName, modules, profiles, t, addToast, persistSetting]);

  const handleApplyProfile = useCallback(async (profileId) => {
    if (!window.api || applyingProfileId) return;
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    setApplyingProfileId(profileId);
    try {
      // Normalize both sides so PAK filenames with/without .disabled match.
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
      setActiveProfileId(profileId);
      persistSetting('activeProfileId', profileId);
      addToast(t.toastProfileApplied, 'success');
    } finally { setApplyingProfileId(null); }
  }, [applyingProfileId, profiles, modules, t, addToast, persistSetting, refreshMods]);

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

  const handleExportProfile = useCallback((profileId) => {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const data = JSON.stringify(profile, null, 2);
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
    initProfiles,
  };
}
