import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { rd } from '../api.js';

/**
 * Host-facing card explaining the UIPI limitation: a non-elevated app cannot
 * inject input into windows running "as Administrator", so the remote mouse
 * appears frozen over those programs. Offers a one-click relaunch-as-admin, or a
 * "don't show again" flag so the user can proceed without elevating.
 */
export function ElevationCard(): JSX.Element | null {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void rd.system.isElevated().then(setElevated);
  }, []);

  if (elevated === null) return null;

  if (elevated) {
    return (
      <div className="card">
        <div className="row">
          <div>
            <strong>
              <span className="dot on" />
              Running as administrator
            </strong>
            <div className="muted">
              Remote input works in all normal apps, including ones opened “as administrator”.
            </div>
          </div>
          <span className="badge green">Full control</span>
        </div>
      </div>
    );
  }

  // Not elevated. Respect the "hide" flag.
  if (settings?.hideAdminWarning) return null;

  const restart = async () => {
    setBusy(true);
    setNote(null);
    const result = await rd.system.relaunchElevated();
    setBusy(false);
    if (result === 'cancelled') setNote('Elevation was cancelled — nothing changed.');
    else if (result === 'unsupported') setNote('Not supported on this platform.');
    // On 'relaunching' the app exits; nothing more to do here.
  };

  return (
    <div className="card" style={{ borderColor: 'var(--amber)' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <strong style={{ color: 'var(--amber)' }}>
            ⚠ Some programs won’t accept the remote mouse
          </strong>
          <div className="muted" style={{ marginTop: 6 }}>
            Windows blocks remote input to any window running <b>as administrator</b> (Task Manager,
            installers, some work tools) unless this app is elevated too. The remote mouse looks
            frozen over those windows even though it moves everywhere else. Restart as administrator
            to control them.
          </div>
          {note && (
            <div className="muted" style={{ marginTop: 8, color: 'var(--text)' }}>
              {note}
            </div>
          )}
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Even as administrator, the Windows UAC prompt and the lock/login screen still can’t be
            controlled — those are separate secure desktops (by design, not bypassed).
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="ghost"
          onClick={() => updateSettings({ hideAdminWarning: true })}
          title="Hide this message and keep using the app without elevating"
        >
          Don’t show again
        </button>
        <button className="primary" onClick={restart} disabled={busy}>
          {busy ? 'Waiting for UAC…' : 'Restart as administrator'}
        </button>
      </div>
    </div>
  );
}
