import { useRef, useEffect, useState } from 'react';
import { Globe, ChevronDown, Minus, Square, X } from 'lucide-react';
import LiquidGlass from '../common/LiquidGlass';

// Linux has no titleBarOverlay support — the BrowserWindow runs with
// frame: false but Electron can't synthesize OS-style close/min/max
// buttons there. We render custom buttons in the header for those
// platforms; Windows keeps using its native titleBarOverlay buttons.
const NEEDS_CUSTOM_CONTROLS =
  typeof window !== 'undefined' &&
  window.api?.system?.platform &&
  window.api.system.platform !== 'win32';

export default function AppHeader({
  activeTab, t, isDark, lang, supportedLocales,
  langDropdownOpen, setLangDropdownOpen, changeLang,
}) {
  const langDropdownRef = useRef(null);
  // The entry animation is dropped once it finishes. Left in place, its
  // `forwards` fill keeps an opacity animation active on the header, which
  // makes Chromium treat the header as a backdrop root: the glass menu below
  // could then only see (and blur) the header itself, not the page behind.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target)) {
        setLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setLangDropdownOpen]);

  // Keep the header's max width in sync with the main content below it so the
  // right edge (Nexus Mods + language picker) lines up with the rightmost card.
  // Nexus tab is wider (1600px) than the other tabs (max-w-6xl = 1152px), so
  // we animate the max-width for a slide-out/slide-in feel when switching tabs.
  const isWide = activeTab === 'nexus';

  const tabTitle =
    activeTab === 'modules' ? t.modules :
    activeTab === 'dashboard' ? t.dashboard :
    activeTab === 'profiles' ? t.profiles :
    activeTab === 'nexus' ? (t.nexus || 'Nexus') :
    activeTab === 'steamWorkshop' ? t.steamWorkshop :
    t.settings;

  return (
    <header
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) setEntered(true); }}
      className={`w-full flex justify-between items-center mb-6 z-30 relative ${entered ? '' : 'animate-slide-down'} duration-700 select-none [-webkit-app-region:drag] ${isWide ? 'max-w-[1600px]' : 'max-w-6xl'}`}
      // Matches <main>'s springy width transition so the top bar slides out in
      // sync with the content below when switching to/from the Nexus tab.
      style={{ transition: 'max-width 500ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
    >
      <h2 className="text-2xl font-light text-slate-600 dark:text-slate-400 tracking-wide flex items-center gap-3 transition-colors duration-700">
        {/* elementtiming: public/splash.js waits for this to reach the screen,
            i.e. for the interface's first paint, before starting its droplets */}
        <span elementtiming="hzmm-ui" className="text-slate-400 dark:text-slate-500 font-bold">HZMM</span>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="font-bold text-slate-800 dark:text-slate-200">
          {tabTitle}
        </span>
      </h2>

      <div className="flex items-center gap-2 [-webkit-app-region:no-drag]">
        <div className="relative" ref={langDropdownRef}>
          {/* Glass capsule, like a toolbar item floating over the window. */}
          <LiquidGlass
            as="button"
            onClick={() => setLangDropdownOpen(prev => !prev)}
            radius={20} edge={8} strength={14} blur={8}
            className="group relative flex items-center gap-2 px-4 py-2 rounded-full text-slate-600 dark:text-slate-300 font-bold text-sm cursor-pointer transition-[scale] duration-300 hover:scale-105 active:scale-95"
          >
            <Globe className="w-4 h-4 transition-transform duration-500 group-hover:rotate-[30deg]" style={{ color: 'var(--accent-500)' }} />
            <span className="hidden sm:inline">{supportedLocales.find(l => l.code === lang)?.name || lang}</span>
            <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${langDropdownOpen ? 'rotate-180' : ''}`} />
          </LiquidGlass>
          {langDropdownOpen && (
            // Floating glass menu: the cards underneath bend along its rim.
            <LiquidGlass
              radius={22} edge={16} strength={30} blur={10}
              className="lg-menu absolute left-1/2 -translate-x-1/2 top-full mt-2 min-w-[140px] py-1.5 rounded-[22px] z-50 animate-zoom-in"
            >
              {supportedLocales.map((locale, i) => (
                <button
                  key={locale.code}
                  onClick={() => changeLang(locale.code)}
                  style={{ animationDelay: `${i * 40}ms`, ...(locale.code === lang ? { color: isDark ? 'var(--accent-400)' : 'var(--accent-600)' } : {}) }}
                  className={`w-full text-left px-4 py-2 text-sm cursor-pointer flex items-center gap-3 opacity-0 animate-[langItemIn_0.3s_ease_forwards] transition-colors duration-150
                    ${locale.code === lang
                      ? 'font-bold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/[0.06]'}`}
                >
                  {locale.code === lang && (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent-500)' }} />
                  )}
                  <span className={locale.code === lang ? '' : 'ml-[18px]'}>{locale.name}</span>
                </button>
              ))}
            </LiquidGlass>
          )}
        </div>

        {NEEDS_CUSTOM_CONTROLS && (
          <div className="flex items-center gap-0.5 ml-1">
            <button
              onClick={() => window.api?.window?.minimize()}
              className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors duration-200"
              title={t.windowMinimize}
              aria-label={t.windowMinimize}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => window.api?.window?.maximize()}
              className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-colors duration-200"
              title={t.windowMaximize}
              aria-label={t.windowMaximize}
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={() => window.api?.window?.close()}
              className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-rose-500 hover:text-white transition-colors duration-200"
              title={t.close}
              aria-label={t.close}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
