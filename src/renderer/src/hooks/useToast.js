import { useState, useCallback, useRef, useEffect } from 'react';

export const TOAST_DURATION_MS = 3000;
// For errors the user has to read and act on (e.g. why a save was refused).
export const TOAST_LONG_DURATION_MS = 12000;

function clearTimer(timers, id) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function forgetTag(tags, id) {
  for (const [tag, tagId] of tags) if (tagId === id) tags.delete(tag);
}

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  // Track each toast's auto-dismiss timer so manual dismissal clears the
  // pending timer and unmount can flush all of them — no orphaned timers,
  // no setState-after-unmount.
  const timersRef = useRef(new Map());
  // tag → id of the toast currently showing for that tag.
  const tagsRef = useRef(new Map());

  // options.duration: ms until auto-dismiss (default 3 s); 0 / Infinity keeps
  // the toast until the user dismisses it.
  // options.tag: a new toast replaces the one still showing with the same tag
  // (e.g. a successful save replaces the error from the attempt before it).
  // Without options every toast behaves as before: 3 s, never replaced.
  const addToast = useCallback((message, type = 'success', options = {}) => {
    const id = ++toastIdRef.current;
    const tag = options?.tag ?? null;
    const replaced = tag !== null ? tagsRef.current.get(tag) : undefined;
    if (replaced !== undefined) clearTimer(timersRef.current, replaced);
    if (tag !== null) tagsRef.current.set(tag, id);
    setToasts(prev => [...(replaced !== undefined ? prev.filter(t => t.id !== replaced) : prev), { id, message, type }]);
    const duration = options?.duration ?? TOAST_DURATION_MS;
    if (!(duration > 0 && Number.isFinite(duration))) return;
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      forgetTag(tagsRef.current, id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
    timersRef.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id) => {
    clearTimer(timersRef.current, id);
    forgetTag(tagsRef.current, id);
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
