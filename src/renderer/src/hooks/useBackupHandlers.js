import { useState, useCallback } from 'react';

export function useBackupHandlers({ addToast, showConfirm, t }) {
  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [worldSelectOpen, setWorldSelectOpen] = useState(false);
  const [worldSelectLoading, setWorldSelectLoading] = useState(false);
  const [availableWorlds, setAvailableWorlds] = useState([]);

  const handleBackup = useCallback(async () => {
    if (!window.api?.saves) return;
    setWorldSelectLoading(true);
    setWorldSelectOpen(true);
    try {
      const worlds = await window.api.saves.listWorlds();
      setAvailableWorlds(worlds);
    } catch (err) {
      console.error('List worlds failed:', err);
      setAvailableWorlds([]);
    } finally {
      setWorldSelectLoading(false);
    }
  }, []);

  const handleConfirmBackup = useCallback(async (worldNames) => {
    setWorldSelectOpen(false);
    if (!window.api?.saves || !worldNames.length) return;
    setBackupLoading(true);
    try {
      await window.api.saves.backup(worldNames);
      addToast(t.toastBackupSuccess, 'success');
      const list = await window.api.saves.listBackups();
      setBackups(list);
    } catch (err) {
      console.error('Backup failed:', err);
      addToast(t.toastBackupFailed || err.message, 'error');
    } finally {
      setBackupLoading(false);
    }
  }, [t, addToast]);

  const handleListBackups = useCallback(async () => {
    if (!window.api?.saves) return;
    const list = await window.api.saves.listBackups();
    setBackups(list);
  }, []);

  const handleRestoreBackup = useCallback((backupPath) => {
    showConfirm(t.confirmRestoreTitle, t.confirmRestoreDesc, async () => {
      try {
        await window.api.saves.restoreBackup(backupPath);
        addToast(t.toastRestoreSuccess, 'success');
        const list = await window.api.saves.listBackups();
        setBackups(list);
      } catch (err) {
        console.error('Restore failed:', err);
        addToast(err.message || 'Restore failed', 'error');
      }
    });
  }, [t, showConfirm, addToast]);

  const handleDeleteBackup = useCallback((backupPath) => {
    showConfirm(t.confirmDeleteBackupTitle || t.confirmTitle, t.confirmDeleteBackupDesc || t.confirmUninstallDesc, async () => {
      try {
        await window.api.saves.deleteBackup(backupPath);
        const list = await window.api.saves.listBackups();
        setBackups(list);
        addToast(t.toastBackupDeleted || t.toastUninstalled, 'success');
      } catch (err) {
        console.error('Delete backup failed:', err);
      }
    });
  }, [t, showConfirm, addToast]);

  const initBackups = useCallback(async () => {
    if (window.api?.saves?.listBackups) {
      const list = await window.api.saves.listBackups();
      setBackups(list);
    }
  }, []);

  return {
    backups, backupLoading,
    worldSelectOpen, setWorldSelectOpen,
    worldSelectLoading, availableWorlds,
    handleBackup, handleConfirmBackup, handleListBackups,
    handleRestoreBackup, handleDeleteBackup,
    initBackups,
  };
}
