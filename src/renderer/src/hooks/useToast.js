import { useState, useCallback, useRef, useEffect } from 'react';

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  // Track each toast's auto-dismiss timer so manual dismissal clears the
  // pending timer and unmount can flush all of them — no orphaned timers,
  // no setState-after-unmount.
  const timersRef = useRef(new Map());

  const addToast = useCallback((message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
    timersRef.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Flush any pending auto-dismiss timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return { toasts, addToast, dismissToast };
}
