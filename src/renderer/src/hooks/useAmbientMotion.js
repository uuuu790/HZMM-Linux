import { useEffect } from 'react';

// Pauses the decorative infinite loops (background orbs, logo breath, launch
// glow) whenever nobody is watching: window unfocused or hidden, no input for
// IDLE_MS, or reduced motion requested. While any of them runs, Chromium keeps
// producing frames and every frame re-blurs all the backdrop-filter glass on
// screen — close to a full CPU core. Resuming continues from the paused frame,
// so there is no visible jump.
//
// Elements opt in via the CSS selectors under `.ambient-paused` in
// appStyles.js (orb-float-*, logo-breath, ambient-loop).
const IDLE_MS = 8000;

export function useAmbientMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let lastActivity = Date.now();
    let timer = null;

    const isAway = () => document.hidden || !document.hasFocus() || !!reduceMotion?.matches;

    // Recompute the paused state. While running, a single timer is armed for
    // the moment the idle window would elapse; while paused, none is armed.
    const check = () => {
      clearTimeout(timer);
      timer = null;
      const idleFor = Date.now() - lastActivity;
      const paused = isAway() || idleFor >= IDLE_MS;
      root.classList.toggle('ambient-paused', paused);
      if (!paused) timer = setTimeout(check, IDLE_MS - idleFor);
    };

    // Hot path (pointermove fires constantly): just stamp the time, and only
    // do real work when waking up from the paused state.
    const onActivity = () => {
      lastActivity = Date.now();
      if (!timer) check();
    };
    const onAttention = () => { lastActivity = Date.now(); check(); };

    const activityEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
    activityEvents.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener('focus', onAttention);
    window.addEventListener('blur', check);
    document.addEventListener('visibilitychange', onAttention);
    reduceMotion?.addEventListener?.('change', check);
    check();

    return () => {
      clearTimeout(timer);
      activityEvents.forEach(ev => window.removeEventListener(ev, onActivity));
      window.removeEventListener('focus', onAttention);
      window.removeEventListener('blur', check);
      document.removeEventListener('visibilitychange', onAttention);
      reduceMotion?.removeEventListener?.('change', check);
      root.classList.remove('ambient-paused');
    };
  }, []);
}
