import { useEffect, useState } from 'react';

/**
 * The always-visible "Remote session active" overlay. Rendered in its own
 * frameless window. It stays visible to the local user even in stealth mode
 * (stealth only excludes it from screen CAPTURE, never from the local display).
 */
export function Indicator(): JSX.Element {
  const [info, setInfo] = useState<{ controllerName: string; unattended: boolean }>({
    controllerName: '',
    unattended: false,
  });

  useEffect(() => {
    return window.rdIndicator.onUpdate((next) => setInfo(next));
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
      </div>
    </div>
  );
}
