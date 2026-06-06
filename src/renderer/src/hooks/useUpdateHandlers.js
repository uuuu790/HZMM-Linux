import { useState, useCallback } from 'react';

export function useUpdateHandlers({ addToast: _addToast, t: _t }) {
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState('idle');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);

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
    } catch { setUpdateState('available'); }
    unsub();
  }, [updateInfo]);

  const handleInstallUpdate = useCallback(async () => {
    if (!window.api) return;
    setIsUpdating(true);
    await window.api.appUpdate.install();
  }, []);

  const initVersion = useCallback(async () => {
    try { const ver = await window.api.appUpdate.getVersion(); setAppVersion(ver); } catch { /* ignore */ }
  }, []);

  return {
    appVersion, updateState, updateInfo, updateProgress, isUpdating,
    handleCheckUpdate, handleDownloadUpdate, handleInstallUpdate,
    initVersion,
  };
}
