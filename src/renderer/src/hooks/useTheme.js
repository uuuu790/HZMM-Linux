import { useState, useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { getTheme } from '../constants/themes';

export function useTheme({ persistSetting }) {
  // Default to dark on first launch — matches the look of the Windows build
  // (which is what most existing HZMM screenshots show) and the Linux gaming
  // audience's overwhelmingly dark-themed desktops (Steam Deck, etc.).
  // Users can still toggle from Settings; the choice persists via IPC.
  const [isDark, setIsDark] = useState(true);
  const [themeId, setThemeId] = useState('ember');
  const activeTransitionRef = useRef(null);

  const toggleDark = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      persistSetting('darkMode', next);
      window.api?.system?.setTitleBarTheme(next);
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  }, [persistSetting]);

  const changeTheme = useCallback((id, e) => {
    if (id === themeId) return;
    if (activeTransitionRef.current) {
      activeTransitionRef.current.skipTransition();
      activeTransitionRef.current = null;
    }
    if (e && document.startViewTransition) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const maxDist = Math.max(
        Math.hypot(x, y),
        Math.hypot(window.innerWidth - x, y),
        Math.hypot(x, window.innerHeight - y),
        Math.hypot(window.innerWidth - x, window.innerHeight - y)
      );
      const duration = 1000;
      const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

      const transition = document.startViewTransition(() => {
        flushSync(() => { setThemeId(id); });
        persistSetting('themeId', id);
      });
      activeTransitionRef.current = transition;
      transition.finished.then(() => { activeTransitionRef.current = null; });
      transition.ready.then(() => {
        document.documentElement.animate([
          { clipPath: `circle(0px at ${x}px ${y}px)` },
          { clipPath: `circle(${maxDist}px at ${x}px ${y}px)` },
        ], { duration, easing, pseudoElement: '::view-transition-new(root)' });
        document.documentElement.animate([
          { filter: 'brightness(1)', opacity: 1 },
          { filter: 'brightness(0.96)', opacity: 0.98 },
        ], { duration, easing, pseudoElement: '::view-transition-old(root)' });
      });
    } else {
      setThemeId(id);
      persistSetting('themeId', id);
    }
  }, [themeId, persistSetting]);

  useEffect(() => {
    const theme = getTheme(themeId);
    const root = document.documentElement;
    Object.entries(theme.accent).forEach(([key, val]) => {
      root.style.setProperty(`--accent-${key}`, val);
    });
    root.style.setProperty('--gradient-from', theme.gradient.from);
    root.style.setProperty('--gradient-to', theme.gradient.to);
    root.style.setProperty('--icon-hue-rotate', theme.iconHueRotate || '0deg');
    theme.orbs.light.forEach((c, i) => root.style.setProperty(`--orb-light-${i + 1}`, c));
    theme.orbs.dark.forEach((c, i) => root.style.setProperty(`--orb-dark-${i + 1}`, c));
  }, [themeId]);

  return { isDark, setIsDark, themeId, setThemeId, toggleDark, changeTheme };
}
