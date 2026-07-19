import { useState, useEffect, useCallback } from 'react';

// nxm:// handler wiring: the Settings toggle state plus toasts for installs
// that arrive from the browser ("Mod Manager Download" button). The install
// itself runs entirely in the main process — this hook only reflects it.
export function useNxm({ addToast, t, refreshMods }) {
  const [nxmEnabled, setNxmEnabled] = useState(false);

  useEffect(() => {
    if (!window.api?.nxm) return;
    window.api.nxm.getStatus().then(s => setNxmEnabled(!!s?.enabled)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!window.api?.nxm) return;
    const off = window.api.nxm.onEvent(async (ev) => {
      if (ev.type === 'started') {
        addToast(t.nxmInstallStarted || 'Installing from Nexus link…', 'info');
      } else if (ev.type === 'done') {
        addToast(t.nxmInstallDone || 'Mod installed from Nexus link', 'success');
        try { await refreshMods(); } catch { /* list refresh is best-effort */ }
      } else if (ev.type === 'failed') {
        const msg = ev.error === 'NEXUS_API_KEY_REQUIRED'
          ? (t.nxmNeedApiKey || 'Set your Nexus API key in Settings first')
          : (ev.error || '');
        addToast(`${t.nxmInstallFailed || 'Nexus link install failed'}: ${msg}`, 'error');
      } else if (ev.type === 'wrong-game') {
        addToast(t.nxmWrongGame || 'That Nexus link is for a different game', 'warning');
      }
    });
    return off;
  }, [addToast, t, refreshMods]);

  const handleSetNxmEnabled = useCallback(async (enabled) => {
    if (!window.api?.nxm) return;
    try {
      const s = await window.api.nxm.setEnabled(enabled);
      setNxmEnabled(!!s?.enabled);
      if (enabled && s?.error) {
        addToast(t.nxmRegisterFailed || 'Could not register the nxm:// handler', 'error');
      }
    } catch {
      addToast(t.nxmRegisterFailed || 'Could not register the nxm:// handler', 'error');
    }
  }, [addToast, t]);

  return { nxmEnabled, handleSetNxmEnabled };
}
