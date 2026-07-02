import { useState, useCallback } from 'react';

export function useUpdateHandlers() {
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState('idle');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(null);

  const handleCheckUpdate = useCallback(async () => {
    if (!window.api) return;
    setUpdateState('checking');
    try {
      const result = await window.api.appUpdate.check();
      if (result.hasUpdate) { setUpdateInfo(result); setUpdateState('available'); }
      else { setUpdateState('latest'); }
    } catch { setUpdateState('idle'); }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    if (!window.api) return;
    setUpdateState('downloading');
    setUpdateProgress(0);
    const unsub = window.api.appUpdate.onProgress((p) => setUpdateProgress(p));
    try {
      await window.api.appUpdate.download(updateInfo?.downloadUrl, updateInfo?.expectedHash);
      setUpdateState('ready');
    } catch {
      setUpdateState('available');
    } finally {
      unsub();
    }
  }, [updateInfo]);

  const handleInstallUpdate = useCallback(async () => {
    if (!window.api) return;
    setUpdateError(null);
    setIsUpdating(true);
    // On success the main process quits the app. If spawning the updater fails
    // (e.g. AV blocks cmd.exe) it won't quit — listen so the UI doesn't hang on
    // "installing" forever and the user can retry.
    const unsub = window.api.appUpdate.onInstallFailed((message) => {
      setIsUpdating(false);
      setUpdateState('ready');
      setUpdateError(message || 'Update install failed');
      unsub();
    });
    try {
      await window.api.appUpdate.install();
    } catch (err) {
      setIsUpdating(false);
      setUpdateState('ready');
      setUpdateError(err?.message || 'Update install failed');
      unsub();
    }
  }, []);

  const initVersion = useCallback(async () => {
    try { const ver = await window.api.appUpdate.getVersion(); setAppVersion(ver); } catch { /* ignore */ }
  }, []);

  return {
    appVersion, updateState, updateInfo, updateProgress, isUpdating, updateError,
    handleCheckUpdate, handleDownloadUpdate, handleInstallUpdate,
    initVersion,
  };
}
