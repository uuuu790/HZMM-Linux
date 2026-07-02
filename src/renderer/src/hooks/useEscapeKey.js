import { useEffect } from 'react';

// Close a modal on Escape. Pass the modal's close handler and an `active`
// flag (defaults to true). The listener is only attached while active, and
// always cleans up — so modals controlled by an `isOpen` prop won't leak
// listeners, and parent-conditionally-rendered modals (mounted === open)
// can simply omit the flag.
//
// Guards against IME composition: pressing Escape to cancel a CJK candidate
// window fires keydown with `isComposing`/keyCode 229, which should not close
// the modal.
export function useEscapeKey(onEscape, active = true) {
  useEffect(() => {
    if (!active || typeof onEscape !== 'function') return;

    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (e.isComposing || e.keyCode === 229) return;
      onEscape();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, active]);
}

export default useEscapeKey;
