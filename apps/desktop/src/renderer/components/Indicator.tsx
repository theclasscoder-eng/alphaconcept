import { useEffect, useState } from 'react';

/**
 * The always-visible "Remote session active" overlay. Rendered in its own
 * frameless window. It stays visible to the local user even in stealth mode
 * (stealth only excludes it from screen CAPTURE, never from the local display).
 *
 * The user can hide this overlay from Settings; the tray icon then remains the
 * persistent indicator. When shown, it displays the host's emergency-stop
 * shortcut so anyone at the machine knows how to end the session immediately.
 */
export function Indicator(): JSX.Element {
  const [info, setInfo] = useState<{ controllerName: string; unattended: boolean }>({
    controllerName: '',
    unattended: false,
  });
  const [shortcut, setShortcut] = useState('Ctrl+Alt+F12');

  useEffect(() => {
    const off = window.rdIndicator.onUpdate((next) => setInfo(next));
    // Same preload is loaded in the indicator window, so the bridge is available.
    void window.remoteDesktop?.session.emergencyShortcut().then(setShortcut).catch(() => undefined);
    return off;
  }, []);

  return (
    <div className="indicator">
      <span className="pulse" />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>Remote session active</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {info.controllerName || 'Controller connected'}
          {info.unattended ? ' · unattended' : ''}
        </div>
        <div style={{ fontSize: 11, marginTop: 2, color: 'var(--amber)' }}>
          Press {shortcut} to end
        </div>
      </div>
    </div>
  );
}
