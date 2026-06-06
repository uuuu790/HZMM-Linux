import { useState, useCallback } from 'react';

export function useConfirmModal() {
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false, title: '', description: '', onConfirm: null, variant: 'danger',
  });

  const showConfirm = useCallback((title, description, onConfirm, variant = 'danger') => {
    setConfirmModal({ isOpen: true, title, description, onConfirm, variant });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmModal({ isOpen: false, title: '', description: '', onConfirm: null, variant: 'danger' });
  }, []);

  return { confirmModal, showConfirm, closeConfirm };
}
